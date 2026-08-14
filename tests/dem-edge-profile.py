#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import numpy as np
from pmtiles.reader import MmapSource, Reader, all_tiles


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'tools' / 'patch_dem_edge_collar.py'
REPORT = ROOT / 'data' / 'dem-edge-collar-report.json'
ARCHIVE = ROOT / 'data' / 'alan-dem-7.2.pmtiles'


spec = importlib.util.spec_from_file_location('alan_dem_edge_collar', SCRIPT)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)

source_heights = np.array([-10000.0, -123.4, 0.0, 1000.0, 4321.7])
roundtrip = module.decode_terrain_rgb(module.encode_terrain_rgb(source_heights))
assert np.allclose(roundtrip, source_heights, atol=0.051)

capped = module.smooth_cap_heights(
    np.array([-500.0, 500.0, 1000.0, 2000.0, 4000.0]),
    1000.0,
    120.0,
)
assert np.all(np.diff(capped) >= 0)
assert np.all(capped <= 1000.0)
assert capped[-1] > 999.9

distances = np.array([0.0, 3200.0, 3850.0, 4500.0])
outside = module.outside_height_profile(
    np.full(distances.shape, 4000.0),
    distances,
    1000.0,
    120.0,
    3200.0,
    4500.0,
    -10000.0,
)
assert outside[0] <= 1000.0
assert np.isclose(outside[0], outside[1])
assert np.all(np.diff(outside[1:]) < 0)
assert np.isclose(outside[-1], -10000.0)

report = json.loads(REPORT.read_text(encoding='utf-8'))
assert report['version'] == '7.2.3-r1'
assert report['mode'] == 'hidden-tapered-dem-edge-collar'
assert report['collar_m'] == 4500
assert report['inner_taper_m'] == 900
assert report['outer_skirt_m'] == 3200
assert report['safe_max_elevation_m'] == 1000
assert report['technical_base_m'] == -10000
assert report['rendered_safe_max_m'] == 2550
assert report['frame_top_m'] == 4000
assert report['frame_clearance_m'] == 1450
assert report['changed_tiles'] > 0
assert report['new_tiles'] > 0
assert report['collar_pixels'] > 0
assert report['inside_capped_pixels'] > 0
assert report['outer_descent_pixels'] > 0
assert all(item['maximum_written_height_m'] <= 1000.0 for item in report['per_zoom'])
assert all(item['minimum_written_height_m'] < -9900.0 for item in report['per_zoom'])

with ARCHIVE.open('rb') as handle:
    source = MmapSource(handle)
    reader = Reader(source)
    header = reader.header()
    metadata = reader.metadata()
    tile_count = sum(1 for _ in all_tiles(source))

assert header['version'] == 3
assert header['min_zoom'] == 7
assert header['max_zoom'] == 12
assert tile_count == report['total_tiles_after']
assert ARCHIVE.stat().st_size == report['pmtiles_bytes_after']
assert metadata['alan_edge_collar_mode'] == 'tapered-safe-foundation'
assert metadata['alan_edge_collar_m'] == 4500
assert metadata['alan_edge_inner_taper_m'] == 900
assert metadata['alan_edge_outer_skirt_m'] == 3200
assert metadata['alan_edge_safe_max_elevation_m'] == 1000
assert metadata['alan_edge_cap_softness_m'] == 120
assert metadata['alan_edge_technical_base_m'] == -10000

print('dem-edge-profile: ok')
