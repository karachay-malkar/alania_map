#!/usr/bin/env python3
"""Deterministically reduce mountain points and bind project mountain PNGs."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


TARGET_COUNTS = {
    "five_thousander": 4,
    "main_mountain": 21,
    "mountain": 537,
    "rock": 236,
    "ridge": 0,
    "hill": 202,
}
ICON_COUNTS = {
    "five_thousander": 4,
    "main_mountain": 21,
    "mountain": 152,
    "rock": 67,
    "ridge": 0,
    "hill": 56,
}
TYPE_ORDER = ["five_thousander", "main_mountain", "mountain", "rock", "ridge", "hill"]
MANDATORY_TYPES = {"five_thousander", "main_mountain"}
ICON_GROUPS = {
    "five_thousander": ["mount-11", "mount-17", "mount-22", "mount-26"],
    "main_mountain": ["mount-3", "mount-12", "mount-13", "mount-16", "mount-23", "mount-29"],
    "mountain": ["mount-4", "mount-6", "mount-9", "mount-18", "mount-27", "mount-30"],
    "rock": ["mount-5", "mount-15", "mount-19", "mount-21", "mount-25"],
    "ridge": ["mount-2", "mount-7", "mount-14", "mount-20", "mount-24"],
    "hill": ["mount-8", "mount-10", "mount-28"],
}
ICON_MIN_ZOOMS = (8.2, 9.6, 11.0)


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: Any, *, compact: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(value, ensure_ascii=False, separators=(",", ":") if compact else None, indent=None if compact else 2)
    path.write_text(text + ("" if compact else "\n"), encoding="utf-8")


def km_xy(lon: float, lat: float, mean_lat: float) -> tuple[float, float]:
    return lon * 111.320 * math.cos(math.radians(mean_lat)), lat * 110.574


def dist_sq(left: dict[str, Any], right: dict[str, Any]) -> float:
    dx = left["x"] - right["x"]
    dy = left["y"] - right["y"]
    return dx * dx + dy * dy


def stable_fraction(value: str) -> float:
    digest = hashlib.sha256(value.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big") / float(2**64 - 1)


def decorate(features: list[dict[str, Any]]) -> list[dict[str, Any]]:
    mean_lat = sum(f["properties"]["latitude"] for f in features) / len(features)
    elevations_by_type: dict[str, list[int]] = defaultdict(list)
    for feature in features:
        props = feature["properties"]
        if props["elevation_m"] is not None:
            elevations_by_type[props["type"]].append(props["elevation_m"])
    ranges = {
        type_name: (min(values), max(values)) if values else (0, 1)
        for type_name, values in elevations_by_type.items()
    }
    records: list[dict[str, Any]] = []
    for feature in features:
        props = feature["properties"]
        lon = float(props["longitude"])
        lat = float(props["latitude"])
        x, y = km_xy(lon, lat, mean_lat)
        low, high = ranges.get(props["type"], (0, 1))
        elevation = props["elevation_m"] or 0
        elevation_score = 0.0 if high == low else (elevation - low) / (high - low)
        records.append({
            "feature": feature,
            "id": props["id"],
            "type": props["type"],
            "lon": lon,
            "lat": lat,
            "x": x,
            "y": y,
            "elevation": elevation,
            "elevation_score": elevation_score,
            "named": bool(props.get("name")),
        })
    return records


def proportional_schedule(targets: dict[str, int], already: Counter[str]) -> list[str]:
    remaining = {t: max(0, targets.get(t, 0) - already.get(t, 0)) for t in TYPE_ORDER}
    total = sum(remaining.values())
    chosen = Counter()
    schedule: list[str] = []
    for step in range(1, total + 1):
        available = [t for t in TYPE_ORDER if chosen[t] < remaining[t]]
        type_name = max(
            available,
            key=lambda t: (remaining[t] * step / total - chosen[t], remaining[t], -TYPE_ORDER.index(t)),
        )
        schedule.append(type_name)
        chosen[type_name] += 1
    return schedule


def select_uniform(records: list[dict[str, Any]], targets: dict[str, int]) -> tuple[list[dict[str, Any]], dict[str, float]]:
    by_type: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        by_type[record["type"]].append(record)

    selected: list[dict[str, Any]] = [r for r in records if r["type"] in MANDATORY_TYPES]
    selected_ids = {r["id"] for r in selected}
    counts = Counter(r["type"] for r in selected)

    # Preserve spatial extremes of every ordinary category before the greedy pass.
    for type_name in TYPE_ORDER:
        if type_name in MANDATORY_TYPES or targets.get(type_name, 0) <= 0:
            continue
        candidates = by_type[type_name]
        extrema = []
        for key in ("x", "y"):
            extrema.extend((min(candidates, key=lambda r: (r[key], r["id"])), max(candidates, key=lambda r: (r[key], r["id"]))))
        for record in extrema:
            if counts[type_name] >= targets[type_name] or record["id"] in selected_ids:
                continue
            selected.append(record)
            selected_ids.add(record["id"])
            counts[type_name] += 1

    candidates = [r for r in records if r["id"] not in selected_ids and counts[r["type"]] < targets.get(r["type"], 0)]
    min_dist = {r["id"]: min((dist_sq(r, s) for s in selected), default=float("inf")) for r in candidates}
    schedule = proportional_schedule(targets, counts)
    selection_scores: dict[str, float] = {}

    for type_name in schedule:
        pool = [r for r in candidates if r["type"] == type_name and r["id"] not in selected_ids]
        if not pool:
            raise RuntimeError(f"Not enough points for category {type_name}")
        max_distance = max(min_dist[r["id"]] for r in pool) or 1.0
        best = max(
            pool,
            key=lambda r: (
                0.76 * (min_dist[r["id"]] / max_distance)
                + 0.21 * r["elevation_score"]
                + 0.02 * (1.0 if r["named"] else 0.0)
                + 0.01 * stable_fraction(r["id"]),
                r["elevation"],
                r["id"],
            ),
        )
        score = 0.76 * (min_dist[best["id"]] / max_distance) + 0.21 * best["elevation_score"] + 0.02 * (1.0 if best["named"] else 0.0)
        selection_scores[best["id"]] = score
        selected.append(best)
        selected_ids.add(best["id"])
        counts[type_name] += 1
        for record in candidates:
            if record["id"] in selected_ids:
                continue
            distance = dist_sq(record, best)
            if distance < min_dist[record["id"]]:
                min_dist[record["id"]] = distance

    if len(selected) != sum(targets.values()):
        raise RuntimeError(f"Expected {sum(targets.values())} points, selected {len(selected)}")
    if Counter(r["type"] for r in selected) != Counter(targets):
        raise RuntimeError(f"Category counts mismatch: {Counter(r['type'] for r in selected)}")
    return selected, selection_scores


def select_icons(selected_points: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, float]]:
    by_type: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in selected_points:
        by_type[record["type"]].append(record)

    selected: list[dict[str, Any]] = [r for r in selected_points if r["type"] in MANDATORY_TYPES]
    selected_ids = {r["id"] for r in selected}
    counts = Counter(r["type"] for r in selected)
    candidates = [r for r in selected_points if r["id"] not in selected_ids and ICON_COUNTS.get(r["type"], 0) > 0]
    min_dist = {r["id"]: min((dist_sq(r, s) for s in selected), default=float("inf")) for r in candidates}
    schedule = proportional_schedule(ICON_COUNTS, counts)
    scores: dict[str, float] = {}

    for type_name in schedule:
        pool = [r for r in candidates if r["type"] == type_name and r["id"] not in selected_ids]
        if not pool:
            raise RuntimeError(f"Not enough icon candidates for category {type_name}")
        max_distance = max(min_dist[r["id"]] for r in pool) or 1.0
        best = max(
            pool,
            key=lambda r: (
                0.70 * (min_dist[r["id"]] / max_distance)
                + 0.28 * r["elevation_score"]
                + 0.02 * stable_fraction(r["id"]),
                r["elevation"],
                r["id"],
            ),
        )
        score = 0.70 * (min_dist[best["id"]] / max_distance) + 0.28 * best["elevation_score"]
        scores[best["id"]] = score
        selected.append(best)
        selected_ids.add(best["id"])
        counts[type_name] += 1
        for record in candidates:
            if record["id"] in selected_ids:
                continue
            distance = dist_sq(record, best)
            if distance < min_dist[record["id"]]:
                min_dist[record["id"]] = distance

    if len(selected) != sum(ICON_COUNTS.values()):
        raise RuntimeError(f"Expected {sum(ICON_COUNTS.values())} icon bindings, selected {len(selected)}")
    return selected, scores


def choose_icons(icon_points: list[dict[str, Any]], scores: dict[str, float]) -> list[dict[str, Any]]:
    usage: Counter[str] = Counter()
    placed: list[tuple[dict[str, Any], str]] = []
    ordinary = [r for r in icon_points if r["type"] not in MANDATORY_TYPES]
    ordinary_sorted = sorted(ordinary, key=lambda r: (scores.get(r["id"], 0), r["elevation"], r["id"]), reverse=True)
    tier_by_id: dict[str, float] = {}
    for index, record in enumerate(ordinary_sorted):
        tier_by_id[record["id"]] = ICON_MIN_ZOOMS[0] if index < 75 else ICON_MIN_ZOOMS[1] if index < 175 else ICON_MIN_ZOOMS[2]

    ordered = sorted(
        icon_points,
        key=lambda r: (
            2 if r["type"] == "five_thousander" else 1 if r["type"] == "main_mountain" else 0,
            scores.get(r["id"], 0),
            r["elevation"],
            r["id"],
        ),
        reverse=True,
    )
    bindings: list[dict[str, Any]] = []
    for rank, record in enumerate(ordered):
        options = ICON_GROUPS[record["type"]]
        def option_score(icon_id: str) -> tuple[float, float, float]:
            nearby_same = sum(1 for other, assigned in placed if assigned == icon_id and dist_sq(record, other) < 20 * 20)
            return (nearby_same, usage[icon_id], stable_fraction(record["id"] + ":" + icon_id))
        icon_id = min(options, key=option_score)
        usage[icon_id] += 1
        placed.append((record, icon_id))

        if record["type"] == "five_thousander":
            min_zoom = 6.7
            icon_scale = 1.05 + 0.13 * record["elevation_score"]
            priority = 1000 + record["elevation"]
        elif record["type"] == "main_mountain":
            min_zoom = 6.9
            icon_scale = 0.82 + 0.16 * record["elevation_score"]
            priority = 900 + record["elevation"]
        else:
            min_zoom = tier_by_id[record["id"]]
            base_scale = {"mountain": 0.58, "rock": 0.50, "ridge": 0.56, "hill": 0.40}[record["type"]]
            icon_scale = base_scale + 0.10 * record["elevation_score"]
            priority = int(700 - min_zoom * 20 + scores.get(record["id"], 0) * 100)

        bindings.append({
            "point_id": record["id"],
            "icon_id": icon_id,
            "min_zoom": round(min_zoom, 1),
            "icon_scale": round(icon_scale, 4),
            "priority": priority,
        })
    return sorted(bindings, key=lambda b: b["point_id"])



def build_catalog() -> dict[str, Any]:
    return {
        "version": "12.1.1",
        "source": "final_mount_library_30_png(1).zip",
        "excluded": ["mount-1"],
        "rules": {
            "mount-11": "five_thousander only",
            "sets_are_disjoint": True,
        },
        "groups": ICON_GROUPS,
    }


def nearest_neighbor_stats(records: list[dict[str, Any]]) -> dict[str, float]:
    distances = []
    for index, record in enumerate(records):
        nearest = min((math.sqrt(dist_sq(record, other)) for j, other in enumerate(records) if j != index), default=0.0)
        distances.append(nearest)
    distances.sort()
    def percentile(p: float) -> float:
        if not distances:
            return 0.0
        return distances[min(len(distances) - 1, round((len(distances) - 1) * p))]
    return {
        "minimum_km": round(distances[0], 3),
        "p10_km": round(percentile(0.10), 3),
        "median_km": round(percentile(0.50), 3),
        "p90_km": round(percentile(0.90), 3),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--full", type=Path, default=Path("data/archive/mountain_points_full.geojson"))
    parser.add_argument("--project-root", type=Path, default=Path("."))
    args = parser.parse_args()
    root = args.project_root.resolve()
    full = read_json(root / args.full)
    records = decorate(full["features"])
    selected, point_scores = select_uniform(records, TARGET_COUNTS)
    selected = sorted(selected, key=lambda r: (TYPE_ORDER.index(r["type"]), r["id"]))
    active_collection = {"type": "FeatureCollection", "features": [r["feature"] for r in selected]}
    icon_points, icon_scores = select_icons(selected)
    bindings = choose_icons(icon_points, icon_scores)
    catalog = build_catalog()

    write_json(root / "data/mountains/mountain_points.geojson", active_collection, compact=True)
    write_json(root / "data/mountains/mountain_icon_bindings.json", bindings, compact=False)
    write_json(root / "data/mountains/mountain_icon_catalog.json", catalog, compact=False)

    selected_by_id = {r["id"]: r for r in selected}
    icon_types = Counter(selected_by_id[b["point_id"]]["type"] for b in bindings)
    report = {
        "version": "12.1.1",
        "source_points": len(records),
        "active_points": len(selected),
        "target_counts": TARGET_COUNTS,
        "actual_counts": dict(Counter(r["type"] for r in selected)),
        "icon_bindings": len(bindings),
        "icon_counts": dict(icon_types),
        "icon_tiers": dict(Counter(str(b["min_zoom"]) for b in bindings)),
        "used_icons": dict(Counter(b["icon_id"] for b in bindings)),
        "point_spacing": nearest_neighbor_stats(selected),
        "icon_spacing": nearest_neighbor_stats(icon_points),
        "mandatory_missing_icons": [r["id"] for r in selected if r["type"] in MANDATORY_TYPES and r["id"] not in {b["point_id"] for b in bindings}],
        "mount_1_used": any(b["icon_id"] == "mount-1" for b in bindings),
        "mount_11_non_5000": [b["point_id"] for b in bindings if b["icon_id"] == "mount-11" and selected_by_id[b["point_id"]]["type"] != "five_thousander"],
    }
    write_json(root / "data/mountains/selection_report.json", report, compact=False)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
