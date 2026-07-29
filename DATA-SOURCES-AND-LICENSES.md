# Источники данных и компоненты

- OpenStreetMap: `https://download.geofabrik.de/russia/north-caucasus-fed-district-260726.osm.pbf`, © OpenStreetMap contributors, ODbL.
- Рельеф: Mapzen/Tilezen Skadi SRTM HGT, без изменений.
- Сборка: GDAL/OGR, GeoPandas/Shapely, Tippecanoe, PMTiles CLI.
- MapLibre GL JS 5.24.0; PMTiles JS 4.4.1; локальный Noto Sans.

Манифесты: `data/vector-build-manifest.json`, `data/shards-manifest.json`.
Проверки данных: `data/river-network-report.json`, `data/natural-layer-report.json`.
