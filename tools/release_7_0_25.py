#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PARTS = [ROOT / 'assets/map-data.part-000.js', ROOT / 'assets/map-data.part-001.js']
MARKER = 'window.ALAN_MAP_DATA = '
VERSION = '7.0.25'
PREVIOUS_VERSION = '7.0.24'
RELEASE_TAG = '7.0.25-r2'
TARGET_CORNERS = [
    [40.517840, 43.412650],  # south-west
    [43.731622, 42.734095],  # south-east
    [44.184003, 43.856420],  # north-east
    [40.970221, 44.534975],  # north-west
]
TARGET_BOUNDS = [
    min(point[0] for point in TARGET_CORNERS),
    min(point[1] for point in TARGET_CORNERS),
    max(point[0] for point in TARGET_CORNERS),
    max(point[1] for point in TARGET_CORNERS),
]
TARGET_CENTER = [
    round(sum(point[0] for point in TARGET_CORNERS) / len(TARGET_CORNERS), 6),
    round(sum(point[1] for point in TARGET_CORNERS) / len(TARGET_CORNERS), 6),
]
SHARD_SIZE = 786432
VECTOR_ARCHIVE = f'data/alan-vector-{VERSION}.pmtiles'
DEM_ARCHIVE = f'data/alan-dem-{VERSION}.pmtiles'
LANDCOVER_ARCHIVE = f'data/alan-landcover-{VERSION}.pmtiles'


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


def frame_ring() -> list[list[float]]:
    return [list(point) for point in TARGET_CORNERS] + [list(TARGET_CORNERS[0])]


def frame_collection(kind: str) -> dict:
    return {
        'type': 'FeatureCollection',
        'features': [{
            'type': 'Feature',
            'properties': {'kind': kind, 'visible': 1 if kind == 'focus' else 0},
            'geometry': {'type': 'Polygon', 'coordinates': [frame_ring()]},
        }],
    }


def frame_mask_collection() -> dict:
    west, south, east, north = TARGET_BOUNDS
    margin = 10.0
    outer = [
        [west - margin, south - margin],
        [east + margin, south - margin],
        [east + margin, north + margin],
        [west - margin, north + margin],
        [west - margin, south - margin],
    ]
    hole = list(reversed(frame_ring()))
    return {
        'type': 'FeatureCollection',
        'features': [{
            'type': 'Feature',
            'properties': {'kind': 'frame_mask', 'visible': 1},
            'geometry': {'type': 'Polygon', 'coordinates': [outer, hole]},
        }],
    }


def point_in_frame(lon: float, lat: float) -> bool:
    inside = False
    ring = frame_ring()
    for first, second in zip(ring, ring[1:]):
        x1, y1 = first
        x2, y2 = second
        if ((y1 > lat) != (y2 > lat)):
            x_cross = (x2 - x1) * (lat - y1) / (y2 - y1) + x1
            if lon < x_cross:
                inside = not inside
    return inside


def replace_required(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding='utf-8')
    if old not in text:
        if new in text:
            return
        raise RuntimeError(f'{label}: expected text not found in {path.relative_to(ROOT)}')
    path.write_text(text.replace(old, new), encoding='utf-8')


def patch_runtime_versions() -> None:
    ui = ROOT / 'assets/map-ui.js'
    page = ROOT / 'assets/map-page.js'
    bootstrap = ROOT / 'assets/bootstrap.js'
    index = ROOT / 'index.html'
    runtime_test = ROOT / 'tests/runtime-contract.mjs'

    replace_required(ui, f"const VERSION = '{PREVIOUS_VERSION}';", f"const VERSION = '{VERSION}';", 'map-ui version')
    replace_required(ui, f"const DEFAULT_STORAGE_KEY = 'alan-map-stage{PREVIOUS_VERSION}-view';", f"const DEFAULT_STORAGE_KEY = 'alan-map-stage{VERSION}-view';", 'map-ui storage key')
    replace_required(ui, f'Alan Map · {PREVIOUS_VERSION}', f'Alan Map · {VERSION}', 'map-ui title')
    replace_required(page, f"const VERSION = '{PREVIOUS_VERSION}';", f"const VERSION = '{VERSION}';", 'map-page version')

    bootstrap_text = bootstrap.read_text(encoding='utf-8')
    bootstrap_text = re.sub(r"const RELEASE = '[^']+';", f"const RELEASE = '{RELEASE_TAG}';", bootstrap_text, count=1)
    if f"const RELEASE = '{RELEASE_TAG}';" not in bootstrap_text:
        raise RuntimeError('bootstrap release tag patch failed')
    bootstrap.write_text(bootstrap_text, encoding='utf-8')

    index_text = index.read_text(encoding='utf-8')
    index_text = re.sub(r'Alan Map 7\.0\.24', f'Alan Map {VERSION}', index_text)
    index_text = re.sub(r'7\.0\.24-r\d+', RELEASE_TAG, index_text)
    index_text = index_text.replace(f'assets/map.css?v={PREVIOUS_VERSION}', f'assets/map.css?v={RELEASE_TAG}')
    index_text = index_text.replace(f'assets/bootstrap.js?v={PREVIOUS_VERSION}', f'assets/bootstrap.js?v={RELEASE_TAG}')
    index_text = re.sub(r'assets/map\.css\?v=[^"\']+', f'assets/map.css?v={RELEASE_TAG}', index_text)
    index_text = re.sub(r'assets/bootstrap\.js\?v=[^"\']+', f'assets/bootstrap.js?v={RELEASE_TAG}', index_text)
    if RELEASE_TAG not in index_text or f'Alan Map {VERSION}' not in index_text:
        raise RuntimeError('index version/cache patch failed')
    index.write_text(index_text, encoding='utf-8')

    test_text = runtime_test.read_text(encoding='utf-8').replace(PREVIOUS_VERSION, VERSION).replace(PREVIOUS_VERSION.replace('.', r'\.'), VERSION.replace('.', r'\.'))
    runtime_test.write_text(test_text, encoding='utf-8')


def write_docs() -> None:
    corners_text = ', '.join(f'[{lon:.6f}, {lat:.6f}]' for lon, lat in TARGET_CORNERS)
    content = (
        f'# Alan Map {VERSION}\n\n'
        f'Интерактивная 3D-карта Alan Til на MapLibre GL JS. Рабочая область задана повёрнутым прямоугольником по четырём углам: {corners_text}. '
        f'Технический envelope тайлов: `{TARGET_BOUNDS}`; центр: `{TARGET_CENTER}`. OSM-векторы физически обрезаются по контуру рамки, а внешний участок DEM/envelope закрывается runtime-маской без CSS clip-path. '
        'Север визуально ориентирован вниз (bearing 180°); географические координаты остаются стандартными.\n\n'
        '3D-рельеф: Copernicus DEM GLO-30. Дороги, реки, водоёмы, residential, ледники/снег и вершины: локальный OpenStreetMap/Geofabrik PMTiles. '
        'Copernicus CLMS LCM-10 подключается при наличии CDSE OAuth credentials; без них используется OSM forest fallback.\n'
    )
    (ROOT / 'README.md').write_text(content, encoding='utf-8')


def prepare() -> None:
    data = read_data()
    bounds = list(TARGET_BOUNDS)
    data['mapFrame'] = frame_collection('map_frame')
    data['focus'] = frame_collection('focus')
    data['frameMask'] = frame_mask_collection()
    data['frameClip'] = None
    data['bounds'] = bounds
    data['center'] = list(TARGET_CENTER)
    for key in ('regionalDem', 'regionalVector', 'regionalLandcover'):
        if isinstance(data.get(key), dict):
            data[key]['bounds'] = bounds
    for key in ('applicationVersion', 'version', 'stage'):
        data[key] = VERSION
    write_data(data)
    patch_runtime_versions()
    write_docs()

    build = ROOT / 'build'
    build.mkdir(exist_ok=True)
    (build / 'rectangular-bounds.json').write_text(json.dumps({'bounds': bounds}, indent=2), encoding='utf-8')
    (build / 'map-frame.geojson').write_text(json.dumps(data['mapFrame'], ensure_ascii=False), encoding='utf-8')
    print(json.dumps({'version': VERSION, 'bounds': bounds, 'center': TARGET_CENTER, 'corners': TARGET_CORNERS}, ensure_ascii=False))


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def shard_archive(archive: Path, logical_path: str) -> dict:
    directory = ROOT / f"data/shards/{Path(logical_path).stem.replace('alan-', '')}"
    if directory.exists():
        shutil.rmtree(directory)
    directory.mkdir(parents=True)
    records = []
    with archive.open('rb') as source:
        index = 0
        while True:
            chunk = source.read(SHARD_SIZE)
            if not chunk:
                break
            target = directory / f'part-{index:03d}.bin'
            target.write_bytes(chunk)
            records.append({'file': target.name, 'size': len(chunk), 'sha256': hashlib.sha256(chunk).hexdigest()})
            index += 1
    return {
        'archive_path': logical_path,
        'parts_path': directory.relative_to(ROOT).as_posix() + '/',
        'byte_length': archive.stat().st_size,
        'shard_size': SHARD_SIZE,
        'shard_count': len(records),
        'shards': records,
    }


def finalize(dem: Path, vector: Path, landcover: Path | None, source_url: str, source_md5: str, tippecanoe_commit: str) -> None:
    if not dem.exists() or not vector.exists():
        raise RuntimeError('DEM or vector PMTiles missing')
    data = read_data()
    bounds = list(TARGET_BOUNDS)
    for key in ('applicationVersion', 'version', 'stage'):
        data[key] = VERSION
    data['dataVersion'] = VERSION + '-rotated-rectangle.2'
    data['mapFrame'] = frame_collection('map_frame')
    data['focus'] = frame_collection('focus')
    data['frameMask'] = frame_mask_collection()
    data['frameClip'] = None
    data['bounds'] = bounds
    data['center'] = list(TARGET_CENTER)
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
        'source': 'Copernicus DEM GLO-30',
        'sourceSnapshot': 'Copernicus DEM GLO-30 public COGs',
        'attribution': 'Copernicus DEM GLO-30',
    }
    data['regionalVector'] = {
        **(data.get('regionalVector') or {}),
        'available': True,
        'archivePath': VECTOR_ARCHIVE,
        'minzoom': 7,
        'maxzoom': 13,
        'bounds': bounds,
        'layers': ['landcover', 'landuse', 'transportation', 'water', 'waterway', 'peak'],
        'physicallyClipped': True,
        'sourceSnapshot': source_url,
        'attribution': 'Geofabrik © OpenStreetMap contributors',
    }
    if landcover and landcover.exists():
        data['regionalLandcover'] = {
            'available': True,
            'archivePath': LANDCOVER_ARCHIVE,
            'minzoom': 7,
            'maxzoom': 12,
            'tileSize': 256,
            'bounds': bounds,
            'source': 'Copernicus CLMS LCM-10',
            'year': 2020,
            'collectionId': '828f6b20-8ffd-48f8-a1da-fefd271456db',
            'attribution': 'Copernicus Land Monitoring Service LCM-10',
        }
    else:
        data['regionalLandcover'] = {
            'available': False,
            'bounds': bounds,
            'source': 'Copernicus CLMS LCM-10',
            'year': 2020,
            'collectionId': '828f6b20-8ffd-48f8-a1da-fefd271456db',
            'blockedReason': 'CDSE OAuth credentials are required to materialize LCM-10 locally',
        }
    write_data(data)

    for report_name in ('river-network-report.json', 'natural-layer-report.json'):
        source = ROOT / 'build' / report_name
        if source.exists():
            shutil.copy2(source, ROOT / 'data' / report_name)

    targets = [(vector, VECTOR_ARCHIVE), (dem, DEM_ARCHIVE)]
    if landcover and landcover.exists():
        targets.append((landcover, LANDCOVER_ARCHIVE))
    archives = {}
    for source, logical in targets:
        destination = ROOT / logical
        destination.parent.mkdir(parents=True, exist_ok=True)
        if source.resolve() != destination.resolve():
            shutil.copy2(source, destination)
        archives[logical] = shard_archive(destination, logical)

    generated_at = datetime.now(timezone.utc).isoformat()
    (ROOT / 'data/shards-manifest.json').write_text(
        json.dumps({'schema_version': 1, 'generated_at': generated_at, 'archives': archives}, ensure_ascii=False, indent=2),
        encoding='utf-8',
    )
    copernicus_manifest = {
        'version': VERSION,
        'bounds': bounds,
        'dem': {'source': 'Copernicus DEM GLO-30', 'archive': DEM_ARCHIVE, 'bytes': (ROOT / DEM_ARCHIVE).stat().st_size, 'sha256': sha256(ROOT / DEM_ARCHIVE)},
        'landcover': {'source': 'Copernicus CLMS LCM-10', 'year': 2020, 'archive': LANDCOVER_ARCHIVE if landcover and landcover.exists() else None, 'available': bool(landcover and landcover.exists())},
        'vector': {'source': 'OpenStreetMap / Geofabrik', 'archive': VECTOR_ARCHIVE, 'bytes': (ROOT / VECTOR_ARCHIVE).stat().st_size, 'sha256': sha256(ROOT / VECTOR_ARCHIVE)},
    }
    (ROOT / 'data/copernicus-build-manifest.json').write_text(json.dumps(copernicus_manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    vector_manifest = {
        'version': VERSION,
        'generated_at': generated_at,
        'source': {'url': source_url, 'md5': source_md5},
        'tools': {'pipeline': 'gdal-geopandas-tippecanoe-pmtiles', 'tippecanoe_commit': tippecanoe_commit},
        'archive': {'logical_path': VECTOR_ARCHIVE, 'byte_length': vector.stat().st_size, 'sha256': sha256(vector), 'shard_size': SHARD_SIZE, 'shard_count': archives[VECTOR_ARCHIVE]['shard_count']},
        'layers': ['landcover', 'landuse', 'transportation', 'water', 'waterway', 'peak'],
        'physical_clip': f'rotated mapFrame polygon inside tile envelope {bounds} before tile packaging',
    }
    (ROOT / 'data/vector-build-manifest.json').write_text(json.dumps(vector_manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    write_docs()


def coordinate_pairs(value):
    if isinstance(value, list):
        if len(value) >= 2 and all(isinstance(item, (int, float)) for item in value[:2]):
            yield float(value[0]), float(value[1])
        else:
            for item in value:
                yield from coordinate_pairs(item)


def validate() -> None:
    data = read_data()
    if data.get('version') != VERSION or data.get('applicationVersion') != VERSION or data.get('stage') != VERSION:
        raise RuntimeError('version mismatch')
    if data.get('bounds') != TARGET_BOUNDS:
        raise RuntimeError(f'bounds mismatch: {data.get("bounds")}')
    if data.get('center') != TARGET_CENTER:
        raise RuntimeError(f'center mismatch: {data.get("center")}')
    expected_ring = frame_ring()
    for key in ('mapFrame', 'focus'):
        ring = data[key]['features'][0]['geometry']['coordinates'][0]
        if ring != expected_ring:
            raise RuntimeError(f'{key} rotated rectangle mismatch')
    mask_coordinates = data.get('frameMask', {}).get('features', [{}])[0].get('geometry', {}).get('coordinates', [])
    if len(mask_coordinates) != 2 or mask_coordinates[1] != list(reversed(expected_ring)):
        raise RuntimeError('frameMask mismatch')
    if data.get('frameClip') is not None:
        raise RuntimeError('CSS frameClip must remain disabled')
    for key in ('regionalDem', 'regionalVector', 'regionalLandcover'):
        if data.get(key, {}).get('bounds') != TARGET_BOUNDS:
            raise RuntimeError(f'{key} bounds mismatch')
    if data['regionalDem'].get('archivePath') != DEM_ARCHIVE or data['regionalVector'].get('archivePath') != VECTOR_ARCHIVE:
        raise RuntimeError('runtime archive path mismatch')
    if data['regionalDem'].get('source') != 'Copernicus DEM GLO-30' or data['regionalDem'].get('encoding') != 'mapbox':
        raise RuntimeError('Copernicus DEM runtime configuration mismatch')

    required_regions = {'ULLU QARAÇAY', 'MALQAR', 'BIZIÑGI', 'HOLAM', 'ÇEGEM', 'BASXAN', 'TEBERDİ', 'ARXIZ', 'NARSANA', 'MARA', 'SXAWAT'}
    seen = set()
    for feature in (data.get('regionalLabels') or {}).get('features') or []:
        props = feature.get('properties') or {}
        name = str(props.get('name_alan_latin') or props.get('name_map') or props.get('name_ru') or '')
        if name in required_regions:
            seen.add(name)
            for lon, lat in coordinate_pairs((feature.get('geometry') or {}).get('coordinates')):
                if not point_in_frame(lon, lat):
                    raise RuntimeError(f'regional label {name} is outside rotated crop')
    if seen != required_regions:
        raise RuntimeError(f'missing required regional labels: {sorted(required_regions - seen)}')

    bootstrap = (ROOT / 'assets/bootstrap.js').read_text(encoding='utf-8')
    ui = (ROOT / 'assets/map-ui.js').read_text(encoding='utf-8')
    page = (ROOT / 'assets/map-page.js').read_text(encoding='utf-8')
    index = (ROOT / 'index.html').read_text(encoding='utf-8')
    for source_name, source in [('bootstrap', bootstrap), ('ui', ui), ('page', page), ('index', index)]:
        if PREVIOUS_VERSION in source:
            raise RuntimeError(f'stale {PREVIOUS_VERSION} reference remains in {source_name}')
    if RELEASE_TAG not in bootstrap or RELEASE_TAG not in index:
        raise RuntimeError('cache-busting release tag mismatch')
    if "encoding:String(data.regionalDem.encoding || 'terrarium')" not in ui:
        raise RuntimeError('dynamic DEM encoding missing')

    shards = json.loads((ROOT / 'data/shards-manifest.json').read_text(encoding='utf-8'))
    required_archives = {DEM_ARCHIVE, VECTOR_ARCHIVE}
    if data.get('regionalLandcover', {}).get('available'):
        required_archives.add(LANDCOVER_ARCHIVE)
    if set(shards.get('archives', {})) != required_archives:
        raise RuntimeError(f'shard manifest archive set mismatch: {set(shards.get("archives", {}))}')
    for logical, record in shards['archives'].items():
        total = 0
        for item in record['shards']:
            path = ROOT / record['parts_path'] / item['file']
            if not path.exists() or path.stat().st_size != item['size'] or sha256(path) != item['sha256']:
                raise RuntimeError(f'invalid shard {path}')
            total += path.stat().st_size
        if total != record['byte_length']:
            raise RuntimeError(f'shard total mismatch {logical}')
    print(f'release-{VERSION} validation: ok')


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('prepare')
    final = sub.add_parser('finalize')
    final.add_argument('--dem', required=True)
    final.add_argument('--vector', required=True)
    final.add_argument('--landcover')
    final.add_argument('--source-url', required=True)
    final.add_argument('--source-md5', required=True)
    final.add_argument('--tippecanoe-commit', required=True)
    sub.add_parser('validate')
    args = parser.parse_args()
    if args.command == 'prepare':
        prepare()
    elif args.command == 'finalize':
        finalize(
            Path(args.dem),
            Path(args.vector),
            Path(args.landcover) if args.landcover else None,
            args.source_url,
            args.source_md5,
            args.tippecanoe_commit,
        )
    else:
        validate()


if __name__ == '__main__':
    main()
