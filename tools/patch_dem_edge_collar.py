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
TERRAIN_RGB_BASE_M = -10000.0
TERRAIN_RGB_STEP_M = 0.1
RELEASE = '7.2.3-r1'
DEFAULT_CAP_SOFTNESS_M = 120.0


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


def decode_terrain_rgb(rgb: np.ndarray) -> np.ndarray:
    values = (
        rgb[..., 0].astype(np.uint32) * 256 * 256
        + rgb[..., 1].astype(np.uint32) * 256
        + rgb[..., 2].astype(np.uint32)
    )
    return TERRAIN_RGB_BASE_M + values.astype(np.float64) * TERRAIN_RGB_STEP_M


def encode_terrain_rgb(heights_m: np.ndarray) -> np.ndarray:
    maximum = TERRAIN_RGB_BASE_M + ((256 ** 3) - 1) * TERRAIN_RGB_STEP_M
    clipped = np.clip(np.asarray(heights_m, dtype=np.float64), TERRAIN_RGB_BASE_M, maximum)
    values = np.rint((clipped - TERRAIN_RGB_BASE_M) / TERRAIN_RGB_STEP_M).astype(np.uint32)
    return np.stack(
        [
            (values >> 16) & 255,
            (values >> 8) & 255,
            values & 255,
        ],
        axis=-1,
    ).astype(np.uint8)


def smoothstep(values: np.ndarray) -> np.ndarray:
    amount = np.clip(np.asarray(values, dtype=np.float64), 0.0, 1.0)
    return amount * amount * (3.0 - 2.0 * amount)


def outside_height_profile(
    nearest_heights_m: np.ndarray,
    distances_m: np.ndarray,
    safe_max_elevation_m: float,
    cap_softness_m: float,
    outer_skirt_m: float,
    collar_m: float,
    technical_base_m: float,
) -> np.ndarray:
    safe_heights = smooth_cap_heights(
        nearest_heights_m,
        safe_max_elevation_m,
        cap_softness_m,
    )
    denominator = max(1.0, collar_m - outer_skirt_m)
    descent = smoothstep((distances_m - outer_skirt_m) / denominator)
    return safe_heights + (technical_base_m - safe_heights) * descent


def smooth_cap_heights(
    original_heights_m: np.ndarray,
    safe_max_elevation_m: float,
    cap_softness_m: float,
) -> np.ndarray:
    softness = max(TERRAIN_RGB_STEP_M, float(cap_softness_m))
    heights = np.asarray(original_heights_m, dtype=np.float64)
    return safe_max_elevation_m - softness * np.logaddexp(
        0.0,
        (safe_max_elevation_m - heights) / softness,
    )


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
    present = {(x, y) for tz, x, y in tiles if tz == z}
    output: set[tuple[int, int]] = set()
    for (tz, x, y), payload in tiles.items():
        if tz != z:
            continue
        alpha = png_array(payload)[:, :, 3]
        missing_neighbor = any(
            (x + dx, y + dy) not in present
            for dy in (-1, 0, 1)
            for dx in (-1, 0, 1)
            if dx or dy
        )
        if np.any(alpha == 0) or missing_neighbor:
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
    tiles: dict[tuple[int, int, int], bytes],
    z: int,
    x: int,
    y: int,
    collar_px: int,
    inner_taper_px: int,
    ground_m_per_pixel: float,
    safe_max_elevation_m: float,
    cap_softness_m: float,
    outer_skirt_m: float,
    collar_m: float,
    technical_base_m: float,
) -> tuple[bytes | None, dict]:
    mosaic, original_valid = local_mosaic(tiles, z, x, y)
    if not np.any(original_valid):
        return None, {}

    outside_distances, nearest = distance_transform_edt(
        ~original_valid, return_distances=True, return_indices=True
    )
    inside_distances = distance_transform_edt(original_valid)
    center_slice = (slice(TILE_SIZE, TILE_SIZE * 2), slice(TILE_SIZE, TILE_SIZE * 2))
    center_valid = original_valid[center_slice]
    center = mosaic[center_slice].copy()
    stats = {
        'collar_pixels': 0,
        'inside_taper_pixels': 0,
        'inside_capped_pixels': 0,
        'outer_descent_pixels': 0,
        'minimum_written_height_m': None,
        'maximum_written_height_m': None,
    }
    written_heights: list[np.ndarray] = []

    center_inside_distances = inside_distances[center_slice]
    taper_center = center_valid & (center_inside_distances <= inner_taper_px)
    if np.any(taper_center):
        ty, tx = np.nonzero(taper_center)
        original_heights = decode_terrain_rgb(center[ty, tx, :3])
        tapered_heights = smooth_cap_heights(
            original_heights,
            safe_max_elevation_m,
            cap_softness_m,
        )
        changed = np.abs(tapered_heights - original_heights) >= TERRAIN_RGB_STEP_M * 0.5
        if np.any(changed):
            changed_y = ty[changed]
            changed_x = tx[changed]
            changed_heights = tapered_heights[changed]
            center[changed_y, changed_x, :3] = encode_terrain_rgb(changed_heights)
            stats['inside_taper_pixels'] = int(np.count_nonzero(changed))
            stats['inside_capped_pixels'] = int(
                np.count_nonzero(original_heights[changed] > safe_max_elevation_m)
            )
            written_heights.append(changed_heights)

    center_outside_distances = outside_distances[center_slice]
    fill_center = (~center_valid) & (center_outside_distances <= collar_px)
    if np.any(fill_center):
        fy, fx = np.nonzero(fill_center)
        global_y = fy + TILE_SIZE
        global_x = fx + TILE_SIZE
        nearest_y = nearest[0, global_y, global_x]
        nearest_x = nearest[1, global_y, global_x]
        nearest_heights = decode_terrain_rgb(mosaic[nearest_y, nearest_x, :3])
        distances_m = np.maximum(
            0.0,
            center_outside_distances[fy, fx] - 1.0,
        ) * ground_m_per_pixel
        fill_heights = outside_height_profile(
            nearest_heights,
            distances_m,
            safe_max_elevation_m,
            cap_softness_m,
            outer_skirt_m,
            collar_m,
            technical_base_m,
        )
        center[fy, fx, :3] = encode_terrain_rgb(fill_heights)
        center[fy, fx, 3] = 255
        stats['collar_pixels'] = int(len(fill_heights))
        stats['outer_descent_pixels'] = int(np.count_nonzero(distances_m > outer_skirt_m))
        written_heights.append(fill_heights)

    if not written_heights:
        return None, {}
    all_written = np.concatenate(written_heights)
    stats['minimum_written_height_m'] = float(np.min(all_written))
    stats['maximum_written_height_m'] = float(np.max(all_written))
    return png_bytes(center), stats


def patch_zoom(
    tiles: dict[tuple[int, int, int], bytes],
    z: int,
    collar_m: float,
    center_lat: float,
    safe_max_elevation_m: float,
    cap_softness_m: float,
    inner_taper_m: float,
    outer_skirt_m: float,
    technical_base_m: float,
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
            'inside_taper_pixels': 0,
            'inside_capped_pixels': 0,
            'outer_descent_pixels': 0,
        }

    ground_m_per_pixel = WEB_MERCATOR_PIXEL_M * math.cos(math.radians(center_lat)) / (2 ** z)
    collar_px = max(1, int(math.ceil(collar_m / max(0.01, ground_m_per_pixel))))
    inner_taper_px = max(1, int(math.ceil(inner_taper_m / max(0.01, ground_m_per_pixel))))
    if collar_px >= TILE_SIZE:
        raise RuntimeError(f'z{z}: collar exceeds one tile ({collar_px}px); enlarge local neighborhood')

    candidates = neighbor_candidates(boundary)
    updates: dict[tuple[int, int, int], bytes] = {}
    changed_tiles = 0
    new_tiles = 0
    collar_pixels = 0
    inside_taper_pixels = 0
    inside_capped_pixels = 0
    outer_descent_pixels = 0
    minimum_written_height_m = math.inf
    maximum_written_height_m = -math.inf

    for x, y in sorted(candidates):
        payload, stats = patch_target_tile(
            tiles,
            z,
            x,
            y,
            collar_px,
            inner_taper_px,
            ground_m_per_pixel,
            safe_max_elevation_m,
            cap_softness_m,
            outer_skirt_m,
            collar_m,
            technical_base_m,
        )
        if payload is None:
            continue
        key = (z, x, y)
        existing = tiles.get(key)
        if existing == payload:
            continue
        updates[key] = payload
        collar_pixels += int(stats.get('collar_pixels', 0))
        inside_taper_pixels += int(stats.get('inside_taper_pixels', 0))
        inside_capped_pixels += int(stats.get('inside_capped_pixels', 0))
        outer_descent_pixels += int(stats.get('outer_descent_pixels', 0))
        if stats.get('minimum_written_height_m') is not None:
            minimum_written_height_m = min(
                minimum_written_height_m, float(stats['minimum_written_height_m'])
            )
        if stats.get('maximum_written_height_m') is not None:
            maximum_written_height_m = max(
                maximum_written_height_m, float(stats['maximum_written_height_m'])
            )
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
        'inside_taper_pixels': inside_taper_pixels,
        'inside_capped_pixels': inside_capped_pixels,
        'outer_descent_pixels': outer_descent_pixels,
        'collar_px': collar_px,
        'inner_taper_px': inner_taper_px,
        'ground_m_per_pixel': round(ground_m_per_pixel, 3),
        'minimum_written_height_m': None if minimum_written_height_m == math.inf else round(minimum_written_height_m, 1),
        'maximum_written_height_m': None if maximum_written_height_m == -math.inf else round(maximum_written_height_m, 1),
    }


def expand_bounds(
    header: dict,
    metadata: dict,
    collar_m: float,
    center_lat: float,
    safe_max_elevation_m: float,
    cap_softness_m: float,
    inner_taper_m: float,
    outer_skirt_m: float,
    technical_base_m: float,
) -> None:
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
    metadata['alan_edge_collar_mode'] = 'tapered-safe-foundation'
    metadata['alan_edge_inner_taper_m'] = int(round(inner_taper_m))
    metadata['alan_edge_outer_skirt_m'] = int(round(outer_skirt_m))
    metadata['alan_edge_safe_max_elevation_m'] = int(round(safe_max_elevation_m))
    metadata['alan_edge_cap_softness_m'] = int(round(cap_softness_m))
    metadata['alan_edge_technical_base_m'] = int(round(technical_base_m))


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
    safe_max_elevation_m: float,
    cap_softness_m: float,
    inner_taper_m: float,
    outer_skirt_m: float,
    technical_base_m: float,
    relief_exaggeration: float,
    frame_top_m: float,
    report_path: Path | None,
) -> dict:
    if input_pmtiles.resolve() == output_pmtiles.resolve():
        raise RuntimeError('Input and output PMTiles paths must be different')
    if not 0 < inner_taper_m < outer_skirt_m < collar_m:
        raise RuntimeError('Expected 0 < inner taper < outer skirt < collar width')
    if cap_softness_m <= 0:
        raise RuntimeError('Cap softness must be positive')
    rendered_safe_max_m = safe_max_elevation_m * relief_exaggeration
    if rendered_safe_max_m >= frame_top_m:
        raise RuntimeError(
            f'Safe collar height intersects frame: {safe_max_elevation_m} * '
            f'{relief_exaggeration} >= {frame_top_m}'
        )
    data = load_map_data(data_parts)
    center_lat = float(data['center'][1])
    dem = data['regionalDem']
    minzoom = int(dem['minzoom'])
    maxzoom = int(dem['maxzoom'])

    before = input_pmtiles.stat().st_size
    header, metadata, tiles = read_archive(input_pmtiles)
    if metadata.get('alan_edge_collar_m'):
        raise RuntimeError('Input DEM already contains an edge collar; use the clean 7.2 DEM source')
    original_tile_count = len(tiles)
    per_zoom = [
        patch_zoom(
            tiles,
            z,
            collar_m,
            center_lat,
            safe_max_elevation_m,
            cap_softness_m,
            inner_taper_m,
            outer_skirt_m,
            technical_base_m,
        )
        for z in range(minzoom, maxzoom + 1)
    ]
    expand_bounds(
        header,
        metadata,
        collar_m,
        center_lat,
        safe_max_elevation_m,
        cap_softness_m,
        inner_taper_m,
        outer_skirt_m,
        technical_base_m,
    )
    write_archive(output_pmtiles, header, metadata, tiles)
    after = output_pmtiles.stat().st_size

    report = {
        'version': RELEASE,
        'mode': 'hidden-tapered-dem-edge-collar',
        'collar_m': int(round(collar_m)),
        'inner_taper_m': int(round(inner_taper_m)),
        'outer_skirt_m': int(round(outer_skirt_m)),
        'safe_max_elevation_m': int(round(safe_max_elevation_m)),
        'cap_softness_m': int(round(cap_softness_m)),
        'technical_base_m': int(round(technical_base_m)),
        'relief_exaggeration': relief_exaggeration,
        'rendered_safe_max_m': int(round(rendered_safe_max_m)),
        'frame_top_m': int(round(frame_top_m)),
        'frame_clearance_m': int(round(frame_top_m - rendered_safe_max_m)),
        'fill_method': 'smooth-height-cap-plus-hidden-outer-descent',
        'alpha_inside_collar': 255,
        'terrain_base_drop_removed_near_map_frame': True,
        'terrain_above_frame_prevented': True,
        'visible_dem_inside_frame_preserved': True,
        'terrain_changes_limited_to_hidden_frame_band': True,
        'pmtiles_bytes_before': before,
        'pmtiles_bytes_after': after,
        'total_tiles_before': original_tile_count,
        'total_tiles_after': len(tiles),
        'changed_tiles': sum(item['changed_tiles'] for item in per_zoom),
        'new_tiles': sum(item['new_tiles'] for item in per_zoom),
        'collar_pixels': sum(item['collar_pixels'] for item in per_zoom),
        'inside_taper_pixels': sum(item['inside_taper_pixels'] for item in per_zoom),
        'inside_capped_pixels': sum(item['inside_capped_pixels'] for item in per_zoom),
        'outer_descent_pixels': sum(item['outer_descent_pixels'] for item in per_zoom),
        'per_zoom': per_zoom,
    }
    if (
        report['changed_tiles'] <= 0
        or report['new_tiles'] <= 0
        or report['collar_pixels'] <= 0
        or report['inside_taper_pixels'] <= 0
        or report['inside_capped_pixels'] <= 0
        or report['outer_descent_pixels'] <= 0
    ):
        raise RuntimeError(f'DEM collar was not materialized: {report}')
    written_maxima = [
        item['maximum_written_height_m']
        for item in per_zoom
        if item.get('maximum_written_height_m') is not None
    ]
    if written_maxima and max(written_maxima) > safe_max_elevation_m + TERRAIN_RGB_STEP_M:
        raise RuntimeError(
            f'Hidden frame band exceeds its safe cap: {max(written_maxima)} > '
            f'{safe_max_elevation_m}'
        )
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
    parser.add_argument('--safe-max-elevation-m', type=float, default=1000.0)
    parser.add_argument('--cap-softness-m', type=float, default=DEFAULT_CAP_SOFTNESS_M)
    parser.add_argument('--inner-taper-m', type=float, default=900.0)
    parser.add_argument('--outer-skirt-m', type=float, default=3200.0)
    parser.add_argument('--technical-base-m', type=float, default=TERRAIN_RGB_BASE_M)
    parser.add_argument('--relief-exaggeration', type=float, default=2.55)
    parser.add_argument('--frame-top-m', type=float, default=4000.0)
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    patch(
        args.input_pmtiles,
        args.output_pmtiles,
        args.data_part,
        args.collar_m,
        args.safe_max_elevation_m,
        args.cap_softness_m,
        args.inner_taper_m,
        args.outer_skirt_m,
        args.technical_base_m,
        args.relief_exaggeration,
        args.frame_top_m,
        args.report,
    )


if __name__ == '__main__':
    main()
