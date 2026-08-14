#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

import release_7_0_25 as base

ROOT = Path(__file__).resolve().parents[1]
VERSION = '7.2'
PREVIOUS_VERSION = '7.1'
RELEASE_TAG = '7.2-r1'
DEM_ARCHIVE = f'data/alan-dem-{VERSION}.pmtiles'
VECTOR_ARCHIVE = f'data/alan-vector-{VERSION}.pmtiles'
LANDCOVER_ARCHIVE = 'data/alan-landcover-7.0.25.pmtiles'
BASELINE_DEM_BYTES_71 = 89_296_988
BASELINE_VECTOR_BYTES = 16_913_027
BASELINE_VECTOR_SHA256 = '1d8d9417aeeba39147e7db2a6680d2032b7876633d1031f3a6fe93dde96d17fb'
DATA_VERSION = '7.2-range-streaming-lod.1'

base.VERSION = VERSION
base.PREVIOUS_VERSION = PREVIOUS_VERSION
base.RELEASE_TAG = RELEASE_TAG
base.DEM_ARCHIVE = DEM_ARCHIVE
base.VECTOR_ARCHIVE = VECTOR_ARCHIVE
base.LANDCOVER_ARCHIVE = LANDCOVER_ARCHIVE


def replace_version_tokens(path: Path) -> None:
    text = path.read_text(encoding='utf-8')
    text = text.replace('7.1-r1', RELEASE_TAG)
    text = text.replace("'7.1'", "'7.2'")
    text = text.replace('"7.1"', '"7.2"')
    text = text.replace('Alan Map 7.1', 'Alan Map 7.2')
    path.write_text(text, encoding='utf-8')


def patch_runtime_versions() -> None:
    ui = ROOT / 'assets/map-ui.js'
    page = ROOT / 'assets/map-page.js'
    presentation = ROOT / 'assets/map-presentation.js'
    bootstrap = ROOT / 'assets/bootstrap.js'
    index = ROOT / 'index.html'
    runtime_test = ROOT / 'tests/runtime-contract.mjs'
    smoke_test = ROOT / 'tests/map-smoke.mjs'

    base.replace_required(ui, "const VERSION = '7.1';", "const VERSION = '7.2';", 'map-ui version')
    base.replace_required(ui, "const DEFAULT_STORAGE_KEY = 'alan-map-stage7.1-view';", "const DEFAULT_STORAGE_KEY = 'alan-map-stage7.2-view';", 'map-ui storage key')
    ui_text = ui.read_text(encoding='utf-8')
    if "'alan-map-stage7.1-view'," not in ui_text:
        ui_text = ui_text.replace("const LEGACY_STORAGE_KEYS = [\n", "const LEGACY_STORAGE_KEYS = [\n    'alan-map-stage7.1-view',\n", 1)
    ui_text = ui_text.replace('Alan Map · 7.1', 'Alan Map · 7.2')
    ui.write_text(ui_text, encoding='utf-8')

    base.replace_required(page, "const VERSION = '7.1';", "const VERSION = '7.2';", 'map-page version')

    presentation_text = presentation.read_text(encoding='utf-8')
    presentation_text = re.sub(r"const VERSION = '7\.1-r1';", f"const VERSION = '{RELEASE_TAG}';", presentation_text, count=1)
    if f"const VERSION = '{RELEASE_TAG}';" not in presentation_text:
        raise RuntimeError('map-presentation version patch failed')
    presentation.write_text(presentation_text, encoding='utf-8')

    bootstrap_text = bootstrap.read_text(encoding='utf-8')
    bootstrap_text = re.sub(r"const RELEASE = '[^']+';", f"const RELEASE = '{RELEASE_TAG}';", bootstrap_text, count=1)
    if f"const RELEASE = '{RELEASE_TAG}';" not in bootstrap_text:
        raise RuntimeError('bootstrap release patch failed')
    bootstrap.write_text(bootstrap_text, encoding='utf-8')

    index_text = index.read_text(encoding='utf-8')
    index_text = index_text.replace('Alan Map 7.1', 'Alan Map 7.2')
    index_text = re.sub(r'7\.1-r[0-9]+', RELEASE_TAG, index_text)
    index_text = re.sub(r'assets/map\.css\?v=[^"\']+', f'assets/map.css?v={RELEASE_TAG}', index_text)
    index_text = re.sub(r'assets/bootstrap\.js\?v=[^"\']+', f'assets/bootstrap.js?v={RELEASE_TAG}', index_text)
    index_text = re.sub(r'assets/map-presentation\.js\?v=[^"\']+', f'assets/map-presentation.js?v={RELEASE_TAG}', index_text)
    index_text = re.sub(r'<!-- Alan Map [^>]+ presentation -->', f'<!-- Alan Map {RELEASE_TAG} presentation -->', index_text)
    if RELEASE_TAG not in index_text or 'Alan Map 7.2' not in index_text:
        raise RuntimeError('index version/cache patch failed')
    index.write_text(index_text, encoding='utf-8')

    replace_version_tokens(runtime_test)
    replace_version_tokens(smoke_test)


def write_docs() -> None:
    corners_text = ', '.join(f'[{lon:.6f}, {lat:.6f}]' for lon, lat in base.TARGET_CORNERS)
    content = (
        f'# Alan Map {VERSION}\n\n'
        f'Интерактивная 3D-карта Alan Til на MapLibre GL JS. Рабочая область — повёрнутый прямоугольник по четырём углам: {corners_text}. '
        f'Технический envelope: `{base.TARGET_BOUNDS}`; центр: `{base.TARGET_CENTER}`. '
        'Геометрия, векторные слои и визуальная композиция унаследованы без изменения от 7.1.\n\n'
        'Версия 7.2 переводит локальные PMTiles с крупных shard-загрузок на HTTP Range: браузер получает только требуемые диапазоны DEM и vector архивов. '
        'DEM остаётся одной визуально непрерывной 3D-поверхностью, но хранится как стандартная многоуровневая пирамида z7–z12; MapLibre выбирает нужный LOD по масштабу без отключения слоёв. '
        'После остановки камеры четыре соседних тайла тихо прогреваются в idle-время и попадают в ограниченный RAM-кэш диапазонов.\n\n'
        'Рельеф Copernicus DEM GLO-30 физически обрезан по mapFrame, высоты квантованы до 1 м. '
        'Полностью заполненные DEM-тайлы сохраняются как RGB PNG, пограничные/NoData — как RGBA PNG; PNG кодируются lossless с максимальной zlib-оптимизацией. '
        'Никакие подписи, леса, реки или декоративные слои не скрываются во время движения карты.\n'
    )
    (ROOT / 'README.md').write_text(content, encoding='utf-8')


base.patch_runtime_versions = patch_runtime_versions
base.write_docs = write_docs


def prepare() -> None:
    base.prepare()


def finalize(dem: Path, vector: Path) -> None:
    if not dem.exists():
        raise RuntimeError(f'DEM PMTiles missing: {dem}')
    if not vector.exists():
        raise RuntimeError(f'vector PMTiles missing: {vector}')
    if vector.stat().st_size != BASELINE_VECTOR_BYTES or base.sha256(vector) != BASELINE_VECTOR_SHA256:
        raise RuntimeError('reconstructed 7.0.25 vector archive differs from verified baseline')

    data = base.read_data()
    bounds = list(base.TARGET_BOUNDS)
    for key in ('applicationVersion','version','stage'):
        data[key] = VERSION
    data['dataVersion'] = DATA_VERSION
    data['mapFrame'] = base.frame_collection('map_frame')
    data['focus'] = base.frame_collection('focus')
    data['frameMask'] = base.frame_mask_collection()
    data['frameClip'] = None
    data['bounds'] = bounds
    data['center'] = list(base.TARGET_CENTER)
    data['regionalDem'] = {
        **(data.get('regionalDem') or {}),
        'available':True,
        'archivePath':DEM_ARCHIVE,
        'minzoom':7,
        'maxzoom':12,
        'tileSize':256,
        'encoding':'mapbox',
        'bounds':bounds,
        'physicallyClipped':True,
        'physicalClipGeometry':'mapFrame',
        'outsideTilesRemoved':True,
        'outsidePixelsTransparent':True,
        'source':'Copernicus DEM GLO-30',
        'sourceSnapshot':'Copernicus DEM GLO-30 public COGs',
        'attribution':'Copernicus DEM GLO-30',
        'heightQuantizationM':1,
        'lodModel':'single-pyramid-z7-z12',
        'streamingMode':'http-range',
        'tileContainer':'PMTiles',
        'tileImageFormat':'PNG lossless mixed RGB/RGBA',
    }
    if isinstance(data.get('regionalVector'),dict):
        data['regionalVector']['archivePath'] = VECTOR_ARCHIVE
        data['regionalVector']['bounds'] = bounds
        data['regionalVector']['physicallyClipped'] = True
        data['regionalVector']['streamingMode'] = 'http-range'
        data['regionalVector']['reusedFrom'] = '7.0.25'

    base.apply_presentation_overrides(data)
    base.write_data(data)

    dem_destination = ROOT / DEM_ARCHIVE
    vector_destination = ROOT / VECTOR_ARCHIVE
    dem_destination.parent.mkdir(parents=True,exist_ok=True)
    if dem.resolve() != dem_destination.resolve():
        shutil.copy2(dem,dem_destination)
    if vector.resolve() != vector_destination.resolve():
        shutil.copy2(vector,vector_destination)

    # 7.2 serves the actual PMTiles archives with HTTP Range. The previous
    # concatenated shard transport is removed so there is no duplicate payload.
    shutil.rmtree(ROOT / 'data/shards',ignore_errors=True)
    (ROOT / 'data/shards-manifest.json').unlink(missing_ok=True)
    (ROOT / 'data/alan-dem-7.1.pmtiles').unlink(missing_ok=True)
    (ROOT / 'data/alan-vector-7.0.25.pmtiles').unlink(missing_ok=True)

    old_copernicus = json.loads((ROOT / 'data/copernicus-build-manifest.json').read_text(encoding='utf-8'))
    generated_at = datetime.now(timezone.utc).isoformat()
    copernicus_manifest = {
        'version':VERSION,
        'generated_at':generated_at,
        'bounds':bounds,
        'dem':{
            'source':'Copernicus DEM GLO-30',
            'archive':DEM_ARCHIVE,
            'bytes':dem_destination.stat().st_size,
            'sha256':base.sha256(dem_destination),
            'physical_clip':'rotated mapFrame polygon',
            'outside_tiles_removed':True,
            'outside_pixels_transparent':True,
            'height_quantization_m':1,
            'lod_model':'single-pyramid-z7-z12',
            'streaming':'http-range',
            'baseline_bytes_7_1':BASELINE_DEM_BYTES_71,
        },
        'landcover':old_copernicus.get('landcover') or {'source':'Copernicus CLMS LCM-10','year':2020,'archive':None,'available':False},
        'vector':{
            'source':'OpenStreetMap / Geofabrik',
            'archive':VECTOR_ARCHIVE,
            'bytes':vector_destination.stat().st_size,
            'sha256':base.sha256(vector_destination),
            'reused_from':'7.0.25',
            'streaming':'http-range',
        },
    }
    (ROOT / 'data/copernicus-build-manifest.json').write_text(json.dumps(copernicus_manifest,ensure_ascii=False,indent=2),encoding='utf-8')

    old_vector_manifest = json.loads((ROOT / 'data/vector-build-manifest.json').read_text(encoding='utf-8'))
    old_vector_manifest['version'] = VERSION
    old_vector_manifest['generated_at'] = generated_at
    archive_record = old_vector_manifest.get('archive') or {}
    archive_record = {
        'logical_path':VECTOR_ARCHIVE,
        'byte_length':vector_destination.stat().st_size,
        'sha256':base.sha256(vector_destination),
        'streaming':'http-range',
        'reused_from':'7.0.25',
    }
    old_vector_manifest['archive'] = archive_record
    old_vector_manifest['physical_clip'] = 'rotated mapFrame polygon; geometry unchanged from verified 7.0.25 payload'
    (ROOT / 'data/vector-build-manifest.json').write_text(json.dumps(old_vector_manifest,ensure_ascii=False,indent=2),encoding='utf-8')

    (ROOT / 'data/streaming-build-manifest.json').write_text(json.dumps({
        'version':VERSION,
        'generated_at':generated_at,
        'transport':'direct PMTiles HTTP Range',
        'range_cache':{'max_entries':256,'max_bytes_default':40 * 1024 * 1024,'adaptive_for_low_memory':True},
        'neighbor_prefetch':{'enabled':True,'neighbors':4,'timing':'idle after moveend','disabled_on_save_data_or_2g':True},
        'visual_layer_hiding_during_motion':False,
        'performance_diagnostics':'window.ALAN_MAP_PERFORMANCE_DIAGNOSTICS()',
    },ensure_ascii=False,indent=2),encoding='utf-8')
    write_docs()


def validate() -> None:
    data = base.read_data()
    if any(data.get(key) != VERSION for key in ('version','applicationVersion','stage')):
        raise RuntimeError('version mismatch')
    if data.get('dataVersion') != DATA_VERSION:
        raise RuntimeError('dataVersion mismatch')
    if data.get('bounds') != base.TARGET_BOUNDS or data.get('center') != base.TARGET_CENTER:
        raise RuntimeError('bounds/center mismatch')

    expected_ring = base.frame_ring()
    for key in ('mapFrame','focus'):
        if data[key]['features'][0]['geometry']['coordinates'][0] != expected_ring:
            raise RuntimeError(f'{key} rotated rectangle mismatch')
    mask_coordinates = data.get('frameMask',{}).get('features',[{}])[0].get('geometry',{}).get('coordinates',[])
    if len(mask_coordinates) != 2 or mask_coordinates[1] != list(reversed(expected_ring)):
        raise RuntimeError('frameMask mismatch')
    if data.get('frameClip') is not None:
        raise RuntimeError('CSS frameClip must remain disabled')

    dem = data.get('regionalDem') or {}
    if dem.get('archivePath') != DEM_ARCHIVE or dem.get('streamingMode') != 'http-range':
        raise RuntimeError('7.2 DEM streaming configuration mismatch')
    if dem.get('lodModel') != 'single-pyramid-z7-z12' or dem.get('heightQuantizationM') != 1:
        raise RuntimeError('7.2 DEM LOD/quantization configuration mismatch')
    for key in ('physicallyClipped','outsideTilesRemoved','outsidePixelsTransparent'):
        if dem.get(key) is not True:
            raise RuntimeError(f'7.2 DEM physical crop flag missing: {key}')

    vector = data.get('regionalVector') or {}
    if vector.get('archivePath') != VECTOR_ARCHIVE or vector.get('streamingMode') != 'http-range':
        raise RuntimeError('7.2 vector streaming configuration mismatch')

    dem_path = ROOT / DEM_ARCHIVE
    vector_path = ROOT / VECTOR_ARCHIVE
    if not dem_path.exists() or not vector_path.exists():
        raise RuntimeError('direct PMTiles archives are missing')
    if dem_path.stat().st_size >= BASELINE_DEM_BYTES_71:
        raise RuntimeError(f'7.2 DEM was not reduced: {dem_path.stat().st_size} >= {BASELINE_DEM_BYTES_71}')
    if dem_path.stat().st_size >= 100_000_000 or vector_path.stat().st_size >= 100_000_000:
        raise RuntimeError('direct PMTiles archive exceeds GitHub single-file limit target')
    if vector_path.stat().st_size != BASELINE_VECTOR_BYTES or base.sha256(vector_path) != BASELINE_VECTOR_SHA256:
        raise RuntimeError('verified vector payload changed unexpectedly')
    if (ROOT / 'data/shards').exists() or (ROOT / 'data/shards-manifest.json').exists():
        raise RuntimeError('legacy shard transport must be removed in 7.2')

    required_regions = {'ULLU QARAÇAY','MALQAR','BIZIÑGI','HOLAM','ÇEGEM','BASXAN','TEBERDİ','ARXIZ','NARSANA','MARA','SXAWAT'}
    seen = set()
    for feature in (data.get('regionalLabels') or {}).get('features') or []:
        props = feature.get('properties') or {}
        name = str(props.get('name_alan_latin') or props.get('name_map') or props.get('name_ru') or '')
        if name in required_regions:
            seen.add(name)
            for lon,lat in base.coordinate_pairs((feature.get('geometry') or {}).get('coordinates')):
                if not base.point_in_frame(lon,lat):
                    raise RuntimeError(f'regional label {name} is outside rotated crop')
    if seen != required_regions:
        raise RuntimeError(f'missing required regional labels: {sorted(required_regions - seen)}')

    for feature in (data.get('boundaries') or {}).get('features') or []:
        properties = feature.get('properties') or {}
        if properties.get('boundary_id') == base.HISTORICAL_ETHNOGRAPHIC_BOUNDARY_ID or properties.get('boundary_type') == 'historical_ethnographic':
            raise RuntimeError('historical ethnographic Karachay-Balkar divide must remain removed')

    bootstrap = (ROOT / 'assets/bootstrap.js').read_text(encoding='utf-8')
    ui = (ROOT / 'assets/map-ui.js').read_text(encoding='utf-8')
    page = (ROOT / 'assets/map-page.js').read_text(encoding='utf-8')
    presentation = (ROOT / 'assets/map-presentation.js').read_text(encoding='utf-8')
    index = (ROOT / 'index.html').read_text(encoding='utf-8')
    if "'alan-map-stage7.1-view'," not in ui:
        raise RuntimeError('7.1 camera state migration key missing')
    if 'ShardLruCache' in page or 'ShardedPmtilesSource' in page or 'shards-manifest' in page:
        raise RuntimeError('legacy sharded PMTiles runtime remains')
    for required in ('FetchSource','InstrumentedRangeSource','RangeLruCache','ALAN_MAP_PERFORMANCE_DIAGNOSTICS','installPrefetch'):
        if required not in page:
            raise RuntimeError(f'7.2 range/performance runtime missing: {required}')
    if 'if (moving) setVisibility' in ui or 'qualityProfile.forestPattern && !moving' in ui:
        raise RuntimeError('visual layers still disappear while map is moving')
    if 'maxTileCacheSize: 128' not in ui or 'maxTileCacheSize: 192' not in ui:
        raise RuntimeError('7.2 tile-cache profiles missing')
    for source_name,source in (('bootstrap',bootstrap),('ui',ui),('page',page),('presentation',presentation),('index',index)):
        if source_name != 'ui' and PREVIOUS_VERSION in source:
            raise RuntimeError(f'stale {PREVIOUS_VERSION} runtime reference remains in {source_name}')
    if RELEASE_TAG not in bootstrap or RELEASE_TAG not in presentation or RELEASE_TAG not in index:
        raise RuntimeError('cache-busting release tag mismatch')

    manifest = json.loads((ROOT / 'data/copernicus-build-manifest.json').read_text(encoding='utf-8'))
    if manifest.get('version') != VERSION or int((manifest.get('dem') or {}).get('bytes') or 0) != dem_path.stat().st_size:
        raise RuntimeError('Copernicus manifest mismatch')
    if not (ROOT / 'data/streaming-build-manifest.json').exists():
        raise RuntimeError('streaming build manifest missing')
    vector_manifest = json.loads((ROOT / 'data/vector-build-manifest.json').read_text(encoding='utf-8'))
    vector_archive_record = vector_manifest.get('archive') or {}
    if vector_archive_record.get('logical_path') != VECTOR_ARCHIVE or vector_archive_record.get('streaming') != 'http-range':
        raise RuntimeError('vector build manifest still describes shard transport')

    print(f'release-{VERSION} validation: ok; DEM {dem_path.stat().st_size} bytes vs {BASELINE_DEM_BYTES_71} in 7.1')


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest='command',required=True)
    sub.add_parser('prepare')
    final = sub.add_parser('finalize')
    final.add_argument('--dem',required=True)
    final.add_argument('--vector',required=True)
    sub.add_parser('validate')
    args = parser.parse_args()
    if args.command == 'prepare':
        prepare()
    elif args.command == 'finalize':
        finalize(Path(args.dem),Path(args.vector))
    else:
        validate()


if __name__ == '__main__':
    main()
