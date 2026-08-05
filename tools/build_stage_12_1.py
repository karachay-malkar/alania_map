#!/usr/bin/env python3
"""Generate 1000 mountain bindings and river-chain diagnostics for Alan Map 12.1."""
from __future__ import annotations

import hashlib
import json
import math
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable

VERSION = "12.1.4"
ROOT = Path(__file__).resolve().parents[1]
TYPE_ORDER = ["five_thousander", "main_mountain", "mountain", "rock", "ridge", "hill"]
ICON_GROUPS = {
    "five_thousander": ["mount-11", "mount-17", "mount-22", "mount-26"],
    "main_mountain": ["mount-3", "mount-12", "mount-13", "mount-16", "mount-23", "mount-29"],
    "mountain": ["mount-4", "mount-6", "mount-9", "mount-18", "mount-27", "mount-30"],
    "rock": ["mount-5", "mount-15", "mount-19", "mount-21", "mount-25"],
    "ridge": ["mount-2", "mount-7", "mount-14", "mount-20", "mount-24"],
    "hill": ["mount-8", "mount-10", "mount-28"],
}
BASE_SCALE = {"mountain": 0.38, "rock": 0.35, "ridge": 0.42, "hill": 0.33}
CORRIDOR_KM = {1: 18.0, 2: 13.0, 3: 9.0}
GAP_TARGET_KM = {1: 6.5, 2: 7.0, 3: 7.5}


def load(path: str) -> Any:
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


def save(path: str, value: Any) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def stable(value: str) -> float:
    return int.from_bytes(hashlib.sha256(value.encode()).digest()[:8], "big") / (2**64 - 1)


def kmxy(lon: float, lat: float, mean_lat: float) -> tuple[float, float]:
    return lon * 111.320 * math.cos(math.radians(mean_lat)), lat * 110.574


def iter_lines(geometry: dict[str, Any]) -> Iterable[list[list[float]]]:
    if geometry.get("type") == "LineString":
        yield geometry.get("coordinates") or []
    elif geometry.get("type") == "MultiLineString":
        yield from geometry.get("coordinates") or []


def build_segments(rivers: dict[str, Any], mean_lat: float) -> list[dict[str, Any]]:
    result = []
    for feature in rivers["features"]:
        props = feature["properties"]
        tier = int(props["tier"])
        for line in iter_lines(feature["geometry"]):
            points = [kmxy(float(p[0]), float(p[1]), mean_lat) for p in line]
            for (ax, ay), (bx, by) in zip(points, points[1:]):
                dx, dy = bx - ax, by - ay
                length_sq = dx * dx + dy * dy
                if length_sq > 1e-10:
                    result.append({"system_id": props["system_id"], "tier": tier, "ax": ax, "ay": ay, "dx": dx, "dy": dy, "length_sq": length_sq})
    if not result:
        raise RuntimeError("No usable local river segments")
    return result


def nearest_river(point: dict[str, Any], segments: list[dict[str, Any]]) -> dict[str, Any]:
    best = None
    best_sq = float("inf")
    px, py = point["x"], point["y"]
    for segment in segments:
        t = ((px - segment["ax"]) * segment["dx"] + (py - segment["ay"]) * segment["dy"]) / segment["length_sq"]
        t = max(0.0, min(1.0, t))
        qx = segment["ax"] + t * segment["dx"]
        qy = segment["ay"] + t * segment["dy"]
        vx, vy = px - qx, py - qy
        distance_sq = vx * vx + vy * vy
        if distance_sq < best_sq:
            cross = segment["dx"] * (py - segment["ay"]) - segment["dy"] * (px - segment["ax"])
            best_sq = distance_sq
            best = {"system_id": segment["system_id"], "tier": segment["tier"], "distance_km": math.sqrt(distance_sq), "nearest_x": qx, "side": "left" if cross > 0 else "right" if cross < 0 else "axis"}
    assert best is not None
    best["in_corridor"] = best["distance_km"] <= CORRIDOR_KM[best["tier"]]
    return best


def distance(a: dict[str, Any], b: dict[str, Any]) -> float:
    return math.hypot(a["x"] - b["x"], a["y"] - b["y"])


def decorate(points: dict[str, Any], rivers: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    features = points["features"]
    mean_lat = sum(float(f["properties"]["latitude"]) for f in features) / len(features)
    elevations = defaultdict(list)
    for feature in features:
        props = feature["properties"]
        if props.get("elevation_m") is not None:
            elevations[props["type"]].append(int(props["elevation_m"]))
    ranges = {kind: (min(values), max(values)) for kind, values in elevations.items()}
    records = []
    for feature in features:
        props = feature["properties"]
        x, y = kmxy(float(props["longitude"]), float(props["latitude"]), mean_lat)
        low, high = ranges.get(props["type"], (0, 1))
        elevation = int(props.get("elevation_m") or 0)
        records.append({"feature": feature, "id": props["id"], "type": props["type"], "lat": float(props["latitude"]), "elevation": elevation, "elevation_score": 0.0 if high == low else (elevation - low) / (high - low), "x": x, "y": y})

    segments = build_segments(rivers, mean_lat)
    for record in records:
        record["river"] = nearest_river(record, segments)
        record["nearest_point_km"] = min(distance(record, other) for other in records if other is not record)

    groups = defaultdict(list)
    for record in records:
        river = record["river"]
        if river["in_corridor"] and river["side"] != "axis":
            groups[(river["system_id"], river["side"])].append(record)
    for record in records:
        river = record["river"]
        same_gap = None
        if river["in_corridor"] and river["side"] != "axis":
            peers = groups[(river["system_id"], river["side"])]
            same_gap = min((distance(record, other) for other in peers if other is not record), default=None)
        record["same_side_gap_km"] = same_gap
        target = GAP_TARGET_KM[river["tier"]]
        side_score = 1.0 if same_gap is None and river["in_corridor"] else max(0.0, min(1.0, ((same_gap or 0.0) - target * 0.65) / (target * 0.8)))
        spacing_score = max(0.0, min(1.0, (record["nearest_point_km"] - 3.1) / 2.6))
        record["gap_score"] = max(side_score, spacing_score)

    side_report = []
    for system_id in sorted({r["river"]["system_id"] for r in records if r["river"]["in_corridor"]}):
        system = [r for r in records if r["river"]["in_corridor"] and r["river"]["system_id"] == system_id]
        item = {"system_id": system_id, "tier": min(r["river"]["tier"] for r in system), "corridor_points": len(system)}
        for side in ("left", "right"):
            side_records = [r for r in system if r["river"]["side"] == side]
            gaps = [r["same_side_gap_km"] for r in side_records if r["same_side_gap_km"] is not None]
            item[f"{side}_points"] = len(side_records)
            item[f"{side}_max_nearest_gap_km"] = round(max(gaps), 3) if gaps else None
        side_report.append(item)
    report = {"segment_count": len(segments), "corridor_point_count": sum(r["river"]["in_corridor"] for r in records), "large_spacing_count": sum(r["nearest_point_km"] > 5.5 for r in records), "river_sides": side_report}
    return records, report


def build_bindings(records: list[dict[str, Any]], manifest: dict[str, Any]) -> list[dict[str, Any]]:
    aspects = {icon["id"]: icon["width"] / icon["height"] for icon in manifest["icons"]}
    usage = Counter()
    bindings = []
    for record in sorted(records, key=lambda r: r["id"]):
        options = ICON_GROUPS[record["type"]]
        desired = 3.55 if record["gap_score"] >= 0.55 else 3.05
        if record["type"] == "five_thousander":
            desired = 1.15 if usage["mount-11"] == 0 else 3.0
        icon = min(options, key=lambda item: (usage[item], abs(aspects.get(item, 3.0) - desired), stable(record["id"] + item)))
        usage[icon] += 1
        if record["type"] == "five_thousander":
            scale = 1.10 + 0.16 * record["elevation_score"] + 0.05 * record["gap_score"]
            priority = 2000 + record["elevation"]
        elif record["type"] == "main_mountain":
            scale = 0.86 + 0.16 * record["elevation_score"] + 0.07 * record["gap_score"]
            priority = 1500 + record["elevation"]
        else:
            scale = min(BASE_SCALE[record["type"]] + 0.075 * record["elevation_score"] + 0.14 * record["gap_score"] + (0.025 if record["river"]["in_corridor"] else 0), 0.61)
            priority = 700 + int(record["elevation_score"] * 100) + int(record["gap_score"] * 80)
        river = record["river"]
        shift = max(-0.14, min(0.14, (record["x"] - river["nearest_x"]) / max(river["distance_km"], 1e-6) * (0.07 + 0.05 * record["gap_score"]))) if river["in_corridor"] else (stable(record["id"] + ":base") - 0.5) * 0.035
        bindings.append({"point_id": record["id"], "icon_id": icon, "min_zoom": 6.7, "icon_scale": round(scale, 4), "base_shift": round(shift, 4), "priority": priority})
    return bindings


def main() -> None:
    full = load("data/archive/mountain_points_full.geojson")
    points = load("data/mountains/mountain_points.geojson")
    river_parts = [load("data/hydrography/rivers-major.geojson"), load("data/hydrography/rivers-medium.geojson"), load("data/hydrography/rivers-minor.geojson")]
    rivers = {"type": "FeatureCollection", "features": [feature for part in river_parts for feature in part["features"]]}
    manifest = load("data/mountains/mountain_icon_manifest.json")
    if len(points["features"]) != 1000:
        raise RuntimeError("Active point set must contain exactly 1000 points")
    records, chain_report = decorate(points, rivers)
    bindings = build_bindings(records, manifest)
    by_id = {record["id"]: record for record in records}
    selection = {
        "version": VERSION,
        "source_points": len(full["features"]),
        "active_points": len(records),
        "actual_counts": dict(Counter(r["type"] for r in records)),
        "icon_bindings": len(bindings),
        "icon_counts": dict(Counter(by_id[b["point_id"]]["type"] for b in bindings)),
        "icon_tiers": dict(Counter(str(b["min_zoom"]) for b in bindings)),
        "used_icons": dict(Counter(b["icon_id"] for b in bindings)),
        "river_chain_analysis": chain_report,
        "unbound_points": sorted(set(by_id) - {b["point_id"] for b in bindings}),
        "mount_1_used": any(b["icon_id"] == "mount-1" for b in bindings),
        "mount_11_non_5000": [b["point_id"] for b in bindings if b["icon_id"] == "mount-11" and by_id[b["point_id"]]["type"] != "five_thousander"],
        "draw_order": "ordinary north-to-south, then main_mountain, then five_thousander",
    }
    catalog = {"version": VERSION, "source": "final_mount_library_30_png(1).zip", "excluded": ["mount-1"], "rules": {"mount-11": "five_thousander only", "all_active_points_have_icons": True, "river_corridor_geometry_adjustment": "scale, wide-icon selection and center-based shear; image center remains on the source coordinate"}, "groups": ICON_GROUPS}
    save("data/mountains/mountain_icon_bindings.json", bindings)
    save("data/mountains/mountain_icon_catalog.json", catalog)
    save("data/mountains/selection_report.json", selection)
    save("data/hydrography/river_mountain_report.json", {"version": VERSION, "method": "Every active mountain coordinate is checked against the nearest validated river segment; scale, PNG aspect and center-based shear reduce chain gaps while the image center stays fixed.", **chain_report})
    print(json.dumps(selection, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
