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
const riverParts = ['major', 'medium', 'minor'].map((name) => readJson(`../data/hydrography/rivers-${name}.geojson`));
const rawRivers = {type: 'FeatureCollection', features: riverParts.flatMap((part) => part.features)};
const rivers = dataModule.normalizeRivers(rawRivers);
const selection = readJson('../data/mountains/selection_report.json');
const catalog = readJson('../data/mountains/mountain_icon_catalog.json');
const riverSourceReport = readJson('../data/hydrography/river_source_report.json');
const riverMountainReport = readJson('../data/hydrography/river_mountain_report.json');

assert.equal(config.version, '12.1.4');
assert.equal(full.collection.features.length, 3797);
assert.equal(active.collection.features.length, 1000);
assert.equal(bindingsRaw.length, 1000);
assert.equal(icons.collection.features.length, 1000);
assert.deepEqual(Object.keys(bindingsRaw[0]).sort(), ['base_shift', 'icon_id', 'icon_scale', 'min_zoom', 'point_id', 'priority']);
assert.equal(new Set(bindingsRaw.map((binding) => binding.point_id)).size, 1000);
assert.equal(bindingsRaw.every((binding) => binding.min_zoom === 6.7), true);
assert.equal(bindingsRaw.every((binding) => Math.abs(binding.base_shift) <= 0.2), true);
assert.equal(selection.version, '12.1.4');
assert.equal(selection.unbound_points.length, 0);
assert.equal(selection.mount_1_used, false);
assert.deepEqual(selection.mount_11_non_5000, []);
assert.equal(catalog.version, '12.1.4');
assert.equal(manifest.icons.length, 29);

assert.equal(rivers.collection.features.length, 31);
assert.equal(rivers.summary.representedSystems, 32);
assert.deepEqual(rivers.summary.tiers, {1: 11, 2: 10, 3: 10});
assert.equal(riverSourceReport.source_validation.present, 32);
assert.deepEqual(riverSourceReport.source_validation.missing, []);
assert.deepEqual(riverSourceReport.source_validation.disconnected, []);
assert.equal(riverMountainReport.version, '12.1.4');
assert.ok(riverMountainReport.corridor_point_count >= 800);
assert.equal(rawRivers.features.some((feature) => String(feature.properties.class || '').toLowerCase() === 'stream'), false);

assert.equal(mapModule.SIZE_MULTIPLIER, 2);
assert.deepEqual(mapModule.BASE_WIDTH_M, {
  mountain: 16000,
  rock: 15200,
  ridge: 17200,
  hill: 15200,
  main_mountain: 20000,
  five_thousander: 24000
});

const style = mapModule.createStyle({boundary, rivers: rivers.collection});
assert.deepEqual(Object.keys(style.sources).sort(), ['boundary', 'rivers']);
assert.equal(style.layers.some((layer) => layer.type === 'symbol' || layer.type === 'circle'), false);
assert.equal(style.layers.some((layer) => layer.source === 'mountain-points'), false);
assert.ok(style.layers.find((layer) => layer.id === config.riverBufferLayerId));
assert.ok(style.layers.find((layer) => layer.id === config.riverLineLayerId));
const styleOrder = style.layers.map((layer) => layer.id);
assert.ok(styleOrder.indexOf('territory-outline') < styleOrder.indexOf(config.riverBufferLayerId));
assert.ok(styleOrder.indexOf(config.riverBufferLayerId) < styleOrder.indexOf(config.riverLineLayerId));

const source = fs.readFileSync(new URL('../src/map.js', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.ok(source.includes("type: 'custom'"));
assert.ok(source.includes('gl.drawArrays(gl.TRIANGLES'));
assert.ok(source.includes('buildSpriteMetrics'));
assert.ok(source.includes("map.addLayer(imageLayer, config.riverBufferLayerId)"));
assert.ok(source.includes('const left = coordinate.x - width * (icon.center_x / icon.width)'));
assert.ok(source.includes('const top = coordinate.y - height * (icon.center_y / icon.height)'));
assert.ok(source.includes('base_shift'));
assert.equal(source.includes('summit_x'), false);
assert.equal(source.includes('summit_y'), false);
assert.equal(source.includes('bindPointInteraction'), false);
assert.equal(source.includes('nearestPointFeature'), false);
assert.equal(source.includes('showFeatureCard'), false);
assert.equal(source.includes("map.on('mousemove'"), false);
assert.equal(source.includes("map.on('click'"), false);
assert.equal(index.includes('feature-card'), false);
assert.equal(index.includes('data-total-points'), false);
for (const token of ['pitch: 0', 'maxPitch: 0', 'bearing: 0', 'dragRotate: false', 'pitchWithRotate: false', 'touchPitch: false', 'renderWorldCopies: false']) assert.ok(source.includes(token));

console.log(JSON.stringify({
  version: config.version,
  sourcePoints: 3797,
  activePoints: 1000,
  icons: 1000,
  sizeMultiplier: mapModule.SIZE_MULTIPLIER,
  anchorMode: 'center',
  pointRendering: false,
  pointInteraction: false,
  rivers: rivers.summary,
  corridorPoints: riverMountainReport.corridor_point_count,
  sources: Object.keys(style.sources)
}, null, 2));
