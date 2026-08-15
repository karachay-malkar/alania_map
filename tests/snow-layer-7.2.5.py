#!/usr/bin/env python3
from __future__ import annotations
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXPECTED_BOUNDS = [40.51784,42.734095,44.184003,44.534975]
EXPECTED_RING = [[40.51784,43.41265],[43.731622,42.734095],[44.184003,43.85642],[40.970221,44.534975],[40.51784,43.41265]]
MARKER = 'window.ALAN_MAP_DATA = '
source = ''.join((ROOT/f'assets/map-data.part-{i:03d}.js').read_text(encoding='utf-8') for i in (0,1))
payload = source[source.index(MARKER)+len(MARKER):].strip().removesuffix(';')
data = json.loads(payload)
report = json.loads((ROOT/'data/snow-report-7.2.5.json').read_text(encoding='utf-8'))
assert data['bounds'] == EXPECTED_BOUNDS
assert data['mapFrame']['features'][0]['geometry']['coordinates'][0] == EXPECTED_RING
snow = data['regionalSnow']
assert snow['available'] is True and snow['version'] == '7.2.5'
assert snow['bounds'] == EXPECTED_BOUNDS
assert snow['method'] == 'worldcover-class-70-plus-multiyear-late-summer-ndsi'
assert snow['ndsiThreshold'] == 0.4
assert report['sources']['worldcover']['class'] == 70
assert report['sources']['worldcover']['class_name'] == 'Snow and Ice'
assert report['sources']['sentinel2']['collections_by_year'] == {
    '2020':'sentinel-2-l2a',
    '2021':'sentinel-2-l2a',
    '2023':'sentinel-2-c1-l2a',
    '2024':'sentinel-2-c1-l2a',
    '2025':'sentinel-2-c1-l2a',
}
assert report['sources']['sentinel2']['years'] == [2020,2021,2023,2024,2025]
assert report['algorithm']['permanent_consensus'] == 0.6
assert report['algorithm']['seasonal_consensus_min'] == 0.25
coverage = report['coverage']
assert coverage['permanent_pixels'] > 0
assert coverage['permanent_area_km2'] > 0
assert coverage['elbrus_permanent_pixels_within_8km'] > 0
for key in ('permanent','seasonal'):
    path = ROOT/snow[key]['archivePath']
    assert path.exists() and path.stat().st_size > 1000
    assert path.stat().st_size < 100_000_000
assert (ROOT/'data/alan-dem-7.2.pmtiles').exists()
assert (ROOT/'data/alan-vector-7.2.pmtiles').exists()
print('snow-layer-7.2.5: ok', coverage)
