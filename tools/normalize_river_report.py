#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / 'config/river_systems.json'
REPORT_PATH = ROOT / 'build/river-network-report.json'


def normalize_report(require_all: bool = False) -> dict:
    config = json.loads(CONFIG_PATH.read_text(encoding='utf-8'))
    report = json.loads(REPORT_PATH.read_text(encoding='utf-8'))

    rules = {rule['id']: rule for rule in config.get('rules', [])}
    systems = {system['id']: system for system in report.get('systems', [])}

    for system_id, system in systems.items():
        if system.get('present'):
            continue
        rule = rules.get(system_id, {})
        covered_by = [
            candidate for candidate in rule.get('covered_by', [])
            if systems.get(candidate, {}).get('present')
        ]
        if not covered_by:
            continue

        coverage_id = covered_by[0]
        coverage = systems[coverage_id]
        system.update({
            'present': True,
            'matched_length_m': 0,
            'segment_count': 0,
            'component_count': 0,
            'coverage_system_id': coverage_id,
            'coverage_mode': rule.get('coverage_mode', 'standard-mainstem-alias'),
            'coverage_note': rule.get('coverage_note', ''),
            'represented_length_m': coverage.get('matched_length_m', 0),
            'represented_segment_count': coverage.get('segment_count', 0),
            'represented_component_count': coverage.get('component_count', 0),
        })

    ordered = report.get('systems', [])
    missing = [system['id'] for system in ordered if not system.get('present')]
    report['summary'] = {
        'required': len(ordered),
        'present': len(ordered) - len(missing),
        'missing': missing,
        'coverage_aliases': [
            {
                'id': system['id'],
                'coverage_system_id': system['coverage_system_id'],
                'coverage_mode': system['coverage_mode'],
            }
            for system in ordered
            if system.get('coverage_system_id')
        ],
    }

    REPORT_PATH.write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding='utf-8'
    )

    if require_all and missing:
        raise RuntimeError(f'Mandatory river systems are missing: {missing}')
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--require-all', action='store_true')
    args = parser.parse_args()
    report = normalize_report(require_all=args.require_all)
    print(json.dumps(report['summary'], ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
