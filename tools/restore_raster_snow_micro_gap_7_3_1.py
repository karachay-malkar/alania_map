#!/usr/bin/env python3
from __future__ import annotations

import io
import json
import sqlite3
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage
from affine import Affine
from rasterio.features import shapes, rasterize
from rasterio.warp import reproject, Resampling
from shapely.geometry import shape, mapping
from shapely.ops import transform as shp_transform
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[1]
BASE_COMMIT = 'd02e26a09e1f87ba24d46d50ae175f7c1db5659a'
BASE_RAW = f'https://raw.githubusercontent.com/karachay-malkar/alania_map/{BASE_COMMIT}/'
BASE_FILES = [
    'assets/map-ui.js', 'assets/map-page.js',
    'assets/map-data.part-000.js', 'assets/map-data.part-001.js',
    'index.html', 'README.md',
    'tests/runtime-contract.mjs', 'tests/map-smoke.mjs',
]
PARTS = [ROOT / 'assets/map-data.part-000.js', ROOT / 'assets/map-data.part-001.js']
MARKER = 'window.ALAN_MAP_DATA = '
HALF = 20037508.342789244
WORLD = HALF * 2
DETAIL_Z = 12
REF_Z = 11
THRESHOLD = 96
MAX_DISTANCE_PX = 2.25
MAX_COMPONENT_PX = 64
MAX_PATCH_RATIO = 0.035
MINZOOM = 10.75
DATA_VERSION = '7.3.1-snow-raster-micro-gap-z12.1'
TO_3857 = Transformer.from_crs('EPSG:4326', 'EPSG:3857', always_xy=True).transform
TO_4326 = Transformer.from_crs('EPSG:3857', 'EPSG:4326', always_xy=True).transform


def restore_baseline() -> None:
    for rel in BASE_FILES:
        target = ROOT / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(BASE_RAW + rel, timeout=60) as response:
            target.write_bytes(response.read())


def read_data() -> dict:
    source = ''.join(path.read_text(encoding='utf-8') for path in PARTS)
    payload = source[source.index(MARKER) + len(MARKER):].strip()
    if payload.endswith(';'):
        payload = payload[:-1]
    return json.loads(payload)


def write_data(data: dict) -> None:
    payload = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
    midpoint = len(payload) // 2
    left = payload.rfind('},"', 0, midpoint)
    right = payload.find('},"', midpoint)
    candidates = [position + 1 for position in (left, right) if position >= 0]
    cut = min(candidates, key=lambda position: abs(position - midpoint)) if candidates else midpoint
    PARTS[0].write_text('\n' + MARKER + payload[:cut], encoding='utf-8')
    PARTS[1].write_text(payload[cut:] + ';\n', encoding='utf-8')


def xyz_y(z: int, tms_y: int) -> int:
    return (1 << z) - 1 - int(tms_y)


def load_mosaic(path: Path, zoom: int) -> tuple[np.ndarray, Affine]:
    connection = sqlite3.connect(path)
    rows = list(connection.execute(
        'select tile_column,tile_row,tile_data from tiles where zoom_level=? order by tile_column,tile_row',
        (zoom,),
    ))
    connection.close()
    if not rows:
        raise RuntimeError(f'No z{zoom} tiles in {path}')
    xs = [int(row[0]) for row in rows]
    ys = [xyz_y(zoom, row[1]) for row in rows]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    mosaic = np.zeros(((max_y - min_y + 1) * 256, (max_x - min_x + 1) * 256), dtype=np.uint8)
    for tile_x, tile_row, tile_data in rows:
        tile_y = xyz_y(zoom, tile_row)
        alpha = np.asarray(Image.open(io.BytesIO(tile_data)).convert('RGBA'), dtype=np.uint8)[:, :, 3]
        row0 = (tile_y - min_y) * 256
        col0 = (int(tile_x) - min_x) * 256
        mosaic[row0:row0 + 256, col0:col0 + 256] = alpha
    tile_span = WORLD / (1 << zoom)
    pixel_size = tile_span / 256
    west = -HALF + min_x * tile_span
    north = HALF - min_y * tile_span
    return mosaic, Affine(pixel_size, 0, west, 0, -pixel_size, north)


def frame_geometry_3857(data: dict):
    features = (data.get('mapFrame') or {}).get('features') or []
    if not features:
        raise RuntimeError('mapFrame geometry missing')
    return shp_transform(TO_3857, shape(features[0]['geometry'])).buffer(0)


def frame_mask(data: dict, out_shape: tuple[int, int], transform: Affine) -> np.ndarray:
    return rasterize(
        [(mapping(frame_geometry_3857(data)), 1)],
        out_shape=out_shape, transform=transform, fill=0, dtype='uint8', all_touched=False,
    ).astype(bool)


def align_reference(reference: np.ndarray, reference_transform: Affine, detail_shape, detail_transform: Affine) -> np.ndarray:
    destination = np.zeros(detail_shape, dtype=np.uint8)
    reproject(
        reference, destination,
        src_transform=reference_transform, src_crs='EPSG:3857',
        dst_transform=detail_transform, dst_crs='EPSG:3857',
        resampling=Resampling.nearest, src_nodata=0, dst_nodata=0,
    )
    return destination


def filter_components(mask: np.ndarray, core_count: int) -> tuple[np.ndarray, list[int]]:
    labels, count = ndimage.label(mask, structure=np.ones((3, 3), dtype=np.uint8))
    if not count:
        return np.zeros_like(mask, dtype=bool), []
    sizes = np.bincount(labels.ravel())
    components = [(index, int(sizes[index])) for index in range(1, len(sizes)) if 1 <= sizes[index] <= MAX_COMPONENT_PX]
    components.sort(key=lambda item: (item[1], item[0]))
    cap = max(1, int(core_count * MAX_PATCH_RATIO))
    keep: list[int] = []
    total = 0
    for index, size in components:
        if total + size > cap:
            break
        keep.append(index)
        total += size
    if not keep:
        return np.zeros_like(mask, dtype=bool), []
    return np.isin(labels, np.asarray(keep)), [int(sizes[index]) for index in keep]


def round_coordinates(value, digits: int = 6):
    if isinstance(value, (list, tuple)):
        return [round_coordinates(item, digits) for item in value]
    if isinstance(value, float):
        return round(value, digits)
    return value


def build_patch(data: dict, mbtiles: Path, kind: str) -> tuple[dict, dict]:
    detail, detail_transform = load_mosaic(mbtiles, DETAIL_Z)
    reference, reference_transform = load_mosaic(mbtiles, REF_Z)
    clip_mask = frame_mask(data, detail.shape, detail_transform)
    core = (detail >= THRESHOLD) & clip_mask
    parent = (align_reference(reference, reference_transform, detail.shape, detail_transform) >= THRESHOLD) & clip_mask

    distance = ndimage.distance_transform_edt(~core)
    neighbours = ndimage.convolve(core.astype(np.uint8), np.ones((3, 3), dtype=np.uint8), mode='constant', cval=0) - core.astype(np.uint8)
    parent_missing = parent & ~core
    narrow = parent_missing & (distance <= MAX_DISTANCE_PX) & (neighbours >= 2)

    enclosed = ndimage.binary_fill_holes(core) & ~core & clip_mask
    hole_labels, hole_count = ndimage.label(enclosed, structure=np.ones((3, 3), dtype=np.uint8))
    small_holes = np.zeros_like(core, dtype=bool)
    if hole_count:
        hole_sizes = np.bincount(hole_labels.ravel())
        hole_ids = [index for index in range(1, len(hole_sizes)) if hole_sizes[index] <= MAX_COMPONENT_PX]
        if hole_ids:
            small_holes = np.isin(hole_labels, np.asarray(hole_ids))

    raw = (narrow | small_holes) & ~core & clip_mask
    final, component_sizes = filter_components(raw, int(core.sum()))

    features = []
    for geometry_mapping, value in shapes(final.astype(np.uint8), mask=final, transform=detail_transform):
        if int(value) != 1:
            continue
        geometry = shape(geometry_mapping)
        if geometry.is_empty:
            continue
        geographic = shp_transform(TO_4326, geometry)
        features.append({
            'type': 'Feature',
            'properties': {
                'snow_kind': kind,
                'patch_model': 'z11-parent-z12-micro-gap',
                'detail_zoom': DETAIL_Z,
            },
            'geometry': round_coordinates(mapping(geographic), 6),
        })

    pixel_area = abs(detail_transform.a * detail_transform.e)
    metrics = {
        'detail_zoom': DETAIL_Z,
        'reference_zoom': REF_Z,
        'alpha_threshold': THRESHOLD,
        'max_distance_px': MAX_DISTANCE_PX,
        'max_component_px': MAX_COMPONENT_PX,
        'max_patch_ratio': MAX_PATCH_RATIO,
        'core_pixels': int(core.sum()),
        'parent_missing_pixels': int(parent_missing.sum()),
        'raw_candidate_pixels': int(raw.sum()),
        'patch_pixels': int(final.sum()),
        'patch_ratio_to_core': float(final.sum() / max(1, core.sum())),
        'patch_area_m2_mercator': float(final.sum() * pixel_area),
        'feature_count': len(features),
        'largest_component_px': int(max(component_sizes) if component_sizes else 0),
    }
    if metrics['patch_ratio_to_core'] > MAX_PATCH_RATIO + 0.0001:
        raise RuntimeError(f'{kind}: patch ratio exceeded cap: {metrics}')
    if metrics['largest_component_px'] > MAX_COMPONENT_PX:
        raise RuntimeError(f'{kind}: patch component exceeded cap: {metrics}')
    return {'type': 'FeatureCollection', 'features': features}, metrics


def patch_runtime() -> None:
    ui = ROOT / 'assets/map-ui.js'
    text = ui.read_text(encoding='utf-8')
    text = text.replace("const VERSION = '7.3';", "const VERSION = '7.3.1';", 1)
    text = text.replace("const DEFAULT_STORAGE_KEY = 'alan-map-stage7.3-view';", "const DEFAULT_STORAGE_KEY = 'alan-map-stage7.3.1-view';", 1)
    legacy_anchor = "  const LEGACY_STORAGE_KEYS = [\n"
    if legacy_anchor in text and "'alan-map-stage7.3-view'," not in text:
        text = text.replace(legacy_anchor, legacy_anchor + "    'alan-map-stage7.3-view',\n", 1)

    old_sources = """        ['focus', data.focus],\n        ['frameMask', data.frameMask],\n        ['glaciers', data.glaciers],"""
    new_sources = """        ['focus', data.focus],\n        ['frameMask', data.frameMask],\n        ['snowGapSeasonal', data.snowGapSeasonal],\n        ['snowGapPermanent', data.snowGapPermanent],\n        ['glaciers', data.glaciers],"""
    if old_sources not in text:
        raise RuntimeError('runtime source anchor missing')
    text = text.replace(old_sources, new_sources, 1)

    old_layers = """      if (snowSeasonalTemplate) baseLayers.splice(-1,0,{id:'satellite-snow-seasonal',type:'raster',source:'snow-seasonal',minzoom:Number(data.regionalSnow.seasonal.minzoom),maxzoom:Number(data.regionalSnow.seasonal.maxzoom),paint:{'raster-opacity':['interpolate',['linear'],['zoom'],7,0.26,9,0.36,12,0.52],'raster-fade-duration':100,'raster-resampling':'linear'}});\n      if (snowPermanentTemplate) baseLayers.splice(-1,0,{id:'satellite-snow-permanent',type:'raster',source:'snow-permanent',minzoom:Number(data.regionalSnow.permanent.minzoom),maxzoom:Number(data.regionalSnow.permanent.maxzoom),paint:{'raster-opacity':['interpolate',['linear'],['zoom'],7,0.74,9,0.86,12,0.94],'raster-fade-duration':100,'raster-resampling':'linear'}});"""
    new_layers = """      if (snowSeasonalTemplate) baseLayers.splice(-1,0,{id:'satellite-snow-seasonal',type:'raster',source:'snow-seasonal',minzoom:Number(data.regionalSnow.seasonal.minzoom),paint:{'raster-opacity':['interpolate',['linear'],['zoom'],7,0.26,9,0.36,12,0.52],'raster-fade-duration':100,'raster-resampling':'linear'}});\n      if (snowPermanentTemplate) baseLayers.splice(-1,0,{id:'satellite-snow-permanent',type:'raster',source:'snow-permanent',minzoom:Number(data.regionalSnow.permanent.minzoom),paint:{'raster-opacity':['interpolate',['linear'],['zoom'],7,0.74,9,0.86,12,0.94],'raster-fade-duration':100,'raster-resampling':'linear'}});\n      if (data.snowGapSeasonal?.features?.length) baseLayers.splice(-1,0,{id:'snow-gap-seasonal',type:'fill',source:'polygons',minzoom:Number(data.regionalSnow?.gapPatchMinzoom || 10.75),filter:sourceFilter('snowGapSeasonal'),paint:{'fill-color':'#f5fafb','fill-opacity':0.44,'fill-antialias':true}});\n      if (data.snowGapPermanent?.features?.length) baseLayers.splice(-1,0,{id:'snow-gap-permanent',type:'fill',source:'polygons',minzoom:Number(data.regionalSnow?.gapPatchMinzoom || 10.75),filter:sourceFilter('snowGapPermanent'),paint:{'fill-color':'#fafdfd','fill-opacity':0.92,'fill-antialias':true}});"""
    if old_layers not in text:
        raise RuntimeError('original raster snow layer anchor missing')
    text = text.replace(old_layers, new_layers, 1)
    text = text.replace('Alan Map · 7.3', 'Alan Map · 7.3.1')
    ui.write_text(text, encoding='utf-8')

    page = ROOT / 'assets/map-page.js'
    page.write_text(page.read_text(encoding='utf-8').replace("const VERSION = '7.3';", "const VERSION = '7.3.1';", 1), encoding='utf-8')


def patch_metadata(data: dict, permanent: dict, seasonal: dict) -> None:
    data.pop('snowDisplayPermanent', None)
    data.pop('snowDisplaySeasonal', None)
    data['snowGapPermanent'] = permanent
    data['snowGapSeasonal'] = seasonal
    data['version'] = '7.3.1'
    data['applicationVersion'] = '7.3.1'
    data['stage'] = '7.3.1'
    data['dataVersion'] = DATA_VERSION
    snow = data.get('regionalSnow', {})
    snow.update({
        'displayStrategy': 'raster-original-plus-micro-gap-patches',
        'gapPatchDetailZoom': DETAIL_Z,
        'gapPatchReferenceZoom': REF_Z,
        'gapPatchMinzoom': MINZOOM,
        'gapPatchMaxDistancePx': MAX_DISTANCE_PX,
        'gapPatchMaxComponentPx': MAX_COMPONENT_PX,
        'gapPatchMaxRatio': MAX_PATCH_RATIO,
        'displayNotes': 'Original 7.3 raster snow is primary. Conservative z12 GeoJSON micro-patches only fill small parent-supported gaps near existing detailed snow; no global dilation or replacement contour.',
    })
    data['regionalSnow'] = snow


def patch_docs_and_tests() -> None:
    index = ROOT / 'index.html'
    text = index.read_text(encoding='utf-8')
    text = text.replace('Alan Map 7.3', 'Alan Map 7.3.1')
    text = text.replace('?v=7.3', '?v=7.3.1-snow5')
    text = text.replace(
        '<!-- Alan Map 7.3: generalized z7-z11 DEM; 7.2.5 vector/snow preserved -->',
        '<!-- Alan Map 7.3.1: original raster snow restored; conservative z12 micro-gap patches -->',
    )
    index.write_text(text, encoding='utf-8')

    (ROOT / 'README.md').write_text(
        '# Alan Map 7.3.1\n\n'
        'Снежные слои возвращены к исходной raster-отрисовке версии 7.3. Основной permanent/seasonal snow снова читается напрямую из неизменённых PMTiles 7.2.5 и сохраняет исходную детальную форму на близком масштабе.\n\n'
        'Поверх исходного снега добавлены только небольшие GeoJSON gap-patches, построенные по расхождениям родительского z11 и детального z12. Патч допускается только рядом с уже существующим z12-снегом, отдельный компонент ограничен 64 пикселями, а суммарное добавление ограничено 3.5% детальной маски. Глобального расширения, нового большого контура и сглаживания всей снежной площади нет.\n',
        encoding='utf-8',
    )

    runtime = ROOT / 'tests/runtime-contract.mjs'
    text = runtime.read_text(encoding='utf-8')
    replacements = [
        ("assert.equal(data.version, '7.3');", "assert.equal(data.version, '7.3.1');"),
        ("assert.equal(data.applicationVersion, '7.3');", "assert.equal(data.applicationVersion, '7.3.1');"),
        ("assert.equal(data.dataVersion, '7.3-dem-generalized-z11.1');", f"assert.equal(data.dataVersion, '{DATA_VERSION}');"),
        ("assert.match(uiSource, /const VERSION = '7\\.3'/);", "assert.match(uiSource, /const VERSION = '7\\.3\\.1'/);"),
        ("assert.match(indexSource, /map-presentation-r2\\.js\\?v=7\\.3/);", "assert.match(indexSource, /map-presentation-r2\\.js\\?v=7\\.3\\.1-snow5/);"),
    ]
    for old, new in replacements:
        if old not in text:
            raise RuntimeError(f'runtime contract anchor missing: {old}')
        text = text.replace(old, new, 1)
    anchor = "  assert.equal(data.regionalSnow.seasonal.archivePath, 'data/alan-snow-seasonal-7.2.5.pmtiles');\n"
    extra = anchor + (
        "  assert.equal(data.regionalSnow.displayStrategy, 'raster-original-plus-micro-gap-patches');\n"
        "  assert.equal(data.regionalSnow.gapPatchDetailZoom, 12);\n"
        "  assert.equal(data.regionalSnow.gapPatchReferenceZoom, 11);\n"
        "  assert.ok(data.snowGapPermanent.features.length > 0);\n"
        "  assert.ok(data.snowGapSeasonal.features.length > 0);\n"
    )
    if anchor not in text:
        raise RuntimeError('runtime snow anchor missing')
    runtime.write_text(text.replace(anchor, extra, 1), encoding='utf-8')

    smoke = ROOT / 'tests/map-smoke.mjs'
    smoke.write_text(smoke.read_text(encoding='utf-8').replace("assert.equal(performanceMetrics.version,'7.3');", "assert.equal(performanceMetrics.version,'7.3.1');", 1), encoding='utf-8')


def main() -> None:
    restore_baseline()
    data = read_data()
    permanent, permanent_metrics = build_patch(data, ROOT / 'build/snow-permanent.mbtiles', 'permanent')
    seasonal, seasonal_metrics = build_patch(data, ROOT / 'build/snow-seasonal.mbtiles', 'seasonal')
    patch_metadata(data, permanent, seasonal)
    write_data(data)
    patch_runtime()
    patch_docs_and_tests()
    report = {
        'version': '7.3.1',
        'data_version': DATA_VERSION,
        'strategy': data['regionalSnow']['displayStrategy'],
        'permanent': permanent_metrics,
        'seasonal': seasonal_metrics,
    }
    (ROOT / 'data/snow-gap-patch-7.3.1.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
