# Источники данных и компоненты

- Векторные данные: OpenStreetMap, экстракт Geofabrik `north-caucasus-fed-district-latest-free.shp.zip`, снимок от 2026-07-26. © OpenStreetMap contributors; данные распространяются по ODbL.
- Рельеф: Mapzen/Tilezen Skadi SRTM HGT из AWS Open Data; исходные высоты подготовлены в локальные Terrarium PMTiles.
- Визуальный движок: MapLibre GL JS 5.24.0, лицензия BSD-3-Clause.
- Архивный протокол: PMTiles JS 4.4.1, лицензия BSD-3-Clause.
- Шрифт: Noto Sans, локальные glyph PBF.

В финальный архив входят только данные, необходимые для рабочей области карты. Региональные исходные Shapefile и HGT в архив не включены.
