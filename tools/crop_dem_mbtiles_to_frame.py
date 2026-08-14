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


def load_polygon(path: Path) -> Polygon:
    collection = json.loads(path.read_text(encoding='utf-8'))
    geometry = collection['features'][0]['geometry']
    if geometry.get('type') != 'Polygon':
        raise RuntimeError('map frame must be a Polygon')
    ring = geometry['coordinates'][0]
    polygon = Polygon(ring)
    if not polygon.is_valid or polygon.is_empty:
        raise RuntimeError('invalid map-frame polygon')
    return polygon


def tile_bounds(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    n = 2 ** z
    west = x / n * 360.0 - 180.0
    east = (x + 1) / n * 360.0 - 180.0

    def lat_for_row(row: int) -> float:
        value = math.pi * (1.0 - 2.0 * row / n)
        return math.degrees(math.atan(math.sinh(value)))

    north = lat_for_row(y)
    south = lat_for_row(y + 1)
    return west, south, east, north


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
    x = lon
    y = lat
    for index, first in enumerate(coordinates):
        second = coordinates[(index + 1) % len(coordinates)]
        x1, y1 = first
        x2, y2 = second
        crossing = (y1 > y) != (y2 > y)
        denominator = y2 - y1
        if abs(denominator) < 1e-15:
            continue
        x_cross = (x2 - x1) * (y - y1) / denominator + x1
        inside ^= crossing & (x < x_cross)
    return inside


def encode_terrain_rgba(elevation: np.ndarray, valid: np.ndarray) -> np.ndarray:
    encoded = np.zeros(elevation.shape, dtype=np.int64)
    if np.any(valid):
        values = np.rint((elevation[valid].astype(np.float64) - TERRAIN_BASE) / TERRAIN_INTERVAL)
        encoded[valid] = np.clip(values, 0, 16777215).astype(np.int64)

    rgba = np.zeros((*elevation.shape, 4), dtype=np.uint8)
    rgba[:, :, 0] = ((encoded >> 16) & 255).astype(np.uint8)
    rgba[:, :, 1] = ((encoded >> 8) & 255).astype(np.uint8)
    rgba[:, :, 2] = (encoded & 255).astype(np.uint8)
    rgba[:, :, 3] = np.where(valid, 255, 0).astype(np.uint8)
    return rgba


def png_bytes(rgba: np.ndarray) -> bytes:
    output = io.BytesIO()
    Image.fromarray(rgba, mode='RGBA').save(output, format='PNG', compress_level=6)
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
        'name': 'Alan DEM 7.1',
        'type': 'baselayer',
        'version': '1.0',
        'description': 'Copernicus DEM GLO-30, physically cropped to Alan Map 7.1 mapFrame',
        'format': 'png',
        'minzoom': str(minzoom),
        'maxzoom': str(maxzoom),
        'bounds': f'{west:.6f},{south:.6f},{east:.6f},{north:.6f}',
        'center': f'{polygon.centroid.x:.6f},{polygon.centroid.y:.6f},{minzoom}',
    }
    connection.executemany('INSERT INTO metadata (name,value) VALUES (?,?)', metadata.items())


def build_from_dem(dem: Path, output: Path, frame: Path, minzoom: int, maxzoom: int) -> dict:
    polygon = load_polygon(frame)
    coords = list(polygon.exterior.coords)[:-1]
    west, south, east, north = polygon.bounds
    output.parent.mkdir(parents=True, exist_ok=True)
    output.unlink(missing_ok=True)

    connection = sqlite3.connect(output)
    initialize_mbtiles(connection, polygon, minzoom, maxzoom)

    candidates = 0
    outside_skipped = 0
    tiles_written = 0
    partial = 0
    interior = 0
    transparent_pixels = 0
    valid_pixels = 0
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
            zoom_written = 0
            zoom_skipped = 0
            zoom_partial = 0

            for x in range(x_min, x_max + 1):
                for y in range(y_min, y_max + 1):
                    candidates += 1
                    tile_geo_bounds = tile_bounds(z, x, y)
                    tile_polygon = box(*tile_geo_bounds)
                    if polygon.disjoint(tile_polygon):
                        outside_skipped += 1
                        zoom_skipped += 1
                        continue

                    west_m, south_m, east_m, north_m = tile_mercator_bounds(z, x, y)
                    destination = np.full((TILE_SIZE, TILE_SIZE), np.nan, dtype=np.float32)
                    destination_transform = from_bounds(
                        west_m, south_m, east_m, north_m, TILE_SIZE, TILE_SIZE
                    )
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
                        inside = points_in_polygon(lon, lat, coords)
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

                    outside_count = int(np.count_nonzero(~inside))
                    transparent_pixels += outside_count
                    valid_pixels += int(np.count_nonzero(valid))
                    rgba = encode_terrain_rgba(destination, valid)
                    tile_row_tms = (1 << z) - 1 - y
                    connection.execute(
                        'INSERT INTO tiles (zoom_level,tile_column,tile_row,tile_data) VALUES (?,?,?,?)',
                        (z, x, tile_row_tms, sqlite3.Binary(png_bytes(rgba))),
                    )
                    tiles_written += 1
                    zoom_written += 1

            connection.commit()
            per_zoom[str(z)] = {
                'tiles_written': zoom_written,
                'outside_tiles_skipped': zoom_skipped,
                'partial_tiles_masked': zoom_partial,
            }

    connection.close()
    result = {
        'mode': 'build',
        'source_dem': str(dem),
        'minzoom': minzoom,
        'maxzoom': maxzoom,
        'candidate_tiles': candidates,
        'tiles_written': tiles_written,
        'outside_tiles_skipped': outside_skipped,
        'partial_tiles_masked': partial,
        'interior_tiles': interior,
        'outside_pixels_transparent': transparent_pixels,
        'valid_pixels': valid_pixels,
        'bytes_after': output.stat().st_size,
        'per_zoom': per_zoom,
    }
    if tiles_written == 0 or partial == 0 or outside_skipped == 0 or transparent_pixels == 0:
        raise RuntimeError(f'physical polygon crop did not produce the expected tile set: {result}')
    print(json.dumps(result, indent=2))
    return result


def validate_mbtiles(mbtiles: Path, frame: Path) -> dict:
    polygon = load_polygon(frame)
    coords = list(polygon.exterior.coords)[:-1]
    connection = sqlite3.connect(mbtiles)
    cursor = connection.execute(
        'SELECT zoom_level, tile_column, tile_row, tile_data FROM tiles ORDER BY zoom_level, tile_column, tile_row'
    )

    tiles = 0
    partial = 0
    transparent_pixels = 0
    invalid_outside_tiles = 0
    invalid_partial_pixels = 0
    boundary_inside_pixels = 0

    for z, x, tile_row, tile_data in cursor:
        tiles += 1
        y = (1 << z) - 1 - tile_row
        west, south, east, north = tile_bounds(z, x, y)
        tile_polygon = box(west, south, east, north)
        if polygon.disjoint(tile_polygon):
            invalid_outside_tiles += 1
            continue
        if polygon.contains(tile_polygon):
            continue

        image = Image.open(io.BytesIO(tile_data)).convert('RGBA')
        array = np.asarray(image)
        lon, lat = pixel_lon_lat(z, x, y, image.width, image.height)
        inside = points_in_polygon(lon, lat, coords)
        outside = ~inside
        alpha = array[:, :, 3]
        transparent_pixels += int(np.count_nonzero(outside))
        invalid_partial_pixels += int(np.count_nonzero(alpha[outside] != 0))
        boundary_inside_pixels += int(np.count_nonzero(alpha[inside] != 0))
        partial += 1

    connection.close()
    if invalid_outside_tiles:
        raise RuntimeError(f'{invalid_outside_tiles} wholly outside DEM tiles remain')
    if invalid_partial_pixels:
        raise RuntimeError(f'{invalid_partial_pixels} outside-frame pixels are still opaque')
    if tiles == 0 or partial == 0 or transparent_pixels == 0 or boundary_inside_pixels == 0:
        raise RuntimeError('polygon crop validation did not observe a valid masked boundary')

    result = {
        'mode': 'validate',
        'tiles': tiles,
        'partial_tiles': partial,
        'transparent_pixels_checked': transparent_pixels,
        'boundary_inside_pixels_checked': boundary_inside_pixels,
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
        build_from_dem(args.build_from_dem, args.output, args.frame, args.minzoom, args.maxzoom)
        return
    if not args.mbtiles:
        parser.error('mbtiles path is required for validation')
    if not args.validate:
        parser.error('use --build-from-dem to build or --validate to validate an existing MBTiles')
    validate_mbtiles(args.mbtiles, args.frame)


if __name__ == '__main__':
    main()
