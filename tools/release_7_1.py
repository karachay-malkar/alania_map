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
VERSION = '7.1'
PREVIOUS_VERSION = '7.0.25'
RELEASE_TAG = '7.1-r1'
DEM_ARCHIVE = f'data/alan-dem-{VERSION}.pmtiles'
VECTOR_ARCHIVE = 'data/alan-vector-7.0.25.pmtiles'
LANDCOVER_ARCHIVE = 'data/alan-landcover-7.0.25.pmtiles'
BASELINE_DEM_BYTES = 408_983_932
DATA_VERSION = '7.1-physical-dem-polygon-crop.1'

base.VERSION = VERSION
base.PREVIOUS_VERSION = PREVIOUS_VERSION
base.RELEASE_TAG = RELEASE_TAG
base.DEM_ARCHIVE = DEM_ARCHIVE
base.VECTOR_ARCHIVE = VECTOR_ARCHIVE
base.LANDCOVER_ARCHIVE = LANDCOVER_ARCHIVE


def replace_version_tokens(path: Path) -> None:
    text = path.read_text(encoding='utf-8')
    text = text.replace('7.0.25-r4', RELEASE_TAG)
    text = text.replace('7.0.25-r3', RELEASE_TAG)
    text = text.replace('7.0.25', VERSION)
    path.write_text(text, encoding='utf-8')


def patch_runtime_versions() -> None:
    ui = ROOT / 'assets/map-ui.js'
    page = ROOT / 'assets/map-page.js'
    presentation = ROOT / 'assets/map-presentation.js'
    bootstrap = ROOT / 'assets/bootstrap.js'
    index = ROOT / 'index.html'
    runtime_test = ROOT / 'tests/runtime-contract.mjs'
    smoke_test = ROOT / 'tests/map-smoke.mjs'

    base.replace_required(ui, f"const VERSION = '{PREVIOUS_VERSION}';", f"const VERSION = '{VERSION}';", 'map-ui version')
    base.replace_required(ui, f"const DEFAULT_STORAGE_KEY = 'alan-map-stage{PREVIOUS_VERSION}-view';", f"const DEFAULT_STORAGE_KEY = 'alan-map-stage{VERSION}-view';", 'map-ui storage key')
    base.replace_required(ui, f'Alan Map · {PREVIOUS_VERSION}', f'Alan Map · {VERSION}', 'map-ui title')
    base.replace_required(page, f"const VERSION = '{PREVIOUS_VERSION}';", f"const VERSION = '{VERSION}';", 'map-page version')

    presentation_text = presentation.read_text(encoding='utf-8')
    presentation_text = re.sub(r"const VERSION = '7\.0\.25-r4';", f"const VERSION = '{RELEASE_TAG}';", presentation_text, count=1)
    if f"const VERSION = '{RELEASE_TAG}';" not in presentation_text:
        raise RuntimeError('map-presentation version patch failed')
    presentation.write_text(presentation_text, encoding='utf-8')

    bootstrap_text = bootstrap.read_text(encoding='utf-8')
    bootstrap_text = re.sub(r"const RELEASE = '[^']+';", f"const RELEASE = '{RELEASE_TAG}';", bootstrap_text, count=1)
    if f"const RELEASE = '{RELEASE_TAG}';" not in bootstrap_text:
        raise RuntimeError('bootstrap release tag patch failed')
    bootstrap.write_text(bootstrap_text, encoding='utf-8')

    index_text = index.read_text(encoding='utf-8')
    index_text = index_text.replace('Alan Map 7.0.25', f'Alan Map {VERSION}')
    index_text = re.sub(r'7\.0\.25-r[0-9]+', RELEASE_TAG, index_text)
    index_text = re.sub(r'assets/map\.css\?v=[^"\']+', f'assets/map.css?v={RELEASE_TAG}', index_text)
    index_text = re.sub(r'assets/bootstrap\.js\?v=[^"\']+', f'assets/bootstrap.js?v={RELEASE_TAG}', index_text)
    index_text = re.sub(r'assets/map-presentation\.js\?v=[^"\']+', f'assets/map-presentation.js?v={RELEASE_TAG}', index_text)
    if RELEASE_TAG not in index_text or f'Alan Map {VERSION}' not in index_text:
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
        'OSM-векторы сохранены из проверенной 7.0.25 и уже физически обрезаны по рамке.\n\n'
        'В 7.1 DEM Copernicus GLO-30 физически обрезан по polygon-cutline mapFrame до упаковки PMTiles: '
        'тайлы, не пересекающие рамку, удаляются; у пограничных тайлов пиксели вне рамки прозрачны. '
        'Runtime-маска остаётся только визуальным оформлением края и больше не скрывает полноценный DEM за пределами рамки. '
        'Север визуально ориентирован вниз (bearing 180°); географические координаты остаются стандартными.\n\n'
        '3D-рельеф: Copernicus DEM GLO-30. Дороги, реки, водоёмы, residential, ледники/снег и вершины: '
        'локальный OpenStreetMap/Geofabrik PMTiles из 7.0.25. Copernicus CLMS LCM-10 не пересобирается в этой версии.\n'
    )
    (ROOT / 'README.md').write_text(content, encoding='utf-8')


base.patch_runtime_versions = patch_runtime_versions
base.write_docs = write_docs


def prepare() -> None:
    base.prepare()


def finalize(dem: Path) -> None:
    if not dem.exists():
        raise RuntimeError(f'DEM PMTiles missing: {dem}')

    data = base.read_data()
    bounds = list(base.TARGET_BOUNDS)
    for key in ('applicationVersion', 'version', 'stage'):
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
        'available': True,
        'archivePath': DEM_ARCHIVE,
        'minzoom': 7,
        'maxzoom': 12,
        'tileSize': 256,
        'encoding': 'mapbox',
        'bounds': bounds,
        'physicallyClipped': True,
        'physicalClipGeometry': 'mapFrame',
        'outsideTilesRemoved': True,
        'outsidePixelsTransparent': True,
        'source': 'Copernicus DEM GLO-30',
        'sourceSnapshot': 'Copernicus DEM GLO-30 public COGs',
        'attribution': 'Copernicus DEM GLO-30',
    }
    if isinstance(data.get('regionalVector'), dict):
        data['regionalVector']['archivePath'] = VECTOR_ARCHIVE
        data['regionalVector']['bounds'] = bounds
        data['regionalVector']['physicallyClipped'] = True

    base.apply_presentation_overrides(data)
    base.write_data(data)

    destination = ROOT / DEM_ARCHIVE
    destination.parent.mkdir(parents=True, exist_ok=True)
    if dem.resolve() != destination.resolve():
        shutil.copy2(dem, destination)

    manifest_path = ROOT / 'data/shards-manifest.json'
    previous_manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    previous_archives = previous_manifest.get('archives') or {}
    archives = {logical: record for logical, record in previous_archives.items() if logical != f'data/alan-dem-{PREVIOUS_VERSION}.pmtiles'}
    if VECTOR_ARCHIVE not in archives:
        raise RuntimeError(f'Expected preserved vector archive missing from baseline manifest: {VECTOR_ARCHIVE}')
    archives[DEM_ARCHIVE] = base.shard_archive(destination, DEM_ARCHIVE)

    generated_at = datetime.now(timezone.utc).isoformat()
    manifest_path.write_text(
        json.dumps({'schema_version': 1, 'generated_at': generated_at, 'archives': archives}, ensure_ascii=False, indent=2),
        encoding='utf-8',
    )

    old_copernicus = json.loads((ROOT / 'data/copernicus-build-manifest.json').read_text(encoding='utf-8'))
    old_vector = old_copernicus.get('vector') or {}
    copernicus_manifest = {
        'version': VERSION,
        'bounds': bounds,
        'dem': {
            'source': 'Copernicus DEM GLO-30',
            'archive': DEM_ARCHIVE,
            'bytes': destination.stat().st_size,
            'sha256': base.sha256(destination),
            'physical_clip': 'rotated mapFrame polygon',
            'outside_tiles_removed': True,
            'outside_pixels_transparent': True,
            'baseline_bytes_7_0_25': BASELINE_DEM_BYTES,
        },
        'landcover': old_copernicus.get('landcover') or {'source': 'Copernicus CLMS LCM-10', 'year': 2020, 'archive': None, 'available': False},
        'vector': {**old_vector, 'archive': VECTOR_ARCHIVE, 'reused_from': PREVIOUS_VERSION},
    }
    (ROOT / 'data/copernicus-build-manifest.json').write_text(json.dumps(copernicus_manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    write_docs()


def validate() -> None:
    data = base.read_data()
    if data.get('version') != VERSION or data.get('applicationVersion') != VERSION or data.get('stage') != VERSION:
        raise RuntimeError('version mismatch')
    if data.get('dataVersion') != DATA_VERSION:
        raise RuntimeError(f'dataVersion mismatch: {data.get("dataVersion")}')
    if data.get('bounds') != base.TARGET_BOUNDS or data.get('center') != base.TARGET_CENTER:
        raise RuntimeError('bounds/center mismatch')

    expected_ring = base.frame_ring()
    for key in ('mapFrame', 'focus'):
        ring = data[key]['features'][0]['geometry']['coordinates'][0]
        if ring != expected_ring:
            raise RuntimeError(f'{key} rotated rectangle mismatch')
    mask_coordinates = data.get('frameMask', {}).get('features', [{}])[0].get('geometry', {}).get('coordinates', [])
    if len(mask_coordinates) != 2 or mask_coordinates[1] != list(reversed(expected_ring)):
        raise RuntimeError('frameMask mismatch')
    if data.get('frameClip') is not None:
        raise RuntimeError('CSS frameClip must remain disabled')

    dem = data.get('regionalDem') or {}
    if dem.get('archivePath') != DEM_ARCHIVE or dem.get('bounds') != base.TARGET_BOUNDS:
        raise RuntimeError('7.1 DEM archive/bounds mismatch')
    if dem.get('encoding') != 'mapbox' or dem.get('source') != 'Copernicus DEM GLO-30':
        raise RuntimeError('7.1 DEM runtime configuration mismatch')
    for key in ('physicallyClipped', 'outsideTilesRemoved', 'outsidePixelsTransparent'):
        if dem.get(key) is not True:
            raise RuntimeError(f'7.1 DEM physical crop flag missing: {key}')

    vector = data.get('regionalVector') or {}
    if vector.get('archivePath') != VECTOR_ARCHIVE or vector.get('bounds') != base.TARGET_BOUNDS:
        raise RuntimeError('verified 7.0.25 vector archive changed unexpectedly')

    required_regions = {'ULLU QARAÇAY', 'MALQAR', 'BIZIÑGI', 'HOLAM', 'ÇEGEM', 'BASXAN', 'TEBERDİ', 'ARXIZ', 'NARSANA', 'MARA', 'SXAWAT'}
    seen = set()
    for feature in (data.get('regionalLabels') or {}).get('features') or []:
        props = feature.get('properties') or {}
        name = str(props.get('name_alan_latin') or props.get('name_map') or props.get('name_ru') or '')
        if name in required_regions:
            seen.add(name)
            for lon, lat in base.coordinate_pairs((feature.get('geometry') or {}).get('coordinates')):
                if not base.point_in_frame(lon, lat):
                    raise RuntimeError(f'regional label {name} is outside rotated crop')
    if seen != required_regions:
        raise RuntimeError(f'missing required regional labels: {sorted(required_regions - seen)}')

    for feature in (data.get('regionalLabels') or {}).get('features') or []:
        scale = float((feature.get('properties') or {}).get('display_icon_scale') or 0)
        if abs(scale - base.REGIONAL_LABEL_NARSANA_SCALE) > 1e-6:
            raise RuntimeError(f'regional label scale is not normalized to NARSANA: {scale}')

    for feature in (data.get('boundaries') or {}).get('features') or []:
        properties = feature.get('properties') or {}
        if properties.get('boundary_id') == base.HISTORICAL_ETHNOGRAPHIC_BOUNDARY_ID or properties.get('boundary_type') == 'historical_ethnographic':
            raise RuntimeError('historical ethnographic Karachay-Balkar divide must remain removed')

    bootstrap = (ROOT / 'assets/bootstrap.js').read_text(encoding='utf-8')
    ui = (ROOT / 'assets/map-ui.js').read_text(encoding='utf-8')
    page = (ROOT / 'assets/map-page.js').read_text(encoding='utf-8')
    presentation = (ROOT / 'assets/map-presentation.js').read_text(encoding='utf-8')
    index = (ROOT / 'index.html').read_text(encoding='utf-8')
    for source_name, source in (('bootstrap', bootstrap), ('ui', ui), ('page', page), ('presentation', presentation), ('index', index)):
        if PREVIOUS_VERSION in source:
            raise RuntimeError(f'stale {PREVIOUS_VERSION} reference remains in {source_name}')
    if RELEASE_TAG not in bootstrap or RELEASE_TAG not in presentation or RELEASE_TAG not in index:
        raise RuntimeError('cache-busting release tag mismatch')
    if "encoding:String(data.regionalDem.encoding || 'terrarium')" not in ui:
        raise RuntimeError('dynamic DEM encoding missing')

    shards = json.loads((ROOT / 'data/shards-manifest.json').read_text(encoding='utf-8'))
    archives = shards.get('archives') or {}
    if DEM_ARCHIVE not in archives or VECTOR_ARCHIVE not in archives:
        raise RuntimeError(f'required archive missing from shards manifest: {sorted(archives)}')
    if f'data/alan-dem-{PREVIOUS_VERSION}.pmtiles' in archives:
        raise RuntimeError('old 7.0.25 DEM must not remain in active shards manifest')
    for logical, record in archives.items():
        total = 0
        for item in record['shards']:
            path = ROOT / record['parts_path'] / item['file']
            if not path.exists() or path.stat().st_size != item['size'] or base.sha256(path) != item['sha256']:
                raise RuntimeError(f'invalid shard {path}')
            total += path.stat().st_size
        if total != record['byte_length']:
            raise RuntimeError(f'shard total mismatch {logical}')

    dem_bytes = int(archives[DEM_ARCHIVE]['byte_length'])
    if dem_bytes >= BASELINE_DEM_BYTES:
        raise RuntimeError(f'7.1 DEM was not reduced: {dem_bytes} >= {BASELINE_DEM_BYTES}')

    manifest = json.loads((ROOT / 'data/copernicus-build-manifest.json').read_text(encoding='utf-8'))
    if manifest.get('version') != VERSION or int((manifest.get('dem') or {}).get('bytes') or 0) != dem_bytes:
        raise RuntimeError('Copernicus manifest mismatch')
    print(f'release-{VERSION} validation: ok; DEM {dem_bytes} bytes vs {BASELINE_DEM_BYTES} baseline')


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('prepare')
    final = sub.add_parser('finalize')
    final.add_argument('--dem', required=True)
    sub.add_parser('validate')
    args = parser.parse_args()
    if args.command == 'prepare':
        prepare()
    elif args.command == 'finalize':
        finalize(Path(args.dem))
    else:
        validate()


if __name__ == '__main__':
    main()
