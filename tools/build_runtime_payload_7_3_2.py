#!/usr/bin/env python3
from __future__ import annotations

import argparse
import copy
import gzip
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE_PARTS = [ROOT / 'assets/map-data.part-000.js', ROOT / 'assets/map-data.part-001.js']
MAPLIBRE_PARTS = [ROOT / 'assets/maplibre.part-000.js', ROOT / 'assets/maplibre.part-001.js']
VERSION = '7.3.2'
MARKER = 'window.ALAN_MAP_DATA = '
RUNTIME_OBJECT_PROPERTIES = (
    'object_id', 'object_type', 'object_subtype',
    'name_ru', 'name_map', 'name_alan_latin', 'description_ru',
    'visible', 'pass_id', 'name', 'source_name',
    'ele', 'elevation_m', 'system_id'
)


def read_source_data() -> dict:
    source = ''.join(path.read_text(encoding='utf-8') for path in SOURCE_PARTS).strip()
    if not source.startswith(MARKER) or not source.endswith(';'):
        raise RuntimeError('Unexpected map-data source wrapper.')
    return json.loads(source[len(MARKER):-1])


def json_bytes(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8')


def gzip_bytes(value: bytes) -> int:
    return len(gzip.compress(value, compresslevel=9))


def compact_feature_collection(collection: dict | None) -> dict:
    features = []
    for feature in (collection or {}).get('features', []):
        properties = feature.get('properties') or {}
        features.append({
            'type': feature.get('type', 'Feature'),
            'properties': {key: properties[key] for key in RUNTIME_OBJECT_PROPERTIES if key in properties},
            'geometry': feature.get('geometry')
        })
    return {'type': 'FeatureCollection', 'features': features}


def write_source_parts(data: dict) -> None:
    payload = '\n' + MARKER + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n'
    split = max(1, len(payload) // 2)
    SOURCE_PARTS[0].write_text(payload[:split], encoding='utf-8')
    SOURCE_PARTS[1].write_text(payload[split:], encoding='utf-8')


def main() -> None:
    parser = argparse.ArgumentParser(description='Build Alan Map 7.3.2 first-load runtime payloads.')
    parser.add_argument('--no-source-update', action='store_true', help='Do not rewrite source map-data version metadata.')
    args = parser.parse_args()

    data = read_source_data()
    full_source_before = copy.deepcopy(data)

    for key in ('version', 'applicationVersion', 'stage'):
        data[key] = VERSION

    snow = data.get('regionalSnow') or {}
    if snow.get('available'):
        # The archive physically starts at z8 and contains z13, but runtime intentionally caps at z12
        # so the canonical z12 geometry is overzoomed rather than replaced at close zooms.
        snow['minzoom'] = 8
        snow['maxzoom'] = 12
        snow['archiveMinzoom'] = 8
        snow['archiveMaxzoom'] = 13
        snow['runtimeMaxzoomReason'] = 'canonical-z12-overzoom-preserves-snow-footprint'

    data['runtimeLoading'] = {
        'version': VERSION,
        'maplibreBundle': 'assets/maplibre.js',
        'coreDataScript': 'assets/map-data-core.js',
        'deferredDataScript': 'assets/map-data-deferred.js',
        'deferredPointsScript': 'assets/map-data-points.js',
        'deferredKeys': ['regionalLabelImages'],
        'deferredPointKeys': ['objects', 'modernObjects', 'passes', 'peaks', 'highPeaks'],
        'regionalLabelTexturesDeferredAfterFirstFrame': True,
        'regionalLabelTexturesPreferFirstIdle': True,
        'pointObjectsDeferredUntilZoom': 9.5,
        'snowSourceDeferredUntilFirstIdle': True,
        'runtimeObjectsStrippedToUiProperties': True,
        'runtimeObjectPropertyWhitelist': list(RUNTIME_OBJECT_PROPERTIES)
    }

    if not args.no_source_update:
        write_source_parts(data)

    core = copy.deepcopy(data)
    deferred_collections = {
        'objects': compact_feature_collection(data.get('objects')),
        'modernObjects': compact_feature_collection(data.get('modernObjects')),
        'passes': compact_feature_collection(data.get('passes')),
        'peaks': compact_feature_collection(data.get('peaks')),
        'highPeaks': compact_feature_collection(data.get('highPeaks'))
    }
    for key in deferred_collections:
        core[key] = {'type': 'FeatureCollection', 'features': []}
    deferred_images = core.pop('regionalLabelImages', {})
    core['regionalLabelImages'] = {}

    core_source = 'window.ALAN_MAP_DATA = ' + json.dumps(core, ensure_ascii=False, separators=(',', ':')) + ';\n'
    deferred_source = 'window.ALAN_MAP_DEFERRED_DATA = ' + json.dumps({
        'version': VERSION,
        'regionalLabelImages': deferred_images
    }, ensure_ascii=False, separators=(',', ':')) + ';\n'
    deferred_points_source = 'window.ALAN_MAP_POINT_DATA = ' + json.dumps({
        'version': VERSION,
        **deferred_collections
    }, ensure_ascii=False, separators=(',', ':')) + ';\n'
    maplibre_source = ''.join(path.read_text(encoding='utf-8') for path in MAPLIBRE_PARTS)

    (ROOT / 'assets/map-data-core.js').write_text(core_source, encoding='utf-8')
    (ROOT / 'assets/map-data-deferred.js').write_text(deferred_source, encoding='utf-8')
    (ROOT / 'assets/map-data-points.js').write_text(deferred_points_source, encoding='utf-8')
    (ROOT / 'assets/maplibre.js').write_text(maplibre_source, encoding='utf-8')

    original_bytes = json_bytes(full_source_before)
    updated_full_bytes = json_bytes(data)
    core_bytes = core_source.encode('utf-8')
    deferred_bytes = deferred_source.encode('utf-8')
    deferred_points_bytes = deferred_points_source.encode('utf-8')
    maplibre_bytes = maplibre_source.encode('utf-8')

    report = {
        'version': VERSION,
        'sourceDataBytesBefore': len(original_bytes),
        'sourceDataGzipBytesBefore': gzip_bytes(original_bytes),
        'sourceDataBytesUpdated': len(updated_full_bytes),
        'runtimeCoreScriptBytes': len(core_bytes),
        'runtimeCoreScriptGzipBytes': gzip_bytes(core_bytes),
        'runtimeDeferredScriptBytes': len(deferred_bytes),
        'runtimeDeferredScriptGzipBytes': gzip_bytes(deferred_bytes),
        'runtimeDeferredPointsScriptBytes': len(deferred_points_bytes),
        'runtimeDeferredPointsScriptGzipBytes': gzip_bytes(deferred_points_bytes),
        'runtimeMaplibreScriptBytes': len(maplibre_bytes),
        'runtimeMaplibreScriptGzipBytes': gzip_bytes(maplibre_bytes),
        'initialDataRawReductionPercent': round((1 - len(core_bytes) / max(1, len(original_bytes))) * 100, 2),
        'initialDataGzipReductionPercent': round((1 - gzip_bytes(core_bytes) / max(1, gzip_bytes(original_bytes))) * 100, 2),
        'objectsFeatureCount': len((data.get('objects') or {}).get('features', [])),
        'modernObjectsFeatureCount': len((data.get('modernObjects') or {}).get('features', [])),
        'passesFeatureCount': len((data.get('passes') or {}).get('features', [])),
        'deferredPointFeatureCount': sum(len(collection.get('features', [])) for collection in deferred_collections.values()),
        'deferredRegionalLabelImageCount': len(deferred_images),
        'runtimeObjectPropertyWhitelist': list(RUNTIME_OBJECT_PROPERTIES),
        'snowRuntimeMinzoom': snow.get('minzoom'),
        'snowRuntimeMaxzoom': snow.get('maxzoom'),
        'snowArchiveMinzoom': snow.get('archiveMinzoom'),
        'snowArchiveMaxzoom': snow.get('archiveMaxzoom')
    }
    report_path = ROOT / 'data/runtime-loading-report-7.3.2.json'
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
