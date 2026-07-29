# Источники данных и компоненты

- OpenStreetMap: `https://download.geofabrik.de/russia/north-caucasus-fed-district-260726.osm.pbf`, © OpenStreetMap contributors, ODbL.
- Рельеф: Mapzen/Tilezen Skadi SRTM HGT, без изменений.
- Сборка: GDAL/OGR, GeoPandas/Shapely, Tippecanoe, PMTiles CLI.
- MapLibre GL JS 5.24.0; PMTiles JS 4.4.1; локальный Noto Sans.

Манифесты: `data/vector-build-manifest.json`, `data/shards-manifest.json`. Проверки данных: `data/river-network-report.json`, `data/natural-layer-report.json`.

## Иллюстрированные горы Alan Map 8.0

- `assets/mountains/mount-1.png` — `mount-30.png`: локальная проектная библиотека прозрачных PNG.
- `assets/mountains/elbrus.png`: отдельная двухвершинная композиция, собранная из утверждённых проектных фигурок.
- `assets/mountains/catalog.json`: размеры, типы и рекомендуемая географическая ширина фигурок.
- Горные PNG не загружаются из внешних источников; все файлы хранятся автономно в репозитории.
