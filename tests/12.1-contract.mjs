import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const config = require('../src/config.js');
const dataModule = require('../src/data.js');
const mapModule = require('../src/map.js');

const readJson = (path) => JSON.parse(fs.readFileSync(new URL(path, import.meta.url), 'utf8'));
const boundaryRaw = readJson('../data/map-frame.geojson');
const mountainsRaw = readJson('../data/mountains/mountain_points.geojson');
const fullRaw = readJson('../data/archive/mountain_points_full.geojson');
const bindingsRaw = readJson('../data/mountains/mountain_icon_bindings.json');
const manifestRaw = readJson('../data/mountains/mountain_icon_manifest.json');
const catalog = readJson('../data/mountains/mountain_icon_catalog.json');
const report = readJson('../data/mountains/selection_report.json');

const boundary = dataModule.normalizeBoundary(boundaryRaw);
const normalized = dataModule.normalizeMountainPoints(mountainsRaw, boundary);
const full = dataModule.normalizeMountainPoints(fullRaw, boundary);
const icons = dataModule.normalizeBindings(bindingsRaw, normalized.collection);
const manifest = dataModule.normalizeIconManifest(manifestRaw);
const bounds = dataModule.calculateBounds(boundary);

const expectedCounts = {
  five_thousander: 4,
  main_mountain: 21,
  mountain: 537,
  rock: 236,
  ridge: 0,
  hill: 202
};
const expectedIconCounts = {
  five_thousander: 4,
  main_mountain: 21,
  mountain: 152,
  rock: 67,
  ridge: 0,
  hill: 56
};

assert.equal(config.version, '12.1.1');
assert.ok(boundary.features.length > 0, 'boundary is empty');
assert.ok(bounds.every(Number.isFinite), 'boundary bounds are invalid');
assert.equal(full.collection.features.length, 3797);
assert.equal(normalized.collection.features.length, 1000);
assert.deepEqual(normalized.summary.counts, expectedCounts);
assert.equal(normalized.summary.invalid, 0);
assert.equal(normalized.summary.outside, 0);
assert.equal(normalized.summary.named, 24);
assert.equal(icons.bindings.length, 300);
assert.deepEqual(icons.summary.counts, expectedIconCounts);
assert.deepEqual(icons.summary.tiers, {'6.7': 4, '6.9': 21, '8.2': 75, '9.6': 100, '11': 100});
assert.equal(report.source_points, 3797);
assert.equal(report.active_points, 1000);
assert.equal(report.icon_bindings, 300);
assert.deepEqual(report.mandatory_missing_icons, []);
assert.equal(report.mount_1_used, false);
assert.deepEqual(report.mount_11_non_5000, []);

const allowedTypes = new Set(Object.keys(config.categories));
const fullIds = new Set(full.collection.features.map((feature) => feature.properties.id));
const activeIds = new Set();
const activeById = new Map();
const allowedKeys = ['elevation_m', 'id', 'latitude', 'longitude', 'name', 'type'];
for (const feature of normalized.collection.features) {
  assert.equal(feature.type, 'Feature');
  assert.equal(feature.geometry.type, 'Point');
  assert.deepEqual(Object.keys(feature.properties).sort(), allowedKeys);
  assert.ok(allowedTypes.has(feature.properties.type));
  assert.ok(fullIds.has(feature.properties.id), `active ID is absent in archive: ${feature.properties.id}`);
  assert.ok(!activeIds.has(feature.properties.id), `duplicate ID: ${feature.properties.id}`);
  activeIds.add(feature.properties.id);
  activeById.set(feature.properties.id, feature);
  assert.equal(feature.properties.longitude, feature.geometry.coordinates[0]);
  assert.equal(feature.properties.latitude, feature.geometry.coordinates[1]);
  assert.match(feature.properties.id, /^(mount|rock|ridge|hill)(-(main|5000))?-\d{4}$/);
  if (!['main_mountain', 'five_thousander'].includes(feature.properties.type)) {
    assert.equal(feature.properties.name, '', `ordinary point exposes a name: ${feature.properties.id}`);
  }
  if (feature.properties.type === 'five_thousander') assert.ok(feature.properties.elevation_m >= 5000);
}

const bindingKeys = ['icon_id', 'icon_scale', 'min_zoom', 'point_id', 'priority'];
const boundIds = new Set();
for (const binding of bindingsRaw) {
  assert.deepEqual(Object.keys(binding).sort(), bindingKeys);
  assert.ok(activeIds.has(binding.point_id));
  assert.ok(!boundIds.has(binding.point_id), `duplicate binding: ${binding.point_id}`);
  boundIds.add(binding.point_id);
  assert.match(binding.icon_id, /^mount-(?:[2-9]|1\d|2\d|30)$/);
  assert.notEqual(binding.icon_id, 'mount-1');
  const point = activeById.get(binding.point_id);
  if (binding.icon_id === 'mount-11') assert.equal(point.properties.type, 'five_thousander');
}
for (const feature of normalized.collection.features) {
  if (['main_mountain', 'five_thousander'].includes(feature.properties.type)) {
    assert.ok(boundIds.has(feature.properties.id), `mandatory icon missing: ${feature.properties.id}`);
  }
}

const catalogSets = Object.values(catalog.groups);
const catalogIcons = catalogSets.flat();
assert.equal(new Set(catalogIcons).size, catalogIcons.length, 'icon sets overlap');
assert.deepEqual([...new Set(catalogIcons)].sort((a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1])), Array.from({length: 29}, (_, index) => `mount-${index + 2}`));
assert.equal(catalog.groups.five_thousander.includes('mount-11'), true);
for (const [type, iconIds] of Object.entries(catalog.groups)) {
  for (const binding of bindingsRaw.filter((item) => activeById.get(item.point_id).properties.type === type)) {
    assert.ok(iconIds.includes(binding.icon_id), `wrong icon type: ${binding.point_id} -> ${binding.icon_id}`);
  }
}
assert.equal(manifest.icons.length, 29);
assert.deepEqual(manifest.icons.map((icon) => icon.id).sort((a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1])), Array.from({length: 29}, (_, index) => `mount-${index + 2}`));

const atlas = fs.readFileSync(new URL('../assets/mountains/mountain-atlas.png', import.meta.url));
assert.equal(atlas.toString('ascii', 1, 4), 'PNG');
assert.equal(atlas.readUInt32BE(16), manifest.atlas_width);
assert.equal(atlas.readUInt32BE(20), manifest.atlas_height);

const style = mapModule.createStyle({boundary, mountains: normalized.collection, icons: icons.collection});
assert.equal(style.version, 8);
assert.deepEqual(Object.keys(style.sources).sort(), ['boundary', 'mountain-icons', 'mountain-points']);
assert.equal(Object.hasOwn(style, 'terrain'), false);
assert.equal(JSON.stringify(style).includes('raster-dem'), false);
assert.equal(JSON.stringify(style).includes('hillshade'), false);
assert.equal(JSON.stringify(style).includes('fill-extrusion'), false);
assert.equal(style.layers.filter((layer) => layer.type === 'circle').length, 6);
assert.equal(config.iconTiers.map(mapModule.createIconLayer).length, 4);
assert.ok(config.iconTiers.map(mapModule.createIconLayer).every((layer) => layer.type === 'symbol'));

const mapSource = fs.readFileSync(new URL('../src/map.js', import.meta.url), 'utf8');
for (const token of ['pitch: 0', 'maxPitch: 0', 'bearing: 0', 'dragRotate: false', 'pitchWithRotate: false', 'touchPitch: false', 'renderWorldCopies: false']) {
  assert.ok(mapSource.includes(token), `missing flat-map contract: ${token}`);
}
const appSource = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const bootstrapSource = fs.readFileSync(new URL('../assets/bootstrap.js', import.meta.url), 'utf8');
const combinedRuntime = `${mapSource}\n${appSource}\n${bootstrapSource}`;
for (const forbidden of ['PMTiles', 'raster-dem', 'setTerrain(', 'localStorage', 'fantasy-relief', 'map-ui.js', 'map-page.js']) {
  assert.equal(combinedRuntime.includes(forbidden), false, `legacy runtime remains active: ${forbidden}`);
}

console.log(JSON.stringify({
  version: config.version,
  sourcePoints: full.collection.features.length,
  activePoints: normalized.summary.total,
  counts: normalized.summary.counts,
  iconBindings: icons.summary.total,
  iconCounts: icons.summary.counts,
  iconTiers: icons.summary.tiers,
  atlas: {width: manifest.atlas_width, height: manifest.atlas_height, icons: manifest.icons.length},
  bounds,
  sources: Object.keys(style.sources),
  baseLayers: style.layers.map((layer) => layer.id),
  iconLayers: config.iconTiers.map((tier) => mapModule.iconLayerId(tier))
}, null, 2));
