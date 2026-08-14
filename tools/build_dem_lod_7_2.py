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
from rasterio.transform import from_bounds
from rasterio.warp import Resampling, reproject
from shapely.geometry import Polygon, box

WEB_MERCATOR_HALF_WORLD = 20037508.342789244
TILE_SIZE = 256
TERRAIN_BASE = -10000.0
TERRAIN_INTERVAL = 0.1
HEIGHT_QUANTIZATION_M = 1.0


def load_polygon(path: Path) -> Polygon:
    collection = json.loads(path.read_text(encoding='utf-8'))
    geometry = collection['features'][0]['geometry']
    if geometry.get('type') != 'Polygon':
        raise RuntimeError('map frame must be a Polygon')
    polygon = Polygon(geometry['coordinates'][0])
    if not polygon.is_valid or polygon.is_empty:
        raise RuntimeError('invalid map-frame polygon')
    return polygon


def tile_bounds(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    n = 2 ** z
    west = x / n * 360.0 - 180.0
    east = (x + 1) / n * 360.0 - 180.0

    def latitude(row: int) -> float:
        value = math.pi * (1.0 - 2.0 * row / n)
        return math.degrees(math.atan(math.sinh(value)))

    return west, latitude(y + 1), east, latitude(y)


def tile_mercator_bounds(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    n = 2 ** z
    span = (WEB_MERCATOR_HALF_WORLD * 2.0) / n
    west = -WEB_MERCATOR_HALF_WORLD + x * span
    east = west + span
    north = WEB_MERCATOR_HALF_WORLD - y * span
    south = north - span
    return west, south, east, north


def lon_to_tile_x(lon: float, z: int) -> int:
    n = 2 ** z
    return max(0, min(n - 1, int(math.floor((lon + 180.0) / 360.0 * n))))


def lat_to_tile_y(lat: float, z: int) -> int:
    n = 2 ** z
    clipped = max(-85.05112878, min(85.05112878, lat))
    radians = math.radians(clipped)
    value = (1.0 - math.asinh(math.tan(radians)) / math.pi) / 2.0 * n
    return max(0, min(n - 1, int(math.floor(value))))


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


def quantize_elevation(elevation: np.ndarray, valid: np.ndarray) -> np.ndarray:
    quantized = np.zeros(elevation.shape, dtype=np.float64)
    if np.any(valid):
        quantized[valid] = np.rint(elevation[valid].astype(np.float64) / HEIGHT_QUANTIZATION_M) * HEIGHT_QUANTIZATION_M
    return quantized


def encode_mapbox_rgb(elevation: np.ndarray, valid: np.ndarray) -> np.ndarray:
    quantized = quantize_elevation(elevation, valid)
    encoded = np.zeros(elevation.shape, dtype=np.int64)
    if np.any(valid):
        values = np.rint((quantized[valid] - TERRAIN_BASE) / TERRAIN_INTERVAL)
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


def initialize_mbtiles(connection: sqlite3.Connection, polygon: Polygon, minzoom: int, maxzoom: int) -> None:
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
        'name': 'Alan DEM 7.2',
        'type': 'baselayer',
        'version': '1.0',
        'description': 'Copernicus DEM GLO-30, 1 m quantized, physically cropped, multi-zoom LOD pyramid for Alan Map 7.2',
        'format': 'png',
        'minzoom': str(minzoom),
        'maxzoom': str(maxzoom),
        'bounds': f'{west:.6f},{south:.6f},{east:.6f},{north:.6f}',
        'center': f'{polygon.centroid.x:.6f},{polygon.centroid.y:.6f},{minzoom}',
    }
    connection.executemany('INSERT INTO metadata (name,value) VALUES (?,?)', metadata.items())


def build_from_dem(dem: Path, output: Path, frame: Path, minzoom: int, maxzoom: int) -> dict:
    polygon = load_polygon(frame)
    coordinates = list(polygon.exterior.coords)[:-1]
    west, south, east, north = polygon.bounds
    output.parent.mkdir(parents=True, exist_ok=True)
    output.unlink(missing_ok=True)

    connection = sqlite3.connect(output)
    initialize_mbtiles(connection, polygon, minzoom, maxzoom)

    candidates = outside_skipped = tiles_written = partial = interior = 0
    transparent_pixels = valid_pixels = rgb_tiles = rgba_tiles = 0
    encoded_bytes = 0
    per_zoom: dict[str, dict[str, int]] = {}

    with rasterio.open(dem) as source:
        if source.crs is None:
            raise RuntimeError('source DEM has no CRS')
        src_nodata = source.nodata

        for z in range(minzoom, maxzoom + 1):
            x_min = lon_to_tile_x(west, z)
            x_max = lon_to_tile_x(east, z)
            y_min = lat_to_tile_y(north, z)
            y_max = lat_to_tile_y(south, z)
            zoom_written = zoom_skipped = zoom_partial = zoom_rgb = zoom_rgba = 0
            zoom_bytes = 0

            for x in range(x_min, x_max + 1):
                for y in range(y_min, y_max + 1):
                    candidates += 1
                    geo_bounds = tile_bounds(z, x, y)
                    tile_polygon = box(*geo_bounds)
                    if polygon.disjoint(tile_polygon):
                        outside_skipped += 1
                        zoom_skipped += 1
                        continue

                    west_m, south_m, east_m, north_m = tile_mercator_bounds(z, x, y)
                    destination = np.full((TILE_SIZE, TILE_SIZE), np.nan, dtype=np.float32)
                    destination_transform = from_bounds(west_m, south_m, east_m, north_m, TILE_SIZE, TILE_SIZE)
                    reproject(
                        source=rasterio.band(source, 1),
                        destination=destination,
                        src_transform=source.transform,
                        src_crs=source.crs,
                        src_nodata=src_nodata,
                        dst_transform=destination_transform,
                        dst_crs='EPSG:3857',
                        dst_nodata=np.nan,
                        resampling=Resampling.bilinear,
                        num_threads=2,
                    )

                    if polygon.contains(tile_polygon):
                        inside = np.ones(destination.shape, dtype=bool)
                        interior += 1
                    else:
                        lon, lat = pixel_lon_lat(z, x, y, TILE_SIZE, TILE_SIZE)
                        inside = points_in_polygon(lon, lat, coordinates)
                        partial += 1
                        zoom_partial += 1

                    source_valid = np.isfinite(destination)
                    if src_nodata is not None and np.isfinite(src_nodata):
                        source_valid &= ~np.isclose(destination, float(src_nodata), rtol=0.0, atol=0.01)
                    valid = source_valid & inside
                    if not np.any(valid):
                        outside_skipped += 1
                        zoom_skipped += 1
                        continue

                    transparent_pixels += int(np.count_nonzero(~valid))
                    valid_pixels += int(np.count_nonzero(valid))
                    image, mode = encode_tile(destination, valid)
                    payload = png_bytes(image, mode)
                    encoded_bytes += len(payload)
                    zoom_bytes += len(payload)
                    if mode == 'RGB':
                        rgb_tiles += 1
                        zoom_rgb += 1
                    else:
                        rgba_tiles += 1
                        zoom_rgba += 1

                    tile_row_tms = (1 << z) - 1 - y
                    connection.execute(
                        'INSERT INTO tiles (zoom_level,tile_column,tile_row,tile_data) VALUES (?,?,?,?)',
                        (z, x, tile_row_tms, sqlite3.Binary(payload)),
                    )
                    tiles_written += 1
                    zoom_written += 1

            connection.commit()
            per_zoom[str(z)] = {
                'tiles_written':zoom_written,
                'outside_tiles_skipped':zoom_skipped,
                'partial_tiles_masked':zoom_partial,
                'rgb_tiles':zoom_rgb,
                'rgba_tiles':zoom_rgba,
                'png_bytes':zoom_bytes,
            }

    connection.close()
    result = {
        'mode':'build',
        'source_dem':str(dem),
        'lod_model':f'single-pyramid-z{minzoom}-z{maxzoom}',
        'minzoom':minzoom,
        'maxzoom':maxzoom,
        'tile_size':TILE_SIZE,
        'height_quantization_m':HEIGHT_QUANTIZATION_M,
        'png_compression':'Pillow optimize + zlib level 9',
        'candidate_tiles':candidates,
        'tiles_written':tiles_written,
        'outside_tiles_skipped':outside_skipped,
        'partial_tiles_masked':partial,
        'interior_tiles':interior,
        'rgb_tiles':rgb_tiles,
        'rgba_tiles':rgba_tiles,
        'transparent_pixels':transparent_pixels,
        'valid_pixels':valid_pixels,
        'encoded_png_bytes':encoded_bytes,
        'mbtiles_bytes':output.stat().st_size,
        'per_zoom':per_zoom,
    }
    if tiles_written == 0 or partial == 0 or outside_skipped == 0 or rgba_tiles == 0 or rgb_tiles == 0:
        raise RuntimeError(f'7.2 DEM build did not produce the expected mixed RGB/RGBA LOD tile set: {result}')
    print(json.dumps(result, indent=2))
    return result


def decode_mapbox_rgb(array: np.ndarray) -> np.ndarray:
    code = array[:, :, 0].astype(np.int64) * 65536 + array[:, :, 1].astype(np.int64) * 256 + array[:, :, 2].astype(np.int64)
    return TERRAIN_BASE + code.astype(np.float64) * TERRAIN_INTERVAL


def validate_mbtiles(mbtiles: Path, frame: Path) -> dict:
    polygon = load_polygon(frame)
    coordinates = list(polygon.exterior.coords)[:-1]
    connection = sqlite3.connect(mbtiles)
    cursor = connection.execute('SELECT zoom_level,tile_column,tile_row,tile_data FROM tiles ORDER BY zoom_level,tile_column,tile_row')

    tiles = partial = rgb_tiles = rgba_tiles = 0
    invalid_outside_tiles = invalid_partial_pixels = 0
    transparent_pixels = boundary_inside_pixels = quantization_errors = 0

    for z, x, tile_row, tile_data in cursor:
        tiles += 1
        y = (1 << z) - 1 - tile_row
        west, south, east, north = tile_bounds(z, x, y)
        tile_polygon = box(west, south, east, north)
        if polygon.disjoint(tile_polygon):
            invalid_outside_tiles += 1
            continue

        image = Image.open(io.BytesIO(tile_data))
        mode = image.mode
        if mode == 'RGB':
            rgb_tiles += 1
            array_rgb = np.asarray(image.convert('RGB'))
            alpha = np.full((image.height,image.width),255,dtype=np.uint8)
        else:
            rgba_tiles += 1
            array_rgba = np.asarray(image.convert('RGBA'))
            array_rgb = array_rgba[:,:,:3]
            alpha = array_rgba[:,:,3]

        valid = alpha != 0
        elevations = decode_mapbox_rgb(array_rgb)
        if np.any(valid):
            quantization_errors += int(np.count_nonzero(np.abs(elevations[valid] - np.rint(elevations[valid])) > 1e-6))

        if polygon.contains(tile_polygon):
            continue
        partial += 1
        if mode == 'RGB':
            invalid_partial_pixels += image.width * image.height
            continue
        lon, lat = pixel_lon_lat(z, x, y, image.width, image.height)
        inside = points_in_polygon(lon, lat, coordinates)
        outside = ~inside
        transparent_pixels += int(np.count_nonzero(alpha[outside] == 0))
        invalid_partial_pixels += int(np.count_nonzero(alpha[outside] != 0))
        boundary_inside_pixels += int(np.count_nonzero(alpha[inside] != 0))

    connection.close()
    if invalid_outside_tiles:
        raise RuntimeError(f'{invalid_outside_tiles} wholly outside DEM tiles remain')
    if invalid_partial_pixels:
        raise RuntimeError(f'{invalid_partial_pixels} outside-frame pixels are still opaque')
    if quantization_errors:
        raise RuntimeError(f'{quantization_errors} valid DEM pixels are not quantized to 1 m')
    if tiles == 0 or partial == 0 or rgb_tiles == 0 or rgba_tiles == 0 or transparent_pixels == 0 or boundary_inside_pixels == 0:
        raise RuntimeError('7.2 DEM validation did not observe the expected RGB/RGBA LOD structure')

    result = {
        'mode':'validate',
        'tiles':tiles,
        'partial_tiles':partial,
        'rgb_tiles':rgb_tiles,
        'rgba_tiles':rgba_tiles,
        'transparent_pixels_checked':transparent_pixels,
        'boundary_inside_pixels_checked':boundary_inside_pixels,
        'height_quantization_m':HEIGHT_QUANTIZATION_M,
        'quantization_errors':quantization_errors,
    }
    print(json.dumps(result, indent=2))
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('mbtiles', nargs='?', type=Path)
    parser.add_argument('--frame', type=Path, required=True)
    parser.add_argument('--build-from-dem', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--minzoom', type=int, default=7)
    parser.add_argument('--maxzoom', type=int, default=12)
    parser.add_argument('--validate', action='store_true')
    args = parser.parse_args()

    if args.build_from_dem:
        if not args.output:
            parser.error('--output is required with --build-from-dem')
        build_from_dem(args.build_from_dem,args.output,args.frame,args.minzoom,args.maxzoom)
        return
    if not args.mbtiles:
        parser.error('mbtiles path is required for validation')
    if not args.validate:
        parser.error('use --build-from-dem to build or --validate to validate an existing MBTiles')
    validate_mbtiles(args.mbtiles,args.frame)


if __name__ == '__main__':
    main()
