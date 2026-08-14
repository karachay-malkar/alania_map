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
from shapely.geometry import Polygon, box


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


def process(mbtiles: Path, frame: Path, validate_only: bool = False) -> dict:
    polygon = load_polygon(frame)
    coords = list(polygon.exterior.coords)[:-1]
    connection = sqlite3.connect(mbtiles)
    connection.execute('PRAGMA journal_mode=DELETE')
    rows = connection.execute(
        'SELECT zoom_level, tile_column, tile_row, tile_data FROM tiles ORDER BY zoom_level, tile_column, tile_row'
    ).fetchall()

    removed = 0
    partial = 0
    unchanged = 0
    transparent_pixels = 0
    invalid_outside_tiles = 0
    invalid_partial_pixels = 0

    for z, x, tile_row, tile_data in rows:
        y = (1 << z) - 1 - tile_row
        west, south, east, north = tile_bounds(z, x, y)
        tile_polygon = box(west, south, east, north)

        if polygon.disjoint(tile_polygon):
            if validate_only:
                invalid_outside_tiles += 1
            else:
                connection.execute(
                    'DELETE FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?',
                    (z, x, tile_row),
                )
                removed += 1
            continue

        if polygon.contains(tile_polygon):
            unchanged += 1
            continue

        image = Image.open(io.BytesIO(tile_data)).convert('RGBA')
        array = np.array(image, copy=True)
        lon, lat = pixel_lon_lat(z, x, y, image.width, image.height)
        inside = points_in_polygon(lon, lat, coords)
        outside = ~inside
        outside_count = int(np.count_nonzero(outside))
        transparent_pixels += outside_count

        if validate_only:
            alpha = array[:, :, 3]
            invalid_partial_pixels += int(np.count_nonzero(alpha[outside] != 0))
            partial += 1
            continue

        if not np.any(inside):
            connection.execute(
                'DELETE FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?',
                (z, x, tile_row),
            )
            removed += 1
            continue

        array[outside, 0:3] = 0
        array[outside, 3] = 0
        output = io.BytesIO()
        Image.fromarray(array, mode='RGBA').save(output, format='PNG', optimize=True, compress_level=9)
        connection.execute(
            'UPDATE tiles SET tile_data=? WHERE zoom_level=? AND tile_column=? AND tile_row=?',
            (sqlite3.Binary(output.getvalue()), z, x, tile_row),
        )
        partial += 1

    if validate_only:
        connection.close()
        if invalid_outside_tiles:
            raise RuntimeError(f'{invalid_outside_tiles} wholly outside DEM tiles remain')
        if invalid_partial_pixels:
            raise RuntimeError(f'{invalid_partial_pixels} outside-frame pixels are still opaque')
        if partial == 0 or transparent_pixels == 0:
            raise RuntimeError('no masked boundary pixels were found; polygon crop was not materialized')
        result = {
            'mode': 'validate',
            'tiles': len(rows),
            'partial_tiles': partial,
            'transparent_pixels_checked': transparent_pixels,
        }
        print(json.dumps(result, indent=2))
        return result

    connection.commit()
    connection.execute('VACUUM')
    connection.close()

    result = {
        'mode': 'crop',
        'tiles_before': len(rows),
        'tiles_removed': removed,
        'partial_tiles_masked': partial,
        'interior_tiles_unchanged': unchanged,
        'outside_pixels_transparent': transparent_pixels,
        'bytes_after': mbtiles.stat().st_size,
    }
    print(json.dumps(result, indent=2))
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('mbtiles', type=Path)
    parser.add_argument('--frame', type=Path, required=True)
    parser.add_argument('--validate', action='store_true')
    args = parser.parse_args()
    process(args.mbtiles, args.frame, validate_only=args.validate)


if __name__ == '__main__':
    main()
