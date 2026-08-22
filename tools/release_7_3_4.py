#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSION = '7.3.4'
BASE_VERSION = '7.3.3'
OLD_DEM = 'data/alan-dem-7.3.3.pmtiles'
NEW_DEM = 'data/alan-dem-7.3.4.pmtiles'
DATA_VERSION = '7.3.4-dem-unified-256-single-source.1'
MARKER = 'window.ALAN_MAP_DATA = '
SOURCE_PARTS = [ROOT / 'assets/map-data.part-000.js', ROOT / 'assets/map-data.part-001.js']
EXPECTED_BOUNDS = [40.51784, 42.734095, 44.184003, 44.534975]
EXPECTED_CENTER = [42.350921, 43.634535]
EXPECTED_RING = [
    [40.51784, 43.41265],
    [43.731622, 42.734095],
    [44.184003, 43.85642],
    [40.970221, 44.534975],
    [40.51784, 43.41265],
]
LOD_MODEL = 'unified-z7-z8-z9-z10-256-single-source-overzoom-z10'
GEOMETRY_GENERALIZATION = 'numeric-web-mercator-z10-z9-z7-lowpass-z8-from-z7'
Z8_LINEAGE = 'numeric-bilinear-upsample-of-z7-no-new-source-detail'
EFFECTIVE_INFORMATION_RESOLUTION = {'7': 885.148, '8': 885.148, '9': 221.287, '10': 110.644}
PHYSICAL_RESOLUTION = {'7': 885.148, '8': 442.574, '9': 221.287, '10': 110.644}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def parse_wrapped(path: Path, marker: str) -> dict:
    source = path.read_text(encoding='utf-8').strip()
    if not source.startswith(marker) or not source.endswith(';'):
        raise RuntimeError(f'{path}: unexpected wrapper')
    return json.loads(source[len(marker):-1])


def write_wrapped(path: Path, marker: str, data: dict) -> None:
    path.write_text(
        marker + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n',
        encoding='utf-8',
    )


def read_source_parts() -> dict:
    source = ''.join(path.read_text(encoding='utf-8') for path in SOURCE_PARTS).strip()
    if not source.startswith(MARKER) or not source.endswith(';'):
        raise RuntimeError('Unexpected map-data source wrapper')
    return json.loads(source[len(MARKER):-1])


def write_source_parts(data: dict) -> None:
    payload = '\n' + MARKER + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n'
    midpoint = len(payload) // 2
    SOURCE_PARTS[0].write_text(payload[:midpoint], encoding='utf-8')
    SOURCE_PARTS[1].write_text(payload[midpoint:], encoding='utf-8')


def replace_required(text: str, old: str, new: str, label: str, count: int = 1) -> str:
    occurrences = text.count(old)
    if occurrences < count:
        raise RuntimeError(f'{label}: expected at least {count} occurrence(s), found {occurrences}: {old!r}')
    return text.replace(old, new, count)


def frame_ring(data: dict) -> list:
    return (((data.get('mapFrame') or {}).get('features') or [{}])[0].get('geometry') or {}).get('coordinates', [[]])[0]


def validate_geography(data: dict) -> None:
    if data.get('bounds') != EXPECTED_BOUNDS:
        raise RuntimeError(f'map bounds changed: {data.get("bounds")}')
    if data.get('center') != EXPECTED_CENTER:
        raise RuntimeError(f'map center changed: {data.get("center")}')
    if frame_ring(data) != EXPECTED_RING:
        raise RuntimeError('map frame geometry changed')


def prepare() -> None:
    data = read_source_parts()
    validate_geography(data)
    if data.get('version') not in (BASE_VERSION, VERSION):
        raise RuntimeError(f'unexpected source version: {data.get("version")}')
    dem = data.get('regionalDem') or {}
    if data.get('version') == BASE_VERSION:
        expected = {
            'archivePath': OLD_DEM,
            'tileSize': 512,
            'minzoom': 7,
            'maxzoom': 10,
        }
        for key, value in expected.items():
            if dem.get(key) != value:
                raise RuntimeError(f'7.3.3 DEM baseline mismatch: {key}={dem.get(key)!r}, expected {value!r}')

    build = ROOT / 'build'
    build.mkdir(exist_ok=True)
    (build / 'map-frame.geojson').write_text(
        json.dumps(data['mapFrame'], ensure_ascii=False, separators=(',', ':')) + '\n',
        encoding='utf-8',
    )
    (build / 'rectangular-bounds.json').write_text(
        json.dumps({'bounds': EXPECTED_BOUNDS}, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8',
    )
    (build / 'map-data-7.3.4-dem-config.js').write_text(
        MARKER + json.dumps({
            'center': EXPECTED_CENTER,
            'regionalDem': {'minzoom': 7, 'maxzoom': 10, 'tileSize': 256},
        }, separators=(',', ':')) + ';\n',
        encoding='utf-8',
    )
    print(json.dumps({
        'version': VERSION,
        'baseVersion': data.get('version'),
        'bounds': EXPECTED_BOUNDS,
        'center': EXPECTED_CENTER,
        'targetTileSize': 256,
        'physicalNativeZooms': [7, 8, 9, 10],
    }, ensure_ascii=False, indent=2))


def patch_map_data(data: dict, dem_bytes: int, dem_sha256: str) -> dict:
    validate_geography(data)
    for key in ('version', 'applicationVersion', 'stage'):
        if key in data:
            data[key] = VERSION
    data['dataVersion'] = DATA_VERSION

    runtime_loading = data.get('runtimeLoading')
    if isinstance(runtime_loading, dict):
        runtime_loading['version'] = VERSION

    dem = data.get('regionalDem')
    if not isinstance(dem, dict):
        raise RuntimeError('regionalDem missing')
    dem.update({
        'archivePath': NEW_DEM,
        'archiveBytes': dem_bytes,
        'archiveSha256': dem_sha256,
        'tileSize': 256,
        'minzoom': 7,
        'maxzoom': 10,
        'highestNativeZoom': 10,
        'overzoomFrom': 10,
        'lodModel': LOD_MODEL,
        'physicalNativeZooms': [7, 8, 9, 10],
        'nativeZ8': True,
        'runtimeNativeZooms': [7, 8, 9, 10],
        'runtimeNetworkLevels': 1,
        'runtimeTerrainSources': 1,
        'z8RuntimeMode': 'physical-z8-derived-numerically-from-z7',
        'z8RequestsEnabled': True,
        'transitionMode': 'single-source-enable-once-after-initial-dem-ready',
        'geometryGeneralization': GEOMETRY_GENERALIZATION,
        'z8Lineage': Z8_LINEAGE,
        'physicalGroundMPerPixelAtCenter': PHYSICAL_RESOLUTION,
        'effectiveGroundMPerInformationPixelAtCenter': EFFECTIVE_INFORMATION_RESOLUTION,
    })
    return data


def patch_runtime_payloads(dem_bytes: int, dem_sha256: str) -> None:
    data = patch_map_data(read_source_parts(), dem_bytes, dem_sha256)
    write_source_parts(data)

    core_path = ROOT / 'assets/map-data-core.js'
    core = patch_map_data(parse_wrapped(core_path, MARKER), dem_bytes, dem_sha256)
    write_wrapped(core_path, MARKER, core)

    for filename, marker in [
        ('assets/map-data-deferred.js', 'window.ALAN_MAP_DEFERRED_DATA = '),
        ('assets/map-data-points.js', 'window.ALAN_MAP_POINT_DATA = '),
    ]:
        path = ROOT / filename
        payload = parse_wrapped(path, marker)
        payload['version'] = VERSION
        write_wrapped(path, marker, payload)


def patch_bootstrap() -> None:
    path = ROOT / 'assets/bootstrap.js'
    text = path.read_text(encoding='utf-8')
    text = replace_required(text, "const RELEASE = '7.3.3';", "const RELEASE = '7.3.4';", 'bootstrap release')
    text = replace_required(text, "'dem-lod-7.3.3.js',", "'dem-lod-7.3.4.js',", 'bootstrap terrain controller')
    path.write_text(text, encoding='utf-8')


def patch_map_page() -> None:
    path = ROOT / 'assets/map-page.js'
    text = path.read_text(encoding='utf-8')
    text = replace_required(text, "const VERSION = '7.3.3';", "const VERSION = '7.3.4';", 'map-page version')
    path.write_text(text, encoding='utf-8')


def patch_map_ui() -> None:
    path = ROOT / 'assets/map-ui.js'
    text = path.read_text(encoding='utf-8')
    text = replace_required(text, "const VERSION = '7.3.3';", "const VERSION = '7.3.4';", 'map-ui version')
    text = replace_required(
        text,
        "const DEFAULT_STORAGE_KEY = 'alan-map-stage7.3.3-view';",
        "const DEFAULT_STORAGE_KEY = 'alan-map-stage7.3.4-view';",
        'map-ui storage key',
    )
    legacy_marker = '  const LEGACY_STORAGE_KEYS = [\n'
    if "'alan-map-stage7.3.3-view'," not in text:
        text = replace_required(
            text,
            legacy_marker,
            legacy_marker + "    'alan-map-stage7.3.3-view',\n",
            'map-ui 7.3.3 storage migration',
        )

    text = replace_required(
        text,
        "        terrain: {source:'terrain-dem',exaggeration:state.relief},\n",
        '',
        'remove initial style terrain',
    )
    text = replace_required(
        text,
        "      map.setTerrain({source:'terrain-dem',exaggeration:numericValue});",
        "      window.ALAN_MAP_TERRAIN_CONTROLLER?.setExaggeration(numericValue);",
        'route relief slider to TerrainController',
    )
    path.write_text(text, encoding='utf-8')


def patch_index() -> None:
    path = ROOT / 'index.html'
    text = path.read_text(encoding='utf-8')
    if '7.3.3' not in text:
        raise RuntimeError('index.html has no 7.3.3 version markers')
    path.write_text(text.replace('7.3.3', VERSION), encoding='utf-8')


def patch_readme() -> None:
    path = ROOT / 'README.md'
    path.write_text(
        '''# Alan Map 7.3.4\n\nВерсия 7.3.4 упрощает только DEM/3D Terrain. География карты, снег, ледники, реки, дороги, леса, населённые пункты, подписи, иконки, рамка, маска, компас и цвета не изменяются.\n\n## DEM 7.3.4\n\nProduction-архив `data/alan-dem-7.3.4.pmtiles` — единая непрерывная 256×256 tile pyramid с физическими Z7/Z8/Z9/Z10. Все уровни строятся из числовых высот до Terrain-RGB кодирования и квантованы с шагом 1 м.\n\n- Z7 — грубая числовая поверхность;\n- Z8 — технический уровень, полученный только из числовой поверхности Z7 и не содержащий новой информации;\n- Z9 — средняя детализация;\n- Z10 — максимальная реальная детализация;\n- Z11–Z14.3 — только overzoom Z10.\n\n## Runtime terrain\n\nВ style существует один `raster-dem` source `terrain-dem` и один `terrain-hillshade`. Initial style не содержит активного `terrain`. После первого отображения карты `TerrainController` прогревает минимальный набор видимых DEM tiles через тот же PMTiles Range cache, ждёт готовности `terrain-dem` и один раз включает 3D после окончания пользовательского движения. После этого source не меняется при любом zoom.\n\nПолзунок рельефа меняет только `exaggeration` того же `terrain-dem`. LOD hysteresis, low/medium/high terrain sources, pending/active source и source-transition tokens из 7.3.3 удалены из production runtime.\n\n## Первый запуск\n\nСохраняются оптимизации 7.3.2–7.3.3: параллельная загрузка runtime-скриптов без `eval`, компактный стартовый пакет данных, отложенные районные текстуры и точечные объекты, deferred snow source, HTTP Range-запросы PMTiles, retry и общий ограниченный LRU-кэш.\n\nКанонический снег остаётся `data/alan-snow-7.3.1.pmtiles`. Векторный архив остаётся `data/alan-vector-7.2.pmtiles`.\n''',
        encoding='utf-8',
    )


def patch_reports(dem_bytes: int, dem_sha256: str, build_report: dict, validation_report: dict, collar_report: dict) -> None:
    old_report = ROOT / 'data/runtime-loading-report-7.3.3.json'
    new_report = ROOT / 'data/runtime-loading-report-7.3.4.json'
    report = json.loads(old_report.read_text(encoding='utf-8'))
    report.update({
        'version': VERSION,
        'demArchivePath': NEW_DEM,
        'demArchiveBytes': dem_bytes,
        'demTileSize': 256,
        'demPhysicalNativeZooms': [7, 8, 9, 10],
        'demNativeZ8': True,
        'demRuntimeTerrainSources': 1,
        'terrainInitialStyleEnabled': False,
        'terrainSourceSwitching': False,
    })
    new_report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    lod_report = {
        'version': VERSION,
        'archive': NEW_DEM,
        'bytes': dem_bytes,
        'sha256': dem_sha256,
        'tileSize': 256,
        'heightQuantizationM': 1,
        'physicalNativeZooms': [7, 8, 9, 10],
        'nativeZ8': True,
        'highestNativeZoom': 10,
        'overzoomFrom': 10,
        'lodModel': LOD_MODEL,
        'z8Lineage': Z8_LINEAGE,
        'physicalGroundMPerPixelAtCenter': PHYSICAL_RESOLUTION,
        'effectiveGroundMPerInformationPixelAtCenter': EFFECTIVE_INFORMATION_RESOLUTION,
        'build': build_report,
        'validation': validation_report,
        'edgeCollar': collar_report,
    }
    (ROOT / 'data/dem-lod-report-7.3.4.json').write_text(
        json.dumps(lod_report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8'
    )

    manifest_path = ROOT / 'data/copernicus-build-manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    manifest['version'] = VERSION
    dem = manifest.setdefault('dem', {})
    dem.update({
        'archive': NEW_DEM,
        'bytes': dem_bytes,
        'sha256': dem_sha256,
        'tile_size': 256,
        'lod_model': LOD_MODEL,
        'native_zoom_range': 'z7-z10',
        'physical_native_zooms': [7, 8, 9, 10],
        'native_z8': True,
        'z8_lineage': Z8_LINEAGE,
        'overzoom_from': 10,
        'height_quantization_m': 1,
        'physical_ground_m_per_pixel_at_center': PHYSICAL_RESOLUTION,
        'effective_ground_m_per_information_pixel_at_center': EFFECTIVE_INFORMATION_RESOLUTION,
    })
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def patch_tests() -> None:
    runtime = ROOT / 'tests/runtime-contract.mjs'
    text = runtime.read_text(encoding='utf-8').replace('7.3.3', '7.3.4')
    replacements = [
        (
            "assert.equal(data.regionalDem.lodModel, 'physical-z7-z9-z10-three-level-512-overzoom');",
            f"assert.equal(data.regionalDem.lodModel, '{LOD_MODEL}');\nassert.deepEqual(data.regionalDem.physicalNativeZooms, [7,8,9,10]);\nassert.equal(data.regionalDem.nativeZ8, true);\nassert.equal(data.regionalDem.runtimeTerrainSources, 1);",
            'runtime DEM model',
        ),
        (
            'assert.equal(data.regionalDem.tileSize, 512);',
            'assert.equal(data.regionalDem.tileSize, 256);',
            'runtime DEM tile size',
        ),
        (
            "assert.equal(data.regionalDem.geometryGeneralization, 'hierarchical-area-lowpass-z10-to-z9-z7-shared-no-native-z8');",
            f"assert.equal(data.regionalDem.geometryGeneralization, '{GEOMETRY_GENERALIZATION}');\nassert.equal(data.regionalDem.z8Lineage, '{Z8_LINEAGE}');",
            'runtime DEM generalization',
        ),
        (
            "assert.deepEqual(data.regionalDem.effectiveGroundMPerInformationPixelAtCenter, {'7':442.574,'8':442.574,'9':221.287,'10':110.644});",
            "assert.deepEqual(data.regionalDem.effectiveGroundMPerInformationPixelAtCenter, {'7':885.148,'8':885.148,'9':221.287,'10':110.644});",
            'runtime information resolution',
        ),
        (
            "assert.equal(data.dataVersion, '7.3.1-dem-hierarchical-512-z10.1');",
            f"assert.equal(data.dataVersion, '{DATA_VERSION}');",
            'runtime data version',
        ),
    ]
    for old, new, label in replacements:
        text = replace_required(text, old, new, label)

    insertion = "assert.match(uiSource, /data\\.regionalDem\\.encoding \\|\\| 'terrarium'/);\n"
    extra = (
        insertion
        + "assert.ok(!/terrain:\\s*\\{source:'terrain-dem'/.test(uiSource));\n"
        + "assert.match(uiSource, /ALAN_MAP_TERRAIN_CONTROLLER\\?\\.setExaggeration\\(numericValue\\)/);\n"
        + "assert.match(bootstrap, /dem-lod-7\\.3\\.4\\.js/);\n"
    )
    text = replace_required(text, insertion, extra, 'runtime terrain architecture assertions')
    runtime.write_text(text, encoding='utf-8')

    smoke = ROOT / 'tests/map-smoke.mjs'
    smoke_text = smoke.read_text(encoding='utf-8').replace('7.3.3', '7.3.4')
    smoke.write_text(smoke_text, encoding='utf-8')


def validate_runtime_references() -> None:
    bootstrap = (ROOT / 'assets/bootstrap.js').read_text(encoding='utf-8')
    ui = (ROOT / 'assets/map-ui.js').read_text(encoding='utf-8')
    page = (ROOT / 'assets/map-page.js').read_text(encoding='utf-8')
    index = (ROOT / 'index.html').read_text(encoding='utf-8')
    controller = (ROOT / 'assets/dem-lod-7.3.4.js').read_text(encoding='utf-8')

    if 'dem-lod-7.3.3.js' in bootstrap:
        raise RuntimeError('bootstrap still loads the 7.3.3 LOD controller')
    if 'dem-lod-7.3.4.js' not in bootstrap:
        raise RuntimeError('bootstrap does not load the 7.3.4 TerrainController')
    if "terrain: {source:'terrain-dem'" in ui:
        raise RuntimeError('map-ui still enables terrain in initial style')
    if "map.setTerrain({source:'terrain-dem',exaggeration:numericValue});" in ui:
        raise RuntimeError('map-ui still owns relief terrain updates')
    if 'ALAN_MAP_TERRAIN_CONTROLLER?.setExaggeration(numericValue)' not in ui:
        raise RuntimeError('map-ui does not route relief updates to TerrainController')
    if "'alan-map-stage7.3.3-view'," not in ui:
        raise RuntimeError('7.3.3 legacy storage migration key missing')

    for name, source in [('bootstrap', bootstrap), ('map-page', page), ('index', index)]:
        if BASE_VERSION in source:
            raise RuntimeError(f'{name} contains stale runtime version {BASE_VERSION}')

    forbidden_controller_tokens = [
        'SOURCE_LOW', 'SOURCE_MEDIUM', 'SOURCE_HIGH', 'pendingSource', 'activeSource',
        'desiredWithHysteresis', 'SWITCH_HYSTERESIS', 'transitionToken',
        'terrain-dem-medium', 'terrain-dem-high', 'terrain-hillshade-medium', 'terrain-hillshade-high',
    ]
    for token in forbidden_controller_tokens:
        if token in controller:
            raise RuntimeError(f'7.3.4 controller still contains removed LOD token: {token}')

    if controller.count("source: SOURCE_ID") < 2:
        raise RuntimeError('7.3.4 controller does not consistently use the single terrain source')
    if OLD_DEM in controller or OLD_DEM in bootstrap or OLD_DEM in page:
        raise RuntimeError('obsolete DEM runtime reference remains')

    data = read_source_parts()
    validate_geography(data)
    dem = data['regionalDem']
    expected = {
        'archivePath': NEW_DEM,
        'tileSize': 256,
        'minzoom': 7,
        'maxzoom': 10,
        'highestNativeZoom': 10,
        'overzoomFrom': 10,
        'nativeZ8': True,
        'runtimeTerrainSources': 1,
        'transitionMode': 'single-source-enable-once-after-initial-dem-ready',
    }
    for key, value in expected.items():
        if dem.get(key) != value:
            raise RuntimeError(f'runtime DEM contract mismatch: {key}={dem.get(key)!r}, expected {value!r}')
    if dem.get('physicalNativeZooms') != [7, 8, 9, 10]:
        raise RuntimeError('runtime DEM native zooms are not z7/z8/z9/z10')


def finalize(dem_path: Path, build_report_path: Path, validation_report_path: Path, collar_report_path: Path) -> None:
    for path in (dem_path, build_report_path, validation_report_path, collar_report_path):
        if not path.exists() or path.stat().st_size <= 0:
            raise RuntimeError(f'missing 7.3.4 build output: {path}')

    build_report = json.loads(build_report_path.read_text(encoding='utf-8'))
    validation_report = json.loads(validation_report_path.read_text(encoding='utf-8'))
    collar_report = json.loads(collar_report_path.read_text(encoding='utf-8'))
    if build_report.get('tile_size') != 256:
        raise RuntimeError(f"builder emitted wrong tile size: {build_report.get('tile_size')}")
    if build_report.get('physical_native_zooms') != [7, 8, 9, 10]:
        raise RuntimeError('builder native zoom contract mismatch')
    if build_report.get('z8_lineage') != Z8_LINEAGE:
        raise RuntimeError('builder z8 lineage mismatch')
    if not validation_report.get('valid') or validation_report.get('native_zooms') != [7, 8, 9, 10]:
        raise RuntimeError('DEM validation failed')
    if validation_report.get('tile_size') != 256 or not validation_report.get('no_native_tiles_after_z10'):
        raise RuntimeError('DEM validation did not prove 256px/z10 overzoom contract')

    target = ROOT / NEW_DEM
    if dem_path.resolve() != target.resolve():
        shutil.copy2(dem_path, target)
    dem_bytes = target.stat().st_size
    dem_sha256 = sha256(target)

    patch_bootstrap()
    patch_map_page()
    patch_map_ui()
    patch_index()
    patch_runtime_payloads(dem_bytes, dem_sha256)
    patch_readme()
    patch_reports(dem_bytes, dem_sha256, build_report, validation_report, collar_report)
    patch_tests()
    validate_runtime_references()

    print(json.dumps({
        'version': VERSION,
        'demArchive': NEW_DEM,
        'demBytes': dem_bytes,
        'demSha256': dem_sha256,
        'tileSize': 256,
        'physicalNativeZooms': [7, 8, 9, 10],
        'runtimeTerrainSources': 1,
        'sourceSwitching': False,
    }, ensure_ascii=False, indent=2))


def validate() -> None:
    validate_runtime_references()
    dem_path = ROOT / NEW_DEM
    if not dem_path.exists() or dem_path.stat().st_size <= 0:
        raise RuntimeError('7.3.4 DEM archive missing')
    for path in [
        ROOT / 'data/dem-lod-report-7.3.4.json',
        ROOT / 'data/runtime-loading-report-7.3.4.json',
        ROOT / 'assets/dem-lod-7.3.4.js',
    ]:
        if not path.exists() or path.stat().st_size <= 0:
            raise RuntimeError(f'missing 7.3.4 release file: {path}')
    print(json.dumps({'version': VERSION, 'valid': True, 'demBytes': dem_path.stat().st_size}, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description='Prepare/finalize Alan Map 7.3.4 unified terrain release.')
    subparsers = parser.add_subparsers(dest='command', required=True)
    subparsers.add_parser('prepare')

    finalize_parser = subparsers.add_parser('finalize')
    finalize_parser.add_argument('--dem', type=Path, required=True)
    finalize_parser.add_argument('--build-report', type=Path, required=True)
    finalize_parser.add_argument('--validation-report', type=Path, required=True)
    finalize_parser.add_argument('--collar-report', type=Path, required=True)

    subparsers.add_parser('validate')
    args = parser.parse_args()

    if args.command == 'prepare':
        prepare()
    elif args.command == 'finalize':
        finalize(args.dem, args.build_report, args.validation_report, args.collar_report)
    elif args.command == 'validate':
        validate()


if __name__ == '__main__':
    main()
