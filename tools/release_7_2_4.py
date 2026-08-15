#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import json
import math
import re
import struct
import unicodedata
from collections import Counter
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
PARTS = [ROOT / 'assets/map-data.part-000.js', ROOT / 'assets/map-data.part-001.js']
MARKER = 'window.ALAN_MAP_DATA = '
VERSION = '7.2.4'
SOURCE_CATALOG = 'osm-overpass-2026-08-15'
SOURCE_TIMESTAMP = '2026-08-15T06:05:02Z'
LABEL_SCALE = 0.533334
ACTIVE_PLACE_TYPES = {'city', 'town', 'village', 'hamlet'}
FRAME_RING = [
    [40.517840, 43.412650],
    [43.731622, 42.734095],
    [44.184003, 43.856420],
    [40.970221, 44.534975],
]

# The line length is immaterial to the fixed shared-font renderer. Its midpoint
# places the label and its bearing controls the projected orientation.
REGIONAL_AXES = {
    'region_baskhan': [[42.575, 43.255], [43.365, 43.645]],
    'region_dommay': [[41.741, 43.298], [41.569, 43.372]],
    'region_arkhyz': [[41.290, 43.522], [41.090, 43.658]],
    'region_sxawat': [[42.681, 43.709], [42.459, 43.861]],
    'region_narsana': [[42.889, 43.787], [42.501, 44.053]],
}

ADDITIONAL_REGIONS = [
    {
        'label_id': 'region_gitche_qarachay',
        'icon_id': 'regional-region-gitche-qarachay',
        'name_map': 'GİTÇE QARAÇAY',
        'name_alan_latin': 'GİTÇE QARAÇAY',
        'name_ru': 'Малый Карачай',
        'placement_priority': 15,
        'coordinates': [[42.784, 43.751], [42.496, 43.949]],
        'placement_basis': 'historical-geographic district; user sketch refined against the Malokarachay district corridor',
    },
    {
        'label_id': 'region_cogetey',
        'icon_id': 'regional-region-cogetey',
        'name_map': 'CÖGETEY',
        'name_alan_latin': 'CÖGETEY',
        'name_ru': 'Джёгетей',
        'placement_priority': 16,
        'coordinates': [[41.920, 43.875], [42.060, 44.105]],
        'placement_basis': 'Djeguta river and Ust-Djeguta settlement corridor',
    },
    {
        'label_id': 'region_zelenchuk',
        'icon_id': 'regional-region-zelenchuk',
        'name_map': 'ZELENÇUK',
        'name_alan_latin': 'ZELENÇUK',
        'name_ru': 'Зеленчук',
        'placement_priority': 17,
        'coordinates': [[41.303, 43.748], [41.637, 44.012]],
        'placement_basis': 'Bolshoy Zelenchuk valley between Lower Arkhyz and Zelenchukskaya',
    },
]

# Local endonyms confirmed independently of the automated Russian fallback.
# Keep this list deliberately small: every other unreviewed spelling remains
# visibly marked as provisional in the exported catalogue.
MANUAL_SETTLEMENT_NAMES = {
    'Джегута': 'CÖGETEY',
    'Новая Джегута': 'CAÑGI CÖGETEY',
}
BASELINE_HISTORIC_DUPLICATES = {
    'Аксу',
    'Белая Гора',
    'Восток',
    'Коммунстрой',
    'Малокурганный',
    'Мара-Аягъы',
}

CYRILLIC_MAP = {
    'А': 'A', 'Б': 'B', 'В': 'V', 'Г': 'G', 'Д': 'D', 'Е': 'E',
    'Ё': 'Ö', 'Ж': 'J', 'З': 'Z', 'И': 'İ', 'Й': 'Y', 'К': 'K',
    'Л': 'L', 'М': 'M', 'Н': 'N', 'О': 'O', 'П': 'P', 'Р': 'R',
    'С': 'S', 'Т': 'T', 'У': 'U', 'Ф': 'F', 'Х': 'X', 'Ц': 'Ţ',
    'Ч': 'Ç', 'Ш': 'Ş', 'Щ': 'Ş', 'Ъ': '', 'Ы': 'I', 'Ь': '',
    'Э': 'E', 'Ю': 'Ü', 'Я': 'YA', 'Ў': 'W',
}
MULTIGRAPHS = (
    ('ДЖ', 'C'),
    ('Җ', 'C'),
    ('КЪ', 'Q'),
    ('ГЪ', 'Ğ'),
    ('НГ', 'Ñ'),
)
ALLOWED_NAME = re.compile(r"^[A-Z0-9 ÇĞİÑÖŞŢÜQWXJ'.,()/\-]+$")


def read_data() -> dict:
    source = ''.join(path.read_text(encoding='utf-8') for path in PARTS)
    index = source.find(MARKER)
    if index < 0:
        raise RuntimeError('ALAN_MAP_DATA marker not found')
    payload = source[index + len(MARKER):].strip()
    if payload.endswith(';'):
        payload = payload[:-1]
    return json.loads(payload)


def write_data(data: dict) -> None:
    payload = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
    midpoint = len(payload) // 2
    left = payload.rfind('},"', 0, midpoint)
    right = payload.find('},"', midpoint)
    candidates = [position + 1 for position in (left, right) if position >= 0]
    cut = min(candidates, key=lambda position: abs(position - midpoint)) if candidates else midpoint
    PARTS[0].write_text('\n' + MARKER + payload[:cut], encoding='utf-8')
    PARTS[1].write_text(payload[cut:] + ';\n', encoding='utf-8')


def point_in_frame(lon: float, lat: float) -> bool:
    inside = False
    for first, second in zip(FRAME_RING, FRAME_RING[1:] + FRAME_RING[:1]):
        x1, y1 = first
        x2, y2 = second
        if (y1 > lat) != (y2 > lat):
            x_cross = (x2 - x1) * (lat - y1) / (y2 - y1) + x1
            if lon < x_cross:
                inside = not inside
    return inside


def normalize_match(value: str) -> str:
    return ''.join(character for character in unicodedata.normalize('NFC', str(value)).casefold() if character.isalnum())


def distance_m(first: list[float], second: list[float]) -> float:
    latitude = (first[1] + second[1]) / 2
    dx = (first[0] - second[0]) * 111320 * math.cos(math.radians(latitude))
    dy = (first[1] - second[1]) * 110574
    return math.hypot(dx, dy)


def transliterate_alan(value: str) -> str:
    text = unicodedata.normalize('NFC', str(value or '')).upper().replace('–', '-').replace('—', '-')
    for source, target in MULTIGRAPHS:
        text = text.replace(source, target)
    output = ''.join(CYRILLIC_MAP.get(character, character) for character in text)
    # U is vocalic at a syllable onset, but becomes W in the diphthongs used by
    # the agreed Alan Latin spelling (TAW, SUW, AWUZ).
    output = re.sub(r'AU', 'AW', output)
    output = re.sub(r'EU', 'EW', output)
    output = re.sub(r'OU', 'OW', output)
    output = re.sub(r'UU', 'UW', output)
    output = re.sub(r'\s+', ' ', output).strip()
    output = unicodedata.normalize('NFC', output)
    if not output or not ALLOWED_NAME.fullmatch(output):
        bad = sorted({character for character in output if not ALLOWED_NAME.fullmatch(character) and character not in " '.,()/-"})
        raise RuntimeError(f'unsupported characters in Alan Latin name {value!r} -> {output!r}: {bad}')
    return output


def accepted_baseline_settlements() -> list[dict]:
    source = ROOT / 'data/settlement-names-accepted-7.2.3.json'
    payload = json.loads(source.read_text(encoding='utf-8'))
    return [
        {
            'type': 'Feature',
            'properties': {
                'object_id': record['object_id'],
                'name_ru': record['name_ru'],
                'name_alan_latin': record['name_alan_latin'],
            },
            'geometry': {'type': 'Point', 'coordinates': record['coordinates']},
        }
        for record in payload.get('settlements') or []
    ]


def match_existing(name_ru: str, coordinates: list[float], existing: list[dict]) -> dict | None:
    wanted = normalize_match(name_ru)
    candidates = []
    for feature in existing:
        properties = feature.get('properties') or {}
        existing_name = str(properties.get('name_ru') or '')
        variants = [normalize_match(part) for part in re.split(r'\s*/\s*', existing_name) if part]
        comparable = any(
            wanted == variant
            or (len(wanted) >= 8 and (wanted.startswith(variant) or variant.startswith(wanted)))
            for variant in variants
        )
        if not comparable:
            continue
        current_coordinates = (feature.get('geometry') or {}).get('coordinates') or []
        if len(current_coordinates) < 2:
            continue
        candidates.append((distance_m(coordinates, current_coordinates), feature))
    if not candidates:
        return None
    distance, feature = min(candidates, key=lambda item: item[0])
    return feature if distance <= 30000 else None


def feature_from_osm(element: dict, existing: list[dict]) -> dict:
    tags = element.get('tags') or {}
    coordinates = [round(float(element['lon']), 7), round(float(element['lat']), 7)]
    name_ru = str(tags.get('name:ru') or tags.get('name') or '').strip()
    matched = match_existing(name_ru, coordinates, existing)
    matched_properties = (matched or {}).get('properties') or {}
    accepted_name = unicodedata.normalize(
        'NFC',
        str(matched_properties.get('name_alan_latin') or matched_properties.get('name_map') or '').strip().upper(),
    )
    manual_name = MANUAL_SETTLEMENT_NAMES.get(name_ru)
    if manual_name:
        name_alan = manual_name
        name_source = 'accepted-local-name'
        review_required = 0
    elif accepted_name and ALLOWED_NAME.fullmatch(accepted_name):
        name_alan = accepted_name
        name_source = 'accepted-map-name'
        review_required = 0
    elif tags.get('name:krc'):
        name_alan = transliterate_alan(tags['name:krc'])
        name_source = 'osm-name:krc'
        review_required = 0
    else:
        name_alan = transliterate_alan(name_ru)
        name_source = 'provisional-alan-transliteration'
        review_required = 1

    if not ALLOWED_NAME.fullmatch(name_alan):
        raise RuntimeError(f'invalid accepted map name: {name_alan!r}')

    place = str(tags.get('place'))
    importance = {'city': 5, 'town': 4, 'village': 3, 'hamlet': 2}[place]
    properties = {
        'object_id': str(matched_properties.get('object_id') or f"settlement_osm_node_{element['id']}"),
        'object_type': 'settlement',
        'object_subtype': place,
        'name_ru': name_ru,
        'name_map': name_alan,
        'name_alan_latin': name_alan,
        'description_ru': f'{name_ru} — действующий населённый пункт по снимку OpenStreetMap от 15.08.2026. Этнографическое описание и состав населения будут добавлены после отдельной проверки источников.',
        'visible': 1,
        'active': 1,
        'label_tier': 'settlement_major' if place in {'city', 'town'} else 'settlement_minor',
        'importance': importance,
        'osm_type': 'node',
        'osm_id': int(element['id']),
        'osm_place': place,
        'source_catalog': SOURCE_CATALOG,
        'source_snapshot': SOURCE_TIMESTAMP,
        'name_source': name_source,
        'name_review_required': review_required,
        'ethnographic_profile_status': 'pending',
    }
    for source_key, target_key in (
        ('population', 'population'),
        ('population:date', 'population_date'),
        ('wikidata', 'wikidata'),
        ('wikipedia', 'wikipedia'),
    ):
        if tags.get(source_key):
            properties[target_key] = tags[source_key]
    return {'type': 'Feature', 'properties': properties, 'geometry': {'type': 'Point', 'coordinates': coordinates}}


def active_settlements(raw: dict, data: dict) -> tuple[list[dict], dict]:
    del data
    existing = accepted_baseline_settlements()
    bbox_count = len(raw.get('elements') or [])
    exact_frame = []
    population_zero = []
    for element in raw.get('elements') or []:
        tags = element.get('tags') or {}
        if element.get('type') != 'node' or tags.get('place') not in ACTIVE_PLACE_TYPES:
            continue
        if not tags.get('name:ru') and not tags.get('name'):
            continue
        if not point_in_frame(float(element['lon']), float(element['lat'])):
            continue
        exact_frame.append(element)
        if str(tags.get('population') or '').strip() == '0':
            population_zero.append(element)

    active = [feature_from_osm(element, existing) for element in exact_frame if element not in population_zero]
    active.sort(key=lambda feature: (
        -int((feature.get('properties') or {}).get('importance') or 0),
        str((feature.get('properties') or {}).get('name_ru') or ''),
        int((feature.get('properties') or {}).get('osm_id') or 0),
    ))
    osm_ids = [feature['properties']['osm_id'] for feature in active]
    if len(osm_ids) != len(set(osm_ids)):
        raise RuntimeError('duplicate OSM settlement ids')

    counts = Counter(feature['properties']['osm_place'] for feature in active)
    sources = Counter(feature['properties']['name_source'] for feature in active)
    manifest = {
        'version': VERSION,
        'catalog': SOURCE_CATALOG,
        'source': 'OpenStreetMap Overpass API',
        'source_snapshot': SOURCE_TIMESTAMP,
        'attribution': '© OpenStreetMap contributors; ODbL',
        'query_place_types': sorted(ACTIVE_PLACE_TYPES),
        'frame': FRAME_RING + [FRAME_RING[0]],
        'filter': 'named node inside exact rotated map frame; population=0 and isolated_dwelling excluded',
        'bbox_nodes_returned': bbox_count,
        'named_settlement_nodes_inside_frame_before_population_filter': len(exact_frame),
        'active_settlements': len(active),
        'active_by_place': dict(sorted(counts.items())),
        'name_sources': dict(sorted(sources.items())),
        'name_review_required': sum(feature['properties']['name_review_required'] for feature in active),
        'excluded_population_zero': [
            {
                'osm_id': int(element['id']),
                'name_ru': (element.get('tags') or {}).get('name:ru') or (element.get('tags') or {}).get('name'),
            }
            for element in population_zero
        ],
        'ethnographic_profiles': 'pending; no ethnicity inferred from place names or coordinates',
    }
    return active, manifest


def duplicate_historic_active(historic: dict, active: list[dict]) -> bool:
    properties = historic.get('properties') or {}
    name = normalize_match(properties.get('name_ru') or '')
    coordinates = (historic.get('geometry') or {}).get('coordinates') or []
    if not name or len(coordinates) < 2:
        return False
    for feature in active:
        active_properties = feature.get('properties') or {}
        if normalize_match(active_properties.get('name_ru') or '') != name:
            continue
        active_coordinates = (feature.get('geometry') or {}).get('coordinates') or []
        if len(active_coordinates) >= 2 and distance_m(coordinates, active_coordinates) <= 30000:
            return True
    return False


def label_font() -> ImageFont.FreeTypeFont:
    candidates = [
        Path('/usr/share/fonts/opentype/urw-base35/URWBookman-Demi.otf'),
        Path('/usr/share/fonts/truetype/urw-base35/URWBookman-Demi.ttf'),
    ]
    for path in candidates:
        if path.exists():
            return ImageFont.truetype(str(path), 56)
    raise RuntimeError('URWBookman-Demi font is required to match the existing regional labels')


def regional_label_uri(text: str) -> str:
    font = label_font()
    probe = ImageDraw.Draw(Image.new('RGBA', (1, 1)))
    bbox = probe.textbbox((0, 0), text, font=font, stroke_width=4)
    width = bbox[2] - bbox[0] + 28
    height = bbox[3] - bbox[1] + 24
    image = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.text(
        (14 - bbox[0], 12 - bbox[1]),
        text,
        font=font,
        fill=(91, 68, 48, 242),
        stroke_width=4,
        stroke_fill=(246, 236, 216, 235),
    )
    from io import BytesIO
    buffer = BytesIO()
    image.save(buffer, format='PNG', optimize=True, compress_level=9)
    return 'data:image/png;base64,' + base64.b64encode(buffer.getvalue()).decode('ascii')


def patch_regional_labels(data: dict) -> None:
    collection = data.setdefault('regionalLabels', {'type': 'FeatureCollection', 'features': []})
    features = collection.setdefault('features', [])
    by_id = {(feature.get('properties') or {}).get('label_id'): feature for feature in features}
    for feature in features:
        properties = feature.setdefault('properties', {})
        properties['display_icon_scale'] = LABEL_SCALE
        label_id = properties.get('label_id')
        if label_id in REGIONAL_AXES:
            feature['geometry'] = {'type': 'LineString', 'coordinates': REGIONAL_AXES[label_id]}

    images = data.setdefault('regionalLabelImages', {})
    for record in ADDITIONAL_REGIONS:
        properties = {
            'label_id': record['label_id'],
            'name_map': record['name_map'],
            'name_alan_latin': record['name_alan_latin'],
            'name_ru': record['name_ru'],
            'label_rank': 1,
            'visible': 1,
            'icon_id': record['icon_id'],
            'placement_priority': record['placement_priority'],
            'importance': 4,
            'display_icon_scale': LABEL_SCALE,
            'placement_basis': record['placement_basis'],
        }
        feature = {
            'type': 'Feature',
            'properties': properties,
            'geometry': {'type': 'LineString', 'coordinates': record['coordinates']},
        }
        if record['label_id'] in by_id:
            existing = by_id[record['label_id']]
            existing.clear()
            existing.update(feature)
        else:
            features.append(feature)
            by_id[record['label_id']] = feature
        images[record['icon_id']] = regional_label_uri(record['name_map'])

    data['regionalLabelCatalog'] = {
        'version': VERSION,
        'shared_reference': 'region_chegem',
        'uniform_scale': LABEL_SCALE,
        'scale_change_from_7_2_3': -0.20,
        'oriented_from_user_markup': sorted(REGIONAL_AXES),
        'added_regions': [record['label_id'] for record in ADDITIONAL_REGIONS],
    }


def png_dimensions(uri: str) -> tuple[int, int]:
    if not isinstance(uri, str) or not uri.startswith('data:image/png;base64,'):
        raise RuntimeError('regional label image must be an embedded PNG')
    payload = base64.b64decode(uri.split(',', 1)[1])
    if payload[:8] != b'\x89PNG\r\n\x1a\n' or len(payload) < 24:
        raise RuntimeError('invalid regional label PNG')
    return struct.unpack('>II', payload[16:24])


def build(source: Path) -> None:
    raw = json.loads(source.read_text(encoding='utf-8'))
    if str((raw.get('osm3s') or {}).get('timestamp_osm_base')) != SOURCE_TIMESTAMP:
        raise RuntimeError('unexpected OSM source timestamp')
    data = read_data()
    active, manifest = active_settlements(raw, data)

    objects = data.setdefault('objects', {'type': 'FeatureCollection', 'features': []})
    retained = []
    removed_historic_duplicates = []
    for feature in objects.get('features') or []:
        properties = feature.get('properties') or {}
        if properties.get('object_type') != 'settlement':
            retained.append(feature)
        elif properties.get('object_subtype') == 'historic_settlement':
            if duplicate_historic_active(feature, active):
                removed_historic_duplicates.append(properties.get('name_ru'))
            else:
                retained.append(feature)
    objects['features'] = retained + active
    manifest['removed_historic_duplicates_replaced_by_active'] = sorted(
        BASELINE_HISTORIC_DUPLICATES | set(filter(None, removed_historic_duplicates))
    )
    data['settlementCatalog'] = manifest
    patch_regional_labels(data)
    write_data(data)
    catalog_rows = []
    for feature in active:
        properties = feature['properties']
        row = {
            'osm_id': properties['osm_id'],
            'object_id': properties['object_id'],
            'place': properties['osm_place'],
            'name_ru': properties['name_ru'],
            'name_alan_latin': properties['name_alan_latin'],
            'coordinates': feature['geometry']['coordinates'],
            'name_source': properties['name_source'],
            'name_review_required': properties['name_review_required'],
            'ethnographic_profile_status': properties['ethnographic_profile_status'],
        }
        for optional in ('population', 'population_date', 'wikidata', 'wikipedia'):
            if optional in properties:
                row[optional] = properties[optional]
        catalog_rows.append(row)
    exported_catalog = {**manifest, 'settlements': catalog_rows}
    (ROOT / 'data/settlement-catalog-7.2.4.json').write_text(
        json.dumps(exported_catalog, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8',
    )
    print(json.dumps({
        'active_settlements': manifest['active_settlements'],
        'active_by_place': manifest['active_by_place'],
        'regional_labels': len(data['regionalLabels']['features']),
        'regional_scale': LABEL_SCALE,
    }, ensure_ascii=False))


def validate() -> None:
    data = read_data()
    catalog = json.loads((ROOT / 'data/settlement-catalog-7.2.4.json').read_text(encoding='utf-8'))
    if catalog.get('version') != VERSION or catalog.get('active_settlements') != 532:
        raise RuntimeError('settlement manifest version/count mismatch')

    active = [
        feature for feature in (data.get('objects') or {}).get('features') or []
        if (feature.get('properties') or {}).get('object_type') == 'settlement'
        and (feature.get('properties') or {}).get('object_subtype') != 'historic_settlement'
    ]
    if len(active) != 532:
        raise RuntimeError(f'active settlement count mismatch: {len(active)}')
    catalog_rows = catalog.get('settlements') or []
    if len(catalog_rows) != 532:
        raise RuntimeError(f'exported settlement catalogue count mismatch: {len(catalog_rows)}')
    ids = set()
    for feature in active:
        properties = feature.get('properties') or {}
        if properties.get('source_catalog') != SOURCE_CATALOG or properties.get('active') != 1:
            raise RuntimeError(f'invalid settlement provenance: {properties.get("object_id")}')
        osm_id = properties.get('osm_id')
        if osm_id in ids:
            raise RuntimeError(f'duplicate settlement OSM id: {osm_id}')
        ids.add(osm_id)
        name = unicodedata.normalize('NFC', str(properties.get('name_alan_latin') or ''))
        if not ALLOWED_NAME.fullmatch(name) or re.search(r'[А-Яа-яЁё]', name):
            raise RuntimeError(f'invalid Alan Latin settlement name: {name!r}')
        coordinates = (feature.get('geometry') or {}).get('coordinates') or []
        if len(coordinates) < 2 or not point_in_frame(float(coordinates[0]), float(coordinates[1])):
            raise RuntimeError(f'settlement outside exact map frame: {properties.get("name_ru")}')
    if {row.get('osm_id') for row in catalog_rows} != ids:
        raise RuntimeError('exported settlement catalogue ids do not match map data')

    regional = (data.get('regionalLabels') or {}).get('features') or []
    if len(regional) != 16:
        raise RuntimeError(f'regional label count mismatch: {len(regional)}')
    by_id = {(feature.get('properties') or {}).get('label_id'): feature for feature in regional}
    required = {'region_gitche_qarachay', 'region_cogetey', 'region_zelenchuk'} | set(REGIONAL_AXES)
    if not required.issubset(by_id):
        raise RuntimeError(f'missing regional labels: {sorted(required - set(by_id))}')
    scales = {float((feature.get('properties') or {}).get('display_icon_scale') or 0) for feature in regional}
    if scales != {LABEL_SCALE}:
        raise RuntimeError(f'regional labels do not share the 20%-reduced scale: {scales}')
    for label_id, expected in REGIONAL_AXES.items():
        if (by_id[label_id].get('geometry') or {}).get('coordinates') != expected:
            raise RuntimeError(f'regional axis mismatch: {label_id}')
    for record in ADDITIONAL_REGIONS:
        feature = by_id[record['label_id']]
        if (feature.get('geometry') or {}).get('coordinates') != record['coordinates']:
            raise RuntimeError(f'new regional placement mismatch: {record["label_id"]}')
        width, height = png_dimensions((data.get('regionalLabelImages') or {}).get(record['icon_id']))
        if width < 200 or height < 70:
            raise RuntimeError(f'regional label image too small: {record["icon_id"]} {width}x{height}')

    print(f'release-{VERSION} data validation: ok; {len(active)} active settlements, {len(regional)} regional labels')


def main() -> None:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest='command', required=True)
    build_parser = subparsers.add_parser('build')
    build_parser.add_argument('--settlements', type=Path, required=True)
    subparsers.add_parser('validate')
    args = parser.parse_args()
    if args.command == 'build':
        build(args.settlements)
    else:
        validate()


if __name__ == '__main__':
    main()
