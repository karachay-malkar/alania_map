#!/usr/bin/env python3
from __future__ import annotations

import argparse
import io
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt
from pmtiles.reader import MmapSource, Reader, all_tiles
from pmtiles.tile import zxy_to_tileid
from pmtiles.writer import write

WEB_MERCATOR_PIXEL_M = 156543.03392804097
TILE_SIZE = 256


def load_map_data(parts: list[Path]) -> dict:
    source = ''.join(path.read_text(encoding='utf-8') for path in parts)
    marker = 'window.ALAN_MAP_DATA = '
    start = source.find(marker)
    if start < 0:
        raise RuntimeError('ALAN_MAP_DATA marker was not found')
    payload = source[start + len(marker):].strip()
    if payload.endswith(';'):
        payload = payload[:-1]
    return json.loads(payload)


def png_array(payload: bytes) -> np.ndarray:
    return np.asarray(Image.open(io.BytesIO(payload)).convert('RGBA'), dtype=np.uint8)


def png_bytes(rgba: np.ndarray) -> bytes:
    output = io.BytesIO()
    if np.all(rgba[:, :, 3] == 255):
        Image.fromarray(rgba[:, :, :3], mode='RGB').save(output, format='PNG', compress_level=6)
    else:
        Image.fromarray(rgba, mode='RGBA').save(output, format='PNG', compress_level=6)
    return output.getvalue()


def read_archive(path: Path) -> tuple[dict, dict, dict[tuple[int, int, int], bytes]]:
    with path.open('rb') as handle:
        source = MmapSource(handle)
        reader = Reader(source)
        header = dict(reader.header())
        metadata = dict(reader.metadata())
        tiles = {(int(z), int(x), int(y)): bytes(payload) for (z, x, y), payload in all_tiles(source)}
    if not tiles:
        raise RuntimeError('DEM PMTiles archive contains no tiles')
    return header, metadata, tiles


def boundary_tiles(tiles: dict[tuple[int, int, int], bytes], z: int) -> set[tuple[int, int]]:
    output: set[tuple[int, int]] = set()
    for (tz, x, y), payload in tiles.items():
        if tz != z:
            continue
        alpha = png_array(payload)[:, :, 3]
        if np.any(alpha == 0):
            output.add((x, y))
    return output


def neighbor_candidates(boundary: set[tuple[int, int]]) -> set[tuple[int, int]]:
    output: set[tuple[int, int]] = set()
    for x, y in boundary:
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                output.add((x + dx, y + dy))
    return output


def local_mosaic(
    tiles: dict[tuple[int, int, int], bytes], z: int, target_x: int, target_y: int
) -> tuple[np.ndarray, np.ndarray]:
    rgba = np.zeros((TILE_SIZE * 3, TILE_SIZE * 3, 4), dtype=np.uint8)
    valid = np.zeros((TILE_SIZE * 3, TILE_SIZE * 3), dtype=bool)
    for local_y, y in enumerate(range(target_y - 1, target_y + 2)):
        for local_x, x in enumerate(range(target_x - 1, target_x + 2)):
            payload = tiles.get((z, x, y))
            if payload is None:
                continue
            image = png_array(payload)
            oy = local_y * TILE_SIZE
            ox = local_x * TILE_SIZE
            rgba[oy:oy + TILE_SIZE, ox:ox + TILE_SIZE] = image
            valid[oy:oy + TILE_SIZE, ox:ox + TILE_SIZE] = image[:, :, 3] > 0
    return rgba, valid


def patch_target_tile(
    tiles: dict[tuple[int, int, int], bytes], z: int, x: int, y: int, collar_px: int
) -> tuple[bytes | None, int]:
    mosaic, original_valid = local_mosaic(tiles, z, x, y)
    if not np.any(original_valid):
        return None, 0

    distances, nearest = distance_transform_edt(~original_valid, return_distances=True, return_indices=True)
    center_slice = (slice(TILE_SIZE, TILE_SIZE * 2), slice(TILE_SIZE, TILE_SIZE * 2))
    center_valid = original_valid[center_slice]
    center_distances = distances[center_slice]
    fill_center = (~center_valid) & (center_distances <= collar_px)
    fill_count = int(np.count_nonzero(fill_center))
    if fill_count == 0:
        return None, 0

    fy, fx = np.nonzero(fill_center)
    global_y = fy + TILE_SIZE
    global_x = fx + TILE_SIZE
    nearest_y = nearest[0, global_y, global_x]
    nearest_x = nearest[1, global_y, global_x]

    center = mosaic[center_slice].copy()
    center[fy, fx, :3] = mosaic[nearest_y, nearest_x, :3]
    center[fy, fx, 3] = 255
    return png_bytes(center), fill_count


def patch_zoom(
    tiles: dict[tuple[int, int, int], bytes], z: int, collar_m: float, center_lat: float
) -> dict:
    boundary = boundary_tiles(tiles, z)
    if not boundary:
        return {
            'zoom': z,
            'boundary_tiles': 0,
            'candidate_tiles': 0,
            'changed_tiles': 0,
            'new_tiles': 0,
            'collar_pixels': 0,
        }

    ground_m_per_pixel = WEB_MERCATOR_PIXEL_M * math.cos(math.radians(center_lat)) / (2 ** z)
    collar_px = max(1, int(math.ceil(collar_m / max(0.01, ground_m_per_pixel))))
    if collar_px >= TILE_SIZE:
        raise RuntimeError(f'z{z}: collar exceeds one tile ({collar_px}px); enlarge local neighborhood')

    candidates = neighbor_candidates(boundary)
    updates: dict[tuple[int, int, int], bytes] = {}
    changed_tiles = 0
    new_tiles = 0
    collar_pixels = 0

    for x, y in sorted(candidates):
        payload, filled = patch_target_tile(tiles, z, x, y, collar_px)
        if payload is None:
            continue
        key = (z, x, y)
        existing = tiles.get(key)
        if existing == payload:
            continue
        updates[key] = payload
        collar_pixels += filled
        if existing is None:
            new_tiles += 1
        else:
            changed_tiles += 1

    tiles.update(updates)
    return {
        'zoom': z,
        'boundary_tiles': len(boundary),
        'candidate_tiles': len(candidates),
        'changed_tiles': changed_tiles,
        'new_tiles': new_tiles,
        'collar_pixels': collar_pixels,
        'collar_px': collar_px,
        'ground_m_per_pixel': round(ground_m_per_pixel, 3),
    }


def expand_bounds(header: dict, metadata: dict, collar_m: float, center_lat: float) -> None:
    dlat = collar_m / 110574.0
    dlon = collar_m / max(1.0, 111320.0 * math.cos(math.radians(center_lat)))
    west = header['min_lon_e7'] / 1e7 - dlon
    south = header['min_lat_e7'] / 1e7 - dlat
    east = header['max_lon_e7'] / 1e7 + dlon
    north = header['max_lat_e7'] / 1e7 + dlat
    header['min_lon_e7'] = int(round(west * 1e7))
    header['min_lat_e7'] = int(round(south * 1e7))
    header['max_lon_e7'] = int(round(east * 1e7))
    header['max_lat_e7'] = int(round(north * 1e7))
    if 'bounds' in metadata:
        metadata['bounds'] = f'{west:.6f},{south:.6f},{east:.6f},{north:.6f}'
    metadata['alan_edge_collar_m'] = int(round(collar_m))
    metadata['alan_edge_collar_mode'] = 'nearest-valid-height'


def write_archive(path: Path, header: dict, metadata: dict, tiles: dict[tuple[int, int, int], bytes]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.unlink(missing_ok=True)
    ordered = sorted(tiles.items(), key=lambda item: zxy_to_tileid(*item[0]))
    with write(path) as writer:
        for (z, x, y), payload in ordered:
            writer.write_tile(zxy_to_tileid(z, x, y), payload)
        writer.finalize(header, metadata)


def patch(
    input_pmtiles: Path,
    output_pmtiles: Path,
    data_parts: list[Path],
    collar_m: float,
    report_path: Path | None,
) -> dict:
    data = load_map_data(data_parts)
    center_lat = float(data['center'][1])
    dem = data['regionalDem']
    minzoom = int(dem['minzoom'])
    maxzoom = int(dem['maxzoom'])

    before = input_pmtiles.stat().st_size
    header, metadata, tiles = read_archive(input_pmtiles)
    original_tile_count = len(tiles)
    per_zoom = [patch_zoom(tiles, z, collar_m, center_lat) for z in range(minzoom, maxzoom + 1)]
    expand_bounds(header, metadata, collar_m, center_lat)
    write_archive(output_pmtiles, header, metadata, tiles)
    after = output_pmtiles.stat().st_size

    report = {
        'version': '7.2.2-r5',
        'mode': 'hidden-dem-edge-collar',
        'collar_m': int(round(collar_m)),
        'fill_method': 'nearest-valid-terrain-rgb',
        'alpha_inside_collar': 255,
        'terrain_base_drop_removed_near_map_frame': True,
        'pmtiles_bytes_before': before,
        'pmtiles_bytes_after': after,
        'total_tiles_before': original_tile_count,
        'total_tiles_after': len(tiles),
        'changed_tiles': sum(item['changed_tiles'] for item in per_zoom),
        'new_tiles': sum(item['new_tiles'] for item in per_zoom),
        'collar_pixels': sum(item['collar_pixels'] for item in per_zoom),
        'per_zoom': per_zoom,
    }
    if report['changed_tiles'] <= 0 or report['new_tiles'] <= 0 or report['collar_pixels'] <= 0:
        raise RuntimeError(f'DEM collar was not materialized: {report}')
    if after > before + 24 * 1024 * 1024:
        raise RuntimeError(f'DEM collar is unexpectedly heavy: {before} -> {after}')
    if report_path:
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('input_pmtiles', type=Path)
    parser.add_argument('output_pmtiles', type=Path)
    parser.add_argument('--data-part', action='append', type=Path, required=True)
    parser.add_argument('--collar-m', type=float, default=4500.0)
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    patch(args.input_pmtiles, args.output_pmtiles, args.data_part, args.collar_m, args.report)


if __name__ == '__main__':
    main()
