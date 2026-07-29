#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import heapq
import json
import math
import re
import shutil
import unicodedata
from collections import defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / 'build'
PARTS = [ROOT / 'assets/map-data.part-000.js', ROOT / 'assets/map-data.part-001.js']
CFG = ROOT / 'config/river_systems.json'
EMPTY = {'type': 'FeatureCollection', 'features': []}
SHARD_SIZE = 786432
VERSION = '7.0.23'
VECTOR_ARCHIVE = f'data/alan-vector-{VERSION}.pmtiles'
DEM_ARCHIVE = 'data/alan-dem-7.0.21.pmtiles'
METRIC_CRS = 32638
CONNECT_TOLERANCE_M = 20.0
POND_MIN_AREA_M2 = 5000.0
EXCLUDED_WATER_VALUES = {
    'basin', 'wastewater', 'quarry', 'swimming_pool', 'rapids',
    'salt_pool', 'ditch', 'drain'
}


def read_map_data() -> dict:
    source = ''.join(path.read_text(encoding='utf-8') for path in PARTS)
    marker = 'window.ALAN_MAP_DATA = '
    index = source.find(marker)
    if index < 0:
        raise RuntimeError('ALAN_MAP_DATA not found')
    payload = source[index + len(marker):].strip()
    if payload.endswith(';'):
        payload = payload[:-1]
    return json.loads(payload)


def write_map_data(data: dict) -> None:
    payload = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
    midpoint = len(payload) // 2
    left = payload.rfind('},"', 0, midpoint)
    right = payload.find('},"', midpoint)
    candidates = [position + 1 for position in (left, right) if position >= 0]
    cut = min(candidates, key=lambda position: abs(position - midpoint)) if candidates else midpoint
    PARTS[0].write_text('\nwindow.ALAN_MAP_DATA = ' + payload[:cut], encoding='utf-8')
    PARTS[1].write_text(payload[cut:] + ';\n', encoding='utf-8')


def features(value: object) -> list[dict]:
    if isinstance(value, dict) and value.get('type') == 'FeatureCollection':
        return list(value.get('features') or [])
    return []


def normalize(value: object) -> str:
    text = unicodedata.normalize('NFKC', str(value or '')).casefold().replace('ё', 'е')
    text = re.sub(r'\b(река|речка|river|riv\.?|р\.|озеро|озёра|озера|lake|reservoir)\b', ' ', text)
    return re.sub(r'[^0-9a-zа-я]+', '', text)


def parse_other_tags(value: object) -> dict[str, str]:
    if not isinstance(value, str):
        return {}
    return {
        key.replace('\\"', '"').replace('\\\\', '\\'): item.replace('\\"', '"').replace('\\\\', '\\')
        for key, item in re.findall(r'"((?:[^"\\]|\\.)*)"=>"((?:[^"\\]|\\.)*)"', value)
    }


def value(row: object, key: str, tags: dict[str, str]) -> str:
    if key in row:
        candidate = row[key]
        if candidate is not None and str(candidate) not in {'', '<NA>', 'nan', 'NaN', 'None'}:
            return str(candidate)
    return str(tags.get(key, '') or '')


def numeric_elevation(raw: str) -> float | None:
    match = re.search(r'-?\d+(?:[.,]\d+)?', raw or '')
    return float(match.group(0).replace(',', '.')) if match else None


def valid_geometry(geometry):
    if geometry is None or geometry.is_empty:
        return None
    from shapely import make_valid
    result = make_valid(geometry)
    return None if result.is_empty else result


def line_parts(geometry):
    geometry = valid_geometry(geometry)
    if geometry is None:
        return
    if geometry.geom_type == 'LineString':
        yield geometry
        return
    if hasattr(geometry, 'geoms'):
        for part in geometry.geoms:
            yield from line_parts(part)


def geometry_hash(geometry) -> str:
    return hashlib.sha1(geometry.wkb).hexdigest()[:16]


def load_rules() -> tuple[list[dict], dict[str, dict], set[str]]:
    config = json.loads(CFG.read_text(encoding='utf-8'))
    by_name: dict[str, dict] = {}
    for rule in config['rules']:
        for name in rule['names']:
            by_name[normalize(name)] = rule
    return config['rules'], by_name, {normalize(name) for name in config['elbrus_names']}


def rule_for_names(names: tuple[str, ...] | list[str], by_name: dict[str, dict]) -> dict | None:
    normalized = [normalize(name) for name in names if name]
    for name in normalized:
        if name in by_name:
            return by_name[name]
    for name in normalized:
        if len(name) < 5:
            continue
        matches = [
            rule for alias, rule in by_name.items()
            if len(alias) >= 5 and (alias in name or name in alias)
        ]
        if matches:
            return sorted(matches, key=lambda rule: (rule['tier'], rule['id']))[0]
    return None


def prepare() -> None:
    BUILD.mkdir(exist_ok=True)
    data = read_map_data()
    frame = data.get('mapFrame')
    if not features(frame):
        raise RuntimeError('mapFrame is empty')
    (BUILD / 'map-frame.geojson').write_text(
        json.dumps(frame, ensure_ascii=False),
        encoding='utf-8'
    )

    custom = {'river_aliases': {}, 'peak_aliases': {}}
    for group, collections in (
        ('river_aliases', ['rivers']),
        ('peak_aliases', ['peaks', 'highPeaks'])
    ):
        for collection_name in collections:
            for feature in features(data.get(collection_name)):
                properties = feature.get('properties') or {}
                alias = {
                    'name_alan_latin': str(properties.get('name_alan_latin') or properties.get('name_map') or ''),
                    'name_ru': str(properties.get('name_ru') or '')
                }
                for name in (
                    properties.get('name_ru'),
                    properties.get('name_map'),
                    properties.get('name_alan_latin')
                ):
                    if normalize(name):
                        custom[group][normalize(name)] = alias
    (BUILD / 'custom-names.json').write_text(
        json.dumps(custom, ensure_ascii=False, indent=2),
        encoding='utf-8'
    )

    registry = list((data.get('mainLakes') or {}).get('registry') or [])
    if not registry:
        for feature in features(data.get('mainLakes')):
            properties = dict(feature.get('properties') or {})
            coordinates = feature.get('geometry', {}).get('coordinates')
            if isinstance(coordinates, list) and len(coordinates) >= 2:
                properties['reference_point'] = [float(coordinates[0]), float(coordinates[1])]
            properties['osm_ids'] = list(properties.get('osm_ids') or [])
            registry.append(properties)
    (BUILD / 'main-lakes-registry.json').write_text(
        json.dumps(registry, ensure_ascii=False, indent=2),
        encoding='utf-8'
    )


def endpoint_graph(segments: list[dict], tolerance: float):
    node_points: list[tuple[float, float]] = []
    buckets: dict[tuple[int, int], list[int]] = defaultdict(list)
    segment_nodes: list[tuple[int, int]] = []
    adjacency: dict[int, list[int]] = defaultdict(list)

    def node_for(coordinate: tuple[float, float]) -> int:
        x, y = coordinate
        cell = (math.floor(x / tolerance), math.floor(y / tolerance))
        best = None
        best_distance = tolerance
        for delta_x in (-1, 0, 1):
            for delta_y in (-1, 0, 1):
                for node_id in buckets.get((cell[0] + delta_x, cell[1] + delta_y), []):
                    point = node_points[node_id]
                    distance = math.hypot(point[0] - x, point[1] - y)
                    if distance <= best_distance:
                        best = node_id
                        best_distance = distance
        if best is not None:
            return best
        node_id = len(node_points)
        node_points.append((x, y))
        buckets[cell].append(node_id)
        return node_id

    for segment_id, segment in enumerate(segments):
        coordinates = list(segment['geometry_metric'].coords)
        start = node_for(tuple(coordinates[0]))
        end = node_for(tuple(coordinates[-1]))
        segment_nodes.append((start, end))
        adjacency[start].append(segment_id)
        adjacency[end].append(segment_id)
    return node_points, segment_nodes, adjacency


def selected_components(selected: set[int], segment_nodes, adjacency) -> list[set[int]]:
    remaining = set(selected)
    result: list[set[int]] = []
    while remaining:
        first = remaining.pop()
        component = {first}
        queue = deque([first])
        while queue:
            segment_id = queue.popleft()
            for node in segment_nodes[segment_id]:
                for neighbour in adjacency.get(node, []):
                    if neighbour in remaining:
                        remaining.remove(neighbour)
                        component.add(neighbour)
                        queue.append(neighbour)
        result.append(component)
    return result


def connection_penalty(segment: dict, system_id: str) -> float:
    assigned = segment.get('assigned_systems') or set()
    if system_id in assigned:
        return 1.0
    if assigned:
        return 40.0
    if not segment.get('name') and not segment.get('name_ru'):
        return 1.05
    return 4.0 if segment['waterway'] != 'canal' else 8.0


def shortest_connection(
    segments: list[dict],
    segment_nodes,
    adjacency,
    selected: set[int],
    target_segment: int,
    system_id: str
) -> list[int]:
    selected_nodes = {
        node for segment_id in selected for node in segment_nodes[segment_id]
    }
    target_nodes = set(segment_nodes[target_segment])
    if selected_nodes & target_nodes:
        return [target_segment]

    distances: dict[int, float] = {}
    previous: dict[int, tuple[int, int]] = {}
    heap: list[tuple[float, int]] = []
    for node in selected_nodes:
        distances[node] = 0.0
        heapq.heappush(heap, (0.0, node))

    destination = None
    while heap:
        distance, node = heapq.heappop(heap)
        if distance != distances.get(node):
            continue
        if node in target_nodes:
            destination = node
            break
        for segment_id in adjacency.get(node, []):
            start, end = segment_nodes[segment_id]
            next_node = end if start == node else start
            segment = segments[segment_id]
            next_distance = distance + max(1.0, segment['length_m']) * connection_penalty(segment, system_id)
            if next_distance >= distances.get(next_node, float('inf')):
                continue
            distances[next_node] = next_distance
            previous[next_node] = (node, segment_id)
            heapq.heappush(heap, (next_distance, next_node))

    if destination is None:
        return [target_segment]
    path = [target_segment]
    node = destination
    while node not in selected_nodes:
        previous_node, segment_id = previous[node]
        path.append(segment_id)
        node = previous_node
    return path


def extend_unambiguous(
    segments: list[dict],
    segment_nodes,
    adjacency,
    selected: set[int],
    system_id: str
) -> set[int]:
    changed = True
    while changed:
        changed = False
        boundary_nodes = {
            node for segment_id in selected for node in segment_nodes[segment_id]
        }
        for node in boundary_nodes:
            candidates = [
                segment_id for segment_id in adjacency.get(node, [])
                if segment_id not in selected
                and not ((segments[segment_id].get('assigned_systems') or set()) - {system_id})
            ]
            if len(candidates) != 1:
                continue
            candidate = candidates[0]
            segment = segments[candidate]
            if segment.get('name') or segment.get('name_ru'):
                continue
            selected.add(candidate)
            changed = True
    return selected


def component_gap_details(component_geometries: list, to_wgs84) -> list[dict]:
    from shapely.ops import nearest_points, transform, unary_union

    gaps: list[dict] = []
    if len(component_geometries) <= 1:
        return gaps
    connected = [0]
    remaining = set(range(1, len(component_geometries)))
    while remaining:
        best = None
        for left in connected:
            for right in remaining:
                distance = component_geometries[left].distance(component_geometries[right])
                if best is None or distance < best[0]:
                    best = (distance, left, right)
        distance, left, right = best
        start, end = nearest_points(component_geometries[left], component_geometries[right])
        start_wgs = transform(to_wgs84, start)
        end_wgs = transform(to_wgs84, end)
        gaps.append({
            'from': [round(start_wgs.x, 7), round(start_wgs.y, 7)],
            'to': [round(end_wgs.x, 7), round(end_wgs.y, 7)],
            'distance_m': round(float(distance), 1)
        })
        connected.append(right)
        remaining.remove(right)
    return gaps


def classify() -> None:
    import geopandas as gpd
    from pyproj import Transformer
    from shapely.geometry import Point, mapping
    from shapely.ops import linemerge, transform, unary_union

    BUILD.mkdir(exist_ok=True)
    frame = valid_geometry(gpd.read_file(BUILD / 'map-frame.geojson').to_crs(4326).geometry.union_all())
    if frame is None:
        raise RuntimeError('mapFrame geometry is invalid')
    custom = json.loads((BUILD / 'custom-names.json').read_text(encoding='utf-8'))
    registry = json.loads((BUILD / 'main-lakes-registry.json').read_text(encoding='utf-8'))
    rule_list, rules_by_name, elbrus_names = load_rules()
    rules_by_id = {rule['id']: rule for rule in rule_list}
    gpkg = BUILD / 'osm-clipped.gpkg'

    available_layers = set(gpd.list_layers(gpkg)['name'])
    source = {
        name: gpd.read_file(gpkg, layer=name).to_crs(4326)
        for name in ('lines', 'multilinestrings', 'multipolygons', 'points')
        if name in available_layers
    }
    if not {'lines', 'multipolygons', 'points'} <= set(source):
        raise RuntimeError(f'OSM extraction is incomplete: {sorted(source)}')

    to_metric = Transformer.from_crs(4326, METRIC_CRS, always_xy=True).transform
    to_wgs84 = Transformer.from_crs(METRIC_CRS, 4326, always_xy=True).transform
    output: dict[str, list[dict]] = defaultdict(list)

    def add(layer: str, geometry, properties: dict, minzoom: int | None = None) -> None:
        geometry = valid_geometry(geometry)
        if geometry is None:
            return
        geometry = valid_geometry(geometry.intersection(frame))
        if geometry is None:
            return
        feature = {
            'type': 'Feature',
            'properties': {
                key: item for key, item in properties.items()
                if item not in (None, '', [])
            },
            'geometry': mapping(geometry)
        }
        if minzoom is not None:
            feature['tippecanoe'] = {'minzoom': int(minzoom)}
        output[layer].append(feature)

    river_segments: list[dict] = []
    for _, row in source['lines'].iterrows():
        tag_map = parse_other_tags(row.get('other_tags'))
        highway = value(row, 'highway', tag_map)
        waterway = value(row, 'waterway', tag_map)
        osm_id = value(row, 'osm_id', tag_map)
        name = value(row, 'name', tag_map)
        name_ru = value(row, 'name:ru', tag_map) or name

        road_class = {
            'motorway': 'motorway', 'motorway_link': 'motorway',
            'trunk': 'trunk', 'trunk_link': 'trunk',
            'primary': 'primary', 'primary_link': 'primary',
            'secondary': 'secondary', 'secondary_link': 'secondary',
            'tertiary': 'tertiary', 'tertiary_link': 'tertiary',
            'unclassified': 'minor', 'residential': 'minor',
            'living_street': 'minor', 'service': 'minor', 'road': 'minor'
        }.get(highway)
        if road_class:
            tunnel = value(row, 'tunnel', tag_map)
            bridge = value(row, 'bridge', tag_map)
            brunnel = (
                'tunnel' if tunnel not in {'', 'no', 'false', '0'}
                else 'bridge' if bridge not in {'', 'no', 'false', '0'}
                else ''
            )
            add(
                'transportation',
                row.geometry,
                {'osm_id': osm_id, 'class': road_class, 'subclass': highway, 'brunnel': brunnel},
                9 if road_class == 'minor' else 7
            )

        if waterway not in {'river', 'stream', 'canal'}:
            continue
        intermittent = value(row, 'intermittent', tag_map).casefold() in {'yes', 'true', '1'}
        tunnel = value(row, 'tunnel', tag_map)
        bridge = value(row, 'bridge', tag_map)
        brunnel = (
            'tunnel' if tunnel not in {'', 'no', 'false', '0'}
            else 'bridge' if bridge not in {'', 'no', 'false', '0'}
            else ''
        )
        matched_rule = rule_for_names((name_ru, name), rules_by_name)
        for part_index, geometry in enumerate(line_parts(row.geometry)):
            clipped = valid_geometry(geometry.intersection(frame))
            if clipped is None:
                continue
            for clipped_part in line_parts(clipped):
                metric_geometry = transform(to_metric, clipped_part)
                if metric_geometry.length <= 0:
                    continue
                assigned = {matched_rule['id']} if matched_rule else set()
                river_segments.append({
                    'osm_id': osm_id,
                    'part_index': part_index,
                    'waterway': waterway,
                    'name': name,
                    'name_ru': name_ru,
                    'intermittent': intermittent,
                    'brunnel': brunnel,
                    'geometry': clipped_part,
                    'geometry_metric': metric_geometry,
                    'length_m': float(metric_geometry.length),
                    'assigned_systems': assigned
                })

    relation_geometries: dict[str, list] = defaultdict(list)
    for _, row in source.get('multilinestrings', gpd.GeoDataFrame()).iterrows():
        tag_map = parse_other_tags(row.get('other_tags'))
        name = value(row, 'name', tag_map)
        name_ru = value(row, 'name:ru', tag_map) or name
        rule = rule_for_names((name_ru, name), rules_by_name)
        relation_type = value(row, 'type', tag_map)
        route = value(row, 'route', tag_map)
        waterway = value(row, 'waterway', tag_map)
        if not rule or not (waterway in {'river', 'stream', 'canal'} or route == 'river' or relation_type == 'waterway'):
            continue
        for part in line_parts(row.geometry):
            relation_geometries[rule['id']].append(transform(to_metric, part))

    for system_id, geometries in relation_geometries.items():
        relation_buffer = unary_union(geometries).buffer(CONNECT_TOLERANCE_M)
        for segment in river_segments:
            if segment['geometry_metric'].intersection(relation_buffer).length >= segment['length_m'] * 0.6:
                segment['assigned_systems'].add(system_id)

    node_points, segment_nodes, adjacency = endpoint_graph(river_segments, CONNECT_TOLERANCE_M)
    used_segments: set[int] = set()
    river_output_records: list[dict] = []
    report_systems: list[dict] = []

    def append_river(system_id: str, tier: int, selected: set[int], canonical_name: str, aliases: dict) -> None:
        if not selected:
            return
        geometries_metric = [river_segments[index]['geometry_metric'] for index in sorted(selected)]
        unified_metric = unary_union(geometries_metric)
        merged_metric = (
            unified_metric
            if unified_metric.geom_type == 'LineString'
            else linemerge(unified_metric)
        )
        merged_wgs = transform(to_wgs84, merged_metric)
        waterway_classes = {river_segments[index]['waterway'] for index in selected}
        river_class = 'canal' if waterway_classes == {'canal'} else 'river' if 'river' in waterway_classes else 'stream'
        osm_ids = sorted({
            river_segments[index]['osm_id'] for index in selected
            if river_segments[index]['osm_id']
        })
        properties = {
            'class': river_class,
            'tier': tier,
            'system_id': system_id,
            'name': canonical_name,
            'name_ru': canonical_name,
            'name_alan_latin': aliases.get('name_alan_latin', ''),
            'osm_ids': ','.join(osm_ids),
            'segment_count': len(selected)
        }
        add('waterway', merged_wgs, properties, 7 if tier == 1 else 8 if tier == 2 else 10)
        river_output_records.append({'system_id': system_id, 'selected': set(selected)})

    for rule in rule_list:
        system_id = rule['id']
        seeds = [
            index for index, segment in enumerate(river_segments)
            if system_id in segment['assigned_systems']
        ]
        if not seeds:
            report_systems.append({
                'id': system_id,
                'tier': rule['tier'],
                'names': rule['names'],
                'matched_length_m': 0,
                'segment_count': 0,
                'component_count': 0,
                'gaps': [],
                'present': False
            })
            continue

        selected = {seeds[0]}
        for seed in seeds[1:]:
            if seed in selected:
                continue
            selected.update(shortest_connection(
                river_segments, segment_nodes, adjacency, selected, seed, system_id
            ))
        selected = extend_unambiguous(
            river_segments, segment_nodes, adjacency, selected, system_id
        )
        components = selected_components(selected, segment_nodes, adjacency)
        component_geometries = [
            unary_union([river_segments[index]['geometry_metric'] for index in component])
            for component in components
        ]
        gaps = component_gap_details(component_geometries, to_wgs84)
        length = sum(river_segments[index]['length_m'] for index in selected)
        alias = (
            custom['river_aliases'].get(normalize(rule['names'][0]))
            or next((
                custom['river_aliases'].get(normalize(river_segments[index]['name_ru']))
                for index in selected
                if custom['river_aliases'].get(normalize(river_segments[index]['name_ru']))
            ), {})
        )
        append_river(system_id, int(rule['tier']), selected, rule['names'][0], alias or {})
        used_segments.update(selected)
        report_systems.append({
            'id': system_id,
            'tier': rule['tier'],
            'names': rule['names'],
            'matched_length_m': round(length, 1),
            'segment_count': len(selected),
            'component_count': len(components),
            'gaps': gaps,
            'present': True
        })

    remaining_named: dict[str, set[int]] = defaultdict(set)
    for index, segment in enumerate(river_segments):
        if index in used_segments:
            continue
        name_key = normalize(segment['name_ru'] or segment['name'])
        if name_key:
            remaining_named[name_key].add(index)
    for name_key, selected in remaining_named.items():
        length = sum(river_segments[index]['length_m'] for index in selected)
        has_river = any(river_segments[index]['waterway'] == 'river' for index in selected)
        if not has_river and length < 1200:
            continue
        representative = min(selected)
        segment = river_segments[representative]
        tier = 2 if has_river or length >= 5000 else 3
        system_id = f'osm-{hashlib.sha1(name_key.encode("utf-8")).hexdigest()[:12]}'
        alias = (
            custom['river_aliases'].get(normalize(segment['name_ru']))
            or custom['river_aliases'].get(normalize(segment['name']))
            or {}
        )
        append_river(system_id, tier, selected, segment['name_ru'] or segment['name'], alias)
        used_segments.update(selected)

    remaining_rivers = {
        index for index, segment in enumerate(river_segments)
        if index not in used_segments and segment['waterway'] == 'river'
    }
    for component in selected_components(remaining_rivers, segment_nodes, adjacency):
        length = sum(river_segments[index]['length_m'] for index in component)
        if length < 5000:
            continue
        digest = hashlib.sha1(
            ','.join(str(index) for index in sorted(component)).encode('utf-8')
        ).hexdigest()[:12]
        append_river(f'osm-unnamed-{digest}', 2, component, '', {})

    report = {
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'connection_tolerance_m': CONNECT_TOLERANCE_M,
        'input_segment_count': len(river_segments),
        'output_system_count': len(river_output_records),
        'systems': report_systems,
        'summary': {
            'required': len(report_systems),
            'present': sum(system['present'] for system in report_systems),
            'missing': [system['id'] for system in report_systems if not system['present']],
            'disconnected': [
                system['id'] for system in report_systems
                if system['present'] and system['component_count'] > int(rules_by_id[system['id']].get('max_components', 1))
            ]
        }
    }
    (BUILD / 'river-network-report.json').write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding='utf-8'
    )

    polygon_rows: list[dict] = []
    ice_geometries = []
    for _, row in source['multipolygons'].iterrows():
        tag_map = parse_other_tags(row.get('other_tags'))
        geometry = valid_geometry(row.geometry)
        if geometry is None:
            continue
        metric_geometry = transform(to_metric, geometry)
        record = {
            'row': row,
            'tags': tag_map,
            'geometry': geometry,
            'metric_geometry': metric_geometry,
            'area_m2': float(metric_geometry.area),
            'osm_id': value(row, 'osm_id', tag_map),
            'name': value(row, 'name', tag_map),
            'name_ru': value(row, 'name:ru', tag_map) or value(row, 'name', tag_map),
            'natural': value(row, 'natural', tag_map),
            'landuse': value(row, 'landuse', tag_map),
            'water': value(row, 'water', tag_map),
            'waterway': value(row, 'waterway', tag_map),
            'leisure': value(row, 'leisure', tag_map)
        }
        polygon_rows.append(record)
        if (
            record['natural'] in {'glacier', 'snowfield', 'ice_shelf'}
            or record['water'] == 'glacier'
            or bool(value(row, 'glacier', tag_map))
            or value(row, 'landcover', tag_map) in {'snow', 'ice'}
        ):
            ice_geometries.append(geometry)

    ice_union = unary_union(ice_geometries) if ice_geometries else None
    resolved_registry = []
    registry_matches: dict[str, dict] = {}
    safe_candidates = [
        record for record in polygon_rows
        if record['natural'] == 'water'
        and record['water'] not in {'river', 'stream', 'canal'}
        and record['waterway'] not in {'riverbank', 'river'}
        and record['water'] not in EXCLUDED_WATER_VALUES
        and record['landuse'] not in {'basin', 'quarry'}
        and record['leisure'] != 'swimming_pool'
    ]
    for item in registry:
        resolved = dict(item)
        requested_ids = {str(identifier) for identifier in item.get('osm_ids') or [] if identifier}
        candidates = [
            record for record in safe_candidates
            if requested_ids and record['osm_id'] in requested_ids
        ]
        reference = item.get('reference_point')
        if not candidates and isinstance(reference, list) and len(reference) >= 2:
            point_metric = transform(to_metric, Point(float(reference[0]), float(reference[1])))
            registry_name = normalize(item.get('name_ru') or item.get('name_map'))
            ranked = []
            for record in safe_candidates:
                distance = float(record['metric_geometry'].distance(point_metric))
                if distance > 7000:
                    continue
                candidate_name = normalize(record['name_ru'] or record['name'])
                name_bonus = 3500 if (
                    registry_name and candidate_name
                    and (
                        registry_name in candidate_name
                        or candidate_name in registry_name
                        or any(
                            token in candidate_name
                            for token in ('бадук', 'соф', 'дукк', 'шадхур', 'донгуз', 'каракол', 'туманл', 'голуб')
                            if token in registry_name
                        )
                    )
                ) else 0
                containment_bonus = 5000 if record['metric_geometry'].contains(point_metric) else 0
                ranked.append((distance - name_bonus - containment_bonus, distance, record))
            if ranked:
                ranked.sort(key=lambda entry: (entry[0], entry[1], -entry[2]['area_m2']))
                candidates = [ranked[0][2]]

        matched_ids = [record['osm_id'] for record in candidates if record['osm_id']]
        resolved['osm_ids'] = sorted(set(matched_ids))
        resolved['resolved'] = bool(candidates)
        if candidates:
            primary = max(candidates, key=lambda record: record['area_m2'])
            resolved['resolved_osm_name'] = primary['name_ru'] or primary['name']
            resolved['resolved_geometry_hash'] = geometry_hash(primary['geometry'])
            match_key = primary['osm_id'] or resolved['resolved_geometry_hash']
            registry_matches[match_key] = resolved
        resolved_registry.append(resolved)
    (BUILD / 'main-lakes-resolved.json').write_text(
        json.dumps(resolved_registry, ensure_ascii=False, indent=2),
        encoding='utf-8'
    )

    water_stats = defaultdict(int)
    water_geometries_metric = []
    for record in polygon_rows:
        row = record['row']
        tag_map = record['tags']
        natural = record['natural']
        landuse = record['landuse']
        water = record['water']
        leisure = record['leisure']
        osm_id = record['osm_id']
        name = record['name']
        name_ru = record['name_ru']
        geometry = record['geometry']

        if natural in {'wood', 'scrub'} or landuse == 'forest':
            add('landcover', geometry, {'class': 'wood', 'subclass': natural or landuse})
        if natural == 'glacier':
            add('landcover', geometry, {
                'osm_id': osm_id, 'class': 'ice', 'subclass': 'glacier',
                'natural': natural, 'name': name, 'name_ru': name_ru
            })
        elif natural in {'snowfield', 'ice_shelf'} or value(row, 'landcover', tag_map) in {'snow', 'ice'}:
            add('landcover', geometry, {
                'osm_id': osm_id, 'class': 'ice', 'subclass': 'snow',
                'natural': natural, 'name': name, 'name_ru': name_ru
            })
        if landuse == 'residential':
            add('landuse', geometry, {'class': 'residential', 'subclass': 'residential'})

        is_ice = (
            natural in {'glacier', 'snowfield', 'ice_shelf'}
            or water == 'glacier'
            or bool(value(row, 'glacier', tag_map))
        )
        intermittent = value(row, 'intermittent', tag_map).casefold() in {'yes', 'true', '1'}
        seasonal = value(row, 'seasonal', tag_map).casefold() in {'yes', 'true', '1', 'spring', 'summer', 'winter'}
        excluded_value = (
            water in EXCLUDED_WATER_VALUES
            or landuse in {'basin', 'quarry'}
            or leisure == 'swimming_pool'
        )
        if is_ice:
            water_stats['excluded_ice'] += 1
            continue
        if intermittent or seasonal:
            water_stats['excluded_temporary'] += 1
            continue
        if excluded_value:
            water_stats[f'excluded_{water or landuse or leisure}'] += 1
            continue

        water_class = ''
        if water in {'river', 'stream', 'canal'} or record['waterway'] in {'riverbank', 'river'}:
            water_class = 'river'
        elif water == 'reservoir' or landuse == 'reservoir':
            water_class = 'reservoir'
        elif water == 'lake':
            water_class = 'lake'
        elif water == 'pond' and record['area_m2'] >= POND_MIN_AREA_M2:
            water_class = 'pond'

        match_key = osm_id or geometry_hash(geometry)
        registry_item = registry_matches.get(match_key)
        if not water_class and registry_item:
            water_class = 'lake'
            water_stats['curated_osm_lake'] += 1
        if not water_class:
            if natural == 'water' or water:
                water_stats['excluded_unclassified_water'] += 1
            continue

        if water_class == 'pond' and record['area_m2'] < POND_MIN_AREA_M2:
            water_stats['excluded_small_pond'] += 1
            continue
        if water_class == 'river' and not (name or name_ru or record['area_m2'] >= 1000):
            water_stats['excluded_small_river_polygon'] += 1
            continue

        if ice_union is not None:
            geometry = valid_geometry(geometry.difference(ice_union))
        if geometry is None:
            water_stats['excluded_fully_overlapped_ice'] += 1
            continue
        properties = {
            'osm_id': osm_id,
            'class': water_class,
            'subclass': water or landuse or natural,
            'natural': natural,
            'name': name,
            'name_ru': name_ru,
            'intermittent': 0,
            'area_m2': round(record['area_m2'])
        }
        if registry_item:
            properties.update({
                'lake_id': registry_item.get('lake_id'),
                'name_alan_latin': registry_item.get('name_alan_latin') or registry_item.get('name_map'),
                'name_ru': registry_item.get('name_ru') or name_ru,
                'label_primary': 1
            })
        add('water', geometry, properties)
        water_geometries_metric.append(transform(to_metric, geometry))
        water_stats[f'included_{water_class}'] += 1

    for _, row in source['points'].iterrows():
        tag_map = parse_other_tags(row.get('other_tags'))
        if value(row, 'natural', tag_map) != 'peak':
            continue
        name = value(row, 'name', tag_map)
        name_ru = value(row, 'name:ru', tag_map) or name
        alias = (
            custom['peak_aliases'].get(normalize(name_ru))
            or custom['peak_aliases'].get(normalize(name))
            or {}
        )
        elevation = numeric_elevation(value(row, 'ele', tag_map))
        hidden = normalize(name_ru) in elbrus_names or normalize(name) in elbrus_names
        add('peak', row.geometry, {
            'osm_id': value(row, 'osm_id', tag_map),
            'class': 'peak',
            'name': name,
            'name_ru': name_ru,
            'name_alan_latin': alias.get('name_alan_latin', ''),
            'ele': elevation,
            'peak_level': 1 if elevation is not None and elevation >= 5000 else 2,
            'hidden': int(hidden)
        }, 7 if elevation is not None and elevation >= 5000 else 10)

    overlap_area = 0.0
    if ice_geometries and water_geometries_metric:
        ice_metric = unary_union([transform(to_metric, geometry) for geometry in ice_geometries])
        water_metric = unary_union(water_geometries_metric)
        overlap_area = float(ice_metric.intersection(water_metric).area)
    natural_report = {
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'strict_water_classes': ['lake', 'reservoir', 'pond', 'river'],
        'pond_min_area_m2': POND_MIN_AREA_M2,
        'water_stats': dict(sorted(water_stats.items())),
        'water_ice_overlap_m2': round(overlap_area, 6),
        'main_lakes': resolved_registry,
        'feature_counts': {
            layer: len(output[layer])
            for layer in ('landcover', 'landuse', 'transportation', 'water', 'waterway', 'peak')
        }
    }
    (BUILD / 'natural-layer-report.json').write_text(
        json.dumps(natural_report, ensure_ascii=False, indent=2),
        encoding='utf-8'
    )

    for layer in ('landcover', 'landuse', 'transportation', 'water', 'waterway', 'peak'):
        (BUILD / f'{layer}.geojson').write_text(
            json.dumps({'type': 'FeatureCollection', 'features': output[layer]}, ensure_ascii=False),
            encoding='utf-8'
        )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def shard_directory_manifest(parts_path: Path, archive_path: str) -> dict:
    shards = sorted(parts_path.glob('part-*.bin'))
    if not shards:
        raise RuntimeError(f'No shards in {parts_path}')
    records = [
        {'file': path.name, 'size': path.stat().st_size, 'sha256': sha256_file(path)}
        for path in shards
    ]
    return {
        'archive_path': archive_path,
        'parts_path': parts_path.relative_to(ROOT).as_posix() + '/',
        'byte_length': sum(record['size'] for record in records),
        'shard_size': SHARD_SIZE,
        'shard_count': len(records),
        'shards': records
    }


def integrate(
    archive: str,
    source_url: str,
    source_md5: str,
    pipeline: str,
    tippecanoe_commit: str
) -> None:
    archive_path = Path(archive)
    size = archive_path.stat().st_size
    previous_size = 13549632
    if size < 1000:
        raise RuntimeError('PMTiles missing')

    vector_parts = ROOT / f'data/shards/vector-{VERSION}'
    shutil.rmtree(vector_parts, ignore_errors=True)
    vector_parts.mkdir(parents=True)
    with archive_path.open('rb') as file:
        index = 0
        while chunk := file.read(SHARD_SIZE):
            (vector_parts / f'part-{index:03d}.bin').write_bytes(chunk)
            index += 1

    old_vector_parts = ROOT / 'data/shards/vector'
    if old_vector_parts.exists():
        shutil.rmtree(old_vector_parts)
    dem_parts = ROOT / 'data/shards/dem-7.0.21'
    old_dem_parts = ROOT / 'data/shards/dem'
    if old_dem_parts.exists() and not dem_parts.exists():
        shutil.move(str(old_dem_parts), str(dem_parts))
    elif old_dem_parts.exists():
        shutil.rmtree(old_dem_parts)

    data = read_map_data()
    for key in ('rivers', 'glaciers', 'peakSnow', 'elbrusSnow', 'peaks', 'highPeaks'):
        data[key] = dict(EMPTY)
    resolved_lakes = json.loads((BUILD / 'main-lakes-resolved.json').read_text(encoding='utf-8'))
    data['mainLakes'] = {'type': 'FeatureCollection', 'features': [], 'registry': resolved_lakes}
    data['regionalVector'] = {
        **(data.get('regionalVector') or {}),
        'available': True,
        'archivePath': VECTOR_ARCHIVE,
        'minzoom': 7,
        'maxzoom': 13,
        'bounds': data.get('bounds'),
        'layers': ['landcover', 'landuse', 'transportation', 'water', 'waterway', 'peak'],
        'physicallyClipped': True,
        'sourceSnapshot': source_url,
        'attribution': 'Geofabrik © OpenStreetMap contributors'
    }
    data['regionalDem'] = {
        **(data.get('regionalDem') or {}),
        'archivePath': DEM_ARCHIVE
    }
    for key in ('applicationVersion', 'version', 'stage'):
        data[key] = VERSION
    data['dataVersion'] = VERSION + '-osm-natural.2'
    write_map_data(data)

    shutil.copy2(BUILD / 'river-network-report.json', ROOT / 'data/river-network-report.json')
    shutil.copy2(BUILD / 'natural-layer-report.json', ROOT / 'data/natural-layer-report.json')

    vector_manifest = shard_directory_manifest(vector_parts, VECTOR_ARCHIVE)
    dem_manifest = shard_directory_manifest(dem_parts, DEM_ARCHIVE)
    shards_manifest = {
        'schema_version': 1,
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'archives': {
            DEM_ARCHIVE: dem_manifest,
            VECTOR_ARCHIVE: vector_manifest
        }
    }
    (ROOT / 'data/shards-manifest.json').write_text(
        json.dumps(shards_manifest, ensure_ascii=False, indent=2),
        encoding='utf-8'
    )

    build_manifest = {
        'version': VERSION,
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'source': {'url': source_url, 'md5': source_md5},
        'tools': {'pipeline': pipeline, 'tippecanoe_commit': tippecanoe_commit},
        'archive': {
            'logical_path': VECTOR_ARCHIVE,
            'byte_length': size,
            'sha256': sha256_file(archive_path),
            'shard_size': SHARD_SIZE,
            'shard_count': index,
            'previous_byte_length': previous_size,
            'delta_bytes': size - previous_size
        },
        'layers': ['landcover', 'landuse', 'transportation', 'water', 'waterway', 'peak'],
        'physical_clip': 'mapFrame polygon before tile packaging'
    }
    (ROOT / 'data/vector-build-manifest.json').write_text(
        json.dumps(build_manifest, ensure_ascii=False, indent=2),
        encoding='utf-8'
    )

    (ROOT / 'README.md').write_text(
        f'# Alan Map {VERSION}\n\n'
        'Автономная карта Alan Til для GitHub Pages. DEM и вектор физически обрезаны '
        'по рабочему контуру. Озёра, ледники, постоянный снег, речная сеть и вершины '
        f'берутся из локального OSM PMTiles. Вектор: {size} байт ({size - previous_size:+d} к 7.0.21).\n',
        encoding='utf-8'
    )
    (ROOT / 'DATA-SOURCES-AND-LICENSES.md').write_text(
        '# Источники данных и компоненты\n\n'
        f'- OpenStreetMap: `{source_url}`, © OpenStreetMap contributors, ODbL.\n'
        '- Рельеф: Mapzen/Tilezen Skadi SRTM HGT, без изменений.\n'
        '- Сборка: GDAL/OGR, GeoPandas/Shapely, Tippecanoe, PMTiles CLI.\n'
        '- MapLibre GL JS 5.24.0; PMTiles JS 4.4.1; локальный Noto Sans.\n\n'
        'Манифесты: `data/vector-build-manifest.json`, `data/shards-manifest.json`. '
        'Проверки данных: `data/river-network-report.json`, `data/natural-layer-report.json`.\n',
        encoding='utf-8'
    )


def validate_repository() -> None:
    build_manifest = json.loads((ROOT / 'data/vector-build-manifest.json').read_text(encoding='utf-8'))
    river_report = json.loads((ROOT / 'data/river-network-report.json').read_text(encoding='utf-8'))
    natural_report = json.loads((ROOT / 'data/natural-layer-report.json').read_text(encoding='utf-8'))
    shards_manifest = json.loads((ROOT / 'data/shards-manifest.json').read_text(encoding='utf-8'))

    if build_manifest['version'] != VERSION:
        raise RuntimeError('vector build version mismatch')
    if natural_report.get('water_ice_overlap_m2') != 0:
        raise RuntimeError(f'water/ice overlap remains: {natural_report["water_ice_overlap_m2"]}')
    if river_report['summary'].get('missing'):
        raise RuntimeError(f'mandatory rivers missing: {river_report["summary"]["missing"]}')
    if river_report['summary'].get('disconnected'):
        raise RuntimeError(f'mandatory rivers disconnected: {river_report["summary"]["disconnected"]}')

    for archive_path in (DEM_ARCHIVE, VECTOR_ARCHIVE):
        archive = shards_manifest.get('archives', {}).get(archive_path)
        if not archive:
            raise RuntimeError(f'{archive_path} missing from shards manifest')
        parts_path = ROOT / archive['parts_path']
        total = 0
        for index, record in enumerate(archive['shards']):
            expected_name = f'part-{index:03d}.bin'
            if record['file'] != expected_name:
                raise RuntimeError(f'invalid shard order: {record["file"]}')
            path = parts_path / record['file']
            if not path.exists() or path.stat().st_size != record['size']:
                raise RuntimeError(f'shard size mismatch: {path}')
            if sha256_file(path) != record['sha256']:
                raise RuntimeError(f'shard sha256 mismatch: {path}')
            total += path.stat().st_size
        if total != archive['byte_length']:
            raise RuntimeError(f'archive byte length mismatch: {archive_path}')

    vector_size = shards_manifest['archives'][VECTOR_ARCHIVE]['byte_length']
    if vector_size > int(16.5 * 1024 * 1024):
        raise RuntimeError(f'vector exceeds 16.5 MiB: {vector_size}')
    if (ROOT / 'data/shards/vector').exists() or (ROOT / 'data/shards/dem').exists():
        raise RuntimeError('unversioned shard directories remain')
    if (ROOT / 'assets/map-natural.js').exists():
        raise RuntimeError('obsolete map-natural.js remains')
    if 'map-natural.js' in (ROOT / 'assets/bootstrap.js').read_text(encoding='utf-8'):
        raise RuntimeError('bootstrap still loads map-natural.js')

    map_ui = (ROOT / 'assets/map-ui.js').read_text(encoding='utf-8')
    obsolete_layer_ids = (
        "id:'glacier-fill'", "id:'peak-snow'", "id:'elbrus-snow-",
        "id:'river-halo'", "id:'river-main'", "id:'main-lake-points'"
    )
    for layer_id in obsolete_layer_ids:
        if layer_id in map_ui:
            raise RuntimeError(f'obsolete layer remains: {layer_id}')

    data = read_map_data()
    if features(data.get('mainLakes')):
        raise RuntimeError('mainLakes point geometry remains')
    source_text = ''.join(path.read_text(encoding='utf-8') for path in PARTS)
    if '"rivers":{"type":"FeatureCollection","features":[{' in source_text:
        raise RuntimeError('duplicated custom river geometry remains')
    if data.get('version') != VERSION or data.get('regionalVector', {}).get('archivePath') != VECTOR_ARCHIVE:
        raise RuntimeError('runtime data version mismatch')


def main() -> None:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest='command', required=True)
    subparsers.add_parser('prepare')
    subparsers.add_parser('classify')
    patch_runtime = subparsers.add_parser('patch-runtime')
    patch_runtime.add_argument('--archive', required=True)
    patch_runtime.add_argument('--source-url', required=True)
    patch_runtime.add_argument('--source-md5', required=True)
    patch_runtime.add_argument('--pipeline', required=True)
    patch_runtime.add_argument('--tippecanoe-commit', required=True)
    subparsers.add_parser('validate-repository')
    arguments = parser.parse_args()

    if arguments.command == 'prepare':
        prepare()
    elif arguments.command == 'classify':
        classify()
    elif arguments.command == 'patch-runtime':
        integrate(
            arguments.archive,
            arguments.source_url,
            arguments.source_md5,
            arguments.pipeline,
            arguments.tippecanoe_commit
        )
    else:
        validate_repository()


if __name__ == '__main__':
    main()
