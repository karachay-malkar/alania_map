#!/usr/bin/env python3
"""Build the deterministic Alan Map 12.1.5 mountain and river runtime package."""
from __future__ import annotations

import hashlib
import json
import math
import shutil
from collections import Counter, defaultdict
from pathlib import Path
from statistics import median
from typing import Any, Iterable

from shapely.geometry import LineString, Point, shape
from shapely.ops import linemerge, unary_union

VERSION = "12.1.5"
ROOT = Path(__file__).resolve().parents[1]
TYPE_ORDER = ["five_thousander", "main_mountain", "ridge", "mountain", "rock", "hill"]
TYPE_PREFIX = {
    "five_thousander": "mount-5000",
    "main_mountain": "mount-main",
    "ridge": "ridge",
    "mountain": "mount",
    "rock": "rock",
    "hill": "hill",
}
FIVE_THOUSANDER_ICONS = ["mount-11", "mount-15", "mount-21", "mount-25"]
ICON_GROUPS = {
    "five_thousander": FIVE_THOUSANDER_ICONS,
    "main_mountain": ["mount-5", "mount-6", "mount-12", "mount-15", "mount-16", "mount-19", "mount-21", "mount-25", "mount-27"],
    "ridge": ["mount-2", "mount-7", "mount-14", "mount-20", "mount-24", "mount-28"],
    "mountain": ["mount-4", "mount-6", "mount-9", "mount-18", "mount-27", "mount-30"],
    "rock": ["mount-5", "mount-15", "mount-19", "mount-21", "mount-25"],
    "hill": ["mount-8", "mount-10", "mount-13", "mount-23", "mount-28", "mount-29"],
}
BASE_SCALE = {"mountain": 0.38, "rock": 0.35, "ridge": 0.42, "hill": 0.33}
CORRIDOR_KM = {1: 18.0, 2: 13.0, 3: 9.0}
GAP_TARGET_KM = {1: 6.5, 2: 7.0, 3: 7.5}
MIN_ROUTE_KM = {1: 5.0, 2: 4.0, 3: 2.5}
MIN_COUNTS = {"mountain": 390, "rock": 150, "hill": 110}
NAME_OVERRIDES = {
    "mount-5000-0002": "Джанги-Тау Восточная",
    "mount-main-0013": "Пик 4859",
}
RUNTIME_FILES = {
    "app": f"assets/app-{VERSION}.js",
    "maplibre": f"assets/maplibre-{VERSION}.js",
    "maplibre_css": f"assets/maplibre-{VERSION}.css",
    "styles": f"styles-{VERSION}.css",
    "atlas": f"assets/mountains/mountain-atlas-{VERSION}.png",
    "boundary": f"data/map-frame-{VERSION}.geojson",
    "render": f"data/mountains/mountain-render-{VERSION}.geojson",
    "manifest": f"data/mountains/mountain-icon-manifest-{VERSION}.json",
    "rivers": f"data/hydrography/rivers-{VERSION}.geojson",
}


def load(path: str) -> Any:
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


def save(path: str, value: Any) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def stable(value: str) -> float:
    return int.from_bytes(hashlib.sha256(value.encode()).digest()[:8], "big") / (2**64 - 1)


def clean_feature(feature: dict[str, Any]) -> dict[str, Any]:
    props = feature["properties"]
    item = {
        "id": str(props["id"]),
        "type": str(props["type"]),
        "longitude": round(float(props["longitude"]), 6),
        "latitude": round(float(props["latitude"]), 6),
        "elevation_m": int(props["elevation_m"]) if props.get("elevation_m") is not None else None,
        "name": str(NAME_OVERRIDES.get(str(props["id"]), props.get("name") or "")).strip(),
    }
    return {"type": "Feature", "properties": item, "geometry": {"type": "Point", "coordinates": [item["longitude"], item["latitude"]]}}


def iter_lines(geometry: dict[str, Any]) -> Iterable[list[list[float]]]:
    if geometry.get("type") == "LineString":
        yield geometry.get("coordinates") or []
    elif geometry.get("type") == "MultiLineString":
        yield from geometry.get("coordinates") or []


def local_projection(features: list[dict[str, Any]]) -> tuple[float, float, float]:
    mean_lat = sum(float(feature["properties"]["latitude"]) for feature in features) / len(features)
    return mean_lat, 111.320 * math.cos(math.radians(mean_lat)), 110.574


def to_xy(lon: float, lat: float, sx: float, sy: float) -> tuple[float, float]:
    return lon * sx, lat * sy


def to_lonlat(x: float, y: float, sx: float, sy: float) -> tuple[float, float]:
    return x / sx, y / sy


def merged_routes(feature: dict[str, Any], sx: float, sy: float) -> list[LineString]:
    lines = [LineString([to_xy(float(point[0]), float(point[1]), sx, sy) for point in line]) for line in iter_lines(feature["geometry"]) if len(line) >= 2]
    if not lines:
        return []
    unioned = unary_union(lines)
    merged = unioned if unioned.geom_type == "LineString" else linemerge(unioned)
    routes = [merged] if merged.geom_type == "LineString" else list(merged.geoms)
    return sorted((route for route in routes if route.length >= 0.25), key=lambda route: (-round(route.length, 6), tuple(round(value, 6) for value in route.bounds), route.wkb_hex))


def side_at(route: LineString, station: float, point: Point) -> str:
    epsilon = min(max(route.length * 1e-5, 0.02), 0.15)
    start = route.interpolate(max(0.0, station - epsilon))
    end = route.interpolate(min(route.length, station + epsilon))
    nearest = route.interpolate(station)
    cross = (end.x - start.x) * (point.y - nearest.y) - (end.y - start.y) * (point.x - nearest.x)
    return "left" if cross > 0 else "right" if cross < 0 else "axis"


def route_normal(route: LineString, station: float, side: str) -> tuple[float, float]:
    epsilon = min(max(route.length * 1e-5, 0.03), 0.2)
    start = route.interpolate(max(0.0, station - epsilon))
    end = route.interpolate(min(route.length, station + epsilon))
    dx, dy = end.x - start.x, end.y - start.y
    length = math.hypot(dx, dy) or 1.0
    left = (-dy / length, dx / length)
    return left if side == "left" else (-left[0], -left[1])


def point_records(features: list[dict[str, Any]], sx: float, sy: float) -> list[dict[str, Any]]:
    records = []
    for feature in features:
        clean = clean_feature(feature)
        props = clean["properties"]
        x, y = to_xy(props["longitude"], props["latitude"], sx, sy)
        records.append({"id": props["id"], "type": props["type"], "elevation": int(props.get("elevation_m") or 0), "feature": clean, "point": Point(x, y), "x": x, "y": y})
    return records


def project_candidates(route: LineString, tier: int, records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    candidates = []
    for record in records:
        distance_km = route.distance(record["point"])
        if distance_km > CORRIDOR_KM[tier]:
            continue
        station = route.project(record["point"])
        side = side_at(route, station, record["point"])
        if side == "axis":
            continue
        candidates.append({**record, "station_km": station, "distance_km": distance_km, "side": side})
    return candidates


def supported_clusters(candidates: list[dict[str, Any]], tier: int, side: str) -> list[list[dict[str, Any]]]:
    selected = sorted((candidate for candidate in candidates if candidate["side"] == side), key=lambda candidate: (candidate["station_km"], candidate["id"]))
    if len(selected) < 2:
        return []
    break_km = max(GAP_TARGET_KM[tier] * 2.2, 12.0)
    clusters: list[list[dict[str, Any]]] = []
    current = [selected[0]]
    for candidate in selected[1:]:
        if candidate["station_km"] - current[-1]["station_km"] <= break_km:
            current.append(candidate)
        else:
            clusters.append(current)
            current = [candidate]
    clusters.append(current)
    return [cluster for cluster in clusters if len(cluster) >= 2 and cluster[-1]["station_km"] - cluster[0]["station_km"] >= GAP_TARGET_KM[tier] * 0.7]


def synthetic_anchor(
    route: LineString,
    station: float,
    side: str,
    tier: int,
    nearby: list[dict[str, Any]],
    boundary_shape: Any,
    sx: float,
    sy: float,
    provenance: dict[str, Any],
) -> dict[str, Any]:
    route_point = route.interpolate(station)
    local = [candidate for candidate in nearby if candidate["side"] == side and abs(candidate["station_km"] - station) <= GAP_TARGET_KM[tier] * 1.6]
    offset = median([candidate["distance_km"] for candidate in local]) if local else CORRIDOR_KM[tier] * 0.38
    offset = min(max(float(offset), 2.8), CORRIDOR_KM[tier] * 0.72)
    nx, ny = route_normal(route, station, side)
    x, y = route_point.x + nx * offset, route_point.y + ny * offset
    lon, lat = to_lonlat(x, y, sx, sy)
    attempts = 0
    while not boundary_shape.covers(Point(lon, lat)) and attempts < 6:
        offset *= 0.65
        x, y = route_point.x + nx * offset, route_point.y + ny * offset
        lon, lat = to_lonlat(x, y, sx, sy)
        attempts += 1
    elevations = [candidate["elevation"] for candidate in local if candidate["elevation"] > 0]
    elevation = int(round(median(elevations))) if elevations else None
    return {
        "type": "Feature",
        "properties": {
            "id": "",
            "type": "ridge",
            "longitude": round(lon, 6),
            "latitude": round(lat, 6),
            "elevation_m": elevation,
            "name": "",
        },
        "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
        "_provenance": {**provenance, "station_km": round(station, 3), "offset_km": round(offset, 3)},
    }


def build_station_anchors(
    full_records: list[dict[str, Any]],
    rivers: dict[str, Any],
    active_ids: set[str],
    boundary_shape: Any,
    sx: float,
    sy: float,
) -> tuple[set[str], list[dict[str, Any]], dict[str, Any], dict[str, dict[str, Any]]]:
    source_anchor_ids: set[str] = set()
    synthetic: list[dict[str, Any]] = []
    route_reports: list[dict[str, Any]] = []
    source_projection: dict[str, dict[str, Any]] = {}

    ordered_features = sorted(rivers["features"], key=lambda feature: (int(feature["properties"]["tier"]), str(feature["properties"]["system_id"])))
    for river_feature in ordered_features:
        properties = river_feature["properties"]
        system_id = str(properties["system_id"])
        tier = int(properties["tier"])
        target = GAP_TARGET_KM[tier]
        for route_index, route in enumerate(merged_routes(river_feature, sx, sy)):
            if route.length < MIN_ROUTE_KM[tier]:
                continue
            candidates = project_candidates(route, tier, full_records)
            for candidate in candidates:
                current = source_projection.get(candidate["id"])
                if current is None or candidate["distance_km"] < current["distance_km"]:
                    source_projection[candidate["id"]] = {
                        "system_id": system_id,
                        "tier": tier,
                        "distance_km": candidate["distance_km"],
                        "station_km": candidate["station_km"],
                        "side": candidate["side"],
                    }
            for side in ("left", "right"):
                for cluster_index, cluster in enumerate(supported_clusters(candidates, tier, side)):
                    start_station = cluster[0]["station_km"]
                    end_station = cluster[-1]["station_km"]
                    span = end_station - start_station
                    samples = max(1, math.ceil(span / (target * 0.78)))
                    desired = [start_station + span * index / samples for index in range(samples + 1)]
                    chosen: list[dict[str, Any]] = []
                    used_in_chain: set[str] = set()
                    for station in desired:
                        options = [
                            candidate
                            for candidate in cluster
                            if candidate["id"] not in used_in_chain and abs(candidate["station_km"] - station) <= target * 0.48
                        ]
                        if options:
                            selected = min(
                                options,
                                key=lambda candidate: (
                                    abs(candidate["station_km"] - station)
                                    + candidate["distance_km"] * 0.10
                                    - (0.32 if candidate["id"] in active_ids else 0.0)
                                    - (0.18 if candidate["type"] in {"mountain", "rock"} else 0.0)
                                    - candidate["elevation"] / 20000.0,
                                    candidate["id"],
                                ),
                            )
                            used_in_chain.add(selected["id"])
                            source_anchor_ids.add(selected["id"])
                            chosen.append({"kind": "source", "station_km": selected["station_km"], "id": selected["id"]})
                        else:
                            item = synthetic_anchor(
                                route,
                                station,
                                side,
                                tier,
                                cluster,
                                boundary_shape,
                                sx,
                                sy,
                                {"system_id": system_id, "route_index": route_index, "side": side, "cluster_index": cluster_index, "reason": "sample_without_source_point"},
                            )
                            synthetic.append(item)
                            chosen.append({"kind": "synthetic", "station_km": station, "item": item})

                    while True:
                        ordered = sorted(chosen, key=lambda item: item["station_km"])
                        oversized = [
                            (right["station_km"] - left["station_km"], left, right)
                            for left, right in zip(ordered, ordered[1:])
                            if right["station_km"] - left["station_km"] > target
                        ]
                        if not oversized:
                            break
                        _, left, right = max(oversized, key=lambda item: item[0])
                        station = (left["station_km"] + right["station_km"]) / 2.0
                        item = synthetic_anchor(
                            route,
                            station,
                            side,
                            tier,
                            cluster,
                            boundary_shape,
                            sx,
                            sy,
                            {"system_id": system_id, "route_index": route_index, "side": side, "cluster_index": cluster_index, "reason": "longitudinal_gap"},
                        )
                        synthetic.append(item)
                        chosen.append({"kind": "synthetic", "station_km": station, "item": item})

                    ordered = sorted(chosen, key=lambda item: item["station_km"])
                    gaps = [right["station_km"] - left["station_km"] for left, right in zip(ordered, ordered[1:])]
                    route_reports.append(
                        {
                            "system_id": system_id,
                            "tier": tier,
                            "route_index": route_index,
                            "side": side,
                            "cluster_index": cluster_index,
                            "route_length_km": round(route.length, 3),
                            "supported_span_km": round(span, 3),
                            "source_candidates": len(cluster),
                            "selected_anchors": len(ordered),
                            "synthetic_anchors": sum(item["kind"] == "synthetic" for item in ordered),
                            "max_longitudinal_gap_km": round(max(gaps), 3) if gaps else 0.0,
                            "target_gap_km": target,
                        }
                    )

    synthetic.sort(key=lambda feature: (
        feature["_provenance"]["system_id"],
        feature["_provenance"]["route_index"],
        feature["_provenance"]["side"],
        feature["_provenance"]["station_km"],
        feature["properties"]["longitude"],
        feature["properties"]["latitude"],
    ))
    for index, feature in enumerate(synthetic, 1):
        feature["properties"]["id"] = f"ridge-{index:04d}"

    by_system: dict[str, dict[str, Any]] = {}
    for report in route_reports:
        entry = by_system.setdefault(
            report["system_id"],
            {"tier": report["tier"], "chains": 0, "selected_anchors": 0, "synthetic_anchors": 0, "max_longitudinal_gap_km": 0.0, "target_gap_km": report["target_gap_km"]},
        )
        entry["chains"] += 1
        entry["selected_anchors"] += report["selected_anchors"]
        entry["synthetic_anchors"] += report["synthetic_anchors"]
        entry["max_longitudinal_gap_km"] = max(entry["max_longitudinal_gap_km"], report["max_longitudinal_gap_km"])
    for entry in by_system.values():
        entry["max_longitudinal_gap_km"] = round(entry["max_longitudinal_gap_km"], 3)

    report = {
        "version": VERSION,
        "method": "Merged river routes are station-referenced. Supported mountain spans are sampled separately on both valley sides; missing longitudinal anchors are added as unnamed ridge anchors parallel to the validated river geometry.",
        "source_anchor_count": len(source_anchor_ids),
        "synthetic_ridge_anchor_count": len(synthetic),
        "systems": by_system,
        "chains": route_reports,
        "all_chain_targets_pass": all(report["max_longitudinal_gap_km"] <= report["target_gap_km"] + 1e-9 for report in route_reports),
    }
    return source_anchor_ids, synthetic, report, source_projection


def nearest_neighbor_distances(records: list[dict[str, Any]]) -> dict[str, float]:
    result: dict[str, float] = {}
    for index, record in enumerate(records):
        best = float("inf")
        for other_index, other in enumerate(records):
            if index == other_index:
                continue
            dx, dy = record["x"] - other["x"], record["y"] - other["y"]
            distance = math.hypot(dx, dy)
            if distance < best:
                best = distance
        result[record["id"]] = best
    return result


def select_active_points(
    current_features: list[dict[str, Any]],
    full_records: list[dict[str, Any]],
    source_anchor_ids: set[str],
    synthetic_features: list[dict[str, Any]],
    source_projection: dict[str, dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    full_by_id = {record["id"]: record for record in full_records}
    current_ids = {feature["properties"]["id"] for feature in current_features if feature["properties"]["id"] in full_by_id}
    mandatory_ids = {record["id"] for record in full_records if record["type"] in {"main_mountain", "five_thousander"}} | source_anchor_ids
    source_target = 1000 - len(synthetic_features)
    selected_ids = current_ids | mandatory_ids
    selected_records = [full_by_id[point_id] for point_id in selected_ids]
    nearest = nearest_neighbor_distances(selected_records)
    max_elevation = max(record["elevation"] for record in full_records) or 1

    counts = Counter(full_by_id[point_id]["type"] for point_id in selected_ids)
    removable = []
    for point_id in selected_ids:
        record = full_by_id[point_id]
        if point_id in mandatory_ids or record["type"] in {"main_mountain", "five_thousander"}:
            continue
        projection = source_projection.get(point_id)
        proximity = 0.0 if projection is None else max(0.0, 1.0 - projection["distance_km"] / CORRIDOR_KM[projection["tier"]])
        isolation = min(nearest[point_id] / 8.0, 1.0)
        elevation = record["elevation"] / max_elevation
        keep_score = isolation * 1.35 + elevation * 0.72 + proximity * 0.60 + stable(point_id + ":keep") * 0.03
        removable.append((keep_score, point_id))
    removable.sort(key=lambda item: (item[0], item[1]))

    removed: list[str] = []
    for _, point_id in removable:
        if len(selected_ids) <= source_target:
            break
        kind = full_by_id[point_id]["type"]
        if kind in MIN_COUNTS and counts[kind] <= MIN_COUNTS[kind]:
            continue
        selected_ids.remove(point_id)
        counts[kind] -= 1
        removed.append(point_id)
    if len(selected_ids) != source_target:
        raise RuntimeError(f"Could not reduce active source points to {source_target}; got {len(selected_ids)}")

    source_features = [clean_feature(full_by_id[point_id]["feature"]) for point_id in selected_ids]
    ridge_features = []
    synthetic_provenance = []
    for feature in synthetic_features:
        copy = {"type": "Feature", "properties": dict(feature["properties"]), "geometry": feature["geometry"]}
        ridge_features.append(copy)
        synthetic_provenance.append({"id": copy["properties"]["id"], **feature["_provenance"]})
    features = source_features + ridge_features
    features.sort(key=lambda feature: (TYPE_ORDER.index(feature["properties"]["type"]), feature["properties"]["id"]))
    if len(features) != 1000 or len({feature["properties"]["id"] for feature in features}) != 1000:
        raise RuntimeError("The active point set must contain exactly 1000 unique objects")

    report = {
        "added_source_points": sorted(selected_ids - current_ids),
        "removed_source_points": sorted(removed),
        "synthetic_ridge_anchors": synthetic_provenance,
        "source_point_count": len(source_features),
        "synthetic_point_count": len(ridge_features),
        "actual_counts": dict(Counter(feature["properties"]["type"] for feature in features)),
    }
    return features, report


def decorate_active(features: list[dict[str, Any]], river_projection: dict[str, dict[str, Any]], sx: float, sy: float) -> list[dict[str, Any]]:
    records = point_records(features, sx, sy)
    elevations: dict[str, list[int]] = defaultdict(list)
    for record in records:
        if record["elevation"] > 0:
            elevations[record["type"]].append(record["elevation"])
    ranges = {kind: (min(values), max(values)) for kind, values in elevations.items()}
    for record in records:
        low, high = ranges.get(record["type"], (0, 1))
        record["elevation_score"] = 0.0 if high == low else (record["elevation"] - low) / (high - low)
        distances = sorted(math.hypot(record["x"] - other["x"], record["y"] - other["y"]) for other in records if other is not record)
        record["nearest_point_km"] = distances[0]
        record["neighbor_count_6km"] = sum(distance <= 6.0 for distance in distances)
        record["priority_neighbor_count_15km"] = sum(
            1
            for other in records
            if other is not record
            and other["type"] in {"main_mountain", "five_thousander"}
            and math.hypot(record["x"] - other["x"], record["y"] - other["y"]) <= 15.0
        )
        projection = river_projection.get(record["id"])
        if projection is None and record["type"] == "ridge":
            projection = {"system_id": "ridge-anchor", "tier": 1, "distance_km": 4.0, "station_km": 0.0, "side": "axis"}
        record["river"] = projection
    return records


def build_bindings(records: list[dict[str, Any]], manifest: dict[str, Any]) -> list[dict[str, Any]]:
    by_icon = {icon["id"]: icon for icon in manifest["icons"]}
    aspects = {icon_id: icon["width"] / icon["height"] for icon_id, icon in by_icon.items()}
    peak_role = {icon_id for icon_id, icon in by_icon.items() if "peak" in icon.get("roles", [])}
    if not set(FIVE_THOUSANDER_ICONS).issubset(peak_role):
        raise RuntimeError("Five-thousander icon group contains a non-peak PNG")

    usage = Counter()
    bindings = []
    five_records = sorted((record for record in records if record["type"] == "five_thousander"), key=lambda record: (-record["elevation"], record["id"]))
    five_assignment = {record["id"]: FIVE_THOUSANDER_ICONS[index] for index, record in enumerate(five_records)}

    for record in sorted(records, key=lambda item: item["id"]):
        kind = record["type"]
        if kind == "five_thousander":
            icon = five_assignment[record["id"]]
        else:
            options = ICON_GROUPS[kind]
            desired = 3.70 if kind == "ridge" else 2.05 if kind == "rock" else 3.25
            if kind == "main_mountain":
                desired = 2.15
            icon = min(options, key=lambda item: (usage[item], abs(aspects.get(item, desired) - desired), stable(record["id"] + item)))
        usage[icon] += 1

        density_score = min(max((record["neighbor_count_6km"] - 2) / 9.0, 0.0), 1.0)
        priority_density = min(max((record["priority_neighbor_count_15km"] - 3) / 17.0, 0.0), 1.0)
        river = record["river"]
        in_corridor = bool(river and river["distance_km"] <= CORRIDOR_KM.get(int(river["tier"]), 18.0))
        if kind == "five_thousander":
            scale = (0.80 + 0.08 * record["elevation_score"]) * (1.0 - 0.10 * density_score - 0.18 * priority_density)
            priority = 3000 + record["elevation"]
        elif kind == "main_mountain":
            scale = (0.68 + 0.10 * record["elevation_score"]) * (1.0 - 0.10 * density_score - 0.28 * priority_density)
            priority = 2200 + record["elevation"]
        elif kind == "ridge":
            scale = 0.43 * (1.0 - 0.08 * density_score)
            priority = 1200 + int(record["elevation_score"] * 100)
        else:
            scale = BASE_SCALE[kind] + 0.065 * record["elevation_score"] + (0.035 if in_corridor else 0.0)
            scale *= 1.0 - 0.22 * density_score
            scale = min(max(scale, 0.285), 0.50)
            priority = 700 + int(record["elevation_score"] * 100) + (60 if in_corridor else 0)

        if river and river["side"] in {"left", "right"} and river["distance_km"] > 0:
            direction = 1.0 if river["side"] == "right" else -1.0
            shift = direction * (0.055 + 0.035 * (1.0 - min(river["distance_km"] / CORRIDOR_KM[int(river["tier"])], 1.0)))
        else:
            shift = (stable(record["id"] + ":base") - 0.5) * 0.03
        bindings.append(
            {
                "point_id": record["id"],
                "icon_id": icon,
                "min_zoom": 6.7,
                "icon_scale": round(scale, 4),
                "base_shift": round(max(-0.12, min(0.12, shift)), 4),
                "priority": priority,
            }
        )
    return bindings


def build_render(features: list[dict[str, Any]], bindings: list[dict[str, Any]]) -> dict[str, Any]:
    bindings_by_id = {binding["point_id"]: binding for binding in bindings}
    result = []
    for feature in features:
        properties = feature["properties"]
        binding = bindings_by_id[properties["id"]]
        result.append(
            {
                "type": "Feature",
                "properties": {
                    **properties,
                    "point_id": properties["id"],
                    "icon_id": binding["icon_id"],
                    "icon_scale": binding["icon_scale"],
                    "base_shift": binding["base_shift"],
                    "priority": binding["priority"],
                },
                "geometry": feature["geometry"],
            }
        )
    return {"type": "FeatureCollection", "features": result}


def write_runtime_files(boundary: dict[str, Any], rivers: dict[str, Any], render: dict[str, Any], manifest: dict[str, Any]) -> None:
    combined_maplibre = (ROOT / "assets/maplibre.part-000.js").read_text(encoding="utf-8") + (ROOT / "assets/maplibre.part-001.js").read_text(encoding="utf-8")
    (ROOT / RUNTIME_FILES["maplibre"]).write_text(combined_maplibre, encoding="utf-8")
    (ROOT / RUNTIME_FILES["app"]).write_text(
        "\n".join((ROOT / path).read_text(encoding="utf-8") for path in ["src/config.js", "src/data.js", "src/map.js", "src/map-compat.js", "src/app.js"]),
        encoding="utf-8",
    )
    shutil.copyfile(ROOT / "assets/maplibre.css", ROOT / RUNTIME_FILES["maplibre_css"])
    shutil.copyfile(ROOT / "styles.css", ROOT / RUNTIME_FILES["styles"])
    shutil.copyfile(ROOT / "assets/mountains/mountain-atlas.png", ROOT / RUNTIME_FILES["atlas"])
    save(RUNTIME_FILES["boundary"], boundary)
    save(RUNTIME_FILES["render"], render)
    save(RUNTIME_FILES["manifest"], manifest)
    save(RUNTIME_FILES["rivers"], rivers)


def main() -> None:
    full = load("data/archive/mountain_points_full.geojson")
    baseline = load("data/archive/mountain_points_12.1.4.geojson")
    boundary = load("data/map-frame.geojson")
    river_parts = [load("data/hydrography/rivers-major.geojson"), load("data/hydrography/rivers-medium.geojson"), load("data/hydrography/rivers-minor.geojson")]
    rivers = {"type": "FeatureCollection", "features": [feature for part in river_parts for feature in part["features"]]}
    manifest = load("data/mountains/mountain_icon_manifest.json")
    manifest["version"] = VERSION
    manifest["atlas"] = RUNTIME_FILES["atlas"]

    full_features = [clean_feature(feature) for feature in full["features"]]
    mean_lat, sx, sy = local_projection(full_features)
    full_records = point_records(full_features, sx, sy)
    full_ids = {feature["properties"]["id"] for feature in full_features}
    active_ids = {feature["properties"]["id"] for feature in baseline["features"] if feature["properties"]["id"] in full_ids}
    boundary_shape = unary_union([shape(feature["geometry"]) for feature in boundary["features"]])

    source_anchor_ids, synthetic, chain_report, source_projection = build_station_anchors(full_records, rivers, active_ids, boundary_shape, sx, sy)
    active_features, selection_delta = select_active_points(baseline["features"], full_records, source_anchor_ids, synthetic, source_projection)

    # Reproject final synthetic ridge anchors onto the closest route metadata from their provenance.
    for item in selection_delta["synthetic_ridge_anchors"]:
        source_projection[item["id"]] = {
            "system_id": item["system_id"],
            "tier": next(int(feature["properties"]["tier"]) for feature in rivers["features"] if feature["properties"]["system_id"] == item["system_id"]),
            "distance_km": item["offset_km"],
            "station_km": item["station_km"],
            "side": item["side"],
        }

    active_records = decorate_active(active_features, source_projection, sx, sy)
    bindings = build_bindings(active_records, manifest)
    render = build_render(active_features, bindings)

    by_id = {record["id"]: record for record in active_records}
    selection = {
        "version": VERSION,
        "source_points": len(full_features),
        "active_points": len(active_features),
        **selection_delta,
        "icon_bindings": len(bindings),
        "icon_counts": dict(Counter(by_id[binding["point_id"]]["type"] for binding in bindings)),
        "icon_tiers": dict(Counter(str(binding["min_zoom"]) for binding in bindings)),
        "used_icons": dict(Counter(binding["icon_id"] for binding in bindings)),
        "unbound_points": sorted(set(by_id) - {binding["point_id"] for binding in bindings}),
        "mount_1_used": any(binding["icon_id"] == "mount-1" for binding in bindings),
        "mount_11_non_5000": [binding["point_id"] for binding in bindings if binding["icon_id"] == "mount-11" and by_id[binding["point_id"]]["type"] != "five_thousander"],
        "five_thousander_icons": {binding["point_id"]: binding["icon_id"] for binding in bindings if by_id[binding["point_id"]]["type"] == "five_thousander"},
        "draw_order": "ordinary and ridge anchors north-to-south, then main_mountain, then five_thousander",
        "runtime_files": RUNTIME_FILES,
    }
    catalog = {
        "version": VERSION,
        "source": "final_mount_library_30_png(1).zip",
        "excluded": ["mount-1"],
        "rules": {
            "mount-11": "five_thousander only",
            "five_thousanders": "peak-role icons only",
            "all_active_points_have_icons": True,
            "river_corridor_geometry_adjustment": "station-referenced source anchors plus unnamed ridge anchors; PNG remains center-anchored",
            "dense_cluster_adjustment": "local icon_scale reduction with global 12.1.4 x2 physical base widths retained",
        },
        "groups": ICON_GROUPS,
    }

    source_report = load("data/hydrography/river_source_report.json")
    source_report["version"] = VERSION

    save("data/mountains/mountain_points.geojson", {"type": "FeatureCollection", "features": active_features})
    save("data/mountains/mountain_icon_bindings.json", bindings)
    save("data/mountains/mountain_icon_catalog.json", catalog)
    save("data/mountains/mountain_icon_manifest.json", manifest)
    save("data/mountains/mountain_render.geojson", render)
    save("data/mountains/selection_report.json", selection)
    save("data/hydrography/rivers.geojson", rivers)
    save("data/hydrography/river_source_report.json", source_report)
    save("data/hydrography/river_mountain_report.json", chain_report)
    write_runtime_files(boundary, rivers, render, manifest)
    print(json.dumps({"version": VERSION, "selection": selection, "chain_summary": {"all_pass": chain_report["all_chain_targets_pass"], "systems": chain_report["systems"]}}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
