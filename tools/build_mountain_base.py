#!/usr/bin/env python3
from __future__ import annotations

import csv
import json
import math
import re
import shutil
import sys
from collections import Counter
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
DATA = ROOT / "data"
MOUNTAINS = DATA / "mountains"
VERSION = "10.0"

TYPE_POOLS = {
    "hill": [2, 3, 4, 7, 8, 9, 10, 13, 14, 17, 18, 20, 23, 24, 26, 28, 29, 30],
    "mount": [5, 6, 10, 12, 13, 14, 16, 17, 18, 19, 20, 22, 23, 24, 25, 26, 27, 28, 29, 30],
    "rock": [5, 6, 12, 15, 16, 19, 21, 22, 25, 27],
    "peak": [11, 15, 16, 19, 21, 25, 27],
}
MAIN_NAMES = {
    "эльбрус", "дыхтау", "шхара", "коштантау", "джангитау", "джанга", "пушкинский пик",
    "мизирги", "катындай", "катын тау", "гестола", "домбай ульген",
}


def load_embedded_data() -> dict[str, Any]:
    parts = sorted(ASSETS.glob("map-data.part-*.js"))
    if not parts:
        raise RuntimeError("Authoritative map-data parts are missing")
    raw = "".join(path.read_text(encoding="utf-8") for path in parts)
    match = re.search(r"window\.ALAN_MAP_DATA\s*=\s*", raw)
    if not match:
        raise RuntimeError("window.ALAN_MAP_DATA assignment was not found")
    return json.loads(raw[match.end():].strip().rstrip(";"))


def feature_collection_features(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, dict) and value.get("type") == "FeatureCollection":
        return [f for f in value.get("features", []) if isinstance(f, dict)]
    return []


def outer_ring(geometry: dict[str, Any]) -> list[list[float]]:
    if geometry.get("type") == "Polygon":
        rings = geometry.get("coordinates") or []
        return max(rings, key=len) if rings else []
    if geometry.get("type") == "MultiPolygon":
        rings = [ring for poly in geometry.get("coordinates") or [] for ring in poly]
        return max(rings, key=len) if rings else []
    return []


def point_in_ring(point: tuple[float, float], ring: list[list[float]]) -> bool:
    x, y = point
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        crosses = ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-15) + xi)
        if crosses:
            inside = not inside
        j = i
    return inside


def normalize_text(value: Any) -> str:
    return re.sub(r"[^0-9a-zа-яё]+", " ", str(value or "").lower()).strip()


def parse_elevation(properties: dict[str, Any]) -> int | None:
    for key in ("ele", "elevation", "elevation_m", "height", "altitude"):
        value = properties.get(key)
        if value is None or value == "":
            continue
        text = str(value).strip().replace(",", ".")
        match = re.search(r"-?\d+(?:\.\d+)?", text)
        if not match:
            continue
        numeric = float(match.group())
        if "ft" in text.lower():
            numeric *= 0.3048
        if 100 <= numeric <= 9000:
            return int(round(numeric))
    return None


def distance_sq(a: tuple[float, float], b: tuple[float, float]) -> float:
    lon_scale = math.cos(math.radians((a[1] + b[1]) / 2))
    dx = (a[0] - b[0]) * lon_scale
    dy = a[1] - b[1]
    return dx * dx + dy * dy


def point_segment_distance_sq(point: tuple[float, float], start: tuple[float, float], end: tuple[float, float]) -> float:
    lon_scale = math.cos(math.radians(point[1]))
    px, py = point[0] * lon_scale, point[1]
    ax, ay = start[0] * lon_scale, start[1]
    bx, by = end[0] * lon_scale, end[1]
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return (px - ax) ** 2 + (py - ay) ** 2
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    qx, qy = ax + t * dx, ay + t * dy
    return (px - qx) ** 2 + (py - qy) ** 2


def nearest_line_id(point: tuple[float, float], lines: list[dict[str, Any]], prefix: str) -> str:
    best_id = f"{prefix}-000"
    best = float("inf")
    for index, feature in enumerate(lines, 1):
        geometry = feature.get("geometry") or {}
        if geometry.get("type") != "LineString":
            continue
        coords = geometry.get("coordinates") or []
        for a, b in zip(coords, coords[1:]):
            value = point_segment_distance_sq(point, tuple(a[:2]), tuple(b[:2]))
            if value < best:
                props = feature.get("properties") or {}
                best = value
                best_id = str(props.get("axis_id") or props.get("ridge_id") or f"{prefix}-{index:03d}")
    return best_id


def classify(elevation: int) -> str:
    if elevation < 1800:
        return "hill"
    if elevation < 3200:
        return "mount"
    if elevation < 4000:
        return "rock"
    return "peak"


def stable_number(seed: str) -> int:
    value = 2166136261
    for byte in seed.encode("utf-8"):
        value ^= byte
        value = (value * 16777619) & 0xFFFFFFFF
    return value


def icon_number(kind: str, elevation: int, seed: str) -> int:
    pool = TYPE_POOLS[kind]
    if kind == "peak" and elevation < 4000:
        pool = [number for number in pool if number != 11]
    chosen = pool[stable_number(seed) % len(pool)]
    if chosen == 1:
        raise RuntimeError("mount-1 was selected")
    if chosen == 11 and elevation < 4000:
        raise RuntimeError("mount-11 was selected below 4000 m")
    return chosen


def source_identifier(feature: dict[str, Any], lon: float, lat: float) -> str:
    props = feature.get("properties") or {}
    for key in ("osm_id", "id", "node_id", "peak_id"):
        value = props.get(key)
        if value not in (None, ""):
            return str(value)
    if feature.get("id") not in (None, ""):
        return str(feature["id"])
    return f"{lon:.7f}-{lat:.7f}"


def resolve_name(properties: dict[str, Any]) -> str:
    for key in ("name:ru", "name_ru", "name", "int_name", "loc_name"):
        value = str(properties.get(key) or "").strip()
        if value:
            return value
    return ""


def is_main(name: str, point: tuple[float, float], references: list[dict[str, Any]]) -> bool:
    normalized = normalize_text(name)
    if normalized and any(item in normalized or normalized in item for item in MAIN_NAMES):
        return True
    for feature in references:
        coords = (feature.get("geometry") or {}).get("coordinates") or []
        if len(coords) >= 2 and distance_sq(point, (float(coords[0]), float(coords[1]))) <= 0.00018:
            return True
    return False


def min_zoom(elevation: int, category: str, kind: str) -> float:
    if category == "main" or elevation >= 4000:
        return 7.0
    if kind == "rock":
        return 7.6
    if kind == "mount":
        return 8.1
    return 9.0


def icon_scale(kind: str, elevation: int, category: str, filler: bool = False) -> float:
    base = {"hill": 0.62, "mount": 0.76, "rock": 0.88, "peak": 1.0}[kind]
    height_factor = max(0.86, min(1.18, elevation / 3600))
    main_factor = 1.08 if category == "main" else 1.0
    filler_factor = 0.78 if filler else 1.0
    return round(base * height_factor * main_factor * filler_factor, 4)


def build_anchors(raw_features: list[dict[str, Any]], ring: list[list[float]], ridges: list[dict[str, Any]], references: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    candidates = []
    rejected = []
    seen = set()
    for feature in raw_features:
        geometry = feature.get("geometry") or {}
        coords = geometry.get("coordinates") or []
        if geometry.get("type") != "Point" or len(coords) < 2:
            continue
        lon, lat = float(coords[0]), float(coords[1])
        if ring and not point_in_ring((lon, lat), ring):
            continue
        props = feature.get("properties") or {}
        elevation = parse_elevation(props)
        name = resolve_name(props)
        source_id = source_identifier(feature, lon, lat)
        dedupe = (round(lon, 6), round(lat, 6), normalize_text(name))
        if dedupe in seen:
            continue
        seen.add(dedupe)
        if elevation is None:
            rejected.append({"source_id": source_id, "longitude": lon, "latitude": lat, "name": name, "reason": "missing_elevation"})
            continue
        kind = classify(elevation)
        category = "main" if is_main(name, (lon, lat), references) else "regular"
        ridge_id = nearest_line_id((lon, lat), ridges, "ridge")
        candidates.append({"source_id": source_id, "longitude": lon, "latitude": lat, "elevation": elevation, "name": name, "category": category, "ridge_id": ridge_id, "type": kind})
    candidates.sort(key=lambda item: (item["type"], item["source_id"], item["longitude"], item["latitude"]))
    counters = Counter()
    for record in candidates:
        counters[record["type"]] += 1
        record["id"] = f"{record['type']}-{counters[record['type']]:05d}"
        number = icon_number(record["type"], record["elevation"], record["source_id"])
        record.update({"kind": "anchor", "icon_id": f"mount-{number}", "icon_number": number, "icon_scale": icon_scale(record["type"], record["elevation"], record["category"]), "min_zoom": min_zoom(record["elevation"], record["category"], record["type"]), "sort_key": round(-record["latitude"], 7)})
    return candidates, rejected


def cumulative_lengths(coords: list[list[float]]) -> tuple[list[float], float]:
    lengths = [0.0]
    total = 0.0
    for a, b in zip(coords, coords[1:]):
        total += math.sqrt(distance_sq(tuple(a[:2]), tuple(b[:2])))
        lengths.append(total)
    return lengths, total


def interpolate_line(coords: list[list[float]], lengths: list[float], distance: float) -> tuple[float, float]:
    for index in range(1, len(lengths)):
        if lengths[index] >= distance:
            segment = lengths[index] - lengths[index - 1]
            ratio = 0.0 if segment == 0 else (distance - lengths[index - 1]) / segment
            a, b = coords[index - 1], coords[index]
            return (float(a[0]) + (float(b[0]) - float(a[0])) * ratio, float(a[1]) + (float(b[1]) - float(a[1])) * ratio)
    return tuple(coords[-1][:2])


def near_lines(point: tuple[float, float], lines: list[dict[str, Any]], threshold: float) -> bool:
    limit = threshold * threshold
    for feature in lines:
        geometry = feature.get("geometry") or {}
        if geometry.get("type") != "LineString":
            continue
        coords = geometry.get("coordinates") or []
        if any(point_segment_distance_sq(point, tuple(a[:2]), tuple(b[:2])) <= limit for a, b in zip(coords, coords[1:])):
            return True
    return False


def estimated_elevation(point: tuple[float, float], anchors: list[dict[str, Any]]) -> int:
    nearest = sorted(anchors, key=lambda item: distance_sq(point, (item["longitude"], item["latitude"])))[:5]
    weighted = []
    for item in nearest:
        distance = max(distance_sq(point, (item["longitude"], item["latitude"])), 1e-8)
        weighted.append((1 / distance, item["elevation"]))
    return int(round(sum(weight * elevation for weight, elevation in weighted) / sum(weight for weight, _ in weighted))) if weighted else 2500


def build_fillers(ridges: list[dict[str, Any]], rivers: list[dict[str, Any]], anchors: list[dict[str, Any]], ring: list[list[float]]) -> list[dict[str, Any]]:
    fillers = []
    anchor_points = [(item["longitude"], item["latitude"]) for item in anchors]
    counter = 0
    for ridge_index, feature in enumerate(ridges, 1):
        geometry = feature.get("geometry") or {}
        if geometry.get("type") != "LineString":
            continue
        coords = geometry.get("coordinates") or []
        if len(coords) < 2:
            continue
        lengths, total = cumulative_lengths(coords)
        if total < 0.035:
            continue
        props = feature.get("properties") or {}
        ridge_id = str(props.get("axis_id") or props.get("ridge_id") or f"ridge-{ridge_index:03d}")
        distance = 0.026
        while distance < total:
            point = interpolate_line(coords, lengths, distance)
            distance += 0.052
            if ring and not point_in_ring(point, ring):
                continue
            if any(distance_sq(point, anchor) < 0.00115 for anchor in anchor_points):
                continue
            if near_lines(point, rivers, 0.013):
                continue
            elevation = estimated_elevation(point, anchors)
            kind = classify(elevation)
            counter += 1
            seed = f"{ridge_id}:{counter}:{point[0]:.6f}:{point[1]:.6f}"
            number = icon_number(kind, elevation, seed)
            fillers.append({"id": f"fill-{kind}-{counter:05d}", "source_id": seed, "longitude": point[0], "latitude": point[1], "elevation": elevation, "name": "", "category": "regular", "ridge_id": ridge_id, "type": kind, "kind": "fill", "icon_id": f"mount-{number}", "icon_number": number, "icon_scale": icon_scale(kind, elevation, "regular", True), "min_zoom": 7.4 if elevation >= 3000 else 8.3, "sort_key": round(-point[1], 7)})
    return fillers


def geojson(records: list[dict[str, Any]]) -> dict[str, Any]:
    return {"type": "FeatureCollection", "features": [{"type": "Feature", "id": record["id"], "properties": {key: value for key, value in record.items() if key not in {"longitude", "latitude"}}, "geometry": {"type": "Point", "coordinates": [record["longitude"], record["latitude"]]}} for record in records]}


def bbox(ring: list[list[float]]) -> list[float]:
    return [min(p[0] for p in ring), min(p[1] for p in ring), max(p[0] for p in ring), max(p[1] for p in ring)]


def write_web_files(bounds: list[float], center: list[float]) -> None:
    (ROOT / "index.html").write_text('''<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no"><meta name="theme-color" content="#c9b991"><title>Alan Map 10.0 — горная основа</title><link rel="stylesheet" href="assets/maplibre.css"><link rel="stylesheet" href="assets/map.css"></head><body><main id="alan-map-root"><div id="map" aria-label="Плоская интерактивная карта гор"></div><div id="map-status" role="status" aria-live="polite">Подготавливается горная основа…</div></main><script src="assets/bootstrap.js"></script></body></html>
''', encoding="utf-8")
    (ASSETS / "bootstrap.js").write_text('''(() => {"use strict";const baseUrl=new URL(".",document.currentScript.src);const fetchText=async name=>{const response=await fetch(new URL(name,baseUrl),{cache:"no-cache"});if(!response.ok)throw new Error(`Не загружен ${name} (${response.status})`);return response.text()};const executeParts=async(names,sourceName)=>{const code=(await Promise.all(names.map(fetchText))).join("");(0,eval)(`${code}\n//# sourceURL=${sourceName}`)};const loadScript=name=>new Promise((resolve,reject)=>{const script=document.createElement("script");script.src=new URL(name,baseUrl).href;script.onload=resolve;script.onerror=()=>reject(new Error(`Не загружен ${name}`));document.head.appendChild(script)});(async()=>{await executeParts(["maplibre.part-000.js","maplibre.part-001.js"],"maplibre.js");await loadScript("map-ui.js");await loadScript("map-page.js")})().catch(error=>{console.error(error);const status=document.getElementById("map-status");if(status){status.textContent=`Карта не загрузилась: ${error.message}`;status.dataset.failed="true"}})})();
''', encoding="utf-8")
    config = {"version": VERSION, "bounds": bounds, "center": center, "minZoom": 7, "maxZoom": 14.3, "initialZoom": 7.25}
    (ASSETS / "map-config.js").write_text(f"window.ALAN_MOUNTAIN_CONFIG={json.dumps(config, ensure_ascii=False, separators=(',', ':'))};\n", encoding="utf-8")
    (ASSETS / "map-ui.js").write_text(r'''(() => {"use strict";const fetchJson=async url=>{const response=await fetch(url,{cache:"no-cache"});if(!response.ok)throw new Error(`${url}: HTTP ${response.status}`);return response.json()};const status=document.getElementById("map-status");const setStatus=(text,failed=false)=>{if(!status)return;status.textContent=text;status.dataset.failed=failed?"true":"false";status.classList.remove("is-hidden")};async function registerAtlasIcons(map,manifest){const image=new Image();image.decoding="async";image.src=manifest.atlas;await image.decode();for(const icon of manifest.icons){const canvas=document.createElement("canvas");canvas.width=icon.width;canvas.height=icon.height;const context=canvas.getContext("2d",{alpha:true});const sx=Math.max(0,icon.x);const sy=Math.max(0,icon.y);const sw=Math.max(0,Math.min(icon.width-(sx-icon.x),manifest.atlas_width-sx));const sh=Math.max(0,Math.min(icon.height-(sy-icon.y),manifest.atlas_height-sy));context.clearRect(0,0,canvas.width,canvas.height);if(sw>0&&sh>0)context.drawImage(image,sx,sy,sw,sh,sx-icon.x,sy-icon.y,sw,sh);map.addImage(icon.id,context.getImageData(0,0,canvas.width,canvas.height),{pixelRatio:2})}}function mountainLayer(id,kind){return{id,type:"symbol",source:"mountains",filter:["all",["==",["get","kind"],kind],["<=",["get","min_zoom"],["zoom"]]],layout:{"symbol-placement":"point","symbol-sort-key":["get","sort_key"],"icon-image":["get","icon_id"],"icon-anchor":"bottom","icon-size":["*",["get","icon_scale"],["interpolate",["linear"],["zoom"],7,.42,9,.62,11,.9,14.3,1.28]],"icon-allow-overlap":true,"icon-ignore-placement":true,"icon-optional":false,"icon-rotation-alignment":"viewport","icon-pitch-alignment":"viewport"},paint:{"icon-opacity":kind==="fill"?.94:1}}}async function createMap(){const config=window.ALAN_MOUNTAIN_CONFIG;if(!config)throw new Error("Конфигурация карты не загружена");const[frame,mountains,manifest]=await Promise.all([fetchJson("data/map-frame.geojson"),fetchJson("data/mountains/mountain_render.geojson"),fetchJson("data/mountains/mountain_icon_manifest.json")]);const map=new maplibregl.Map({container:"map",style:{version:8,sources:{frame:{type:"geojson",data:frame},mountains:{type:"geojson",data:mountains,promoteId:"id"}},layers:[{id:"outside",type:"background",paint:{"background-color":"#9f916f"}},{id:"land",type:"fill",source:"frame",paint:{"fill-color":"#d4c49d","fill-opacity":1}},{id:"frame-line",type:"line",source:"frame",paint:{"line-color":"#695d43","line-width":["interpolate",["linear"],["zoom"],7,.8,14,1.6],"line-opacity":.6}}]},center:config.center,zoom:config.initialZoom,minZoom:config.minZoom,maxZoom:config.maxZoom,maxBounds:config.bounds,bearing:0,pitch:0,dragRotate:false,pitchWithRotate:false,touchPitch:false,renderWorldCopies:false,attributionControl:false,fadeDuration:0});map.dragRotate.disable();map.touchZoomRotate.disableRotation();map.addControl(new maplibregl.NavigationControl({showCompass:false,visualizePitch:false}),"top-right");await new Promise((resolve,reject)=>{map.once("load",resolve);map.once("error",event=>reject(event.error||new Error("MapLibre error")))});await registerAtlasIcons(map,manifest);map.addLayer(mountainLayer("mountain-fill","fill"));map.addLayer(mountainLayer("mountain-anchor","anchor"));const anchors=mountains.features.filter(feature=>feature.properties.kind==="anchor").length;const fillers=mountains.features.length-anchors;setStatus(`Горная основа: ${anchors} реальных вершин, ${fillers} связующих фигурок`);window.setTimeout(()=>status?.classList.add("is-hidden"),2600);return map}window.AlanMountainMap={createMap}})();
''', encoding="utf-8")
    (ASSETS / "map-page.js").write_text('''(() => {"use strict";const start=async()=>{const script=document.createElement("script");script.src="assets/map-config.js";await new Promise((resolve,reject)=>{script.onload=resolve;script.onerror=reject;document.head.appendChild(script)});window.ALAN_MAP_INSTANCE=await window.AlanMountainMap.createMap()};start().catch(error=>{console.error(error);const status=document.getElementById("map-status");if(status){status.textContent=`Ошибка запуска карты: ${error.message}`;status.dataset.failed="true"}})})();
''', encoding="utf-8")
    (ASSETS / "map.css").write_text('''*{box-sizing:border-box}html,body,#alan-map-root,#map{width:100%;height:100%;margin:0}html,body{overflow:hidden;background:#9f916f}body{font-family:Georgia,"Times New Roman",serif}#alan-map-root{position:relative;isolation:isolate}#map{position:absolute;inset:0;background:#9f916f}#map:after{content:"";position:absolute;inset:0;pointer-events:none;z-index:2;background:radial-gradient(circle at 24% 18%,rgba(255,255,255,.07),transparent 32%),radial-gradient(circle at 78% 76%,rgba(67,51,29,.06),transparent 42%),repeating-linear-gradient(15deg,rgba(70,52,27,.018) 0 1px,transparent 1px 5px);mix-blend-mode:multiply}#map-status{position:absolute;left:50%;bottom:max(18px,env(safe-area-inset-bottom));z-index:5;transform:translateX(-50%);max-width:calc(100% - 32px);padding:8px 12px;border:1px solid rgba(74,61,43,.28);border-radius:999px;background:rgba(232,220,191,.91);color:#4d422f;font-size:13px;white-space:nowrap;transition:opacity .35s ease;backdrop-filter:blur(5px)}#map-status.is-hidden{opacity:0;pointer-events:none}#map-status[data-failed="true"]{color:#702f27;border-color:rgba(112,47,39,.45)}.maplibregl-ctrl-top-right{top:max(10px,env(safe-area-inset-top));right:10px}.maplibregl-ctrl-group{overflow:hidden;border:1px solid rgba(74,61,43,.3)!important;border-radius:10px!important;box-shadow:none!important;background:rgba(232,220,191,.88)!important}.maplibregl-ctrl-group button{width:36px!important;height:36px!important}.maplibregl-ctrl-group button+button{border-top-color:rgba(74,61,43,.18)!important}@media(max-width:560px){#map-status{font-size:12px}}
''', encoding="utf-8")


def cleanup() -> None:
    for path in (DATA / "shards", DATA / "fonts"):
        if path.exists():
            shutil.rmtree(path)
    for pattern in ("source-*.json", "mountain-features-*.json", "peaks-*.json"):
        for path in DATA.glob(pattern):
            path.unlink()
    for path in ASSETS.glob("map-data.part-*.js"):
        path.unlink()
    for name in ("pmtiles.js", "map-core.js"):
        path = ASSETS / name
        if path.exists():
            path.unlink()
    staging = ROOT / "staging"
    if staging.exists():
        shutil.rmtree(staging)


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: build_mountain_base.py <extracted-peaks.geojson>")
    raw = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    raw_features = feature_collection_features(raw)
    if not raw_features:
        raise RuntimeError("Extracted peak collection is empty")
    data = load_embedded_data()
    frame_features = feature_collection_features(data.get("mapFrame") or data.get("focus"))
    if not frame_features:
        raise RuntimeError("Map frame is missing")
    frame = frame_features[0]
    ring = outer_ring(frame.get("geometry") or {})
    ridges = feature_collection_features(data.get("ridges"))
    rivers = feature_collection_features(data.get("rivers"))
    anchors, rejected = build_anchors(raw_features, ring, ridges, feature_collection_features(data.get("highPeaks")))
    if len(anchors) < 100:
        raise RuntimeError(f"Only {len(anchors)} peaks with elevations were extracted; source is incomplete")
    missing_ratio = len(rejected) / max(1, len(raw_features))
    if missing_ratio > 0.04:
        raise RuntimeError(f"{len(rejected)} of {len(raw_features)} peaks lack elevation ({missing_ratio:.1%})")
    fillers = build_fillers(ridges, rivers, anchors, ring)
    MOUNTAINS.mkdir(parents=True, exist_ok=True)
    fields = ["id", "latitude", "longitude", "elevation", "name", "category", "ridge_id"]
    with (MOUNTAINS / "mountain_points.csv").open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fields)
        writer.writeheader()
        for record in sorted(anchors, key=lambda item: (item["ridge_id"], -item["elevation"], item["id"])):
            writer.writerow({field: record[field] for field in fields})
    (MOUNTAINS / "mountain_points.geojson").write_text(json.dumps(geojson(anchors), ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (MOUNTAINS / "mountain_fill.geojson").write_text(json.dumps(geojson(fillers), ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (MOUNTAINS / "mountain_render.geojson").write_text(json.dumps(geojson(fillers + anchors), ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    validation = {"version": VERSION, "source": raw.get("metadata"), "source_feature_count": len(raw_features), "anchor_count": len(anchors), "named_anchor_count": sum(bool(item["name"]) for item in anchors), "unnamed_anchor_count": sum(not item["name"] for item in anchors), "main_count": sum(item["category"] == "main" for item in anchors), "filler_count": len(fillers), "type_counts": dict(Counter(item["type"] for item in anchors)), "missing_elevation_count": len(rejected), "missing_elevation_examples": rejected[:100], "mount_1_present": False, "mount_11_usage": [item["id"] for item in anchors + fillers if item["icon_number"] == 11], "checks": {"all_ids_typed": all(item["id"].split("-", 1)[0] in {"hill", "mount", "rock", "peak"} for item in anchors), "all_categories_valid": all(item["category"] in {"regular", "main"} for item in anchors), "all_have_elevation": all(isinstance(item["elevation"], int) for item in anchors), "all_have_ridge_id": all(bool(item["ridge_id"]) for item in anchors), "mount_1_excluded": all(item["icon_number"] != 1 for item in anchors + fillers), "mount_11_high_only": all(item["elevation"] >= 4000 for item in anchors + fillers if item["icon_number"] == 11)}}
    if not all(validation["checks"].values()):
        raise RuntimeError(f"Validation failed: {validation['checks']}")
    (MOUNTAINS / "mountain_validation.json").write_text(json.dumps(validation, ensure_ascii=False, indent=2), encoding="utf-8")
    (DATA / "map-frame.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": [frame]}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    map_bounds = bbox(ring)
    center = data.get("center") or [(map_bounds[0] + map_bounds[2]) / 2, (map_bounds[1] + map_bounds[3]) / 2]
    write_web_files(map_bounds, center)
    (ROOT / "README.md").write_text(f'''# Alan Map {VERSION} — плоская горная основа\n\n- Все вершины извлечены из автономного слоя `peak` версии 7.0.23, включая безымянные точки.\n- Основная таблица: `data/mountains/mountain_points.csv` — 7 столбцов.\n- Главные вершины отмечены `category=main`.\n- Используются `mount-2`—`mount-30`; `mount-1` исключена.\n- `mount-11` разрешена только для точек от 4000 м.\n- Карта плоская, без DEM, hillshade, дорог, подписей и 3D.\n''', encoding="utf-8")
    (ROOT / "DATA-SOURCES-AND-LICENSES.md").write_text('''# Источники данных и лицензии\n\n- Вершины: автономный слой `peak` Alan Map 7.0.23, подготовленный из OpenStreetMap / Geofabrik, © OpenStreetMap contributors, ODbL.\n- Хребты, реки и рабочий контур: редактируемая географическая основа Alan Map 7.0.21.\n- Визуальный движок: локальная сборка MapLibre GL JS, BSD-3-Clause.\n- Горные PNG предоставлены владельцем проекта; `mount-1` не используется.\n''', encoding="utf-8")
    cleanup()
    print(json.dumps({"status": "ok", "anchors": len(anchors), "unnamed": validation["unnamed_anchor_count"], "fillers": len(fillers), "missing": len(rejected)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
