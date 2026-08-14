#!/usr/bin/env python3
from pathlib import Path


def replace_once(text: str, old: str, new: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'7.2 map-ui patch expected exactly one match, found {count}: {old[:120]!r}')
    return text.replace(old, new, 1)


def main() -> None:
    path = Path('assets/map-ui.js')
    text = path.read_text(encoding='utf-8')
    replacements = [
        ("balanced: {mode: 'balanced', pixelRatio: 1.75, maxTileCacheZoomLevels: 4, maxTileCacheSize: 80, maxCanvasSize: 6144, antialias: false, forestPattern: true},",
         "balanced: {mode: 'balanced', pixelRatio: 1.75, maxTileCacheZoomLevels: 5, maxTileCacheSize: 128, maxCanvasSize: 6144, antialias: false, forestPattern: true},"),
        ("high: {mode: 'high', pixelRatio: 2, maxTileCacheZoomLevels: 5, maxTileCacheSize: 96, maxCanvasSize: 8192, antialias: true, forestPattern: true}",
         "high: {mode: 'high', pixelRatio: 2, maxTileCacheZoomLevels: 6, maxTileCacheSize: 192, maxCanvasSize: 8192, antialias: true, forestPattern: true}"),
        ("    let moving = false;\n", ""),
        ("      if (moving) setVisibility(layerIds.secondaryLabels,false);\n", ""),
        ("        map.setLayoutProperty('forest-pattern','visibility',qualityProfile.forestPattern && !moving ? 'visible' : 'none');",
         "        map.setLayoutProperty('forest-pattern','visibility',qualityProfile.forestPattern ? 'visible' : 'none');"),
        ("document.addEventListener('alan-map:pmtiles-shard-loaded'", "document.addEventListener('alan-map:pmtiles-range-loaded'"),
        ("      map.on('movestart',() => {\n        moving = true;\n        applyLayerState();\n      });\n", ""),
        ("      map.on('moveend',() => {\n        moving = false;\n        applyLayerState();\n", "      map.on('moveend',() => {\n"),
    ]
    for old, new in replacements:
        text = replace_once(text, old, new)
    path.write_text(text, encoding='utf-8')
    print('7.2 map-ui patch: ok')


if __name__ == '__main__':
    main()
