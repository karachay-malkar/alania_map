#!/usr/bin/env python3
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PARTS = [ROOT / 'assets/map-data.part-000.js', ROOT / 'assets/map-data.part-001.js']
MARKER = 'window.ALAN_MAP_DATA = '
VERSION = '7.3.1'
BASE_DATA_VERSION = '7.3.1-snow-canonical-unified-z12.1'
DATA_VERSION = '7.3.1-dem-hierarchical-512-z10.1'
DEM_ARCHIVE = 'data/alan-dem-7.3.pmtiles'
BASELINE_DEM_BYTES = 18_247_328
EXPECTED_BOUNDS = [40.51784, 42.734095, 44.184003, 44.534975]
EXPECTED_CENTER = [42.350921, 43.634535]
EXPECTED_RING = [
    [40.51784, 43.41265],
    [43.731622, 42.734095],
    [44.184003, 43.85642],
    [40.970221, 44.534975],
    [40.51784, 43.41265],
]
EXPECTED_EFFECTIVE_LOD = {'7': 442.574, '8': 442.574, '9': 221.287, '10': 110.644}


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


def immutable_snapshot(data: dict) -> dict:
    snapshot = copy.deepcopy(data)
    snapshot.pop('regionalDem', None)
    snapshot.pop('dataVersion', None)
    return snapshot


def replace_required(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding='utf-8')
    if old not in text:
        raise RuntimeError(f'{label}: expected token not found in {path}')
    path.write_text(text.replace(old, new, 1), encoding='utf-8')


def patch_runtime_contract() -> None:
    path = ROOT / 'tests/runtime-contract.mjs'
    replacements = (
        (
            "assert.equal(data.regionalDem.lodModel, 'single-pyramid-z7-z11-overzoom');",
            "assert.equal(data.regionalDem.lodModel, 'hierarchical-z10-to-z8-z7-shared-512-overzoom');",
            'runtime DEM LOD model',
        ),
        (
            "assert.equal(data.regionalDem.maxzoom, 11);",
            "assert.equal(data.regionalDem.maxzoom, 10);\nassert.equal(data.regionalDem.tileSize, 512);\nassert.equal(data.regionalDem.highestNativeZoom, 10);",
            'runtime DEM maxzoom/tile size',
        ),
        (
            "assert.equal(data.regionalDem.overzoomFrom, 11);",
            "assert.equal(data.regionalDem.overzoomFrom, 10);\nassert.equal(data.regionalDem.geometryGeneralization, 'hierarchical-area-lowpass-z10-to-z8-z7-shared');\nassert.deepEqual(data.regionalDem.effectiveGroundMPerInformationPixelAtCenter, {'7':442.574,'8':442.574,'9':221.287,'10':110.644});",
            'runtime DEM overzoom/effective LOD',
        ),
        (
            "assert.ok(fs.statSync(data.regionalDem.archivePath).size < 56681035);",
            "assert.ok(fs.statSync(data.regionalDem.archivePath).size < 18247328);",
            'runtime DEM size threshold',
        ),
        (
            "assert.equal(data.dataVersion, '7.3.1-snow-canonical-unified-z12.1');",
            f"assert.equal(data.dataVersion, '{DATA_VERSION}');",
            'runtime dataVersion',
        ),
        (
            "assert.equal(collar.version,'7.2.3-r1');",
            "assert.equal(collar.version,'7.3.1-r1');\n  assert.equal(collar.tile_size,512);",
            'runtime collar version/tile size',
        ),
    )
    for old, new, label in replacements:
        replace_required(path, old, new, label)


def prepare() -> None:
    data = read_data()
    if any(data.get(key) != VERSION for key in ('version', 'applicationVersion', 'stage')):
        raise RuntimeError(f'7.3.1 runtime version drifted: {[data.get(key) for key in ("version","applicationVersion","stage")]}')
    if data.get('dataVersion') != BASE_DATA_VERSION:
        raise RuntimeError(f'7.3.1 baseline dataVersion changed: {data.get("dataVersion")}')
    if data.get('bounds') != EXPECTED_BOUNDS or data.get('center') != EXPECTED_CENTER or frame_ring(data) != EXPECTED_RING:
        raise RuntimeError('7.3.1 map frame/bounds/center changed')
    dem = data.get('regionalDem') or {}
    expected = {
        'archivePath': DEM_ARCHIVE,
        'minzoom': 7,
        'maxzoom': 11,
        'tileSize': 256,
        'heightQuantizationM': 1,
        'lodModel': 'single-pyramid-z7-z11-overzoom',
        'overzoomFrom': 11,
    }
    for key, value in expected.items():
        if dem.get(key) != value:
            raise RuntimeError(f'7.3.1 DEM baseline mismatch: {key}={dem.get(key)!r}, expected {value!r}')
    path = ROOT / DEM_ARCHIVE
    if not path.exists() or path.stat().st_size != BASELINE_DEM_BYTES:
        raise RuntimeError(f'7.3.1 DEM baseline bytes changed: {path.stat().st_size if path.exists() else "missing"}')

    build = ROOT / 'build'
    build.mkdir(exist_ok=True)
    (build / 'map-frame.geojson').write_text(
        json.dumps(data['mapFrame'], ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8'
    )
    (build / 'rectangular-bounds.json').write_text(
        json.dumps({'bounds': EXPECTED_BOUNDS}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8'
    )
    (build / 'map-data-7.3.1-dem-config.js').write_text(
        'window.ALAN_MAP_DATA = ' + json.dumps({
            'center': EXPECTED_CENTER,
            'regionalDem': {'minzoom': 7, 'maxzoom': 10, 'tileSize': 512},
        }, separators=(',', ':')) + ';\n', encoding='utf-8'
    )
    print(json.dumps({
        'version': VERSION,
        'baseline_data_version': BASE_DATA_VERSION,
        'baseline_dem_bytes': BASELINE_DEM_BYTES,
        'target_tile_size': 512,
        'target_native_zoom_range': 'z7-z10',
    }, indent=2))


def finalize(dem: Path, build_report: Path, validation_report: Path, collar_report: Path, size_summary: Path) -> None:
    for path in (dem, build_report, validation_report, collar_report, size_summary):
        if not path.exists() or path.stat().st_size <= 0:
            raise RuntimeError(f'missing DEM 7.3.1 output: {path}')

    build_payload = json.loads(build_report.read_text(encoding='utf-8'))
    validation_payload = json.loads(validation_report.read_text(encoding='utf-8'))
    collar_payload = json.loads(collar_report.read_text(encoding='utf-8'))
    summary_payload = json.loads(size_summary.read_text(encoding='utf-8'))
    if build_payload.get('tile_size') != 512 or build_payload.get('minzoom') != 7 or build_payload.get('maxzoom') != 10:
        raise RuntimeError('hierarchical DEM build contract mismatch')
    if build_payload.get('lod_model') != 'hierarchical-z10-to-z8-z7-shared-512':
        raise RuntimeError(f'unexpected LOD model: {build_payload.get("lod_model")}')
    if build_payload.get('effective_ground_m_per_information_pixel_at_center') != EXPECTED_EFFECTIVE_LOD:
        raise RuntimeError(f'effective LOD drifted: {build_payload.get("effective_ground_m_per_information_pixel_at_center")}')
    if validation_payload.get('tile_size') != 512 or validation_payload.get('zooms') != [7, 8, 9, 10]:
        raise RuntimeError('DEM validation zoom/tile-size contract mismatch')
    if int(validation_payload.get('quantization_errors') or 0) != 0:
        raise RuntimeError('DEM validation reports quantization errors')
    if int(collar_payload.get('tile_size') or 0) != 512:
        raise RuntimeError('edge collar did not run in 512px mode')
    if int(collar_payload.get('changed_tiles') or 0) <= 0 or int(collar_payload.get('new_tiles') or 0) <= 0:
        raise RuntimeError('edge collar was not materialized')
    if int(summary_payload.get('dem_bytes_7_3_1') or 0) != dem.stat().st_size:
        raise RuntimeError('DEM size summary mismatch')
    if dem.stat().st_size >= BASELINE_DEM_BYTES:
        raise RuntimeError(f'new DEM is not smaller than current 7.3.1 DEM: {dem.stat().st_size} >= {BASELINE_DEM_BYTES}')

    data = read_data()
    if data.get('dataVersion') != BASE_DATA_VERSION:
        raise RuntimeError('baseline data changed while DEM was building')
    if data.get('bounds') != EXPECTED_BOUNDS or data.get('center') != EXPECTED_CENTER or frame_ring(data) != EXPECTED_RING:
        raise RuntimeError('map geometry changed while DEM was building')
    preserved = immutable_snapshot(data)

    target = ROOT / DEM_ARCHIVE
    shutil.copyfile(dem, target)

    dem_record = dict(data.get('regionalDem') or {})
    dem_record.update({
        'available': True,
        'archivePath': DEM_ARCHIVE,
        'minzoom': 7,
        'maxzoom': 10,
        'tileSize': 512,
        'encoding': 'mapbox',
        'bounds': EXPECTED_BOUNDS,
        'source': 'Copernicus DEM GLO-30',
        'heightQuantizationM': 1,
        'lodModel': 'hierarchical-z10-to-z8-z7-shared-512-overzoom',
        'highestNativeZoom': 10,
        'overzoomFrom': 10,
        'geometryGeneralization': 'hierarchical-area-lowpass-z10-to-z8-z7-shared',
        'effectiveGroundMPerInformationPixelAtCenter': EXPECTED_EFFECTIVE_LOD,
        'horizontalGroundResolutionApproxM': 110.6,
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
    data['dataVersion'] = DATA_VERSION
    write_data(data)

    written = read_data()
    if immutable_snapshot(written) != preserved:
        raise RuntimeError('non-DEM map data changed during 7.3.1 DEM-only finalize')

    patch_runtime_contract()

    copies = (
        (build_report, ROOT / 'data/dem-build-report-7.3.1.json'),
        (validation_report, ROOT / 'data/dem-validation-7.3.1.json'),
        (collar_report, ROOT / 'data/dem-edge-collar-report-7.3.1.json'),
        (size_summary, ROOT / 'data/dem-size-summary-7.3.1.json'),
        (build_report, ROOT / 'data/dem-build-report-7.3.json'),
        (validation_report, ROOT / 'data/dem-validation-7.3.json'),
        (collar_report, ROOT / 'data/dem-edge-collar-report-7.3.json'),
        (size_summary, ROOT / 'data/dem-size-summary-7.3.json'),
        (build_report, ROOT / 'data/dem-crop-report.json'),
        (validation_report, ROOT / 'data/dem-crop-validation.json'),
        (collar_report, ROOT / 'data/dem-edge-collar-report.json'),
        (size_summary, ROOT / 'data/dem-size-summary.json'),
    )
    for source, destination in copies:
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
        'tile_size': 512,
        'lod_model': 'hierarchical-z10-to-z8-z7-shared-512-overzoom',
        'native_zoom_range': 'z7-z10',
        'overzoom_from': 10,
        'effective_ground_m_per_information_pixel_at_center': EXPECTED_EFFECTIVE_LOD,
        'streaming': 'http-range',
        'baseline_bytes_7_3_1': BASELINE_DEM_BYTES,
        'reduction_fraction': 1 - target.stat().st_size / BASELINE_DEM_BYTES,
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    streaming_path = ROOT / 'data/streaming-build-manifest.json'
    streaming = json.loads(streaming_path.read_text(encoding='utf-8'))
    streaming['version'] = VERSION
    streaming['generated_at'] = generated_at
    streaming['dem_geometry'] = {
        'tile_size': 512,
        'native_zoom_range': 'z7-z10',
        'overzoom_after': 10,
        'height_quantization_m': 1,
        'lod_model': 'hierarchical-z10-to-z8-z7-shared-512-overzoom',
        'effective_ground_m_per_information_pixel_at_center': EXPECTED_EFFECTIVE_LOD,
    }
    streaming_path.write_text(json.dumps(streaming, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    print(json.dumps({
        'version': VERSION,
        'dataVersion': DATA_VERSION,
        'dem_bytes': target.stat().st_size,
        'baseline_dem_bytes': BASELINE_DEM_BYTES,
        'reduction_fraction': 1 - target.stat().st_size / BASELINE_DEM_BYTES,
        'other_data_preserved': True,
    }, indent=2))


def validate() -> None:
    data = read_data()
    if any(data.get(key) != VERSION for key in ('version', 'applicationVersion', 'stage')):
        raise RuntimeError('7.3.1 global version mismatch')
    if data.get('dataVersion') != DATA_VERSION:
        raise RuntimeError(f'7.3.1 dataVersion mismatch: {data.get("dataVersion")}')
    if data.get('bounds') != EXPECTED_BOUNDS or data.get('center') != EXPECTED_CENTER or frame_ring(data) != EXPECTED_RING:
        raise RuntimeError('7.3.1 map geometry changed')
    dem = data.get('regionalDem') or {}
    expected = {
        'archivePath': DEM_ARCHIVE,
        'minzoom': 7,
        'maxzoom': 10,
        'tileSize': 512,
        'heightQuantizationM': 1,
        'lodModel': 'hierarchical-z10-to-z8-z7-shared-512-overzoom',
        'highestNativeZoom': 10,
        'overzoomFrom': 10,
        'geometryGeneralization': 'hierarchical-area-lowpass-z10-to-z8-z7-shared',
        'streamingMode': 'http-range',
    }
    for key, value in expected.items():
        if dem.get(key) != value:
            raise RuntimeError(f'DEM metadata mismatch: {key}={dem.get(key)!r}, expected {value!r}')
    if dem.get('effectiveGroundMPerInformationPixelAtCenter') != EXPECTED_EFFECTIVE_LOD:
        raise RuntimeError('effective DEM LOD metadata mismatch')
    path = ROOT / DEM_ARCHIVE
    if not path.exists() or path.stat().st_size >= BASELINE_DEM_BYTES:
        raise RuntimeError('optimized DEM is missing or not smaller than the previous 7.3.1 DEM')
    summary = json.loads((ROOT / 'data/dem-size-summary-7.3.1.json').read_text(encoding='utf-8'))
    if int(summary.get('dem_bytes_7_3_1') or 0) != path.stat().st_size:
        raise RuntimeError('DEM size report mismatch')
    print(f'release-{VERSION} hierarchical DEM validation: ok; DEM={path.stat().st_size} bytes')


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
