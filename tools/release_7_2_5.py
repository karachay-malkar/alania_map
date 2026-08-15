#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PARTS = [ROOT / 'assets/map-data.part-000.js', ROOT / 'assets/map-data.part-001.js']
MARKER = 'window.ALAN_MAP_DATA = '
VERSION = '7.2.5'
DATA_VERSION = '7.2.5-satellite-snow.1'
EXPECTED_BOUNDS = [40.51784, 42.734095, 44.184003, 44.534975]
EXPECTED_RING = [
    [40.51784,43.41265],
    [43.731622,42.734095],
    [44.184003,43.85642],
    [40.970221,44.534975],
    [40.51784,43.41265],
]
PERMANENT_ARCHIVE = 'data/alan-snow-permanent-7.2.5.pmtiles'
SEASONAL_ARCHIVE = 'data/alan-snow-seasonal-7.2.5.pmtiles'
REPORT_PATH = ROOT / 'data/snow-report-7.2.5.json'


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


def prepare() -> None:
    data = read_data()
    if data.get('bounds') != EXPECTED_BOUNDS:
        raise RuntimeError(f'7.2.4 bounds changed before 7.2.5 build: {data.get("bounds")}')
    ring = (((data.get('mapFrame') or {}).get('features') or [{}])[0].get('geometry') or {}).get('coordinates', [[]])[0]
    if ring != EXPECTED_RING:
        raise RuntimeError(f'7.2.4 map frame changed before 7.2.5 build: {ring}')
    build = ROOT / 'build'
    build.mkdir(exist_ok=True)
    (build / 'map-frame.geojson').write_text(
        json.dumps(data['mapFrame'], ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8'
    )
    (build / 'rectangular-bounds.json').write_text(
        json.dumps({'bounds': EXPECTED_BOUNDS}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8'
    )
    print(json.dumps({'version': VERSION, 'bounds': EXPECTED_BOUNDS, 'frame': EXPECTED_RING}, ensure_ascii=False))


def finalize(permanent: Path, seasonal: Path, report: Path) -> None:
    for path in (permanent, seasonal, report):
        if not path.exists() or path.stat().st_size <= 0:
            raise RuntimeError(f'missing 7.2.5 build output: {path}')
    report_payload = json.loads(report.read_text(encoding='utf-8'))
    if report_payload.get('version') != VERSION or report_payload.get('bounds') != EXPECTED_BOUNDS:
        raise RuntimeError('snow report version/bounds mismatch')
    if int((report_payload.get('coverage') or {}).get('elbrus_permanent_pixels_within_8km') or 0) <= 0:
        raise RuntimeError('snow report does not confirm permanent Elbrus coverage')

    permanent_target = ROOT / PERMANENT_ARCHIVE
    seasonal_target = ROOT / SEASONAL_ARCHIVE
    permanent_target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(permanent, permanent_target)
    shutil.copyfile(seasonal, seasonal_target)
    shutil.copyfile(report, REPORT_PATH)

    data = read_data()
    # Preserve the inherited 7.2 application/data architecture and every non-snow collection.
    data['dataVersion'] = DATA_VERSION
    data['regionalSnow'] = {
        'available': True,
        'version': VERSION,
        'bounds': EXPECTED_BOUNDS,
        'source': 'ESA WorldCover 2021 v200 + Sentinel-2 L2A late-summer NDSI consensus',
        'method': 'worldcover-class-70-plus-multiyear-late-summer-ndsi',
        'years': report_payload['sources']['sentinel2']['years'],
        'lateSummerWindow': report_payload['sources']['sentinel2']['late_summer_window'],
        'ndsiThreshold': report_payload['algorithm']['ndsi_threshold'],
        'permanentConsensus': report_payload['algorithm']['permanent_consensus'],
        'seasonalConsensusMin': report_payload['algorithm']['seasonal_consensus_min'],
        'reportPath': 'data/snow-report-7.2.5.json',
        'attribution': '© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021); Copernicus Sentinel-2 data',
        'streamingMode': 'http-range',
        'tileContainer': 'PMTiles',
        'permanent': {
            'archivePath': PERMANENT_ARCHIVE,
            'tileSize': 256,
            'minzoom': 7,
            'maxzoom': 13,
            'bounds': EXPECTED_BOUNDS,
            'kind': 'permanent-snow-and-ice',
        },
        'seasonal': {
            'archivePath': SEASONAL_ARCHIVE,
            'tileSize': 256,
            'minzoom': 7,
            'maxzoom': 13,
            'bounds': EXPECTED_BOUNDS,
            'kind': 'late-summer-residual-snow',
        },
    }
    write_data(data)
    print(json.dumps({
        'version': VERSION,
        'permanent': str(permanent_target.relative_to(ROOT)),
        'seasonal': str(seasonal_target.relative_to(ROOT)),
        'report': str(REPORT_PATH.relative_to(ROOT)),
    }, ensure_ascii=False))


def validate() -> None:
    subprocess.run([sys.executable, str(ROOT / 'tools/release_7_2_4.py'), 'validate'], cwd=ROOT, check=True)
    data = read_data()
    if data.get('bounds') != EXPECTED_BOUNDS:
        raise RuntimeError('bounds changed in 7.2.5')
    ring = (((data.get('mapFrame') or {}).get('features') or [{}])[0].get('geometry') or {}).get('coordinates', [[]])[0]
    if ring != EXPECTED_RING:
        raise RuntimeError('mapFrame changed in 7.2.5')
    if data.get('dataVersion') != DATA_VERSION:
        raise RuntimeError(f'dataVersion mismatch: {data.get("dataVersion")}')
    snow = data.get('regionalSnow') or {}
    if snow.get('available') is not True or snow.get('version') != VERSION:
        raise RuntimeError('regionalSnow metadata is missing')
    for key, expected in (('permanent', PERMANENT_ARCHIVE), ('seasonal', SEASONAL_ARCHIVE)):
        record = snow.get(key) or {}
        if record.get('archivePath') != expected or record.get('bounds') != EXPECTED_BOUNDS:
            raise RuntimeError(f'regionalSnow {key} metadata mismatch')
        path = ROOT / expected
        if not path.exists() or path.stat().st_size < 1000:
            raise RuntimeError(f'regionalSnow {key} archive is missing or too small')
        if path.stat().st_size >= 100_000_000:
            raise RuntimeError(f'regionalSnow {key} archive exceeds direct Git size limit: {path.stat().st_size}')
    report = json.loads(REPORT_PATH.read_text(encoding='utf-8'))
    coverage = report.get('coverage') or {}
    if float(coverage.get('permanent_area_km2') or 0) <= 0:
        raise RuntimeError('permanent snow area is empty')
    if int(coverage.get('elbrus_permanent_pixels_within_8km') or 0) <= 0:
        raise RuntimeError('Elbrus snow coverage is empty')
    if not (ROOT / 'data/alan-dem-7.2.pmtiles').exists() or not (ROOT / 'data/alan-vector-7.2.pmtiles').exists():
        raise RuntimeError('inherited DEM/vector archives were removed')
    print(f'release-{VERSION} validation: ok; permanent={coverage.get("permanent_area_km2")} km2; seasonal={coverage.get("seasonal_area_km2")} km2')


def main() -> None:
    parser = argparse.ArgumentParser()
    subs = parser.add_subparsers(dest='command', required=True)
    subs.add_parser('prepare')
    final = subs.add_parser('finalize')
    final.add_argument('--permanent', type=Path, required=True)
    final.add_argument('--seasonal', type=Path, required=True)
    final.add_argument('--report', type=Path, required=True)
    subs.add_parser('validate')
    args = parser.parse_args()
    if args.command == 'prepare':
        prepare()
    elif args.command == 'finalize':
        finalize(args.permanent, args.seasonal, args.report)
    else:
        validate()


if __name__ == '__main__':
    main()
