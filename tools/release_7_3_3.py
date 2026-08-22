#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VERSION = "7.3.3"
OLD_VERSION = "7.3.2"
OLD_DEM = "data/alan-dem-7.3.pmtiles"
NEW_DEM = "data/alan-dem-7.3.3.pmtiles"
SOURCE_PARTS = [ROOT / "assets/map-data.part-000.js", ROOT / "assets/map-data.part-001.js"]
MARKER = "window.ALAN_MAP_DATA = "


def parse_wrapped(path: Path, marker: str) -> dict:
    source = path.read_text(encoding="utf-8").strip()
    if not source.startswith(marker) or not source.endswith(";"):
        raise RuntimeError(f"{path}: unexpected wrapper")
    return json.loads(source[len(marker):-1])


def write_wrapped(path: Path, marker: str, data: dict) -> None:
    payload = marker + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n"
    path.write_text(payload, encoding="utf-8")


def read_source_parts() -> dict:
    source = "".join(path.read_text(encoding="utf-8") for path in SOURCE_PARTS).strip()
    if not source.startswith(MARKER) or not source.endswith(";"):
        raise RuntimeError("Unexpected map-data source wrapper")
    return json.loads(source[len(MARKER):-1])


def write_source_parts(data: dict) -> None:
    payload = "\n" + MARKER + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n"
    split = max(1, len(payload) // 2)
    SOURCE_PARTS[0].write_text(payload[:split], encoding="utf-8")
    SOURCE_PARTS[1].write_text(payload[split:], encoding="utf-8")


def patch_map_data(data: dict, dem_bytes: int, dem_sha256: str) -> dict:
    for key in ("version", "applicationVersion", "stage"):
        if key in data:
            data[key] = VERSION

    runtime_loading = data.get("runtimeLoading")
    if isinstance(runtime_loading, dict):
        runtime_loading["version"] = VERSION

    dem = data.get("regionalDem")
    if not isinstance(dem, dict):
        raise RuntimeError("regionalDem missing")
    dem.update({
        "archivePath": NEW_DEM,
        "archiveBytes": dem_bytes,
        "archiveSha256": dem_sha256,
        "minzoom": 7,
        "maxzoom": 10,
        "highestNativeZoom": 10,
        "overzoomFrom": 10,
        "lodModel": "physical-z7-z9-z10-three-level-512-overzoom",
        "physicalNativeZooms": [7, 9, 10],
        "nativeZ8": False,
        "runtimeNativeZooms": [7, 9, 10],
        "runtimeNetworkLevels": 3,
        "z8RuntimeMode": "overzoom-z7-native-z8-absent",
        "z8RequestsEnabled": False,
        "transitionMode": "prefetch-visible-tiles-then-switch-on-zoomend",
        "geometryGeneralization": "hierarchical-area-lowpass-z10-to-z9-z7-shared-no-native-z8",
        "effectiveGroundMPerInformationPixelAtCenter": {
            "7": 442.574,
            "8": 442.574,
            "9": 221.287,
            "10": 110.644,
        },
    })
    return data


def patch_map_page() -> None:
    path = ROOT / "assets/map-page.js"
    text = path.read_text(encoding="utf-8")
    text = text.replace("const VERSION = '7.3.2';", "const VERSION = '7.3.3';", 1)

    marker = "    configurations.forEach(registerArchive);\n"
    helper = """    configurations.forEach(registerArchive);

    window.ALAN_MAP_PREFETCH_PM_TILE = async ({archivePath,z,x,y,reason='runtime'}) => {
      const path = String(archivePath || '');
      const record = archiveByPath.get(path);
      if (!record?.archive) throw new Error(`Alan Map: PMTiles archive is not registered for prefetch: ${path}`);
      const zoom = Number(z);
      const tileX = Number(x);
      const tileY = Number(y);
      if (![zoom,tileX,tileY].every(Number.isInteger)) throw new Error('Alan Map: invalid PMTiles prefetch coordinate.');
      const before = performance.now();
      const value = await record.archive.getZxy(zoom,tileX,tileY);
      document.dispatchEvent(new CustomEvent('alan-map:pmtiles-prefetched',{detail:{
        archivePath:path,sourceId:record.sourceId,z:zoom,x:tileX,y:tileY,reason,
        durationMs:performance.now()-before
      }}));
      return value;
    };
"""
    if "window.ALAN_MAP_PREFETCH_PM_TILE" not in text:
        if marker not in text:
            raise RuntimeError("map-page registerArchive marker not found")
        text = text.replace(marker, helper, 1)
    path.write_text(text, encoding="utf-8")


def patch_map_ui() -> None:
    path = ROOT / "assets/map-ui.js"
    text = path.read_text(encoding="utf-8")
    text = text.replace("const VERSION = '7.3.2';", "const VERSION = '7.3.3';", 1)
    text = text.replace("const DEFAULT_STORAGE_KEY = 'alan-map-stage7.3.2-view';", "const DEFAULT_STORAGE_KEY = 'alan-map-stage7.3.3-view';", 1)
    legacy_marker = "  const LEGACY_STORAGE_KEYS = [\n"
    if "'alan-map-stage7.3.2-view'," not in text:
        text = text.replace(legacy_marker, legacy_marker + "    'alan-map-stage7.3.2-view',\n", 1)
    path.write_text(text, encoding="utf-8")


def patch_index() -> None:
    path = ROOT / "index.html"
    text = path.read_text(encoding="utf-8")
    if OLD_VERSION not in text:
        raise RuntimeError("index.html has no 7.3.2 version markers")
    path.write_text(text.replace(OLD_VERSION, VERSION), encoding="utf-8")


def patch_runtime_payloads(dem_bytes: int, dem_sha256: str) -> None:
    source = patch_map_data(read_source_parts(), dem_bytes, dem_sha256)
    write_source_parts(source)

    core_path = ROOT / "assets/map-data-core.js"
    core = patch_map_data(parse_wrapped(core_path, MARKER), dem_bytes, dem_sha256)
    write_wrapped(core_path, MARKER, core)

    for filename, marker in [
        ("assets/map-data-deferred.js", "window.ALAN_MAP_DEFERRED_DATA = "),
        ("assets/map-data-points.js", "window.ALAN_MAP_POINT_DATA = "),
    ]:
        path = ROOT / filename
        data = parse_wrapped(path, marker)
        data["version"] = VERSION
        write_wrapped(path, marker, data)


def patch_reports(dem_bytes: int, dem_sha256: str, baseline_bytes: int) -> None:
    old_report = ROOT / "data/runtime-loading-report-7.3.2.json"
    new_report = ROOT / "data/runtime-loading-report-7.3.3.json"
    report = json.loads(old_report.read_text(encoding="utf-8"))
    report["version"] = VERSION
    report["demArchivePath"] = NEW_DEM
    report["demArchiveBytes"] = dem_bytes
    report["demPhysicalNativeZooms"] = [7, 9, 10]
    report["demNativeZ8"] = False
    new_report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    manifest_path = ROOT / "data/copernicus-build-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["version"] = VERSION
    dem = manifest.setdefault("dem", {})
    dem.update({
        "archive": NEW_DEM,
        "bytes": dem_bytes,
        "sha256": dem_sha256,
        "tile_size": 512,
        "lod_model": "physical-z7-z9-z10-three-level-512-overzoom",
        "native_zoom_range": "z7,z9,z10",
        "physical_native_zooms": [7, 9, 10],
        "native_z8": False,
        "overzoom_from": 10,
        "effective_ground_m_per_information_pixel_at_center": {
            "7": 442.574,
            "8": 442.574,
            "9": 221.287,
            "10": 110.644,
        },
        "baseline_bytes_7_3_2": baseline_bytes,
        "reduction_fraction": 1 - dem_bytes / baseline_bytes,
    })
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def patch_tests() -> None:
    runtime = ROOT / "tests/runtime-contract.mjs"
    text = runtime.read_text(encoding="utf-8")
    text = text.replace("runtime-loading-report-7.3.2.json", "runtime-loading-report-7.3.3.json")
    text = text.replace("'7.3.2'", "'7.3.3'")
    text = text.replace('"7.3.2"', '"7.3.3"')
    text = text.replace(r"7\.3\.2", r"7\.3\.3")
    text = text.replace("data/alan-dem-7.3.pmtiles", NEW_DEM)
    text = text.replace(
        "hierarchical-z10-to-z8-z7-shared-512-overzoom",
        "physical-z7-z9-z10-three-level-512-overzoom",
    )
    text = text.replace(
        "hierarchical-area-lowpass-z10-to-z8-z7-shared",
        "hierarchical-area-lowpass-z10-to-z9-z7-shared-no-native-z8",
    )
    runtime.write_text(text, encoding="utf-8")

    smoke = ROOT / "tests/map-smoke.mjs"
    text = smoke.read_text(encoding="utf-8")
    text = text.replace("7.3.2", "7.3.3")
    text = text.replace(r"7\.3\.2", r"7\.3\.3")
    text = text.replace("data/alan-dem-7.3.pmtiles", NEW_DEM)
    smoke.write_text(text, encoding="utf-8")


def validate_runtime_references() -> None:
    paths = [
        ROOT / "index.html",
        ROOT / "assets/bootstrap.js",
        ROOT / "assets/map-ui.js",
        ROOT / "assets/map-page.js",
        ROOT / "assets/dem-lod-7.3.3.js",
        ROOT / "assets/map-data-core.js",
        ROOT / "assets/map-data.part-000.js",
        ROOT / "assets/map-data.part-001.js",
        ROOT / "tests/runtime-contract.mjs",
        ROOT / "tests/map-smoke.mjs",
    ]
    for path in paths:
        text = path.read_text(encoding="utf-8")
        if OLD_DEM in text:
            raise RuntimeError(f"{path}: stale DEM runtime reference remains")

    strict_version_paths = [
        ROOT / "index.html",
        ROOT / "assets/bootstrap.js",
        ROOT / "assets/map-page.js",
    ]
    for path in strict_version_paths:
        if OLD_VERSION in path.read_text(encoding="utf-8"):
            raise RuntimeError(f"{path}: stale release version remains")

    ui_path = ROOT / "assets/map-ui.js"
    ui_text = ui_path.read_text(encoding="utf-8")
    legacy_key = "alan-map-stage7.3.2-view"
    if legacy_key not in ui_text:
        raise RuntimeError("map-ui.js: 7.3.2 legacy storage migration key missing")
    if OLD_VERSION in ui_text.replace(legacy_key, ""):
        raise RuntimeError("map-ui.js: stale 7.3.2 runtime reference remains outside legacy storage migration")


def main() -> None:
    parser = argparse.ArgumentParser(description="Finalize Alan Map 7.3.3 runtime metadata after physical DEM repack.")
    parser.add_argument("--dem", default=NEW_DEM)
    parser.add_argument("--baseline-bytes", type=int, default=16_699_494)
    args = parser.parse_args()

    dem_path = ROOT / args.dem
    if not dem_path.exists():
        raise SystemExit(f"DEM archive missing: {dem_path}")
    dem_bytes = dem_path.stat().st_size
    dem_sha256 = hashlib.sha256(dem_path.read_bytes()).hexdigest()

    patch_map_page()
    patch_map_ui()
    patch_index()
    patch_runtime_payloads(dem_bytes, dem_sha256)
    patch_reports(dem_bytes, dem_sha256, args.baseline_bytes)
    patch_tests()
    validate_runtime_references()

    print(json.dumps({
        "version": VERSION,
        "demArchive": args.dem,
        "demBytes": dem_bytes,
        "demSha256": dem_sha256,
        "physicalNativeZooms": [7, 9, 10],
        "nativeZ8": False,
        "transitionMode": "prefetch-visible-tiles-then-switch-on-zoomend",
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
