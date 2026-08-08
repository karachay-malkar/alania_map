#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
from collections import Counter
from pathlib import Path
from typing import Any

CATEGORIES = {
    "rounded_hill",
    "rounded_mountain",
    "steep_mountain",
    "isolated_peak",
    "massif",
    "ridge",
    "rocky_peak",
    "rocky_ridge",
    "plateau",
}

NAME_OVERRIDES = {
    "mount-5000-0002": "Джанги-Тау Восточная",
    "mount-main-0013": "Пик 4859",
}

MINGI_TAU = {
    "type": "Feature",
    "properties": {
        "id": "mingi_tau",
        "category": "massif",
        "name": "Минги-тау",
        "alias_ru": "Эльбрус",
        "elevation_m": 5642,
        "main": True,
        "five_thousander": True,
    },
    "geometry": {"type": "Point", "coordinates": [42.436098, 43.353811]},
}


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def point_on_segment(x: float, y: float, a: list[float], b: list[float], eps: float = 1e-10) -> bool:
    ax, ay = float(a[0]), float(a[1])
    bx, by = float(b[0]), float(b[1])
    cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax)
    if abs(cross) > eps:
        return False
    return min(ax, bx) - eps <= x <= max(ax, bx) + eps and min(ay, by) - eps <= y <= max(ay, by) + eps


def point_in_ring(x: float, y: float, ring: list[list[float]]) -> bool:
    inside = False
    if len(ring) < 3:
        return False
    j = len(ring) - 1
    for i in range(len(ring)):
        a, b = ring[j], ring[i]
        if point_on_segment(x, y, a, b):
            return True
        xi, yi = float(b[0]), float(b[1])
        xj, yj = float(a[0]), float(a[1])
        if (yi > y) != (yj > y):
            cross_x = (xj - xi) * (y - yi) / (yj - yi) + xi
            if x < cross_x:
                inside = not inside
        j = i
    return inside


def point_in_polygon(x: float, y: float, polygon: list[list[list[float]]]) -> bool:
    if not polygon or not point_in_ring(x, y, polygon[0]):
        return False
    return not any(point_in_ring(x, y, hole) for hole in polygon[1:])


def point_in_boundary(x: float, y: float, boundary: dict[str, Any]) -> bool:
    for feature in boundary.get("features", []):
        geometry = feature.get("geometry") or {}
        kind = geometry.get("type")
        coordinates = geometry.get("coordinates") or []
        if kind == "Polygon" and point_in_polygon(x, y, coordinates):
            return True
        if kind == "MultiPolygon" and any(point_in_polygon(x, y, polygon) for polygon in coordinates):
            return True
    return False


def normalize_audit_feature(feature: dict[str, Any]) -> dict[str, Any]:
    props = feature.get("properties") or {}
    geometry = feature.get("geometry") or {}
    coordinates = geometry.get("coordinates") or []
    if geometry.get("type") != "Point" or len(coordinates) < 2:
        raise ValueError("Audit contains a non-Point mountain feature")

    ident = str(props.get("id") or "").strip()
    category = str(props.get("morphology") or "").strip()
    if not ident or category not in CATEGORIES:
        raise ValueError(f"Invalid audit feature: id={ident!r}, morphology={category!r}")

    lon, lat = float(coordinates[0]), float(coordinates[1])
    if not (-180 <= lon <= 180 and -90 <= lat <= 90):
        raise ValueError(f"Invalid coordinates for {ident}")

    elevation = props.get("elevation_m")
    elevation_m = int(round(float(elevation))) if elevation not in (None, "") else None
    importance = str(props.get("importance") or "regular")
    name = NAME_OVERRIDES.get(ident, str(props.get("name") or "").strip())

    return {
        "type": "Feature",
        "properties": {
            "id": ident,
            "category": category,
            "name": name,
            "elevation_m": elevation_m,
            "main": importance in {"main", "five_thousander"},
            "five_thousander": importance == "five_thousander",
        },
        "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Build Slippy Map 1.0 canonical mountain data from the verified 12.1.6 terrain audit.")
    parser.add_argument("--audit", type=Path, required=True)
    parser.add_argument("--boundary", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()

    audit = load_json(args.audit)
    boundary = load_json(args.boundary)
    source_features = audit.get("features") or []
    if len(source_features) != 3797:
        raise SystemExit(f"Expected 3797 audited source points, got {len(source_features)}")

    features = [normalize_audit_feature(feature) for feature in source_features]
    ids = [feature["properties"]["id"] for feature in features]
    if len(ids) != len(set(ids)):
        raise SystemExit("Duplicate IDs in the 12.1.6 audit")

    elbrus_duplicates = []
    for feature in features:
        props = feature["properties"]
        text = f"{props.get('name', '')} {props.get('id', '')}".casefold().replace("ё", "е")
        if "эльбрус" in text or "elbrus" in text or "mingi" in text or "минги" in text:
            elbrus_duplicates.append(props["id"])
    if elbrus_duplicates:
        raise SystemExit(f"Unexpected separate Elbrus/Mingi Tau source objects: {elbrus_duplicates}")

    features.append(MINGI_TAU)
    ids = [feature["properties"]["id"] for feature in features]
    if ids.count("mingi_tau") != 1 or len(ids) != len(set(ids)):
        raise SystemExit("Canonical Mingi Tau must occur exactly once and all IDs must be unique")

    outside = []
    for feature in features:
        lon, lat = feature["geometry"]["coordinates"]
        if not point_in_boundary(lon, lat, boundary):
            outside.append(feature["properties"]["id"])

    categories = Counter(feature["properties"]["category"] for feature in features)
    main_count = sum(bool(feature["properties"]["main"]) for feature in features)
    five_count = sum(bool(feature["properties"]["five_thousander"]) for feature in features)

    output = {"type": "FeatureCollection", "features": features}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")

    report = {
        "version": "Slippy Map 1.0",
        "source": {
            "morphology": "GitHub Actions artifact alan-map-terrain-morphology-audit, run 31028658433 (#12), 2026-08-05",
            "source_points": 3797,
            "terrain": "Copernicus DEM GLO-30",
            "boundary": "approved working contour used by the 7.0.23 map lineage",
        },
        "output_points": len(features),
        "categories": dict(sorted(categories.items())),
        "main": main_count,
        "five_thousander": five_count,
        "mingi_tau": {
            "count": ids.count("mingi_tau"),
            "name": "Минги-тау",
            "alias_ru": "Эльбрус",
            "elevation_m": 5642,
        },
        "outside_boundary_count": len(outside),
        "outside_boundary_ids": outside,
        "duplicate_ids": 0,
    }
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))

    if outside:
        raise SystemExit(f"{len(outside)} mountain points are outside the approved map boundary")


if __name__ == "__main__":
    main()
