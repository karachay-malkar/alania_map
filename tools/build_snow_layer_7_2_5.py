#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import re
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import requests
import rasterio
from rasterio.enums import Resampling
from rasterio.features import geometry_mask
from rasterio.transform import from_origin
from rasterio.warp import reproject, transform_bounds, transform_geom
from rasterio.windows import Window, from_bounds

ROOT = Path(__file__).resolve().parents[1]
EARTH_SEARCH = 'https://earth-search.aws.element84.com/v1/search'
SENTINEL_COLLECTION_BY_YEAR = {2020: 'sentinel-2-l2a', 2021: 'sentinel-2-l2a', 2023: 'sentinel-2-c1-l2a', 2024: 'sentinel-2-c1-l2a', 2025: 'sentinel-2-c1-l2a'}
WORLD_COVER_PREFIX = 'https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map'
WORLD_COVER_CLASS_SNOW_ICE = 70
TARGET_CRS = 'EPSG:3857'
YEARS = (2020, 2021, 2023, 2024, 2025)
DATE_START = '08-15'
DATE_END = '09-30'
NDSI_THRESHOLD = 0.40
MIN_GREEN_REFLECTANCE = 0.08
PERMANENT_CONSENSUS = 0.60
SEASONAL_CONSENSUS_MIN = 0.25
MIN_VALID_YEARS_PERMANENT = 3
MIN_VALID_YEARS_SEASONAL = 2
MAX_SCENES_PER_MGRS_YEAR = 2
MAX_SCENE_CLOUD_PERCENT = 45
ELBRUS = (42.445874, 43.349602)
# Vegetated, built-up and water classes are not allowed to create new NDSI snow.
# Bare/sparse (60), snow/ice (70) and WorldCover nodata (0) remain eligible.
WORLD_COVER_NDSI_EXCLUDED = {10, 20, 30, 40, 50, 80, 90, 95, 100}
SCL_INVALID = {0, 1, 2, 3, 6, 7, 8, 9, 10}


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding='utf-8'))


def request_json(method: str, url: str, *, payload: dict | None = None, params: dict | None = None, attempts: int = 5) -> dict:
    last: Exception | None = None
    headers = {
        'User-Agent': 'AlanMap/7.2.5 satellite-snow-builder',
        'Accept': 'application/geo+json, application/json',
    }
    for attempt in range(attempts):
        try:
            response = requests.request(method, url, json=payload, params=params, headers=headers, timeout=120)
            response.raise_for_status()
            content_type = (response.headers.get('content-type') or '').lower()
            if 'json' not in content_type and 'geo+json' not in content_type:
                sample = response.text[:240].replace('\n', ' ')
                raise RuntimeError(f'unexpected content-type {content_type!r}: {sample!r}')
            try:
                return response.json()
            except ValueError as exc:
                sample = response.text[:240].replace('\n', ' ')
                raise RuntimeError(f'invalid JSON response ({content_type!r}): {sample!r}') from exc
        except Exception as exc:  # network retry is intentional in CI
            last = exc
            if attempt + 1 == attempts:
                break
            time.sleep(3 * (attempt + 1))
    raise RuntimeError(f'JSON request failed after {attempts} attempts: {url}: {last}')


def map_frame(frame_path: Path) -> tuple[dict, list[float]]:
    payload = load_json(frame_path)
    feature = (payload.get('features') or [None])[0]
    if not feature or not feature.get('geometry'):
        raise RuntimeError('map frame is empty')
    ring = feature['geometry']['coordinates'][0]
    xs = [float(point[0]) for point in ring]
    ys = [float(point[1]) for point in ring]
    return feature['geometry'], [min(xs), min(ys), max(xs), max(ys)]


def target_grid(bounds_wgs84: list[float], resolution_m: float) -> tuple[Any, int, int, tuple[float, float, float, float]]:
    west, south, east, north = transform_bounds('EPSG:4326', TARGET_CRS, *bounds_wgs84, densify_pts=21)
    width = int(math.ceil((east - west) / resolution_m))
    height = int(math.ceil((north - south) / resolution_m))
    transform = from_origin(west, north, resolution_m, resolution_m)
    return transform, width, height, (west, south, east, north)


def tile_code(latitude: int, longitude: int) -> str:
    ns = 'N' if latitude >= 0 else 'S'
    ew = 'E' if longitude >= 0 else 'W'
    return f'{ns}{abs(latitude):02d}{ew}{abs(longitude):03d}'


def worldcover_urls(bounds: list[float]) -> list[str]:
    west, south, east, north = bounds
    lat0 = math.floor(south / 3) * 3
    lon0 = math.floor(west / 3) * 3
    urls = []
    lat = lat0
    while lat < north:
        lon = lon0
        while lon < east:
            code = tile_code(lat, lon)
            urls.append(f'{WORLD_COVER_PREFIX}/ESA_WorldCover_10m_2021_v200_{code}_Map.tif')
            lon += 3
        lat += 3
    return urls


def clamp_window(window: Window, width: int, height: int) -> Window | None:
    col_off = max(0, int(math.floor(window.col_off)))
    row_off = max(0, int(math.floor(window.row_off)))
    col_end = min(width, int(math.ceil(window.col_off + window.width)))
    row_end = min(height, int(math.ceil(window.row_off + window.height)))
    if col_end <= col_off or row_end <= row_off:
        return None
    return Window(col_off, row_off, col_end - col_off, row_end - row_off)


def window_for_bounds(bounds_wgs84: list[float], target_bounds: tuple[float, float, float, float], transform, width: int, height: int) -> Window | None:
    west, south, east, north = transform_bounds('EPSG:4326', TARGET_CRS, *bounds_wgs84, densify_pts=9)
    tw, ts, te, tn = target_bounds
    west, south, east, north = max(west, tw), max(south, ts), min(east, te), min(north, tn)
    if west >= east or south >= north:
        return None
    return clamp_window(from_bounds(west, south, east, north, transform=transform), width, height)


def window_slices(window: Window) -> tuple[slice, slice]:
    return (
        slice(int(window.row_off), int(window.row_off + window.height)),
        slice(int(window.col_off), int(window.col_off + window.width)),
    )


def reproject_asset(href: str, window: Window, target_transform, target_crs: str, resampling: Resampling, dtype, fill_value):
    shape = (int(window.height), int(window.width))
    destination = np.full(shape, fill_value, dtype=dtype)
    dst_transform = rasterio.windows.transform(window, target_transform)
    env_options = {
        'GDAL_HTTP_MULTIRANGE': 'YES',
        'GDAL_HTTP_MERGE_CONSECUTIVE_RANGES': 'YES',
        'CPL_VSIL_CURL_ALLOWED_EXTENSIONS': '.tif,.TIF',
        'GDAL_DISABLE_READDIR_ON_OPEN': 'EMPTY_DIR',
    }
    last = None
    for attempt in range(4):
        try:
            with rasterio.Env(**env_options), rasterio.open(href) as source:
                reproject(
                    source=rasterio.band(source, 1),
                    destination=destination,
                    src_transform=source.transform,
                    src_crs=source.crs,
                    src_nodata=source.nodata,
                    dst_transform=dst_transform,
                    dst_crs=target_crs,
                    dst_nodata=fill_value,
                    resampling=resampling,
                    num_threads=2,
                )
            return destination
        except Exception as exc:
            last = exc
            if attempt == 3:
                break
            time.sleep(3 * (attempt + 1))
    raise RuntimeError(f'cannot read raster asset {href}: {last}')


def build_worldcover(bounds_wgs84, target_transform, width, height, target_bounds) -> tuple[np.ndarray, list[str]]:
    output = np.zeros((height, width), dtype=np.uint8)
    used = []
    for url in worldcover_urls(bounds_wgs84):
        # WorldCover files are 3x3 degree COGs; the URL itself determines the tile bounds.
        name = url.rsplit('/', 1)[-1]
        match = re.search(r'_([NS])(\d{2})([EW])(\d{3})_Map\.tif$', name)
        if not match:
            continue
        lat = int(match.group(2)) * (1 if match.group(1) == 'N' else -1)
        lon = int(match.group(4)) * (1 if match.group(3) == 'E' else -1)
        window = window_for_bounds([lon, lat, lon + 3, lat + 3], target_bounds, target_transform, width, height)
        if window is None:
            continue
        try:
            values = reproject_asset(url, window, target_transform, TARGET_CRS, Resampling.nearest, np.uint8, 0)
        except RuntimeError as exc:
            # Ocean-only or absent grid entries do not matter for this land AOI, but all expected Caucasus tiles must load.
            raise RuntimeError(f'WorldCover tile failed: {name}: {exc}') from exc
        rows, cols = window_slices(window)
        output[rows, cols] = np.where(values != 0, values, output[rows, cols])
        used.append(url)
    if not used or not np.any(output):
        raise RuntimeError('WorldCover did not provide any data for the map frame')
    return output, used


def earth_search(year: int, frame_geometry: dict) -> list[dict]:
    ring = frame_geometry['coordinates'][0]
    xs = [float(point[0]) for point in ring]
    ys = [float(point[1]) for point in ring]
    collection = SENTINEL_COLLECTION_BY_YEAR[year]
    # GET Item Search is deliberately used here instead of POST: it is simpler for
    # CDN/proxy paths and the AOI is small enough to filter cloud cover client-side.
    params = {
        'collections': collection,
        'bbox': ','.join(str(value) for value in (min(xs), min(ys), max(xs), max(ys))),
        'datetime': f'{year}-{DATE_START}T00:00:00Z/{year}-{DATE_END}T23:59:59Z',
        'limit': 200,
    }
    result = request_json('GET', EARTH_SEARCH, params=params)
    features = [
        item for item in (result.get('features') or [])
        if float((item.get('properties') or {}).get('eo:cloud_cover') or 100) <= MAX_SCENE_CLOUD_PERCENT
    ]
    features.sort(key=lambda item: (float((item.get('properties') or {}).get('eo:cloud_cover') or 100), str(item.get('id') or '')))
    if not features:
        raise RuntimeError(f'no Sentinel-2 L2A scenes found for late summer {year} in {collection}')
    return features


def scene_group(item: dict) -> str:
    properties = item.get('properties') or {}
    for key in ('grid:code', 'mgrs:tile', 's2:mgrs_tile'):
        if properties.get(key):
            return str(properties[key])
    identifier = str(item.get('id') or '')
    match = re.search(r'_T([0-9A-Z]{5})_', identifier)
    return match.group(1) if match else identifier.split('_')[0]


def select_scenes(items: list[dict]) -> list[dict]:
    groups: dict[str, list[dict]] = defaultdict(list)
    for item in items:
        groups[scene_group(item)].append(item)
    selected = []
    for key in sorted(groups):
        group = sorted(groups[key], key=lambda item: (float((item.get('properties') or {}).get('eo:cloud_cover') or 100), str(item.get('id') or '')))
        selected.extend(group[:MAX_SCENES_PER_MGRS_YEAR])
    return selected


def asset(item: dict, candidates: tuple[str, ...], *, common_name: str | None = None, band_name: str | None = None) -> tuple[str, dict]:
    assets = item.get('assets') or {}
    for key in candidates:
        record = assets.get(key)
        if record and record.get('href'):
            return str(record['href']), record
    for record in assets.values():
        for band in record.get('eo:bands') or []:
            if common_name and band.get('common_name') == common_name and record.get('href'):
                return str(record['href']), record
            if band_name and band.get('name') == band_name and record.get('href'):
                return str(record['href']), record
    raise RuntimeError(f'missing asset {candidates} in {item.get("id")}')


def scale_offset(record: dict) -> tuple[float, float]:
    raster_band = ((record.get('raster:bands') or [{}])[0])
    return float(raster_band.get('scale', 1.0)), float(raster_band.get('offset', 0.0))


def process_scene(item: dict, target_transform, width, height, target_bounds, worldcover: np.ndarray) -> tuple[Window, np.ndarray, np.ndarray]:
    bbox = [float(value) for value in item.get('bbox') or []]
    if len(bbox) != 4:
        raise RuntimeError(f'scene bbox missing: {item.get("id")}')
    window = window_for_bounds(bbox, target_bounds, target_transform, width, height)
    if window is None:
        raise RuntimeError(f'scene does not overlap target after STAC query: {item.get("id")}')
    green_href, green_record = asset(item, ('green', 'B03', 'b03'), common_name='green', band_name='B03')
    swir_href, swir_record = asset(item, ('swir16', 'B11', 'b11'), common_name='swir16', band_name='B11')
    scl_href, _ = asset(item, ('scl', 'SCL', 'scl20m'), band_name='SCL')

    green_raw = reproject_asset(green_href, window, target_transform, TARGET_CRS, Resampling.bilinear, np.float32, np.nan)
    swir_raw = reproject_asset(swir_href, window, target_transform, TARGET_CRS, Resampling.bilinear, np.float32, np.nan)
    scl = reproject_asset(scl_href, window, target_transform, TARGET_CRS, Resampling.nearest, np.uint8, 0)
    green_scale, green_offset = scale_offset(green_record)
    swir_scale, swir_offset = scale_offset(swir_record)
    green = green_raw * green_scale + green_offset
    swir = swir_raw * swir_scale + swir_offset
    denominator = green + swir
    valid = np.isfinite(green) & np.isfinite(swir) & (denominator > 0.01)
    valid &= ~np.isin(scl, list(SCL_INVALID))
    rows, cols = window_slices(window)
    eligible_surface = ~np.isin(worldcover[rows, cols], list(WORLD_COVER_NDSI_EXCLUDED))
    valid &= eligible_surface
    ndsi = np.full(green.shape, -999.0, dtype=np.float32)
    np.divide(green - swir, denominator, out=ndsi, where=valid)
    snow = valid & (ndsi >= NDSI_THRESHOLD) & (green >= MIN_GREEN_REFLECTANCE)
    # Sen2Cor snow/ice (SCL=11) is still required to pass the spectral and surface filters;
    # this prevents cloud-like false positives while retaining true high-albedo ice.
    return window, valid, snow


def frame_mask_array(frame_geometry: dict, transform, width: int, height: int) -> np.ndarray:
    geometry_3857 = transform_geom('EPSG:4326', TARGET_CRS, frame_geometry, precision=7)
    return geometry_mask([geometry_3857], out_shape=(height, width), transform=transform, invert=True, all_touched=False)


def write_rgba(path: Path, mask: np.ndarray, transform, rgb: tuple[int, int, int]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    profile = {
        'driver': 'GTiff',
        'height': mask.shape[0],
        'width': mask.shape[1],
        'count': 4,
        'dtype': 'uint8',
        'crs': TARGET_CRS,
        'transform': transform,
        'tiled': True,
        'blockxsize': 512,
        'blockysize': 512,
        'compress': 'DEFLATE',
        'predictor': 2,
        'BIGTIFF': 'IF_SAFER',
    }
    alpha = np.where(mask, 255, 0).astype(np.uint8)
    with rasterio.open(path, 'w', **profile) as dataset:
        for index, value in enumerate(rgb, start=1):
            dataset.write(np.where(mask, value, 0).astype(np.uint8), index)
        dataset.write(alpha, 4)
        dataset.colorinterp = (
            rasterio.enums.ColorInterp.red,
            rasterio.enums.ColorInterp.green,
            rasterio.enums.ColorInterp.blue,
            rasterio.enums.ColorInterp.alpha,
        )


def elbrus_pixels(mask: np.ndarray, transform, radius_m: float = 8000) -> int:
    from rasterio.warp import transform as warp_transform
    xs, ys = warp_transform('EPSG:4326', TARGET_CRS, [ELBRUS[0]], [ELBRUS[1]])
    col = (xs[0] - transform.c) / transform.a
    row = (ys[0] - transform.f) / transform.e
    radius_px = radius_m / abs(transform.a)
    row0 = max(0, int(row - radius_px)); row1 = min(mask.shape[0], int(row + radius_px) + 1)
    col0 = max(0, int(col - radius_px)); col1 = min(mask.shape[1], int(col + radius_px) + 1)
    yy, xx = np.ogrid[row0:row1, col0:col1]
    circle = (yy - row) ** 2 + (xx - col) ** 2 <= radius_px ** 2
    return int(np.count_nonzero(mask[row0:row1, col0:col1] & circle))


def main() -> None:
    parser = argparse.ArgumentParser(description='Build Alan Map 7.2.5 persistent and late-summer snow masks.')
    parser.add_argument('--frame', type=Path, default=ROOT / 'build/map-frame.geojson')
    parser.add_argument('--resolution', type=float, default=20.0)
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'build')
    parser.add_argument('--report', type=Path, default=ROOT / 'build/snow-report-7.2.5.json')
    args = parser.parse_args()

    frame_geometry, bounds = map_frame(args.frame)
    requested_resolution = float(args.resolution)
    # The full rotated Caucasus frame is ~282M cells at 20 m. Fuse the native
    # 10/20 m source data on a 30 m grid, matching the map DEM scale while
    # keeping the build comfortably inside GitHub Actions memory limits.
    effective_resolution = max(30.0, requested_resolution)
    transform, width, height, target_bounds = target_grid(bounds, effective_resolution)
    if width * height > 190_000_000:
        raise RuntimeError(f'target grid unexpectedly large: {width}x{height}')
    print(f'target grid {width}x{height} at {effective_resolution:g} m (requested {requested_resolution:g} m)')

    worldcover, worldcover_sources = build_worldcover(bounds, transform, width, height, target_bounds)
    inside_frame = frame_mask_array(frame_geometry, transform, width, height)
    worldcover_permanent = (worldcover == WORLD_COVER_CLASS_SNOW_ICE) & inside_frame
    if not np.any(worldcover_permanent):
        raise RuntimeError('WorldCover class 70 is empty inside map frame')

    valid_years = np.zeros((height, width), dtype=np.uint8)
    snow_years = np.zeros((height, width), dtype=np.uint8)
    scene_records = []
    yearly_summary = []

    for year in YEARS:
        items = earth_search(year, frame_geometry)
        scenes = select_scenes(items)
        if not scenes:
            raise RuntimeError(f'no selected Sentinel scenes for {year}')
        valid_votes = np.zeros((height, width), dtype=np.uint8)
        snow_votes = np.zeros((height, width), dtype=np.uint8)
        for index, item in enumerate(scenes, start=1):
            cloud = float((item.get('properties') or {}).get('eo:cloud_cover') or 0)
            print(f'{year} scene {index}/{len(scenes)}: {item.get("id")} cloud={cloud:.1f}%')
            window, valid, snow = process_scene(item, transform, width, height, target_bounds, worldcover)
            rows, cols = window_slices(window)
            valid_votes[rows, cols] += valid.astype(np.uint8)
            snow_votes[rows, cols] += snow.astype(np.uint8)
            scene_records.append({
                'year': year,
                'id': item.get('id'),
                'datetime': (item.get('properties') or {}).get('datetime'),
                'cloud_cover': cloud,
                'mgrs_group': scene_group(item),
            })
        year_valid = (valid_votes > 0) & inside_frame
        year_snow = year_valid & (snow_votes * 2 >= valid_votes)
        valid_years += year_valid.astype(np.uint8)
        snow_years += year_snow.astype(np.uint8)
        yearly_summary.append({
            'year': year,
            'catalog_items': len(items),
            'selected_scenes': len(scenes),
            'valid_pixels': int(np.count_nonzero(year_valid)),
            'snow_pixels': int(np.count_nonzero(year_snow)),
        })
        del valid_votes, snow_votes, year_valid, year_snow

    ratio = np.zeros((height, width), dtype=np.float32)
    np.divide(snow_years, valid_years, out=ratio, where=valid_years > 0)
    consensus_permanent = (valid_years >= MIN_VALID_YEARS_PERMANENT) & (ratio >= PERMANENT_CONSENSUS)
    permanent = inside_frame & (worldcover_permanent | consensus_permanent)
    seasonal = inside_frame & ~permanent & (valid_years >= MIN_VALID_YEARS_SEASONAL) & (ratio >= SEASONAL_CONSENSUS_MIN)

    # Guard against any NDSI expansion into land classes that the TЗ explicitly excludes.
    eligible = ~np.isin(worldcover, list(WORLD_COVER_NDSI_EXCLUDED))
    permanent = worldcover_permanent | (permanent & eligible)
    seasonal &= eligible

    permanent_path = args.output_dir / 'snow-permanent-7.2.5.tif'
    seasonal_path = args.output_dir / 'snow-seasonal-7.2.5.tif'
    write_rgba(permanent_path, permanent, transform, (250, 253, 253))
    write_rgba(seasonal_path, seasonal, transform, (245, 250, 251))

    pixel_area_km2 = effective_resolution * effective_resolution / 1_000_000
    report = {
        'version': '7.2.5',
        'built_at': datetime.now(timezone.utc).isoformat(),
        'bounds': bounds,
        'frame': frame_geometry,
        'target_crs': TARGET_CRS,
        'resolution_m': effective_resolution,
        'requested_resolution_m': requested_resolution,
        'grid': {'width': width, 'height': height},
        'sources': {
            'worldcover': {
                'product': 'ESA WorldCover 2021 v200',
                'class': WORLD_COVER_CLASS_SNOW_ICE,
                'class_name': 'Snow and Ice',
                'urls': worldcover_sources,
            },
            'sentinel2': {
                'collections_by_year': {str(year): SENTINEL_COLLECTION_BY_YEAR[year] for year in YEARS},
                'stac': EARTH_SEARCH,
                'years': list(YEARS),
                'late_summer_window': f'{DATE_START}/{DATE_END}',
                'bands': ['B03', 'B11', 'SCL'],
                'scenes': scene_records,
            },
        },
        'algorithm': {
            'ndsi': '(B03-B11)/(B03+B11)',
            'ndsi_threshold': NDSI_THRESHOLD,
            'minimum_green_reflectance': MIN_GREEN_REFLECTANCE,
            'invalid_scl': sorted(SCL_INVALID),
            'worldcover_ndsi_excluded_classes': sorted(WORLD_COVER_NDSI_EXCLUDED),
            'max_scene_cloud_percent': MAX_SCENE_CLOUD_PERCENT,
            'max_scenes_per_mgrs_year': MAX_SCENES_PER_MGRS_YEAR,
            'permanent_consensus': PERMANENT_CONSENSUS,
            'seasonal_consensus_min': SEASONAL_CONSENSUS_MIN,
            'minimum_valid_years_permanent': MIN_VALID_YEARS_PERMANENT,
            'minimum_valid_years_seasonal': MIN_VALID_YEARS_SEASONAL,
            'permanent_definition': 'WorldCover class 70 OR multi-year late-summer NDSI consensus',
            'seasonal_definition': 'late-summer multi-year NDSI residual outside permanent mask',
        },
        'yearly': yearly_summary,
        'coverage': {
            'worldcover_permanent_pixels': int(np.count_nonzero(worldcover_permanent)),
            'consensus_permanent_pixels': int(np.count_nonzero(consensus_permanent & inside_frame)),
            'permanent_pixels': int(np.count_nonzero(permanent)),
            'seasonal_pixels': int(np.count_nonzero(seasonal)),
            'permanent_area_km2': round(float(np.count_nonzero(permanent) * pixel_area_km2), 3),
            'seasonal_area_km2': round(float(np.count_nonzero(seasonal) * pixel_area_km2), 3),
            'elbrus_permanent_pixels_within_8km': elbrus_pixels(permanent, transform),
            'elbrus_seasonal_pixels_within_8km': elbrus_pixels(seasonal, transform),
        },
        'outputs': [str(permanent_path.resolve().relative_to(ROOT)), str(seasonal_path.resolve().relative_to(ROOT))],
    }
    if report['coverage']['elbrus_permanent_pixels_within_8km'] <= 0:
        raise RuntimeError('Elbrus permanent snow check failed: no permanent snow within 8 km')
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report['coverage'], ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
