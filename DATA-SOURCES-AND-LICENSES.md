# Источники данных и компоненты

- Copernicus DEM GLO-30 — источник 3D-рельефа; локально перекодирован в Mapbox Terrain-RGB / PMTiles.
- ESA WorldCover 2021 v200 — 10-метровая глобальная карта земного покрова; класс 70 `Snow and Ice` используется как базовая постоянная маска. Attribution: © ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium. CC BY 4.0.
- Copernicus Sentinel-2 Level-2A — B03, B11 и SCL для многолетнего позднелетнего NDSI; публичные COG индексируются Earth Search (`sentinel-2-c1-l2a`). Copernicus Sentinel data.
- Copernicus Land Monitoring Service LCM-10, 2020 — прежний опциональный 10-метровый слой земного покрова; в 7.2.5 не является источником снега.
- OpenStreetMap / Geofabrik North Caucasus snapshot — дороги, реки, водоёмы, residential и вершины; OSM glacier/snow сохранён только как резервный runtime fallback. © OpenStreetMap contributors, ODbL.
- MapLibre GL JS 5.24.0; PMTiles JS 4.4.1; GDAL/OGR; Rasterio/rio-mbtiles; NumPy.

Методика снежного слоя и список использованных Sentinel-2 сцен фиксируются в `data/snow-report-7.2.5.json`.
