import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const config = require('../src/config.js');
const dataModule = require('../src/data.js');
const mapModule = require('../src/map.js');

const boundaryRaw = JSON.parse(fs.readFileSync(new URL('../data/map-frame.geojson', import.meta.url), 'utf8'));
const mountainsRaw = JSON.parse(fs.readFileSync(new URL('../data/mountains/mountain_points.geojson', import.meta.url), 'utf8'));
const boundary = dataModule.normalizeBoundary(boundaryRaw);
const normalized = dataModule.normalizeMountainPoints(mountainsRaw, boundary);
const bounds = dataModule.calculateBounds(boundary);

assert.equal(config.version, '12.1.0');
assert.ok(boundary.features.length > 0, 'boundary is empty');
assert.ok(bounds.every(Number.isFinite), 'boundary bounds are invalid');
assert.ok(normalized.collection.features.length > 0, 'mountain point collection is empty');
assert.equal(normalized.summary.total, normalized.collection.features.length);

const allowedTypes = new Set(Object.keys(config.categories));
const ids = new Set();
const allowedKeys = ['elevation_m', 'id', 'latitude', 'longitude', 'name', 'type'];
for (const feature of normalized.collection.features) {
  assert.equal(feature.type, 'Feature');
  assert.equal(feature.geometry.type, 'Point');
  assert.equal(feature.geometry.coordinates.length, 2);
  assert.deepEqual(Object.keys(feature.properties).sort(), allowedKeys);
  assert.ok(allowedTypes.has(feature.properties.type), `unknown type: ${feature.properties.type}`);
  assert.ok(!ids.has(feature.properties.id), `duplicate ID: ${feature.properties.id}`);
  ids.add(feature.properties.id);
  assert.equal(feature.properties.longitude, feature.geometry.coordinates[0]);
  assert.equal(feature.properties.latitude, feature.geometry.coordinates[1]);
  assert.match(feature.properties.id, /^(mount|rock|ridge|hill)(-(main|5000))?-\d{4}$/);
  if (!['main_mountain', 'five_thousander'].includes(feature.properties.type)) {
    assert.equal(feature.properties.name, '', `ordinary point exposes a name: ${feature.properties.id}`);
  }
  if (feature.properties.type === 'five_thousander') {
    assert.ok(feature.properties.elevation_m >= 5000, `invalid five-thousander: ${feature.properties.id}`);
  }
}

const style = mapModule.createStyle({boundary, mountains: normalized.collection});
assert.equal(style.version, 8);
assert.deepEqual(Object.keys(style.sources).sort(), ['boundary', 'mountain-points']);
assert.equal(Object.hasOwn(style, 'terrain'), false);
assert.equal(JSON.stringify(style).includes('raster-dem'), false);
assert.equal(JSON.stringify(style).includes('hillshade'), false);
assert.equal(JSON.stringify(style).includes('fill-extrusion'), false);
assert.equal(style.layers.filter((layer) => layer.type === 'circle').length, 6);
assert.ok(style.layers.every((layer) => !['symbol', 'raster', 'hillshade', 'fill-extrusion'].includes(layer.type)));

const mapSource = fs.readFileSync(new URL('../src/map.js', import.meta.url), 'utf8');
for (const token of [
  'pitch: 0',
  'maxPitch: 0',
  'bearing: 0',
  'dragRotate: false',
  'pitchWithRotate: false',
  'touchPitch: false',
  'renderWorldCopies: false'
]) assert.ok(mapSource.includes(token), `missing flat-map contract: ${token}`);

const appSource = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const bootstrapSource = fs.readFileSync(new URL('../assets/bootstrap.js', import.meta.url), 'utf8');
const indexSource = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const combinedRuntime = `${mapSource}\n${appSource}\n${bootstrapSource}`;
for (const forbidden of ['PMTiles', 'raster-dem', 'setTerrain(', 'localStorage', 'fantasy-relief', 'map-ui.js', 'map-page.js']) {
  assert.equal(combinedRuntime.includes(forbidden), false, `legacy runtime remains active: ${forbidden}`);
}
assert.ok(indexSource.includes('assets/maplibre.css'));
assert.ok(indexSource.includes('styles.css'));
assert.equal(indexSource.includes('assets/map.css'), false);

console.log(JSON.stringify({
  version: config.version,
  sourcePoints: mountainsRaw.features.length,
  displayedPoints: normalized.summary.total,
  invalidPoints: normalized.summary.invalid,
  excludedOutsideBoundary: normalized.summary.outside,
  namedPoints: normalized.summary.named,
  counts: normalized.summary.counts,
  bounds,
  sources: Object.keys(style.sources),
  layers: style.layers.map((layer) => layer.id)
}, null, 2));
