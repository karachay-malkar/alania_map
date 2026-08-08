#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import math
from collections import Counter
from pathlib import Path

TARGET_COUNT = 1500
REFERENCE_ZOOM = 9.5
ATLAS_CELL_WIDTH = 200
EARTH_RADIUS_M = 6_371_000.0
CATEGORY_WEIGHTS = {
    'rounded_hill': 0.98,
    'rounded_mountain': 1.00,
    'steep_mountain': 1.03,
    'isolated_peak': 0.95,
    'massif': 1.05,
    'ridge': 1.12,
    'rocky_peak': 1.00,
    'rocky_ridge': 1.12,
    'plateau': 0.98,
}
TARGET_WIDTH_M = {
    'rounded_hill': 1700.0,
    'rounded_mountain': 1850.0,
    'steep_mountain': 1800.0,
    'isolated_peak': 1700.0,
    'massif': 2200.0,
    'ridge': 2200.0,
    'rocky_peak': 1800.0,
    'rocky_ridge': 2050.0,
    'plateau': 2100.0,
}
REVEAL_BANDS = ((500, 7.2, 1), (1000, 8.0, 2), (1500, 8.8, 3))
ROOT_SAFETY_RATIO = 0.78


def load_geojson(path: Path) -> dict:
    value = json.loads(path.read_text(encoding='utf-8'))
    if value.get('type') != 'FeatureCollection' or not isinstance(value.get('features'), list):
        raise RuntimeError(f'{path}: expected FeatureCollection')
    return value


def project(lon: float, lat: float, lat0_rad: float) -> tuple[float, float]:
    return (
        math.radians(lon) * EARTH_RADIUS_M * math.cos(lat0_rad),
        math.radians(lat) * EARTH_RADIUS_M,
    )


def distance(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def meters_per_pixel(zoom: float, lat: float) -> float:
    return 156543.03392 * math.cos(math.radians(lat)) / (2 ** zoom)


def fnv1a(value: str) -> int:
    h = 0x811C9DC5
    for byte in value.encode('utf-8'):
        h ^= byte
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def reveal_for_rank(rank: int) -> tuple[float, int]:
    for upper, zoom, tier in REVEAL_BANDS:
        if rank <= upper:
            return zoom, tier
    raise RuntimeError(f'Rank out of range: {rank}')


def weighted_farthest_selection(points: list[dict], target: int) -> list[int]:
    if len(points) < target:
        raise RuntimeError(f'Need {target} ordinary points, found {len(points)}')

    lat0 = math.radians(sum(item['lat'] for item in points) / len(points))
    projected = [project(item['lon'], item['lat'], lat0) for item in points]

    start = min(
        range(len(points)),
        key=lambda idx: (-points[idx]['elevation_m'], points[idx]['id']),
    )
    selected = [start]
    selected_set = {start}
    nearest = [distance(projected[idx], projected[start]) for idx in range(len(points))]
    nearest[start] = 0.0

    while len(selected) < target:
        best_idx = None
        best_score = -1.0
        best_id = None
        for idx, item in enumerate(points):
            if idx in selected_set:
                continue
            score = nearest[idx] * CATEGORY_WEIGHTS[item['category']]
            candidate_id = item['id']
            if score > best_score + 1e-9 or (abs(score - best_score) <= 1e-9 and (best_id is None or candidate_id < best_id)):
                best_idx = idx
                best_score = score
                best_id = candidate_id
        if best_idx is None:
            raise RuntimeError('Selection stalled')
        selected.append(best_idx)
        selected_set.add(best_idx)
        new_point = projected[best_idx]
        for idx in range(len(points)):
            if idx in selected_set:
                continue
            d = distance(projected[idx], new_point)
            if d < nearest[idx]:
                nearest[idx] = d

    return selected


def assign_variants(selected_items: list[dict], projected_by_id: dict[str, tuple[float, float]]) -> None:
    assigned: list[dict] = []
    for item in sorted(selected_items, key=lambda p: (p['lat'], p['lon'], p['id'])):
        start_variant = (fnv1a(item['id']) % 4) + 1
        neighbours = []
        for other in assigned:
            if other['category'] != item['category']:
                continue
            d = distance(projected_by_id[item['id']], projected_by_id[other['id']])
            if d <= 6000.0:
                neighbours.append((d, other['variant']))
        neighbours.sort(key=lambda pair: pair[0])
        used = {variant for _, variant in neighbours[:3]}
        variant = start_variant
        for step in range(4):
            candidate = ((start_variant - 1 + step) % 4) + 1
            if candidate not in used:
                variant = candidate
                break
        item['variant'] = variant
        item['icon'] = f"{item['category']}_{variant:02d}"
        assigned.append(item)


def build(source: Path, output: Path, report_path: Path) -> None:
    data = load_geojson(source)
    ordinary = []
    for feature in data['features']:
        props = feature.get('properties') or {}
        geometry = feature.get('geometry') or {}
        if props.get('main'):
            continue
        if geometry.get('type') != 'Point':
            continue
        category = str(props.get('category') or '')
        if category not in CATEGORY_WEIGHTS:
            raise RuntimeError(f"Unknown category {category!r} for {props.get('id')}")
        lon, lat = geometry.get('coordinates') or [None, None]
        ordinary.append({
            'id': str(props.get('id') or ''),
            'category': category,
            'elevation_m': float(props.get('elevation_m') or 0.0),
            'lon': float(lon),
            'lat': float(lat),
            'geometry': geometry,
        })

    selected_indices = weighted_farthest_selection(ordinary, TARGET_COUNT)
    selected = []
    for rank, idx in enumerate(selected_indices, start=1):
        item = dict(ordinary[idx])
        item['rank'] = rank
        item['reveal_zoom'], item['reveal_tier'] = reveal_for_rank(rank)
        selected.append(item)

    lat0 = math.radians(sum(item['lat'] for item in ordinary) / len(ordinary))
    projected_all = {item['id']: project(item['lon'], item['lat'], lat0) for item in ordinary}

    min_selected_spacing = float('inf')
    for item in selected:
        nearest = float('inf')
        p = projected_all[item['id']]
        for other in selected:
            if other['id'] == item['id']:
                continue
            d = distance(p, projected_all[other['id']])
            if d < nearest:
                nearest = d
        item['nearest_selected_m'] = nearest
        min_selected_spacing = min(min_selected_spacing, nearest)
        target_width = TARGET_WIDTH_M[item['category']]
        item['icon_width_m'] = min(target_width, nearest * ROOT_SAFETY_RATIO)
        ref_px = item['icon_width_m'] / meters_per_pixel(REFERENCE_ZOOM, item['lat'])
        item['icon_size_ref'] = ref_px / ATLAS_CELL_WIDTH

    max_source_gap = 0.0
    source_distances = []
    selected_projected = [projected_all[item['id']] for item in selected]
    for item in ordinary:
        p = projected_all[item['id']]
        nearest = min(distance(p, q) for q in selected_projected)
        source_distances.append(nearest)
        max_source_gap = max(max_source_gap, nearest)

    assign_variants(selected, projected_all)

    features = []
    for item in selected:
        props = {
            'id': item['id'],
            'category': item['category'],
            'icon': item['icon'],
            'variant': item['variant'],
            'rank': item['rank'],
            'reveal_tier': item['reveal_tier'],
            'reveal_zoom': round(item['reveal_zoom'], 2),
            'icon_size_ref': round(item['icon_size_ref'], 7),
            'icon_width_m': round(item['icon_width_m']),
            'sort_key': round(item['lat'], 6),
        }
        features.append({'type': 'Feature', 'properties': props, 'geometry': item['geometry']})

    result = {'type': 'FeatureCollection', 'features': features}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')

    sorted_distances = sorted(source_distances)
    def percentile(p: float) -> float:
        if not sorted_distances:
            return 0.0
        pos = (len(sorted_distances) - 1) * p
        lo = int(math.floor(pos)); hi = int(math.ceil(pos))
        if lo == hi:
            return sorted_distances[lo]
        frac = pos - lo
        return sorted_distances[lo] * (1 - frac) + sorted_distances[hi] * frac

    report = {
        'version': 'Slippy Map 1.0 mountain icons',
        'algorithm': 'category-weighted deterministic farthest-point thinning',
        'source_ordinary_points': len(ordinary),
        'selected_points': len(selected),
        'category_counts': dict(sorted(Counter(item['category'] for item in selected).items())),
        'reveal_tiers': {
            '1': sum(1 for item in selected if item['reveal_tier'] == 1),
            '2': sum(1 for item in selected if item['reveal_tier'] == 2),
            '3': sum(1 for item in selected if item['reveal_tier'] == 3),
        },
        'min_selected_spacing_m': round(min_selected_spacing, 1),
        'max_source_to_selected_m': round(max_source_gap, 1),
        'p95_source_to_selected_m': round(percentile(0.95), 1),
        'root_safety_ratio': ROOT_SAFETY_RATIO,
        'reference_zoom': REFERENCE_ZOOM,
        'atlas_cell_width_px': ATLAS_CELL_WIDTH,
        'selection_sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, default=Path('data/mountains.geojson'))
    parser.add_argument('--output', type=Path, default=Path('data/mountain-icons-1500.geojson'))
    parser.add_argument('--report', type=Path, default=Path('data/icon-layer-report.json'))
    args = parser.parse_args()
    build(args.source, args.output, args.report)
