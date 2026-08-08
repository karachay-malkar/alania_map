# Slippy Map 1.0

Clean rebuild of the Alan map. Runtime code is new and does not load any 7.x/12.x application code.

## Runtime

- MapLibre GL JS is vendored unchanged as the map engine.
- `src/` is the new application code.
- Runtime reads only `data/map-boundary.geojson` and `data/mountains.geojson`.
- No PMTiles shards, gzip/base64 runtime, `eval`, old bootstrap, or old map application modules are used.
- Default orientation is bearing 180°: north is down, south is up.
- Default pitch is 25° and is reserved for the later 2.5D relief stage.

## Canonical data

- Boundary: the approved working contour used by the 7.0.23 map lineage, stored as standalone GeoJSON.
- Mountain morphology: verified `12.1.6` terrain-audit result from GitHub Actions run `31028658433` (#12, 2026-08-05), calculated for all 3797 source points from Copernicus DEM GLO-30.
- Runtime dataset contains 3798 points: 3797 audited source points plus one canonical `mingi_tau` object.
- Nine morphology categories are retained independently from importance flags.
- Main objects: 26.
- Real five-thousanders: 5, including `mingi_tau` at 5642 m.
- `mingi_tau` is the single canonical object for Минги-тау / Эльбрус. Display name: `Минги-тау`; Russian alias: `Эльбрус`.
- Validation result: 0 duplicate IDs and 0 points outside the approved boundary.

Historical sources were used only to create the canonical GeoJSON. They are never requested by the browser.
