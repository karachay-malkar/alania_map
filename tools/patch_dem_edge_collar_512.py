#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

import patch_dem_edge_collar as base

OUTPUT_TILE_SIZE = 512
RELEASE = '7.3.1-r1'
WEB_MERCATOR_PIXEL_M_256 = 156543.03392804097


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('input_pmtiles', type=Path)
    parser.add_argument('output_pmtiles', type=Path)
    parser.add_argument('--data-part', action='append', type=Path, required=True)
    parser.add_argument('--collar-m', type=float, default=4500.0)
    parser.add_argument('--safe-max-elevation-m', type=float, default=1000.0)
    parser.add_argument('--cap-softness-m', type=float, default=base.DEFAULT_CAP_SOFTNESS_M)
    parser.add_argument('--inner-taper-m', type=float, default=900.0)
    parser.add_argument('--outer-skirt-m', type=float, default=3200.0)
    parser.add_argument('--technical-base-m', type=float, default=base.TERRAIN_RGB_BASE_M)
    parser.add_argument('--relief-exaggeration', type=float, default=2.55)
    parser.add_argument('--frame-top-m', type=float, default=4000.0)
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()

    # The existing collar implementation is geometry-agnostic except for these
    # two module-level resolution constants. Override them rather than changing
    # the proven 256px path used by older releases.
    base.TILE_SIZE = OUTPUT_TILE_SIZE
    base.WEB_MERCATOR_PIXEL_M = WEB_MERCATOR_PIXEL_M_256 * 256.0 / OUTPUT_TILE_SIZE
    base.RELEASE = RELEASE

    report = base.patch(
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
        None,
    )
    report['tile_size'] = OUTPUT_TILE_SIZE
    report['ground_resolution_formula'] = 'web-mercator-512px'
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
