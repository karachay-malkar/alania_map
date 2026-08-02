import assert from 'node:assert/strict';
import fs from 'node:fs';
import config from '../src/config.js';
import dataModule from '../src/data.js';
import mapModule from '../src/map.js';

const readJson = (path) => JSON.parse(fs.readFileSync(new URL(path, import.meta.url), 'utf8'));
const boundary = dataModule.normalizeBoundary(readJson('../data/map-frame.geojson'));
const full = dataModule.normalizeMountainPoints(readJson('../data/archive/mountain_points_full.geojson'), boundary);
const active = dataModule.normalizeMountainPoints(readJson('../data/mountains/mountain_points.geojson'), boundary);
const bindingsRaw = readJson('../data/mountains/mountain_icon_bindings.json');
const icons = dataModule.normalizeBindings(bindingsRaw, active.collection);
const manifest = dataModule.normalizeIconManifest(readJson('../data/mountains/mountain_icon_manifest.json'));
const rivers = dataModule.normalizeRivers(readJson('../data/hydrography/rivers.geojson'));
const selection = readJson('../data/mountains/selection_report.json');
const riverSourceReport = readJson('../data/hydrography/river_source_report.json');
const riverMountainReport = readJson('../data/hydrography/river_mountain_report.json');

assert.equal(config.version, '12.1.3');
assert.equal(full.collection.features.length, 3797);
assert.equal(active.collection.features.length, 1000);
assert.equal(bindingsRaw.length, 1000);
assert.equal(icons.collection.features.length, 1000);
assert.deepEqual(Object.keys(bindingsRaw[0]).sort(), ['base_shift', 'icon_id', 'icon_scale', 'min_zoom', 'point_id', 'priority']);
assert.equal(new Set(bindingsRaw.map((binding) => binding.point_id)).size, 1000);
assert.equal(bindingsRaw.every((binding) => binding.min_zoom === 6.7), true);
assert.equal(bindingsRaw.every((binding) => Math.abs(binding.base_shift) <= 0.2), true);
assert.equal(selection.unbound_points.length, 0);
assert.equal(selection.mount_1_used, false);
assert.deepEqual(selection.mount_11_non_5000, []);
assert.equal(manifest.icons.length, 29);

assert.equal(rivers.collection.features.length, 31);
assert.equal(rivers.summary.representedSystems, 32);
assert.deepEqual(rivers.summary.tiers, {1: 11, 2: 10, 3: 10});
assert.equal(riverSourceReport.source_validation.present, 32);
assert.deepEqual(riverSourceReport.source_validation.missing, []);
assert.deepEqual(riverSourceReport.source_validation.disconnected, []);
assert.ok(riverMountainReport.corridor_point_count >= 800);
assert.equal(readJson('../data/hydrography/rivers.geojson').features.some((feature) => String(feature.properties.class || '').toLowerCase() === 'stream'), false);

const style = mapModule.createStyle({boundary, mountains: active.collection, rivers: rivers.collection});
assert.deepEqual(Object.keys(style.sources).sort(), ['boundary', 'mountain-points', 'rivers']);
assert.equal(style.layers.some((layer) => layer.type === 'symbol'), false);
assert.ok(style.layers.find((layer) => layer.id === config.riverBufferLayerId));
assert.ok(style.layers.find((layer) => layer.id === config.riverLineLayerId));
for (const type of mapModule.CATEGORY_ORDER) {
  const layer = style.layers.find((candidate) => candidate.id === mapModule.categoryLayerId(type));
  assert.equal(layer.layout.visibility, 'none');
}
const styleOrder = style.layers.map((layer) => layer.id);
assert.ok(styleOrder.indexOf('territory-outline') < styleOrder.indexOf(config.riverBufferLayerId));
assert.ok(styleOrder.indexOf(config.riverBufferLayerId) < styleOrder.indexOf(config.riverLineLayerId));
assert.ok(styleOrder.indexOf(config.riverLineLayerId) < styleOrder.indexOf(mapModule.categoryLayerId('mountain')));

const source = fs.readFileSync(new URL('../src/map.js', import.meta.url), 'utf8');
assert.ok(source.includes("type: 'custom'"));
assert.ok(source.includes('gl.drawArrays(gl.TRIANGLES'));
assert.ok(source.includes('buildSpriteMetrics'));
assert.ok(source.includes("map.addLayer(imageLayer, config.riverBufferLayerId)"));
assert.ok(source.includes('base_shift'));
assert.equal(source.includes("map.on('click', config.imageLayerId"), false);
for (const token of ['pitch: 0', 'maxPitch: 0', 'bearing: 0', 'dragRotate: false', 'pitchWithRotate: false', 'touchPitch: false', 'renderWorldCopies: false']) assert.ok(source.includes(token));

console.log(JSON.stringify({
  version: config.version,
  sourcePoints: 3797,
  activePoints: 1000,
  icons: 1000,
  rivers: rivers.summary,
  corridorPoints: riverMountainReport.corridor_point_count,
  sources: Object.keys(style.sources)
}, null, 2));
