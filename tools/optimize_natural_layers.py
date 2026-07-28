#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / 'build'


def compact_feature_properties(path: Path, mode: str) -> None:
    collection = json.loads(path.read_text(encoding='utf-8'))
    features = collection.get('features') or []
    for feature in features:
        properties = feature.get('properties') or {}
        if mode == 'landcover':
            if properties.get('class') == 'ice':
                keep = {'osm_id', 'class', 'subclass', 'natural', 'name', 'name_ru'}
            else:
                keep = {'class', 'subclass'}
        elif mode == 'landuse':
            keep = {'class', 'subclass'}
        elif mode == 'transportation':
            keep = {'class', 'subclass', 'brunnel'}
        else:
            keep = set(properties)
        feature['properties'] = {
            key: value for key, value in properties.items()
            if key in keep and value not in (None, '')
        }
    path.write_text(
        json.dumps(collection, ensure_ascii=False, separators=(',', ':')),
        encoding='utf-8'
    )


def main() -> None:
    compact_feature_properties(BUILD / 'landcover.geojson', 'landcover')
    compact_feature_properties(BUILD / 'landuse.geojson', 'landuse')
    compact_feature_properties(BUILD / 'transportation.geojson', 'transportation')


if __name__ == '__main__':
    main()
