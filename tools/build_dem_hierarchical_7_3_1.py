#!/usr/bin/env python3
from __future__ import annotations

import argparse
import io
import json
import math
import sqlite3
from pathlib import Path

import numpy as np
from PIL import Image
import rasterio
from rasterio.features import geometry_mask
from rasterio.transform import from_bounds
from rasterio.warp import Resampling, reproject, transform_geom
from shapely.geometry import Polygon, box

WEB_MERCATOR_HALF_WORLD = 20037508.342789244
WEB_MERCATOR_PIXEL_M_256 = 156543.03392804097
OUTPUT_TILE_SIZE = 512
LOGICAL_TILE_SIZE = 256
MIN_ZOOM = 7
MAX_ZOOM = 10
TERRAIN_BASE = -10000.0
TERRAIN_INTERVAL = 0.1
HEIGHT_QUANTIZATION_M = 1.0
INTERNAL_NODATA = -32768.0
CENTER_LAT = 43.634535


def load_frame(path: Path) -> tuple[dict, Polygon]:
    collection = json.loads(path.read_text(encoding='utf-8'))
    geometry = collection['features'][0]['geometry']
    if geometry.get('type') != 'Polygon':
        raise RuntimeError('map frame must be a Polygon')
    polygon = Polygon(geometry['coordinates'][0])
    if not polygon.is_valid or polygon.is_empty:
        raise RuntimeError('invalid map-frame polygon')
    return geometry, polygon


def lon_to_tile_x(lon: float, z: int) -> int:
    n = 2 ** z
    return max(0, min(n - 1, int(math.floor((lon + 180.0) / 360.0 * n))))


def lat_to_tile_y(lat: float, z: int) -> int:
    n = 2 ** z
    clipped = max(-85.05112878, min(85.05112878, lat))
    radians = math.radians(clipped)
    value = (1.0 - math.asinh(math.tan(radians)) / math.pi) / 2.0 * n
    return max(0, min(n - 1, int(math.floor(value))))


def tile_bounds(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    n = 2 ** z
    west = x / n * 360.0 - 180.0
    east = (x + 1) / n * 360.0 - 180.0

    def latitude(row: int) -> float:
        value = math.pi * (1.0 - 2.0 * row / n)
        return math.degrees(math.atan(math.sinh(value)))

    return west, latitude(y + 1), east, latitude(y)


def tile_rect_mercator_bounds(z: int, x_min: int, y_min: int, x_max: int, y_max: int) -> tuple[float, float, float, float]:
    n = 2 ** z
    span = (WEB_MERCATOR_HALF_WORLD * 2.0) / n
    west = -WEB_MERCATOR_HALF_WORLD + x_min * span
    east = -WEB_MERCATOR_HALF_WORLD + (x_max + 1) * span
    north = WEB_MERCATOR_HALF_WORLD - y_min * span
    south = WEB_MERCATOR_HALF_WORLD - (y_max + 1) * span
    return west, south, east, north


def pixel_lon_lat(z: int, x: int, y: int, width: int, height: int) -> tuple[np.ndarray, np.ndarray]:
    n = float(2 ** z)
    columns = (x * width + np.arange(width, dtype=np.float64) + 0.5) / (n * width)
    rows = (y * height + np.arange(height, dtype=np.float64) + 0.5) / (n * height)
    lon = columns * 360.0 - 180.0
    mercator_y = np.pi * (1.0 - 2.0 * rows)
    lat = np.degrees(np.arctan(np.sinh(mercator_y)))
    return np.meshgrid(lon, lat)


def points_in_polygon(lon: np.ndarray, lat: np.ndarray, coordinates: list[tuple[float, float]]) -> np.ndarray:
    inside = np.zeros(lon.shape, dtype=bool)
    for index, first in enumerate(coordinates):
        second = coordinates[(index + 1) % len(coordinates)]
        x1, y1 = first
        x2, y2 = second
        crossing = (y1 > lat) != (y2 > lat)
        denominator = y2 - y1
        if abs(denominator) < 1e-15:
            continue
        x_cross = (x2 - x1) * (lat - y1) / denominator + x1
        inside ^= crossing & (lon < x_cross)
    return inside


def quantize(array: np.ndarray) -> np.ndarray:
    output = np.asarray(array, dtype=np.float32).copy()
    valid = np.isfinite(output) & (output != INTERNAL_NODATA)
    output[valid] = np.rint(output[valid] / HEIGHT_QUANTIZATION_M) * HEIGHT_QUANTIZATION_M
    output[~valid] = INTERNAL_NODATA
    return output


def frame_mask(frame_3857: dict, shape: tuple[int, int], transform) -> np.ndarray:
    return ~geometry_mask([frame_3857], out_shape=shape, transform=transform, invert=False, all_touched=False)


def warp_to_shape(
    source: np.ndarray,
    src_transform,
    shape: tuple[int, int],
    dst_transform,
    resampling: Resampling,
) -> np.ndarray:
    destination = np.full(shape, INTERNAL_NODATA, dtype=np.float32)
    reproject(
        source=source,
        destination=destination,
        src_transform=src_transform,
        src_crs='EPSG:3857',
        src_nodata=INTERNAL_NODATA,
        dst_transform=dst_transform,
        dst_crs='EPSG:3857',
        dst_nodata=INTERNAL_NODATA,
        resampling=resampling,
        num_threads=2,
    )
    return destination


def build_logical_z10(dem: Path, frame_3857: dict, extent: tuple[float, float, float, float], shape: tuple[int, int]) -> tuple[np.ndarray, object]:
    transform = from_bounds(*extent, shape[1], shape[0])
    destination = np.full(shape, INTERNAL_NODATA, dtype=np.float32)
    with rasterio.open(dem) as source:
        if source.crs is None:
            raise RuntimeError('source DEM has no CRS')
        reproject(
            source=rasterio.band(source, 1),
            destination=destination,
            src_transform=source.transform,
            src_crs=source.crs,
            src_nodata=source.nodata,
            dst_transform=transform,
            dst_crs='EPSG:3857',
            dst_nodata=INTERNAL_NODATA,
            resampling=Resampling.bilinear,
            num_threads=2,
        )
    inside = frame_mask(frame_3857, shape, transform)
    valid = (destination != INTERNAL_NODATA) & np.isfinite(destination) & inside
    destination[~valid] = INTERNAL_NODATA
    return quantize(destination), transform


def downsample_level(source: np.ndarray, src_transform, frame_3857: dict, extent, shape: tuple[int, int]) -> tuple[np.ndarray, object]:
    dst_transform = from_bounds(*extent, shape[1], shape[0])
    destination = warp_to_shape(source, src_transform, shape, dst_transform, Resampling.average)
    inside = frame_mask(frame_3857, shape, dst_transform)
    valid = (destination != INTERNAL_NODATA) & np.isfinite(destination) & inside
    destination[~valid] = INTERNAL_NODATA
    return quantize(destination), dst_transform


def upscale_for_output(source: np.ndarray, src_transform, frame_3857: dict, extent, shape: tuple[int, int]) -> tuple[np.ndarray, np.ndarray, object]:
    dst_transform = from_bounds(*extent, shape[1], shape[0])
    destination = warp_to_shape(source, src_transform, shape, dst_transform, Resampling.bilinear)
    inside = frame_mask(frame_3857, shape, dst_transform)
    valid = (destination != INTERNAL_NODATA) & np.isfinite(destination) & inside
    destination[~valid] = INTERNAL_NODATA
    destination = quantize(destination)
    return destination, valid, dst_transform


def encode_mapbox_rgb(elevation: np.ndarray, valid: np.ndarray) -> np.ndarray:
    encoded = np.zeros(elevation.shape, dtype=np.int64)
    if np.any(valid):
        values = np.rint((elevation[valid].astype(np.float64) - TERRAIN_BASE) / TERRAIN_INTERVAL)
        encoded[valid] = np.clip(values, 0, 16777215).astype(np.int64)
    rgb = np.zeros((*elevation.shape, 3), dtype=np.uint8)
    rgb[:, :, 0] = ((encoded >> 16) & 255).astype(np.uint8)
    rgb[:, :, 1] = ((encoded >> 8) & 255).astype(np.uint8)
    rgb[:, :, 2] = (encoded & 255).astype(np.uint8)
    return rgb


def encode_tile(elevation: np.ndarray, valid: np.ndarray) -> tuple[np.ndarray, str]:
    rgb = encode_mapbox_rgb(elevation, valid)
    if np.all(valid):
        return rgb, 'RGB'
    rgba = np.zeros((*elevation.shape, 4), dtype=np.uint8)
    rgba[:, :, :3] = rgb
    rgba[:, :, 3] = np.where(valid, 255, 0).astype(np.uint8)
    return rgba, 'RGBA'


def png_bytes(array: np.ndarray, mode: str) -> bytes:
    output = io.BytesIO()
    Image.fromarray(array, mode=mode).save(output, format='PNG', compress_level=9, optimize=True)
    return output.getvalue()


def initialize_mbtiles(connection: sqlite3.Connection, polygon: Polygon) -> None:
    connection.executescript(
        '''
        PRAGMA journal_mode=OFF;
        PRAGMA synchronous=OFF;
        PRAGMA temp_store=MEMORY;
        CREATE TABLE metadata (name text, value text);
        CREATE TABLE tiles (zoom_level integer, tile_column integer, tile_row integer, tile_data blob);
        CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row);
        '''
    )
    west, south, east, north = polygon.bounds
    metadata = {
        'name': 'Alan DEM 7.3.1 hierarchical 512',
        'type': 'baselayer',
        'version': '7.3.1',
        'description': 'Copernicus DEM GLO-30, 1 m quantized, hierarchical z10->z9->z8 with z7 sharing z8 information scale, 512px terrain tiles',
        'format': 'png',
        'minzoom': str(MIN_ZOOM),
        'maxzoom': str(MAX_ZOOM),
        'bounds': f'{west:.6f},{south:.6f},{east:.6f},{north:.6f}',
        'center': f'{polygon.centroid.x:.6f},{polygon.centroid.y:.6f},{MIN_ZOOM}',
        'alan_tile_size': str(OUTPUT_TILE_SIZE),
        'alan_lod_model': 'hierarchical-z10-z9-z8-z7-shared',
    }
    connection.executemany('INSERT INTO metadata (name,value) VALUES (?,?)', metadata.items())


def resolution_summary(center_lat: float) -> dict[str, float]:
    base = WEB_MERCATOR_PIXEL_M_256 * math.cos(math.radians(center_lat))
    return {
        '7': round(base / (2 ** 7) * 0.5, 3),
        '8': round(base / (2 ** 8), 3),
        '9': round(base / (2 ** 9), 3),
        '10': round(base / (2 ** 10), 3),
    }


def build_from_dem(dem: Path, output: Path, frame: Path) -> dict:
    frame_geometry, polygon = load_frame(frame)
    frame_3857 = transform_geom('EPSG:4326', 'EPSG:3857', frame_geometry, precision=15)
    west, south, east, north = polygon.bounds

    x_min_7 = lon_to_tile_x(west, MIN_ZOOM)
    x_max_7 = lon_to_tile_x(east, MIN_ZOOM)
    y_min_7 = lat_to_tile_y(north, MIN_ZOOM)
    y_max_7 = lat_to_tile_y(south, MIN_ZOOM)
    extent = tile_rect_mercator_bounds(MIN_ZOOM, x_min_7, y_min_7, x_max_7, y_max_7)
    z7_tiles_x = x_max_7 - x_min_7 + 1
    z7_tiles_y = y_max_7 - y_min_7 + 1

    z10_shape = (
        z7_tiles_y * (2 ** (MAX_ZOOM - MIN_ZOOM)) * LOGICAL_TILE_SIZE,
        z7_tiles_x * (2 ** (MAX_ZOOM - MIN_ZOOM)) * LOGICAL_TILE_SIZE,
    )
    logical: dict[int, tuple[np.ndarray, object]] = {}
    logical[MAX_ZOOM] = build_logical_z10(dem, frame_3857, extent, z10_shape)
    for z in range(MAX_ZOOM - 1, 7, -1):
        source, source_transform = logical[z + 1]
        shape = (source.shape[0] // 2, source.shape[1] // 2)
        logical[z] = downsample_level(source, source_transform, frame_3857, extent, shape)
    logical[MIN_ZOOM] = logical[8]

    output.parent.mkdir(parents=True, exist_ok=True)
    output.unlink(missing_ok=True)
    connection = sqlite3.connect(output)
    initialize_mbtiles(connection, polygon)

    totals = {
        'candidate_tiles': 0,
        'tiles_written': 0,
        'outside_tiles_skipped': 0,
        'partial_tiles_masked': 0,
        'interior_tiles': 0,
        'rgb_tiles': 0,
        'rgba_tiles': 0,
        'transparent_pixels': 0,
        'valid_pixels': 0,
        'encoded_png_bytes': 0,
    }
    per_zoom: dict[str, dict[str, int]] = {}

    for z in range(MIN_ZOOM, MAX_ZOOM + 1):
        logical_array, logical_transform = logical[z]
        factor = 1 if z == MIN_ZOOM else 2
        out_shape = (logical_array.shape[0] * factor, logical_array.shape[1] * factor)
        if factor == 1:
            out_array = logical_array.copy()
            out_transform = logical_transform
            valid_global = (out_array != INTERNAL_NODATA) & np.isfinite(out_array) & frame_mask(frame_3857, out_shape, out_transform)
        else:
            out_array, valid_global, out_transform = upscale_for_output(logical_array, logical_transform, frame_3857, extent, out_shape)
        out_array[~valid_global] = INTERNAL_NODATA

        level_scale = 2 ** (z - MIN_ZOOM)
        x_min = x_min_7 * level_scale
        y_min = y_min_7 * level_scale
        tiles_x = z7_tiles_x * level_scale
        tiles_y = z7_tiles_y * level_scale
        zoom = {
            'tiles_written': 0,
            'outside_tiles_skipped': 0,
            'partial_tiles_masked': 0,
            'rgb_tiles': 0,
            'rgba_tiles': 0,
            'png_bytes': 0,
        }
        for local_y in range(tiles_y):
            for local_x in range(tiles_x):
                totals['candidate_tiles'] += 1
                x = x_min + local_x
                y = y_min + local_y
                row = slice(local_y * OUTPUT_TILE_SIZE, (local_y + 1) * OUTPUT_TILE_SIZE)
                col = slice(local_x * OUTPUT_TILE_SIZE, (local_x + 1) * OUTPUT_TILE_SIZE)
                tile_valid = valid_global[row, col]
                if not np.any(tile_valid):
                    totals['outside_tiles_skipped'] += 1
                    zoom['outside_tiles_skipped'] += 1
                    continue
                tile_elevation = out_array[row, col]
                is_partial = not np.all(tile_valid)
                if is_partial:
                    totals['partial_tiles_masked'] += 1
                    zoom['partial_tiles_masked'] += 1
                else:
                    totals['interior_tiles'] += 1
                image, mode = encode_tile(tile_elevation, tile_valid)
                payload = png_bytes(image, mode)
                totals['encoded_png_bytes'] += len(payload)
                totals['transparent_pixels'] += int(np.count_nonzero(~tile_valid))
                totals['valid_pixels'] += int(np.count_nonzero(tile_valid))
                zoom['png_bytes'] += len(payload)
                if mode == 'RGB':
                    totals['rgb_tiles'] += 1
                    zoom['rgb_tiles'] += 1
                else:
                    totals['rgba_tiles'] += 1
                    zoom['rgba_tiles'] += 1
                tile_row_tms = (1 << z) - 1 - y
                connection.execute(
                    'INSERT INTO tiles (zoom_level,tile_column,tile_row,tile_data) VALUES (?,?,?,?)',
                    (z, x, tile_row_tms, sqlite3.Binary(payload)),
                )
                totals['tiles_written'] += 1
                zoom['tiles_written'] += 1
        connection.commit()
        per_zoom[str(z)] = zoom

    connection.close()
    effective = resolution_summary(CENTER_LAT)
    result = {
        'mode': 'build',
        'source_dem': str(dem),
        'lod_model': 'hierarchical-z10-to-z8-z7-shared-512',
        'hierarchy': {'10': 'source-bilinear-256-logical', '9': 'average-lowpass-from-z10', '8': 'average-lowpass-from-z9', '7': 'same-logical-surface-as-z8'},
        'minzoom': MIN_ZOOM,
        'maxzoom': MAX_ZOOM,
        'tile_size': OUTPUT_TILE_SIZE,
        'logical_tile_size_z8_z10': LOGICAL_TILE_SIZE,
        'height_quantization_m': HEIGHT_QUANTIZATION_M,
        'effective_ground_m_per_information_pixel_at_center': effective,
        'output_interpolation': 'global-bilinear-to-512',
        'downsample_filter': 'area-average-lowpass',
        'png_compression': 'Pillow optimize + zlib level 9',
        **totals,
        'mbtiles_bytes': output.stat().st_size,
        'per_zoom': per_zoom,
    }
    if totals['tiles_written'] == 0 or totals['partial_tiles_masked'] == 0 or totals['rgb_tiles'] == 0 or totals['rgba_tiles'] == 0:
        raise RuntimeError(f'hierarchical DEM build did not produce expected RGB/RGBA tiles: {result}')
    print(json.dumps(result, indent=2))
    return result


def decode_mapbox_rgb(array: np.ndarray) -> np.ndarray:
    code = array[:, :, 0].astype(np.int64) * 65536 + array[:, :, 1].astype(np.int64) * 256 + array[:, :, 2].astype(np.int64)
    return TERRAIN_BASE + code.astype(np.float64) * TERRAIN_INTERVAL


def validate_mbtiles(mbtiles: Path, frame: Path) -> dict:
    frame_geometry, polygon = load_frame(frame)
    frame_3857 = transform_geom('EPSG:4326', 'EPSG:3857', frame_geometry, precision=15)
    connection = sqlite3.connect(mbtiles)
    metadata = dict(connection.execute('SELECT name,value FROM metadata'))
    rows = connection.execute('SELECT zoom_level,tile_column,tile_row,tile_data FROM tiles ORDER BY zoom_level,tile_column,tile_row')

    tiles = partial = rgb_tiles = rgba_tiles = 0
    invalid_outside_tiles = invalid_partial_pixels = transparent_pixels = boundary_inside_pixels = quantization_errors = invalid_sizes = 0
    zooms = set()
    per_zoom: dict[str, int] = {}
    for z, x, tile_row, tile_data in rows:
        z = int(z); x = int(x); tile_row = int(tile_row)
        y = (1 << z) - 1 - tile_row
        zooms.add(z)
        per_zoom[str(z)] = per_zoom.get(str(z), 0) + 1
        tiles += 1
        tile_polygon = box(*tile_bounds(z, x, y))
        if polygon.disjoint(tile_polygon):
            invalid_outside_tiles += 1
            continue
        image = Image.open(io.BytesIO(tile_data))
        if image.width != OUTPUT_TILE_SIZE or image.height != OUTPUT_TILE_SIZE:
            invalid_sizes += 1
        if image.mode == 'RGB':
            rgb_tiles += 1
            array_rgb = np.asarray(image.convert('RGB'))
            alpha = np.full((image.height, image.width), 255, dtype=np.uint8)
        else:
            rgba_tiles += 1
            array_rgba = np.asarray(image.convert('RGBA'))
            array_rgb = array_rgba[:, :, :3]
            alpha = array_rgba[:, :, 3]
        valid = alpha != 0
        elevations = decode_mapbox_rgb(array_rgb)
        if np.any(valid):
            quantization_errors += int(np.count_nonzero(np.abs(elevations[valid] - np.rint(elevations[valid])) > 1e-6))
        if polygon.contains(tile_polygon):
            continue
        partial += 1
        if image.mode == 'RGB':
            invalid_partial_pixels += image.width * image.height
            continue
        tile_extent = tile_rect_mercator_bounds(z, x, y, x, y)
        tile_transform = from_bounds(*tile_extent, image.width, image.height)
        inside = frame_mask(frame_3857, (image.height, image.width), tile_transform)
        outside = ~inside
        transparent_pixels += int(np.count_nonzero(alpha[outside] == 0))
        invalid_partial_pixels += int(np.count_nonzero(alpha[outside] != 0))
        boundary_inside_pixels += int(np.count_nonzero(alpha[inside] != 0))
    connection.close()

    expected_zooms = set(range(MIN_ZOOM, MAX_ZOOM + 1))
    if zooms != expected_zooms:
        raise RuntimeError(f'unexpected zoom set: {sorted(zooms)} != {sorted(expected_zooms)}')
    if metadata.get('alan_tile_size') != str(OUTPUT_TILE_SIZE):
        raise RuntimeError(f'MBTiles tile size metadata mismatch: {metadata.get("alan_tile_size")}')
    if invalid_sizes or invalid_outside_tiles or invalid_partial_pixels or quantization_errors:
        raise RuntimeError(
            f'validation failed: sizes={invalid_sizes}, outside_tiles={invalid_outside_tiles}, outside_pixels={invalid_partial_pixels}, quantization={quantization_errors}'
        )
    if tiles == 0 or partial == 0 or rgb_tiles == 0 or rgba_tiles == 0 or transparent_pixels == 0 or boundary_inside_pixels == 0:
        raise RuntimeError('validation did not observe expected mixed RGB/RGBA boundary structure')

    result = {
        'mode': 'validate',
        'tiles': tiles,
        'zooms': sorted(zooms),
        'per_zoom_tiles': per_zoom,
        'tile_size': OUTPUT_TILE_SIZE,
        'partial_tiles': partial,
        'rgb_tiles': rgb_tiles,
        'rgba_tiles': rgba_tiles,
        'transparent_pixels_checked': transparent_pixels,
        'boundary_inside_pixels_checked': boundary_inside_pixels,
        'height_quantization_m': HEIGHT_QUANTIZATION_M,
        'quantization_errors': quantization_errors,
        'hierarchical_contract': True,
        'effective_ground_m_per_information_pixel_at_center': resolution_summary(CENTER_LAT),
    }
    print(json.dumps(result, indent=2))
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('mbtiles', nargs='?', type=Path)
    parser.add_argument('--frame', type=Path, required=True)
    parser.add_argument('--build-from-dem', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--validate', action='store_true')
    args = parser.parse_args()
    if args.build_from_dem:
        if not args.output:
            parser.error('--output is required with --build-from-dem')
        build_from_dem(args.build_from_dem, args.output, args.frame)
        return
    if not args.mbtiles:
        parser.error('mbtiles path is required for validation')
    if not args.validate:
        parser.error('use --build-from-dem to build or --validate to validate an existing MBTiles')
    validate_mbtiles(args.mbtiles, args.frame)


if __name__ == '__main__':
    main()
