#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PARTS = [ROOT / 'assets/map-data.part-000.js', ROOT / 'assets/map-data.part-001.js']
MARKER = 'window.ALAN_MAP_DATA = '
VERSION = '7.3'
DATA_VERSION = '7.3-dem-generalized-z11.1'
DEM_ARCHIVE = 'data/alan-dem-7.3.pmtiles'
OLD_DEM_ARCHIVE = 'data/alan-dem-7.2.pmtiles'
VECTOR_ARCHIVE = 'data/alan-vector-7.2.pmtiles'
PERMANENT_SNOW_ARCHIVE = 'data/alan-snow-permanent-7.2.5.pmtiles'
SEASONAL_SNOW_ARCHIVE = 'data/alan-snow-seasonal-7.2.5.pmtiles'
BASELINE_DEM_BYTES = 56_681_035
VECTOR_BYTES = 16_913_027
VECTOR_SHA256 = '1d8d9417aeeba39147e7db2a6680d2032b7876633d1031f3a6fe93dde96d17fb'
PERMANENT_SNOW_BYTES = 2_399_106
SEASONAL_SNOW_BYTES = 2_384_959
EXPECTED_BOUNDS = [40.51784, 42.734095, 44.184003, 44.534975]
EXPECTED_CENTER = [42.350921, 43.634535]
EXPECTED_RING = [
    [40.51784, 43.41265],
    [43.731622, 42.734095],
    [44.184003, 43.85642],
    [40.970221, 44.534975],
    [40.51784, 43.41265],
]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


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


def frame_ring(data: dict) -> list:
    return (((data.get('mapFrame') or {}).get('features') or [{}])[0].get('geometry') or {}).get('coordinates', [[]])[0]


def replace_required(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding='utf-8')
    if old not in text:
        raise RuntimeError(f'{label}: expected token not found in {path}')
    path.write_text(text.replace(old, new, 1), encoding='utf-8')


def patch_runtime_versions() -> None:
    ui = ROOT / 'assets/map-ui.js'
    page = ROOT / 'assets/map-page.js'
    bootstrap = ROOT / 'assets/bootstrap.js'
    index = ROOT / 'index.html'
    runtime_test = ROOT / 'tests/runtime-contract.mjs'
    smoke_test = ROOT / 'tests/map-smoke.mjs'

    replace_required(ui, "const VERSION = '7.2.5';", "const VERSION = '7.3';", 'map-ui version')
    replace_required(ui, "const DEFAULT_STORAGE_KEY = 'alan-map-stage7.2-view';", "const DEFAULT_STORAGE_KEY = 'alan-map-stage7.3-view';", 'map-ui storage key')
    ui_text = ui.read_text(encoding='utf-8')
    legacy_anchor = "  const LEGACY_STORAGE_KEYS = [\n"
    if "'alan-map-stage7.2-view'," not in ui_text:
        if legacy_anchor not in ui_text:
            raise RuntimeError('map-ui legacy storage list not found')
        ui_text = ui_text.replace(legacy_anchor, legacy_anchor + "    'alan-map-stage7.2-view',\n", 1)
    ui_text = ui_text.replace('Alan Map · 7.2.5', 'Alan Map · 7.3')
    ui.write_text(ui_text, encoding='utf-8')

    replace_required(page, "const VERSION = '7.2.5';", "const VERSION = '7.3';", 'map-page version')
    replace_required(bootstrap, "const RELEASE = '7.2.5';", "const RELEASE = '7.3';", 'bootstrap release')

    index_text = index.read_text(encoding='utf-8')
    if 'Alan Map 7.2.5' not in index_text:
        raise RuntimeError('index 7.2.5 title not found')
    index_text = index_text.replace('Alan Map 7.2.5', 'Alan Map 7.3')
    index_text = index_text.replace('?v=7.2.5', '?v=7.3')
    index_text = index_text.replace(
        '<!-- Alan Map 7.3: aligned regional names and completed settlement-name audit -->',
        '<!-- Alan Map 7.3: generalized z7-z11 DEM; 7.2.5 vector/snow preserved -->'
    )
    index.write_text(index_text, encoding='utf-8')

    test_text = runtime_test.read_text(encoding='utf-8')
    replacements = [
        ("assert.match(uiSource, /const VERSION = '7\\.2\\.5'/);", "assert.match(uiSource, /const VERSION = '7\\.3'/);"),
        ("assert.match(indexSource, /map-presentation-r2\\.js\\?v=7\\.2\\.5/);", "assert.match(indexSource, /map-presentation-r2\\.js\\?v=7\\.3/);"),
        ("assert.equal(data.version, '7.2');", "assert.equal(data.version, '7.3');"),
        ("assert.equal(data.applicationVersion, '7.2');", "assert.equal(data.applicationVersion, '7.3');"),
        ("assert.equal(data.regionalDem.lodModel, 'single-pyramid-z7-z12');", "assert.equal(data.regionalDem.lodModel, 'single-pyramid-z7-z11-overzoom');"),
        ("assert.equal(data.regionalDem.archivePath, 'data/alan-dem-7.2.pmtiles');", "assert.equal(data.regionalDem.archivePath, 'data/alan-dem-7.3.pmtiles');\nassert.equal(data.regionalDem.maxzoom, 11);\nassert.equal(data.regionalDem.overzoomFrom, 11);"),
        ("assert.ok(fs.statSync(data.regionalDem.archivePath).size < 89296988);", "assert.ok(fs.statSync(data.regionalDem.archivePath).size < 56681035);"),
    ]
    for old, new in replacements:
        if old not in test_text:
            raise RuntimeError(f'runtime-contract token missing: {old}')
        test_text = test_text.replace(old, new, 1)
    runtime_test.write_text(test_text, encoding='utf-8')

    smoke_text = smoke_test.read_text(encoding='utf-8')
    for old, new in (
        ("data/alan-dem-7.2.pmtiles", "data/alan-dem-7.3.pmtiles"),
    ):
        if old not in smoke_text:
            raise RuntimeError(f'map-smoke token missing: {old}')
        smoke_text = smoke_text.replace(old, new)
    smoke_test.write_text(smoke_text, encoding='utf-8')


def prepare() -> None:
    data = read_data()
    if data.get('bounds') != EXPECTED_BOUNDS or data.get('center') != EXPECTED_CENTER:
        raise RuntimeError(f'7.2.5 bounds/center changed: {data.get("bounds")} / {data.get("center")}')
    if frame_ring(data) != EXPECTED_RING:
        raise RuntimeError(f'7.2.5 mapFrame changed: {frame_ring(data)}')
    dem = data.get('regionalDem') or {}
    if dem.get('archivePath') != OLD_DEM_ARCHIVE or int(dem.get('maxzoom') or -1) != 12:
        raise RuntimeError(f'7.2.5 DEM contract changed: {dem}')
    for relative, expected_size in (
        (OLD_DEM_ARCHIVE, BASELINE_DEM_BYTES),
        (VECTOR_ARCHIVE, VECTOR_BYTES),
        (PERMANENT_SNOW_ARCHIVE, PERMANENT_SNOW_BYTES),
        (SEASONAL_SNOW_ARCHIVE, SEASONAL_SNOW_BYTES),
    ):
        path = ROOT / relative
        if not path.exists() or path.stat().st_size != expected_size:
            raise RuntimeError(f'baseline payload mismatch: {relative} -> {path.stat().st_size if path.exists() else "missing"}')
    if sha256(ROOT / VECTOR_ARCHIVE) != VECTOR_SHA256:
        raise RuntimeError('7.2.5 vector SHA256 changed')

    build = ROOT / 'build'
    build.mkdir(exist_ok=True)
    (build / 'map-frame.geojson').write_text(
        json.dumps(data['mapFrame'], ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8'
    )
    (build / 'rectangular-bounds.json').write_text(
        json.dumps({'bounds': EXPECTED_BOUNDS}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8'
    )
    (build / 'map-data-7.3-dem-config.js').write_text(
        'window.ALAN_MAP_DATA = ' + json.dumps({
            'center': EXPECTED_CENTER,
            'regionalDem': {'minzoom': 7, 'maxzoom': 11},
        }, separators=(',', ':')) + ';\n', encoding='utf-8'
    )
    print(json.dumps({'version': VERSION, 'base': '7.2.5', 'dem_maxzoom_before': 12, 'dem_maxzoom_after': 11}))


def finalize(dem: Path, build_report: Path, validation_report: Path, collar_report: Path, size_summary: Path) -> None:
    for path in (dem, build_report, validation_report, collar_report, size_summary):
        if not path.exists() or path.stat().st_size <= 0:
            raise RuntimeError(f'missing 7.3 build output: {path}')

    build_payload = json.loads(build_report.read_text(encoding='utf-8'))
    validation_payload = json.loads(validation_report.read_text(encoding='utf-8'))
    collar_payload = json.loads(collar_report.read_text(encoding='utf-8'))
    summary_payload = json.loads(size_summary.read_text(encoding='utf-8'))
    if build_payload.get('maxzoom') != 11 or build_payload.get('height_quantization_m') != 1.0:
        raise RuntimeError(f'7.3 DEM build contract mismatch: {build_payload}')
    if '12' in (build_payload.get('per_zoom') or {}):
        raise RuntimeError('z12 unexpectedly remains in 7.3 DEM')
    if int(validation_payload.get('quantization_errors') or 0) != 0:
        raise RuntimeError('DEM validation reports quantization errors')
    if int(collar_payload.get('changed_tiles') or 0) <= 0 or int(collar_payload.get('new_tiles') or 0) <= 0:
        raise RuntimeError('7.3 edge collar was not materialized')
    if dem.stat().st_size >= BASELINE_DEM_BYTES:
        raise RuntimeError(f'7.3 DEM is not smaller than 7.2.5: {dem.stat().st_size} >= {BASELINE_DEM_BYTES}')

    target = ROOT / DEM_ARCHIVE
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(dem, target)
    old_target = ROOT / OLD_DEM_ARCHIVE
    old_target.unlink(missing_ok=True)

    data = read_data()
    if data.get('bounds') != EXPECTED_BOUNDS or frame_ring(data) != EXPECTED_RING:
        raise RuntimeError('map geometry changed during 7.3 build')
    snow_before = json.dumps(data.get('regionalSnow'), ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    vector_before = json.dumps(data.get('regionalVector'), ensure_ascii=False, sort_keys=True, separators=(',', ':'))

    for key in ('version', 'applicationVersion', 'stage'):
        data[key] = VERSION
    data['dataVersion'] = DATA_VERSION
    dem_record = dict(data.get('regionalDem') or {})
    dem_record.update({
        'available': True,
        'archivePath': DEM_ARCHIVE,
        'minzoom': 7,
        'maxzoom': 11,
        'tileSize': 256,
        'encoding': 'mapbox',
        'bounds': EXPECTED_BOUNDS,
        'source': 'Copernicus DEM GLO-30',
        'heightQuantizationM': 1,
        'lodModel': 'single-pyramid-z7-z11-overzoom',
        'highestNativeZoom': 11,
        'overzoomFrom': 11,
        'geometryGeneralization': 'drop-z12-bilinear-downsample',
        'horizontalGroundResolutionApproxM': 55.3,
        'streamingMode': 'http-range',
        'tileContainer': 'PMTiles',
        'physicallyClipped': True,
        'physicalClipGeometry': 'mapFrame',
        'outsideTilesRemoved': True,
        'outsidePixelsTransparent': True,
        'edgeCollarM': int(collar_payload.get('collar_m') or 4500),
        'edgeInnerTaperM': int(collar_payload.get('inner_taper_m') or 900),
        'edgeOuterSkirtM': int(collar_payload.get('outer_skirt_m') or 3200),
        'edgeSafeMaxElevationM': int(collar_payload.get('safe_max_elevation_m') or 1000),
    })
    data['regionalDem'] = dem_record
    write_data(data)

    if json.dumps(data.get('regionalSnow'), ensure_ascii=False, sort_keys=True, separators=(',', ':')) != snow_before:
        raise RuntimeError('regionalSnow changed during DEM-only 7.3 release')
    if json.dumps(data.get('regionalVector'), ensure_ascii=False, sort_keys=True, separators=(',', ':')) != vector_before:
        raise RuntimeError('regionalVector changed during DEM-only 7.3 release')

    patch_runtime_versions()

    for source, destination in (
        (build_report, ROOT / 'data/dem-build-report-7.3.json'),
        (validation_report, ROOT / 'data/dem-validation-7.3.json'),
        (collar_report, ROOT / 'data/dem-edge-collar-report-7.3.json'),
        (size_summary, ROOT / 'data/dem-size-summary-7.3.json'),
        (build_report, ROOT / 'data/dem-crop-report.json'),
        (validation_report, ROOT / 'data/dem-crop-validation.json'),
        (collar_report, ROOT / 'data/dem-edge-collar-report.json'),
        (size_summary, ROOT / 'data/dem-size-summary.json'),
    ):
        shutil.copyfile(source, destination)

    generated_at = datetime.now(timezone.utc).isoformat()
    manifest_path = ROOT / 'data/copernicus-build-manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    manifest['version'] = VERSION
    manifest['generated_at'] = generated_at
    manifest['bounds'] = EXPECTED_BOUNDS
    manifest['dem'] = {
        'source': 'Copernicus DEM GLO-30',
        'archive': DEM_ARCHIVE,
        'bytes': target.stat().st_size,
        'sha256': sha256(target),
        'physical_clip': 'rotated mapFrame polygon + hidden tapered edge collar',
        'height_quantization_m': 1,
        'lod_model': 'single-pyramid-z7-z11-overzoom',
        'highest_native_zoom': 11,
        'geometry_generalization': 'drop-z12-bilinear-downsample',
        'streaming': 'http-range',
        'baseline_bytes_7_2_5': BASELINE_DEM_BYTES,
        'reduction_fraction': 1 - target.stat().st_size / BASELINE_DEM_BYTES,
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    streaming_path = ROOT / 'data/streaming-build-manifest.json'
    streaming = json.loads(streaming_path.read_text(encoding='utf-8'))
    streaming['version'] = VERSION
    streaming['generated_at'] = generated_at
    streaming['dem_geometry'] = {
        'native_zoom_range': 'z7-z11',
        'overzoom_after': 11,
        'height_quantization_m': 1,
    }
    streaming_path.write_text(json.dumps(streaming, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    readme = (
        '# Alan Map 7.3\n\n'
        'Версия 7.3 основана на полном состоянии 7.2.5 и выполняет первый этап геометрической оптимизации карты.\n\n'
        'DEM Copernicus GLO-30 сохраняет квантование высоты 1 м, точный mapFrame и скрытый tapered edge collar. '
        'Самый подробный нативный уровень z12 удалён: рельеф хранится как пирамида z7–z11, а при дальнейшем приближении MapLibre overzoom-ит z11. '
        'Это снижает горизонтальную детализацию примерно с 27.7 до 55.3 м/пиксель в районе центра карты и убирает микрорельеф, не меняя положение крупных хребтов, долин и вершин.\n\n'
        'Векторный архив 7.2 и оба спутниковых снежных архива 7.2.5 сохранены без пересборки и без изменения байтов. '
        'Навигация, подписи, населённые пункты, рамка, компас, состояния просмотра и presentation-слои не перепроектировались.\n'
    )
    (ROOT / 'README.md').write_text(readme, encoding='utf-8')
    print(json.dumps({'version': VERSION, 'dem_bytes': target.stat().st_size, 'reduction_fraction': 1 - target.stat().st_size / BASELINE_DEM_BYTES}, indent=2))


def validate() -> None:
    data = read_data()
    if any(data.get(key) != VERSION for key in ('version', 'applicationVersion', 'stage')):
        raise RuntimeError('7.3 global version mismatch')
    if data.get('dataVersion') != DATA_VERSION:
        raise RuntimeError(f'7.3 dataVersion mismatch: {data.get("dataVersion")}')
    if data.get('bounds') != EXPECTED_BOUNDS or data.get('center') != EXPECTED_CENTER or frame_ring(data) != EXPECTED_RING:
        raise RuntimeError('7.3 map bounds/frame/center changed')

    dem = data.get('regionalDem') or {}
    expected_dem = {
        'archivePath': DEM_ARCHIVE,
        'minzoom': 7,
        'maxzoom': 11,
        'heightQuantizationM': 1,
        'lodModel': 'single-pyramid-z7-z11-overzoom',
        'overzoomFrom': 11,
        'geometryGeneralization': 'drop-z12-bilinear-downsample',
        'streamingMode': 'http-range',
    }
    for key, expected in expected_dem.items():
        if dem.get(key) != expected:
            raise RuntimeError(f'7.3 DEM metadata mismatch: {key}={dem.get(key)!r}, expected {expected!r}')
    dem_path = ROOT / DEM_ARCHIVE
    if not dem_path.exists() or dem_path.stat().st_size >= BASELINE_DEM_BYTES:
        raise RuntimeError('optimized 7.3 DEM is missing or not smaller than 7.2.5')
    if (ROOT / OLD_DEM_ARCHIVE).exists():
        raise RuntimeError('obsolete 7.2 DEM duplicate remains in 7.3')

    vector = data.get('regionalVector') or {}
    if vector.get('archivePath') != VECTOR_ARCHIVE:
        raise RuntimeError('vector archive path changed in DEM-only 7.3')
    vector_path = ROOT / VECTOR_ARCHIVE
    if vector_path.stat().st_size != VECTOR_BYTES or sha256(vector_path) != VECTOR_SHA256:
        raise RuntimeError('vector payload changed in DEM-only 7.3')

    snow = data.get('regionalSnow') or {}
    if snow.get('version') != '7.2.5':
        raise RuntimeError('snow metadata version changed')
    for key, archive, size in (
        ('permanent', PERMANENT_SNOW_ARCHIVE, PERMANENT_SNOW_BYTES),
        ('seasonal', SEASONAL_SNOW_ARCHIVE, SEASONAL_SNOW_BYTES),
    ):
        record = snow.get(key) or {}
        path = ROOT / archive
        if record.get('archivePath') != archive or not path.exists() or path.stat().st_size != size:
            raise RuntimeError(f'{key} snow payload changed')

    ui = (ROOT / 'assets/map-ui.js').read_text(encoding='utf-8')
    page = (ROOT / 'assets/map-page.js').read_text(encoding='utf-8')
    bootstrap = (ROOT / 'assets/bootstrap.js').read_text(encoding='utf-8')
    index = (ROOT / 'index.html').read_text(encoding='utf-8')
    if "const VERSION = '7.3';" not in ui or "const VERSION = '7.3';" not in page:
        raise RuntimeError('runtime version 7.3 missing')
    if "const RELEASE = '7.3';" not in bootstrap or '?v=7.3' not in index:
        raise RuntimeError('7.3 cache/version tokens missing')
    if "const DEFAULT_STORAGE_KEY = 'alan-map-stage7.3-view';" not in ui or "'alan-map-stage7.2-view'," not in ui:
        raise RuntimeError('7.3 map-view state migration is incomplete')

    summary = json.loads((ROOT / 'data/dem-size-summary-7.3.json').read_text(encoding='utf-8'))
    if int(summary.get('dem_bytes_7_3') or 0) != dem_path.stat().st_size:
        raise RuntimeError('7.3 DEM size summary mismatch')
    print(f'release-{VERSION} validation: ok; DEM={dem_path.stat().st_size} bytes; vector/snow unchanged')


def main() -> None:
    parser = argparse.ArgumentParser()
    subs = parser.add_subparsers(dest='command', required=True)
    subs.add_parser('prepare')
    final = subs.add_parser('finalize')
    final.add_argument('--dem', type=Path, required=True)
    final.add_argument('--build-report', type=Path, required=True)
    final.add_argument('--validation-report', type=Path, required=True)
    final.add_argument('--collar-report', type=Path, required=True)
    final.add_argument('--size-summary', type=Path, required=True)
    subs.add_parser('validate')
    args = parser.parse_args()
    if args.command == 'prepare':
        prepare()
    elif args.command == 'finalize':
        finalize(args.dem, args.build_report, args.validation_report, args.collar_report, args.size_summary)
    else:
        validate()


if __name__ == '__main__':
    main()
