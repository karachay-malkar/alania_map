# Slippy Map 1.0

Clean rebuild of the Alan map. Runtime code is new and does not load any 7.x/12.x application code.

## Runtime

- MapLibre GL JS is vendored unchanged as the map engine.
- `src/` is the new application code.
- Runtime reads only `data/map-boundary.geojson` and `data/mountains.geojson`.
- No PMTiles shards, gzip/base64 runtime, `eval`, old bootstrap, or old map application modules are used.
- Default orientation is bearing 180°: north is down, south is up.
- Default pitch is 25° and can later host the 2.5D relief stage.

## Data provenance

- Boundary: the approved working contour used to physically clip the 7.0.23 map; stored here as a standalone GeoJSON copy from the later canonical `data/map-frame.geojson` representation of that contour.
- Mountain geometry/morphology: the approved 9-category morphology dataset from the 12.1.6 lineage, recovered from the 12.1.8 data payload and converted once to plain GeoJSON.
- Special mountains: 12.1.8 special-point dataset, normalized into the same canonical file.
- `mingi_tau` is the single canonical object for Минги-тау / Эльбрус. Display name: `Минги-тау`; Russian alias: `Эльбрус`.

Historical files are build-time sources only. They are never requested by the browser.
