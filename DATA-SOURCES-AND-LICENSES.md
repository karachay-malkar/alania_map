# Источники данных и компоненты

- Copernicus DEM GLO-30 — источник 3D-рельефа; локально перекодирован в Mapbox Terrain-RGB / PMTiles.
- Copernicus Land Monitoring Service LCM-10, 2020 — 10-метровый слой земного покрова; сборщик готовит локальный PMTiles через официальный CDSE Sentinel Hub Process API после настройки OAuth credentials.
- OpenStreetMap / Geofabrik latest North Caucasus snapshot at build time — дороги, реки, водоёмы, residential, ледники/постоянный снег, вершины; © OpenStreetMap contributors, ODbL.
- MapLibre GL JS 5.24.0; PMTiles JS 4.4.1; GDAL/OGR; GeoPandas/Shapely; Tippecanoe; Rasterio/rio-rgbify.
