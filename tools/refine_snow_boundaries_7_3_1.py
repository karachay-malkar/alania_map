#!/usr/bin/env python3
from __future__ import annotations

import argparse
import io
import json
import sqlite3
from pathlib import Path

import numpy as np
from PIL import Image
from pyproj import Transformer
from scipy import ndimage
from shapely.geometry import shape, mapping, Polygon, MultiPolygon
from shapely.ops import unary_union, transform as shp_transform
from rasterio.features import rasterize, shapes
from affine import Affine

ROOT = Path(__file__).resolve().parents[1]
PARTS = [ROOT / 'assets/map-data.part-000.js', ROOT / 'assets/map-data.part-001.js']
MARKER = 'window.ALAN_MAP_DATA = '
WEBMERCATOR_HALF_WORLD = 20037508.342789244
WORLD_SPAN = WEBMERCATOR_HALF_WORLD * 2
DETAIL_ZOOM = 12
ALPHA_THRESHOLD = 96
SMOOTH_SIGMA_PX = 1.35
BOUNDARY_ROUND_M = 65.0
SIMPLIFY_M = 28.0
MIN_COMPONENT_M2 = 20_000.0
DATA_VERSION = '7.3.1-snow-refined-z12-area-match.3'
DISPLAY_STRATEGY = 'stable-vector-detailed-area-match'

TO_3857 = Transformer.from_crs('EPSG:4326', 'EPSG:3857', always_xy=True).transform
TO_4326 = Transformer.from_crs('EPSG:3857', 'EPSG:4326', always_xy=True).transform


def read_data() -> dict:
    source = ''.join(path.read_text(encoding='utf-8') for path in PARTS)
    index = source.find(MARKER)
    if index < 0:
        raise RuntimeError('ALAN_MAP_DATA marker not found')
    payload = source[index + len(MARKER):].strip()
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


def xyz_y(z: int, tile_row_tms: int) -> int:
    return (1 << z) - 1 - tile_row_tms


def load_zoom_mosaic(mbtiles: Path, zoom: int) -> tuple[np.ndarray, Affine]:
    connection = sqlite3.connect(mbtiles)
    rows = list(connection.execute(
        'SELECT tile_column,tile_row,tile_data FROM tiles WHERE zoom_level=? ORDER BY tile_column,tile_row',
        (zoom,),
    ))
    connection.close()
    if not rows:
        raise RuntimeError(f'No z{zoom} tiles in {mbtiles}')

    xs = [int(row[0]) for row in rows]
    ys = [xyz_y(zoom, int(row[1])) for row in rows]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    tile_size = 256
    mosaic = np.zeros(((max_y - min_y + 1) * tile_size, (max_x - min_x + 1) * tile_size), dtype=np.uint8)

    for tile_x, tile_row, tile_data in rows:
        tile_y = xyz_y(zoom, int(tile_row))
        image = Image.open(io.BytesIO(tile_data)).convert('RGBA')
        alpha = np.asarray(image, dtype=np.uint8)[:, :, 3]
        row0 = (tile_y - min_y) * tile_size
        col0 = (int(tile_x) - min_x) * tile_size
        mosaic[row0:row0 + tile_size, col0:col0 + tile_size] = alpha

    tile_span = WORLD_SPAN / (1 << zoom)
    pixel_size = tile_span / tile_size
    west = -WEBMERCATOR_HALF_WORLD + min_x * tile_span
    north = WEBMERCATOR_HALF_WORLD - min_y * tile_span
    affine = Affine(pixel_size, 0.0, west, 0.0, -pixel_size, north)
    return mosaic, affine


def collection_union_3857(collection: dict) -> Polygon | MultiPolygon:
    geoms = [shp_transform(TO_3857, shape(feature['geometry'])) for feature in collection.get('features', [])]
    if not geoms:
        return MultiPolygon([])
    return unary_union(geoms).buffer(0)


def frame_geometry_3857(data: dict):
    features = (data.get('mapFrame') or {}).get('features') or []
    if not features:
        raise RuntimeError('mapFrame geometry missing')
    return shp_transform(TO_3857, shape(features[0]['geometry'])).buffer(0)


def rasterize_geometry(geometry, out_shape: tuple[int, int], affine: Affine) -> np.ndarray:
    return rasterize(
        [(mapping(geometry), 1)],
        out_shape=out_shape,
        transform=affine,
        fill=0,
        dtype='uint8',
        all_touched=False,
    ).astype(bool)


def area_match_mask(alpha: np.ndarray, affine: Affine, frame_mask: np.ndarray, target_area_m2: float) -> tuple[np.ndarray, dict]:
    pixel_area = abs(affine.a * affine.e)
    target_pixels = max(1, int(round(target_area_m2 / pixel_area)))

    core = (alpha >= ALPHA_THRESHOLD) & frame_mask
    core = ndimage.binary_closing(core, structure=np.ones((3, 3), dtype=bool), iterations=1)
    if not np.any(core):
        raise RuntimeError('Detailed snow core is empty')

    distance = ndimage.distance_transform_edt(~core)
    low, high = 0.0, 256.0
    for _ in range(18):
        mid = (low + high) / 2.0
        count = int(np.count_nonzero((distance <= mid) & frame_mask))
        if count < target_pixels:
            low = mid
        else:
            high = mid
    radius_px = (low + high) / 2.0
    expanded = (distance <= radius_px) & frame_mask

    probability = ndimage.gaussian_filter(expanded.astype(np.float32), sigma=SMOOTH_SIGMA_PX, mode='nearest')
    lo_t, hi_t = 0.08, 0.92
    best = expanded
    for _ in range(18):
        threshold = (lo_t + hi_t) / 2.0
        candidate = (probability >= threshold) & frame_mask
        count = int(np.count_nonzero(candidate))
        best = candidate
        if count > target_pixels:
            lo_t = threshold
        else:
            hi_t = threshold

    best = ndimage.binary_closing(best, structure=np.ones((3, 3), dtype=bool), iterations=1)
    best &= frame_mask
    result_pixels = int(np.count_nonzero(best))
    return best, {
        'detail_zoom': DETAIL_ZOOM,
        'alpha_threshold': ALPHA_THRESHOLD,
        'target_area_m2': target_area_m2,
        'pixel_area_m2': pixel_area,
        'target_pixels': target_pixels,
        'core_pixels': int(np.count_nonzero(core)),
        'dilation_radius_px': radius_px,
        'dilation_radius_m_mercator': radius_px * abs(affine.a),
        'result_pixels': result_pixels,
        'result_area_m2_raster': result_pixels * pixel_area,
    }


def mask_to_geometry(mask: np.ndarray, affine: Affine, frame_geom, target_area_m2: float):
    geoms = []
    for geom_mapping, value in shapes(mask.astype(np.uint8), mask=mask, transform=affine):
        if int(value) != 1:
            continue
        geom = shape(geom_mapping)
        if geom.area >= MIN_COMPONENT_M2:
            geoms.append(geom)
    if not geoms:
        raise RuntimeError('Polygonization produced no snow geometry')

    geom = unary_union(geoms).buffer(0)
    geom = geom.buffer(BOUNDARY_ROUND_M, resolution=4, join_style=1).buffer(-BOUNDARY_ROUND_M, resolution=4, join_style=1)
    geom = geom.simplify(SIMPLIFY_M, preserve_topology=True).intersection(frame_geom).buffer(0)

    low, high = -500.0, 500.0
    best = geom
    for _ in range(16):
        mid = (low + high) / 2.0
        candidate = geom.buffer(mid, resolution=4, join_style=1).intersection(frame_geom).buffer(0)
        best = candidate
        if candidate.area < target_area_m2:
            low = mid
        else:
            high = mid
    geom = best.simplify(SIMPLIFY_M, preserve_topology=True).intersection(frame_geom).buffer(0)
    return geom


def polygon_parts(geom):
    if geom.is_empty:
        return []
    if geom.geom_type == 'Polygon':
        return [geom]
    if geom.geom_type == 'MultiPolygon':
        return list(geom.geoms)
    return [part for part in getattr(geom, 'geoms', []) if part.geom_type == 'Polygon']


def round_coordinates(value, digits: int = 6):
    if isinstance(value, (list, tuple)):
        return [round_coordinates(item, digits) for item in value]
    if isinstance(value, float):
        return round(value, digits)
    return value


def geometry_to_collection(geom, kind: str) -> dict:
    geographic = shp_transform(TO_4326, geom)
    features = []
    for part in polygon_parts(geographic):
        if part.is_empty:
            continue
        geometry = round_coordinates(mapping(part), 6)
        features.append({
            'type': 'Feature',
            'properties': {
                'snow_kind': kind,
                'display_source_zoom': DETAIL_ZOOM,
                'area_reference_zoom': 7,
                'boundary_model': 'z12-detailed-area-matched',
            },
            'geometry': geometry,
        })
    return {'type': 'FeatureCollection', 'features': features}


def refine_kind(data: dict, mbtiles: Path, collection_key: str, kind: str) -> tuple[dict, dict]:
    target_geom = collection_union_3857(data[collection_key])
    target_area = float(target_geom.area)
    if target_area <= 0:
        raise RuntimeError(f'{collection_key} target area is empty')

    alpha, affine = load_zoom_mosaic(mbtiles, DETAIL_ZOOM)
    frame_geom = frame_geometry_3857(data)
    frame_mask = rasterize_geometry(frame_geom, alpha.shape, affine)
    final_mask, metrics = area_match_mask(alpha, affine, frame_mask, target_area)
    geom = mask_to_geometry(final_mask, affine, frame_geom, target_area)
    collection = geometry_to_collection(geom, kind)

    metrics.update({
        'target_feature_count': len(data[collection_key].get('features', [])),
        'result_feature_count': len(collection['features']),
        'result_area_m2_vector': float(geom.area),
        'area_error_fraction': abs(float(geom.area) - target_area) / target_area,
        'vertex_count': sum(
            len(part.exterior.coords) + sum(len(ring.coords) for ring in part.interiors)
            for part in polygon_parts(geom)
        ),
    })
    if metrics['area_error_fraction'] > 0.025:
        raise RuntimeError(f'{kind} area drift exceeds 2.5%: {metrics}')
    return collection, metrics


def patch_ui() -> None:
    path = ROOT / 'assets/map-ui.js'
    text = path.read_text(encoding='utf-8')
    old = """      const stableSnowVector = data.regionalSnow?.displayStrategy === 'stable-vector-far-contour' &&
        ((data.snowDisplayPermanent?.features?.length || 0) > 0 || (data.snowDisplaySeasonal?.features?.length || 0) > 0);
"""
    new = """      const stableSnowVector = ['stable-vector-far-contour','stable-vector-detailed-area-match'].includes(data.regionalSnow?.displayStrategy) &&
        ((data.snowDisplayPermanent?.features?.length || 0) > 0 || (data.snowDisplaySeasonal?.features?.length || 0) > 0);
"""
    if old not in text:
        raise RuntimeError('stableSnowVector runtime anchor not found')
    text = text.replace(old, new, 1)

    old_layers = """      if (stableSnowVector && data.snowDisplaySeasonal?.features?.length) baseLayers.splice(-1,0,{id:'stable-snow-seasonal',type:'fill',source:'polygons',filter:sourceFilter('snowSeasonalStable'),paint:{'fill-color':'#f5fafb','fill-opacity':snowSeasonalOpacity,'fill-antialias':true}});
      if (stableSnowVector && data.snowDisplayPermanent?.features?.length) baseLayers.splice(-1,0,{id:'stable-snow-permanent',type:'fill',source:'polygons',filter:sourceFilter('snowPermanentStable'),paint:{'fill-color':'#fafdfd','fill-opacity':snowPermanentOpacity,'fill-antialias':true}});
"""
    new_layers = """      if (stableSnowVector && data.snowDisplaySeasonal?.features?.length) {
        baseLayers.splice(-1,0,{id:'stable-snow-seasonal',type:'fill',source:'polygons',filter:sourceFilter('snowSeasonalStable'),paint:{'fill-color':'#f5fafb','fill-opacity':snowSeasonalOpacity,'fill-antialias':true}});
        baseLayers.splice(-1,0,{id:'stable-snow-seasonal-edge',type:'line',source:'polygons',filter:sourceFilter('snowSeasonalStable'),paint:{'line-color':'#f5fafb','line-width':['interpolate',['linear'],['zoom'],7,0.7,11,1.1,14.3,1.7],'line-opacity':0.24,'line-blur':1.15}});
      }
      if (stableSnowVector && data.snowDisplayPermanent?.features?.length) {
        baseLayers.splice(-1,0,{id:'stable-snow-permanent',type:'fill',source:'polygons',filter:sourceFilter('snowPermanentStable'),paint:{'fill-color':'#fafdfd','fill-opacity':snowPermanentOpacity,'fill-antialias':true}});
        baseLayers.splice(-1,0,{id:'stable-snow-permanent-edge',type:'line',source:'polygons',filter:sourceFilter('snowPermanentStable'),paint:{'line-color':'#fafdfd','line-width':['interpolate',['linear'],['zoom'],7,0.8,11,1.25,14.3,1.9],'line-opacity':0.30,'line-blur':1.25}});
      }
"""
    if old_layers not in text:
        raise RuntimeError('stable snow layer anchors not found')
    text = text.replace(old_layers, new_layers, 1)
    path.write_text(text, encoding='utf-8')


def patch_tests_and_readme(metrics: dict) -> None:
    runtime = ROOT / 'tests/runtime-contract.mjs'
    text = runtime.read_text(encoding='utf-8')
    replacements = [
        ("assert.equal(data.dataVersion, '7.3.1-snow-stable-vector-z7.2');", f"assert.equal(data.dataVersion, '{DATA_VERSION}');"),
        ("assert.equal(data.regionalSnow.displayStrategy, 'stable-vector-far-contour');", f"assert.equal(data.regionalSnow.displayStrategy, '{DISPLAY_STRATEGY}');"),
        ("assert.equal(data.regionalSnow.displayMaxzoom, 7);", "assert.equal(data.regionalSnow.displayMaxzoom, 12);"),
        ("assert.equal(data.regionalSnow.displaySourceZoom, 7);", "assert.equal(data.regionalSnow.displaySourceZoom, 12);\n  assert.equal(data.regionalSnow.displayAreaReferenceZoom, 7);\n  assert.equal(data.regionalSnow.boundaryModel, 'z12-detailed-area-matched');"),
    ]
    for old, new in replacements:
        if old not in text:
            raise RuntimeError(f'runtime contract anchor missing: {old}')
        text = text.replace(old, new, 1)
    runtime.write_text(text, encoding='utf-8')

    readme = ROOT / 'README.md'
    readme.write_text(
        '# Alan Map 7.3.1\n\n'
        'Текущая ветка 7.3.1 сохраняет полный объём дальнего снежного покрова, но границы больше не строятся из грубой сетки z7. '
        'Постоянный и сезонный снег пересобраны из детального уровня z12 (около исходного 30-метрового разрешения), после чего геометрия расширена до площади ранее принятого дальнего контура z7.\n\n'
        'Контуры сглажены в метрической проекции, упрощены только на уровне десятков метров и отрисовываются как постоянные GeoJSON-полигоны на всех масштабах. '
        'Для визуально мягкой кромки добавлен антиалиасинговый fill и тонкий line-blur. Snow PMTiles сохранены в проекте как исходные данные, но в runtime не запрашиваются.\n\n'
        f"Permanent: {metrics['permanent']['result_feature_count']} полигонов, ошибка площади {metrics['permanent']['area_error_fraction']*100:.2f}%. "
        f"Seasonal: {metrics['seasonal']['result_feature_count']} полигонов, ошибка площади {metrics['seasonal']['area_error_fraction']*100:.2f}%.\n",
        encoding='utf-8',
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--permanent-mbtiles', type=Path, required=True)
    parser.add_argument('--seasonal-mbtiles', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()

    data = read_data()
    if data.get('version') != '7.3.1' or data.get('dataVersion') != '7.3.1-snow-stable-vector-z7.2':
        raise RuntimeError(f"Unexpected 7.3.1 baseline: {data.get('version')} / {data.get('dataVersion')}")
    if data.get('regionalSnow', {}).get('displayStrategy') != 'stable-vector-far-contour':
        raise RuntimeError('Expected current z7 stable snow baseline')

    permanent, permanent_metrics = refine_kind(data, args.permanent_mbtiles, 'snowDisplayPermanent', 'permanent')
    seasonal, seasonal_metrics = refine_kind(data, args.seasonal_mbtiles, 'snowDisplaySeasonal', 'seasonal')
    data['snowDisplayPermanent'] = permanent
    data['snowDisplaySeasonal'] = seasonal
    snow = data['regionalSnow']
    snow['displayStrategy'] = DISPLAY_STRATEGY
    snow['displayMaxzoom'] = DETAIL_ZOOM
    snow['displaySourceZoom'] = DETAIL_ZOOM
    snow['displayAreaReferenceZoom'] = 7
    snow['boundaryModel'] = 'z12-detailed-area-matched'
    snow['boundarySmoothingM'] = BOUNDARY_ROUND_M
    snow['boundarySimplifyM'] = SIMPLIFY_M
    snow['displayNotes'] = 'Detailed z12 snow geometry expanded to match the accepted far z7 coverage, then rounded and simplified in EPSG:3857. Runtime uses only stable GeoJSON snow geometry.'
    data['regionalSnow'] = snow
    data['dataVersion'] = DATA_VERSION
    write_data(data)
    patch_ui()

    metrics = {'permanent': permanent_metrics, 'seasonal': seasonal_metrics}
    patch_tests_and_readme(metrics)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps({
        'version': '7.3.1',
        'data_version': DATA_VERSION,
        'display_strategy': DISPLAY_STRATEGY,
        'detail_zoom': DETAIL_ZOOM,
        'area_reference_zoom': 7,
        'parameters': {
            'alpha_threshold': ALPHA_THRESHOLD,
            'smooth_sigma_px': SMOOTH_SIGMA_PX,
            'boundary_round_m': BOUNDARY_ROUND_M,
            'simplify_m': SIMPLIFY_M,
            'min_component_m2': MIN_COMPONENT_M2,
        },
        **metrics,
    }, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(metrics, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
