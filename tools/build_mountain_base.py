#!/usr/bin/env python3
"""Build Alan Map 10.0 flat mountain base from the repository's latest embedded map data."""
from __future__ import annotations

import base64
import csv
import hashlib
import json
import math
import re
import shutil
import statistics
import zipfile
from collections import defaultdict, deque
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
MOUNTAIN_DIR = ROOT / "data" / "mountains"
ICON_DIR = ASSETS / "mountains"
STAGING = ROOT / "staging"

MAIN_NAMES = {
    "эльбрус", "минги тау", "мингитау", "дыхтау", "дых тау", "шхара",
    "коштантау", "коштан тау", "джангитау", "джанги тау", "пик пушкина",
    "мизирги", "уллутау", "уллу тау", "тихтенген", "донгуз орунд",
    "донгуз-орун", "гестола", "тетнульд", "айлама", "кукунуртау",
}

ICON_POOLS = {
    "hill": [2, 3, 4, 7, 8, 9, 10, 13, 14, 17, 18, 20, 23, 24, 26, 28, 29, 30],
    "mount": [2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 16, 17, 18, 19, 20, 22, 23, 24, 25, 26, 27, 28, 29, 30],
    "rock": [5, 6, 12, 15, 16, 19, 21, 22, 25, 27],
    "peak": [5, 6, 11, 12, 15, 16, 19, 21, 25, 27],
}

ELEVATION_KEYS = (
    "elevation", "elevation_m", "ele", "ele_m", "height", "height_m",
    "altitude", "alt", "z", "metres", "meters",
)
NAME_KEYS = (
    "name_map", "name", "name_ru", "name_alan_latin", "name_alan",
    "name_en", "name_local", "label",
)
ID_KEYS = ("object_id", "osm_id", "source_id", "id", "fid", "peak_id")
RIDGE_KEYS = ("ridge_id", "ridge", "range_id", "mountain_range", "chain_id")


def stable_hash(value: str, length: int = 10) -> str:
    return hashlib.sha1(value.encode("utf-8")).hexdigest()[:length]


def haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    lon1, lat1 = map(math.radians, a)
    lon2, lat2 = map(math.radians, b)
    dlon = lon2 - lon1
    dlat = lat2 - lat1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371.0088 * 2 * math.asin(min(1.0, math.sqrt(h)))


def parse_number(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value) if math.isfinite(float(value)) else None
    match = re.search(r"-?\d+(?:[.,]\d+)?", str(value).replace("\u00a0", " "))
    if not match:
        return None
    try:
        return float(match.group(0).replace(",", "."))
    except ValueError:
        return None


def first_value(props: dict[str, Any], keys: Iterable[str]) -> Any:
    for key in keys:
        value = props.get(key)
        if value not in (None, ""):
            return value
    return None


def normalize_name(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip())


def normalized_name_key(value: str) -> str:
    return re.sub(r"[^а-яa-z0-9]+", " ", value.lower().replace("ё", "е")).strip()


def load_embedded_data() -> dict[str, Any]:
    parts = sorted(ASSETS.glob("map-data.part-*.js"))
    if not parts:
        single = ASSETS / "map-data.js"
        if single.exists():
            parts = [single]
    if not parts:
        raise RuntimeError("Embedded map-data source was not found")
    text = "".join(p.read_text(encoding="utf-8") for p in parts).strip()
    match = re.search(r"window\.ALAN_MAP_DATA\s*=\s*", text)
    if not match:
        raise RuntimeError("window.ALAN_MAP_DATA assignment was not found")
    payload = text[match.end():].strip()
    if payload.endswith(";"):
        payload = payload[:-1].rstrip()
    data = json.loads(payload)
    if not isinstance(data, dict):
        raise RuntimeError("Embedded map data is not an object")
    return data


def is_point_feature(feature: Any) -> bool:
    try:
        return feature["type"] == "Feature" and feature["geometry"]["type"] == "Point"
    except (KeyError, TypeError):
        return False


def feature_collection(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, dict) or value.get("type") != "FeatureCollection":
        return []
    return [f for f in value.get("features", []) if is_point_feature(f)]


def choose_peak_features(data: dict[str, Any]) -> tuple[str, list[dict[str, Any]]]:
    preferred = ("peaks", "mountainPeaks", "mountain_peaks", "peakPoints", "highPeaks")
    for key in preferred:
        features = feature_collection(data.get(key))
        if features:
            return key, features

    candidates: list[tuple[int, str, list[dict[str, Any]]]] = []
    for key, value in data.items():
        features = feature_collection(value)
        if not features:
            continue
        score = 0
        key_lower = key.lower()
        if "peak" in key_lower or "mount" in key_lower:
            score += 1000
        sample = features[:100]
        for feature in sample:
            props = feature.get("properties") or {}
            text = " ".join(str(v).lower() for v in props.values())
            if "mountain" in text or "peak" in text or "вершин" in text:
                score += 4
            if first_value(props, ELEVATION_KEYS) is not None:
                score += 2
        candidates.append((score + min(len(features), 500), key, features))
    if not candidates:
        raise RuntimeError("No point FeatureCollection suitable for peaks was found")
    _, key, features = max(candidates, key=lambda item: item[0])
    return key, features


def choose_custom_features(data: dict[str, Any]) -> tuple[str | None, list[dict[str, Any]]]:
    preferred = ("customMountains", "mountainRender", "mountainPoints", "mountains")
    for key in preferred:
        features = feature_collection(data.get(key))
        if features:
            return key, features
    candidates: list[tuple[int, str, list[dict[str, Any]]]] = []
    for key, value in data.items():
        features = feature_collection(value)
        if features and ("mount" in key.lower() or "ridge" in key.lower()):
            candidates.append((len(features), key, features))
    if candidates:
        _, key, features = max(candidates)
        return key, features
    return None, []


def classify_type(elevation: float, props: dict[str, Any]) -> str:
    text = " ".join(str(props.get(k, "")).lower() for k in ("kind", "type", "natural", "object_subtype", "subtype", "class"))
    if any(token in text for token in ("cliff", "rock", "скал", "утес", "crag")):
        return "rock"
    if any(token in text for token in ("hill", "холм", "foothill")) or elevation < 1600:
        return "hill"
    if elevation >= 4000:
        return "peak"
    if elevation >= 3200:
        return "rock"
    return "mount"


def is_main(name: str, elevation: float) -> bool:
    key = normalized_name_key(name)
    return elevation >= 4500 or any(main in key for main in MAIN_NAMES)


def point_in_ring(point: tuple[float, float], ring: list[list[float]]) -> bool:
    x, y = point
    inside = False
    if len(ring) < 3:
        return False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        intersects = ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-15) + xi)
        if intersects:
            inside = not inside
        j = i
    return inside


def map_frame_geometry(data: dict[str, Any]) -> dict[str, Any]:
    frame = data.get("mapFrame")
    if isinstance(frame, dict) and frame.get("type") == "FeatureCollection" and frame.get("features"):
        geometry = frame["features"][0].get("geometry")
        if geometry and geometry.get("type") in ("Polygon", "MultiPolygon"):
            return geometry
    if isinstance(frame, dict) and frame.get("type") == "Feature":
        return frame["geometry"]
    raise RuntimeError("Map frame polygon was not found")


def geometry_outer_ring(geometry: dict[str, Any]) -> list[list[float]]:
    if geometry["type"] == "Polygon":
        return geometry["coordinates"][0]
    polygons = geometry["coordinates"]
    return max((poly[0] for poly in polygons), key=len)


def feature_point(feature: dict[str, Any]) -> tuple[float, float] | None:
    coords = feature.get("geometry", {}).get("coordinates")
    if not isinstance(coords, list) or len(coords) < 2:
        return None
    try:
        lon, lat = float(coords[0]), float(coords[1])
    except (TypeError, ValueError):
        return None
    if not (-180 <= lon <= 180 and -90 <= lat <= 90):
        return None
    return lon, lat


def deduplicate_anchors(raw: list[dict[str, Any]], ring: list[list[float]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    anchors: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    seen_source: set[str] = set()
    seen_grid: set[tuple[int, int, int]] = set()

    prepared = []
    for feature in raw:
        point = feature_point(feature)
        props = feature.get("properties") or {}
        elevation = parse_number(first_value(props, ELEVATION_KEYS))
        if point is None or elevation is None:
            rejected.append({"reason": "missing-coordinate-or-elevation", "properties": props})
            continue
        if not point_in_ring(point, ring):
            rejected.append({"reason": "outside-frame", "coordinates": point})
            continue
        source_value = first_value(props, ID_KEYS)
        source_id = str(source_value).strip() if source_value not in (None, "") else ""
        name = normalize_name(first_value(props, NAME_KEYS))
        prepared.append((point[0], point[1], elevation, source_id, name, props))

    prepared.sort(key=lambda row: (round(row[0], 6), round(row[1], 6), -row[2], row[4]))
    type_counts: dict[str, int] = defaultdict(int)
    for lon, lat, elevation, source_id, name, props in prepared:
        source_key = source_id and f"source:{source_id}"
        grid_key = (round(lon * 100000), round(lat * 100000), round(elevation))
        if (source_key and source_key in seen_source) or grid_key in seen_grid:
            rejected.append({"reason": "duplicate", "coordinates": [lon, lat], "source_id": source_id})
            continue
        if source_key:
            seen_source.add(source_key)
        seen_grid.add(grid_key)
        obj_type = classify_type(elevation, props)
        type_counts[obj_type] += 1
        suffix = re.sub(r"\D", "", source_id) if source_id else ""
        suffix = suffix[-12:] if suffix else stable_hash(f"{lon:.7f},{lat:.7f},{elevation:.1f}", 9)
        point_id = f"{obj_type}-{suffix}"
        anchors.append({
            "id": point_id,
            "longitude": round(lon, 7),
            "latitude": round(lat, 7),
            "elevation": round(elevation),
            "name": name,
            "category": "main" if is_main(name, elevation) else "regular",
            "ridge_id": "",
            "kind": "anchor",
            "type": obj_type,
            "source_id": source_id,
            "source_properties": props,
        })
    if not anchors:
        raise RuntimeError("No valid peak points remained after validation")
    return anchors, rejected


def spatial_components(points: list[tuple[float, float]], threshold_km: float) -> list[int]:
    if not points:
        return []
    cell = max(threshold_km / 111.0, 0.005)
    buckets: dict[tuple[int, int], list[int]] = defaultdict(list)
    for index, (lon, lat) in enumerate(points):
        buckets[(math.floor(lon / cell), math.floor(lat / cell))].append(index)
    adjacency: list[list[int]] = [[] for _ in points]
    for index, point in enumerate(points):
        cx, cy = math.floor(point[0] / cell), math.floor(point[1] / cell)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for other in buckets.get((cx + dx, cy + dy), []):
                    if other <= index:
                        continue
                    if haversine_km(point, points[other]) <= threshold_km:
                        adjacency[index].append(other)
                        adjacency[other].append(index)
    labels = [-1] * len(points)
    component = 0
    for start in range(len(points)):
        if labels[start] != -1:
            continue
        queue = deque([start])
        labels[start] = component
        while queue:
            current = queue.popleft()
            for other in adjacency[current]:
                if labels[other] == -1:
                    labels[other] = component
                    queue.append(other)
        component += 1
    return labels


def nearest_index(point: tuple[float, float], points: list[tuple[float, float]], max_km: float | None = None) -> tuple[int | None, float]:
    best_index = None
    best_distance = float("inf")
    for index, candidate in enumerate(points):
        distance = haversine_km(point, candidate)
        if distance < best_distance:
            best_distance = distance
            best_index = index
    if max_km is not None and best_distance > max_km:
        return None, best_distance
    return best_index, best_distance


def build_ridges_and_fillers(
    anchors: list[dict[str, Any]], raw_custom: list[dict[str, Any]], ring: list[list[float]]
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    custom_points: list[tuple[float, float]] = []
    custom_props: list[dict[str, Any]] = []
    for feature in raw_custom:
        point = feature_point(feature)
        if point and point_in_ring(point, ring):
            custom_points.append(point)
            custom_props.append(feature.get("properties") or {})

    anchor_points = [(a["longitude"], a["latitude"]) for a in anchors]
    ridge_source = "custom-mountain-components" if custom_points else "anchor-components"
    base_points = custom_points if custom_points else anchor_points
    labels = spatial_components(base_points, 4.2 if custom_points else 10.0)

    components: dict[int, list[int]] = defaultdict(list)
    for idx, label in enumerate(labels):
        components[label].append(idx)
    ordered_components = sorted(
        components,
        key=lambda label: (
            statistics.mean(base_points[i][0] for i in components[label]),
            statistics.mean(base_points[i][1] for i in components[label]),
        ),
    )
    ridge_names = {label: f"ridge-{order + 1:03d}" for order, label in enumerate(ordered_components)}

    for anchor in anchors:
        explicit = normalize_name(first_value(anchor["source_properties"], RIDGE_KEYS))
        if explicit:
            anchor["ridge_id"] = re.sub(r"[^a-zA-Z0-9а-яА-Я_-]+", "-", explicit).strip("-").lower()
            continue
        nearest, _ = nearest_index((anchor["longitude"], anchor["latitude"]), base_points)
        anchor["ridge_id"] = ridge_names[labels[nearest]] if nearest is not None else "ridge-unassigned"

    fillers: list[dict[str, Any]] = []
    selected_points: list[tuple[float, float]] = []
    if custom_points:
        candidates = sorted(
            enumerate(custom_points),
            key=lambda item: (item[1][1], item[1][0]),
            reverse=True,
        )
        for custom_index, point in candidates:
            anchor_index, anchor_distance = nearest_index(point, anchor_points, 26.0)
            if anchor_index is None or anchor_distance < 1.15:
                continue
            if any(haversine_km(point, chosen) < 1.75 for chosen in selected_points):
                continue
            selected_points.append(point)
            nearest_anchor = anchors[anchor_index]
            estimated_elevation = max(900, round(nearest_anchor["elevation"] * max(0.62, 1 - anchor_distance / 65)))
            props = custom_props[custom_index]
            obj_type = classify_type(estimated_elevation, props)
            ridge_id = ridge_names[labels[custom_index]]
            filler_id = f"fill-{obj_type}-{len(fillers) + 1:05d}"
            fillers.append({
                "id": filler_id,
                "longitude": round(point[0], 7),
                "latitude": round(point[1], 7),
                "elevation": estimated_elevation,
                "name": "",
                "category": "regular",
                "ridge_id": ridge_id,
                "kind": "fill",
                "type": obj_type,
                "source_id": "",
                "source_properties": props,
            })
    return fillers, {
        "ridge_source": ridge_source,
        "ridge_count": len(ordered_components),
        "custom_candidate_count": len(custom_points),
        "filler_count": len(fillers),
    }


def icon_for(record: dict[str, Any], ordinal: int) -> int:
    pool = ICON_POOLS[record["type"]][:]
    if record["elevation"] < 4000 or record["type"] != "peak":
        pool = [number for number in pool if number != 11]
    if not pool:
        pool = [2]
    seed = int(stable_hash(f"{record['id']}:{ordinal}", 8), 16)
    return pool[seed % len(pool)]


def assign_render_properties(records: list[dict[str, Any]]) -> None:
    for ordinal, record in enumerate(sorted(records, key=lambda r: (r["type"], r["id"]))):
        record["icon_number"] = icon_for(record, ordinal)
        record["icon_id"] = f"mount-{record['icon_number']}"
        elevation = record["elevation"]
        base = 0.68 + min(max(elevation - 1000, 0), 4200) / 4200 * 0.58
        if record["kind"] == "fill":
            base *= 0.78
        if record["category"] == "main":
            base *= 1.10
        record["scale"] = round(base, 3)
        record["render_order"] = round((46 - record["latitude"]) * 100000 + (0 if record["kind"] == "fill" else 5000))

    used = {r["icon_number"] for r in records}
    eligible = [r for r in records if r["type"] != "peak" or r["elevation"] >= 4000]
    cursor = 0
    for icon_number in range(2, 31):
        if icon_number == 11 or icon_number in used:
            continue
        while cursor < len(eligible) and eligible[cursor]["type"] == "peak" and icon_number not in ICON_POOLS["peak"]:
            cursor += 1
        if cursor >= len(eligible):
            break
        eligible[cursor]["icon_number"] = icon_number
        eligible[cursor]["icon_id"] = f"mount-{icon_number}"
        used.add(icon_number)
        cursor += 1


def geojson(records: list[dict[str, Any]]) -> dict[str, Any]:
    features = []
    for record in records:
        properties = {k: v for k, v in record.items() if k not in {"longitude", "latitude", "source_properties"}}
        features.append({
            "type": "Feature",
            "properties": properties,
            "geometry": {"type": "Point", "coordinates": [record["longitude"], record["latitude"]]},
        })
    return {"type": "FeatureCollection", "features": features}


def normalize_icons() -> dict[str, Any]:
    atlas_source = STAGING / "mountain-atlas.png"
    atlas_manifest_source = STAGING / "mountain-atlas-source.json"
    if not atlas_source.exists() or not atlas_manifest_source.exists():
        raise RuntimeError("Staged mountain atlas or its manifest was not found")

    ICON_DIR.mkdir(parents=True, exist_ok=True)
    for old in ICON_DIR.glob("*"):
        if old.is_file():
            old.unlink()
    atlas_output = ICON_DIR / "mountain-atlas.png"
    shutil.copy2(atlas_source, atlas_output)
    source = json.loads(atlas_manifest_source.read_text(encoding="utf-8"))
    source_icons = {item["id"]: item for item in source.get("icons", [])}
    manifest_icons = []
    for number in range(2, 31):
        icon_id = f"mount-{number}"
        item = source_icons.get(icon_id)
        if not item:
            raise RuntimeError(f"{icon_id} was not found in the supplied atlas")
        roles = [role for role, pool in ICON_POOLS.items() if number in pool]
        manifest_icons.append({
            "id": icon_id,
            "roles": roles,
            "min_elevation": 4000 if number == 11 else 0,
            "summit_anchor": "top-center",
            "x": int(item["x"]),
            "y": int(item["y"]),
            "width": int(item["width"]),
            "height": int(item["height"]),
        })
    if "mount-1" in source_icons:
        raise RuntimeError("mount-1 must not be present in the output atlas")
    return {
        "version": "10.0",
        "excluded": ["mount-1"],
        "atlas": "assets/mountains/mountain-atlas.png",
        "atlas_width": int(source["atlas_width"]),
        "atlas_height": int(source["atlas_height"]),
        "icons": manifest_icons,
    }

def write_web_files(map_frame: dict[str, Any], bbox: list[float]) -> None:
    center = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2]
    minimal_data = {
        "version": "10.0",
        "mapFrame": {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {"kind": "map_frame"}, "geometry": map_frame}]},
        "bounds": [[bbox[0], bbox[1]], [bbox[2], bbox[3]]],
        "center": center,
    }
    (ASSETS / "map-data.js").write_text(
        "window.ALAN_MAP_DATA = " + json.dumps(minimal_data, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )

    (ROOT / "index.html").write_text('''<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#d8c8a7">
  <title>Alan Map 10.0 — горная основа</title>
  <link rel="stylesheet" href="assets/map.css">
</head>
<body>
  <main id="alan-map-root" aria-label="Плоская карта гор Алании">
    <div id="map" role="application" aria-label="Интерактивная карта"></div>
    <div id="map-status" role="status" aria-live="polite">Подготовка горной основы…</div>
  </main>
  <noscript>Для отображения карты необходимо включить JavaScript.</noscript>
  <script src="assets/bootstrap.js"></script>
</body>
</html>
''', encoding="utf-8")

    (ASSETS / "bootstrap.js").write_text('''(() => {
  "use strict";
  const base = new URL("../", document.currentScript.src);
  const status = document.getElementById("map-status");
  const setStatus = (text, failed = false) => {
    if (!status) return;
    status.textContent = text;
    status.dataset.failed = failed ? "true" : "false";
  };
  const fetchText = async (path) => {
    const response = await fetch(new URL(path, base), { cache: "no-store" });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response.text();
  };
  const execute = (source, label) => {
    const script = document.createElement("script");
    script.textContent = `${source}\n//# sourceURL=${label}`;
    document.head.appendChild(script);
    script.remove();
  };
  const executeParts = async (paths, label) => execute((await Promise.all(paths.map(fetchText))).join("\n"), label);
  (async () => {
    try {
      setStatus("Загрузка локального картографического движка…");
      await executeParts(["assets/maplibre.part-000.js", "assets/maplibre.part-001.js"], "maplibre.local.js");
      for (const path of ["assets/map-data.js", "assets/mountain-config.js", "assets/mountain-engine.js", "assets/map-page.js"]) {
        execute(await fetchText(path), path);
      }
    } catch (error) {
      console.error(error);
      setStatus(`Ошибка загрузки: ${error.message}`, true);
    }
  })();
})();
''', encoding="utf-8")

    (ASSETS / "mountain-config.js").write_text('''window.ALAN_MOUNTAIN_CONFIG = Object.freeze({
  version: "10.0",
  renderUrl: "data/mountains/mountain_render.geojson",
  manifestUrl: "data/mountains/mountain_icon_manifest.json",
  background: "#cdbd9c",
  land: "#decfab",
  boundary: "#76684f",
  minZoom: 5.4,
  maxZoom: 14,
  initialZoom: 6.15
});
''', encoding="utf-8")

    (ASSETS / "mountain-engine.js").write_text(r'''(() => {
  "use strict";
  const config = window.ALAN_MOUNTAIN_CONFIG;
  const data = window.ALAN_MAP_DATA;

  async function fetchJson(path) {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response.json();
  }

  function loadAtlas(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = "async";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Не удалось загрузить атлас ${url}`));
      image.src = url;
    });
  }

  async function registerAtlasIcons(map, manifest) {
    const atlas = await loadAtlas(manifest.atlas);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    for (const icon of manifest.icons) {
      canvas.width = icon.width;
      canvas.height = icon.height;
      context.clearRect(0, 0, icon.width, icon.height);
      context.drawImage(atlas, icon.x, icon.y, icon.width, icon.height, 0, 0, icon.width, icon.height);
      if (!map.hasImage(icon.id)) map.addImage(icon.id, context.getImageData(0, 0, icon.width, icon.height), { pixelRatio: 1 });
    }
  }

  function style() {
    return {
      version: 8,
      glyphs: "",
      sources: {
        frame: { type: "geojson", data: data.mapFrame }
      },
      layers: [
        { id: "background", type: "background", paint: { "background-color": config.background } },
        { id: "land", type: "fill", source: "frame", paint: { "fill-color": config.land, "fill-opacity": 1 } },
        { id: "frame-line", type: "line", source: "frame", paint: { "line-color": config.boundary, "line-width": ["interpolate", ["linear"], ["zoom"], 5.4, 0.8, 10, 1.4], "line-opacity": 0.58 } }
      ]
    };
  }

  function iconSizeExpression(multiplier) {
    return ["*", ["coalesce", ["get", "scale"], 1], ["interpolate", ["linear"], ["zoom"], 5.4, 0.19 * multiplier, 6.5, 0.26 * multiplier, 8, 0.39 * multiplier, 10, 0.58 * multiplier, 12, 0.82 * multiplier, 14, 1.04 * multiplier]];
  }

  function addMountainLayer(map, id, kind, multiplier) {
    map.addLayer({
      id,
      type: "symbol",
      source: "mountains",
      filter: ["==", ["get", "kind"], kind],
      minzoom: config.minZoom,
      layout: {
        "icon-image": ["get", "icon_id"],
        "icon-size": iconSizeExpression(multiplier),
        "icon-anchor": "top",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "icon-rotation-alignment": "viewport",
        "icon-pitch-alignment": "viewport",
        "symbol-sort-key": ["get", "render_order"],
        "symbol-z-order": "source"
      },
      paint: { "icon-opacity": ["interpolate", ["linear"], ["zoom"], 5.4, 0.86, 6.2, 1] }
    });
  }

  async function createMap() {
    const status = document.getElementById("map-status");
    const setStatus = (text, failed = false) => {
      if (!status) return;
      status.textContent = text;
      status.dataset.failed = failed ? "true" : "false";
    };
    const map = new maplibregl.Map({
      container: "map",
      style: style(),
      center: data.center,
      zoom: config.initialZoom,
      minZoom: config.minZoom,
      maxZoom: config.maxZoom,
      maxBounds: data.bounds,
      bearing: 0,
      pitch: 0,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      renderWorldCopies: false,
      attributionControl: false,
      fadeDuration: 0
    });
    map.dragRotate.disable();
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }), "top-right");

    map.on("load", async () => {
      try {
        setStatus("Загрузка точек вершин и фигурок…");
        const [renderData, manifest] = await Promise.all([fetchJson(config.renderUrl), fetchJson(config.manifestUrl)]);
        await registerAtlasIcons(map, manifest);
        map.addSource("mountains", { type: "geojson", data: renderData, promoteId: "id" });
        addMountainLayer(map, "mountain-fill", "fill", 0.92);
        addMountainLayer(map, "mountain-anchor", "anchor", 1);
        const anchorCount = renderData.features.filter(feature => feature.properties.kind === "anchor").length;
        const fillCount = renderData.features.length - anchorCount;
        setStatus(`Горная основа: ${anchorCount} вершин, ${fillCount} связующих фигурок`);
        window.setTimeout(() => status?.classList.add("is-hidden"), 2600);
      } catch (error) {
        console.error(error);
        setStatus(`Ошибка горного слоя: ${error.message}`, true);
      }
    });
    return map;
  }

  window.AlanMountainMap = { createMap };
})();
''', encoding="utf-8")

    (ASSETS / "map-page.js").write_text('''(() => {
  "use strict";
  window.AlanMountainMap.createMap().then(map => { window.alanMap = map; }).catch(error => {
    console.error(error);
    const status = document.getElementById("map-status");
    if (status) { status.textContent = `Ошибка запуска карты: ${error.message}`; status.dataset.failed = "true"; }
  });
})();
''', encoding="utf-8")

    (ASSETS / "map.css").write_text('''* { box-sizing: border-box; }
html, body, #alan-map-root, #map { width: 100%; height: 100%; margin: 0; }
html, body { overflow: hidden; background: #cdbd9c; }
body { font-family: Georgia, "Times New Roman", serif; }
#alan-map-root { position: relative; isolation: isolate; }
#map { position: absolute; inset: 0; background: #cdbd9c; }
#map::after {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 2;
  background:
    radial-gradient(circle at 25% 20%, rgba(255,255,255,.055), transparent 33%),
    radial-gradient(circle at 76% 75%, rgba(90,70,40,.035), transparent 40%);
  mix-blend-mode: multiply;
}
#map-status {
  position: absolute;
  left: 50%;
  bottom: max(18px, env(safe-area-inset-bottom));
  z-index: 5;
  transform: translateX(-50%);
  max-width: calc(100% - 32px);
  padding: 8px 12px;
  border: 1px solid rgba(74,61,43,.28);
  border-radius: 999px;
  background: rgba(232,220,191,.9);
  color: #4d422f;
  font-size: 13px;
  white-space: nowrap;
  transition: opacity .35s ease;
  backdrop-filter: blur(5px);
}
#map-status.is-hidden { opacity: 0; pointer-events: none; }
#map-status[data-failed="true"] { color: #702f27; border-color: rgba(112,47,39,.45); }
.maplibregl-ctrl-top-right { top: max(10px, env(safe-area-inset-top)); right: 10px; }
.maplibregl-ctrl-group { overflow: hidden; border: 1px solid rgba(74,61,43,.3) !important; border-radius: 10px !important; box-shadow: none !important; background: rgba(232,220,191,.88) !important; }
.maplibregl-ctrl-group button { width: 36px !important; height: 36px !important; }
.maplibregl-ctrl-group button + button { border-top-color: rgba(74,61,43,.18) !important; }
@media (max-width: 560px) { #map-status { font-size: 12px; } }
''', encoding="utf-8")


def bbox_of_ring(ring: list[list[float]]) -> list[float]:
    lons = [float(point[0]) for point in ring]
    lats = [float(point[1]) for point in ring]
    return [min(lons), min(lats), max(lons), max(lats)]


def write_outputs(
    data: dict[str, Any], peak_key: str, custom_key: str | None,
    anchors: list[dict[str, Any]], fillers: list[dict[str, Any]],
    rejected: list[dict[str, Any]], ridge_report: dict[str, Any], icon_manifest: dict[str, Any],
    map_frame: dict[str, Any], ring: list[list[float]],
) -> None:
    MOUNTAIN_DIR.mkdir(parents=True, exist_ok=True)
    fields = ["id", "latitude", "longitude", "elevation", "name", "category", "ridge_id"]
    with (MOUNTAIN_DIR / "mountain_points.csv").open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for record in sorted(anchors, key=lambda r: (r["ridge_id"], -r["elevation"], r["id"])):
            writer.writerow({field: record[field] for field in fields})

    all_records = fillers + anchors
    (MOUNTAIN_DIR / "mountain_points.geojson").write_text(json.dumps(geojson(anchors), ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (MOUNTAIN_DIR / "mountain_fill.geojson").write_text(json.dumps(geojson(fillers), ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (MOUNTAIN_DIR / "mountain_render.geojson").write_text(json.dumps(geojson(all_records), ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (MOUNTAIN_DIR / "mountain_icon_manifest.json").write_text(json.dumps(icon_manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    used_icons = sorted({record["icon_number"] for record in all_records})
    validation = {
        "version": "10.0",
        "source_version": data.get("version"),
        "peak_source_key": peak_key,
        "custom_mountain_source_key": custom_key,
        "anchor_count": len(anchors),
        "named_anchor_count": sum(bool(record["name"]) for record in anchors),
        "unnamed_anchor_count": sum(not record["name"] for record in anchors),
        "main_count": sum(record["category"] == "main" for record in anchors),
        "filler_count": len(fillers),
        "type_counts": dict(sorted(defaultdict(int, {t: sum(record["type"] == t for record in anchors) for t in ICON_POOLS}).items())),
        "rejected_count": len(rejected),
        "rejected_examples": rejected[:50],
        "ridge": ridge_report,
        "icons_used": used_icons,
        "icons_unused": [number for number in range(2, 31) if number not in used_icons],
        "mount_1_present": False,
        "mount_11_usage": [record["id"] for record in all_records if record["icon_number"] == 11],
        "checks": {
            "all_anchor_names_optional": True,
            "all_anchors_have_elevation": all(record["elevation"] is not None for record in anchors),
            "all_anchors_have_ridge": all(bool(record["ridge_id"]) for record in anchors),
            "mount_11_only_high_peaks": all(record["type"] == "peak" and record["elevation"] >= 4000 for record in all_records if record["icon_number"] == 11),
        },
    }
    if not all(validation["checks"].values()):
        raise RuntimeError(f"Validation failed: {validation['checks']}")
    (MOUNTAIN_DIR / "mountain_validation.json").write_text(json.dumps(validation, ensure_ascii=False, indent=2), encoding="utf-8")

    bbox = bbox_of_ring(ring)
    write_web_files(map_frame, bbox)


def cleanup_obsolete() -> None:
    for path in [ROOT / "data" / "shards", ROOT / "data" / "fonts"]:
        if path.exists():
            shutil.rmtree(path)
    for name in ["pmtiles.js", "map-core.js", "map-ui.js"]:
        path = ASSETS / name
        if path.exists():
            path.unlink()
    for path in ASSETS.glob("map-data.part-*.js"):
        path.unlink()
    for pattern in ("mountain-icons.b64.part-*", "build-bundle.b64.part-*", "build-bundle.zip"):
        for path in STAGING.glob(pattern):
            path.unlink()
    for path in [STAGING / "mountain-icons.zip", STAGING / "mountain-atlas.png", STAGING / "mountain-atlas-source.json", STAGING / "build.trigger"]:
        if path.exists():
            path.unlink()
    extracted = STAGING / "mountain-icons-extracted"
    if extracted.exists():
        shutil.rmtree(extracted)
    if STAGING.exists() and not any(STAGING.iterdir()):
        STAGING.rmdir()


def write_docs() -> None:
    (ROOT / "README.md").write_text('''# Alan Map 10.0 — горная основа

Первая часть новой плоской карты Alan Til в стиле рисованной 2D-карты.

- Реальный DEM используется только при подготовке данных и не отображается.
- Все пригодные именованные и безымянные вершины собраны в `data/mountains/mountain_points.csv`.
- Тип точки закодирован префиксом `hill-`, `mount-`, `rock-` или `peak-`.
- Главные горы помечены `category=main`; пока они используют общую библиотеку фигурок.
- Используются `mount-2`—`mount-30`; `mount-1` полностью исключён.
- `mount-11` разрешён только для вершин не ниже 4000 м.
- Карта плоская: без 3D, наклона, вращения, дорог, подписей и населённых пунктов.

Источник публикации: этап 1 версии 10.0.
''', encoding="utf-8")
    (ROOT / "DATA-SOURCES-AND-LICENSES.md").write_text('''# Источники данных и компоненты

- Исходные точки вершин и рабочий контур перенесены из актуальной автономной версии Alan Map 7.0.21.
- Векторные первоисточники: OpenStreetMap / Geofabrik, © OpenStreetMap contributors, ODbL.
- DEM Mapzen/Tilezen Skadi SRTM использовался ранее при подготовке географической основы, но в версии 10.0 не отображается и в публикацию не входит.
- Визуальный движок: локальная сборка MapLibre GL JS 5.24.0, BSD-3-Clause.
- Горные PNG предоставлены владельцем проекта; `mount-1` не используется.
''', encoding="utf-8")


def main() -> None:
    data = load_embedded_data()
    map_frame = map_frame_geometry(data)
    ring = geometry_outer_ring(map_frame)
    peak_key, raw_peaks = choose_peak_features(data)
    custom_key, raw_custom = choose_custom_features(data)
    anchors, rejected = deduplicate_anchors(raw_peaks, ring)
    fillers, ridge_report = build_ridges_and_fillers(anchors, raw_custom, ring)
    assign_render_properties(fillers + anchors)
    icon_manifest = normalize_icons()
    write_outputs(data, peak_key, custom_key, anchors, fillers, rejected, ridge_report, icon_manifest, map_frame, ring)
    write_docs()
    cleanup_obsolete()
    print(json.dumps({
        "status": "ok",
        "anchors": len(anchors),
        "fillers": len(fillers),
        "peak_source": peak_key,
        "custom_source": custom_key,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
