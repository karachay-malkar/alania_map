import assert from 'node:assert/strict';
import fs from 'node:fs';
import config from '../src/config.js';
import dataModule from '../src/data.js';
import mapModule from '../src/map.js';

const readJson = (path) => JSON.parse(fs.readFileSync(new URL(path, import.meta.url), 'utf8'));
const boundary = dataModule.normalizeBoundary(readJson('../data/map-frame-12.1.5.geojson'));
const render = dataModule.normalizeRender(readJson('../data/mountains/mountain-render-12.1.5.geojson'));
const manifest = dataModule.normalizeIconManifest(readJson('../data/mountains/mountain-icon-manifest-12.1.5.json'));
const rivers = dataModule.normalizeRivers(readJson('../data/hydrography/rivers-12.1.5.geojson'));
const full = readJson('../data/archive/mountain_points_full.geojson');
const active = readJson('../data/mountains/mountain_points.geojson');
const bindings = readJson('../data/mountains/mountain_icon_bindings.json');
const selection = readJson('../data/mountains/selection_report.json');
const riverReport = readJson('../data/hydrography/river_mountain_report.json');
const riverSourceReport = readJson('../data/hydrography/river_source_report.json');
const catalog = readJson('../data/mountains/mountain_icon_catalog.json');

assert.equal(config.version, '12.1.5');
assert.equal(full.features.length, 3797);
assert.equal(active.features.length, 1000);
assert.equal(render.collection.features.length, 1000);
assert.equal(bindings.length, 1000);
assert.equal(new Set(bindings.map((binding) => binding.point_id)).size, 1000);
assert.equal(selection.version, '12.1.5');
assert.equal(selection.active_points, 1000);
assert.equal(selection.synthetic_point_count, selection.actual_counts.ridge);
assert.ok(selection.synthetic_point_count > 0);
assert.equal(selection.unbound_points.length, 0);
assert.equal(selection.mount_1_used, false);
assert.deepEqual(selection.mount_11_non_5000, []);
assert.equal(catalog.version, '12.1.5');
assert.equal(manifest.icons.length, 29);
assert.equal(manifest.atlas, 'assets/mountains/mountain-atlas-12.1.5.png');
assert.equal(render.summary.counts.ridge, selection.synthetic_point_count);
assert.equal(render.collection.features.find((feature) => feature.properties.id === 'mount-5000-0002').properties.name, 'Джанги-Тау Восточная');
assert.equal(render.collection.features.find((feature) => feature.properties.id === 'mount-main-0013').properties.name, 'Пик 4859');

assert.equal(rivers.collection.features.length, 31);
assert.equal(rivers.summary.representedSystems, 32);
assert.deepEqual(rivers.summary.tiers, {1: 11, 2: 10, 3: 10});
assert.equal(riverSourceReport.version, '12.1.5');
assert.equal(riverSourceReport.source_validation.present, 32);
assert.deepEqual(riverSourceReport.source_validation.missing, []);
assert.deepEqual(riverSourceReport.source_validation.disconnected, []);
assert.equal(riverReport.version, '12.1.5');
assert.equal(riverReport.all_chain_targets_pass, true);
assert.ok(riverReport.source_anchor_count >= 300);
assert.ok(riverReport.synthetic_ridge_anchor_count > 0);
for (const chain of riverReport.chains) assert.ok(chain.max_longitudinal_gap_km <= chain.target_gap_km, JSON.stringify(chain));
for (const systemId of ['cherek-balkarsky', 'cherek-bezengiysky', 'kuban', 'teberda', 'malka', 'chegem', 'baksan', 'bolshoy-zelenchuk']) {
  const system = riverReport.systems[systemId];
  assert.ok(system, `missing station report for ${systemId}`);
  assert.ok(system.max_longitudinal_gap_km <= system.target_gap_km, JSON.stringify({systemId, system}));
}

const iconById = new Map(manifest.icons.map((icon) => [icon.id, icon]));
for (const [pointId, iconId] of Object.entries(selection.five_thousander_icons)) {
  assert.ok(iconById.get(iconId)?.roles.includes('peak'), `${pointId} uses non-peak ${iconId}`);
}
assert.equal(new Set(Object.values(selection.five_thousander_icons)).size, 4);

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
assert.ok(style.layers.find((layer) => layer.id === config.riverBufferLayerId));
assert.ok(style.layers.find((layer) => layer.id === config.riverLineLayerId));

const mapSource = fs.readFileSync(new URL('../src/map.js', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const appBundle = fs.readFileSync(new URL('../assets/app-12.1.5.js', import.meta.url), 'utf8');
const maplibreBundle = fs.readFileSync(new URL('../assets/maplibre-12.1.5.js', import.meta.url), 'utf8');
assert.ok(mapSource.includes("type: 'custom'"));
assert.ok(mapSource.includes('gl.drawArrays(gl.TRIANGLES'));
assert.ok(mapSource.includes('const left = coordinate.x - width * (icon.center_x / icon.width)'));
assert.ok(mapSource.includes('const top = coordinate.y - height * (icon.center_y / icon.height)'));
assert.ok(mapSource.includes('antialias: false'));
assert.ok(mapSource.includes('pixelRatio: Math.min'));
assert.equal(mapSource.includes("map.on('mousemove'"), false);
assert.equal(mapSource.includes("map.on('click'"), false);
assert.equal(index.includes('assets/bootstrap.js'), false);
assert.equal(index.includes('eval('), false);
assert.equal(appBundle.includes('eval('), false);
assert.equal(maplibreBundle.includes('eval('), false);
assert.ok(index.includes('assets/maplibre-12.1.5.js'));
assert.ok(index.includes('assets/app-12.1.5.js'));
assert.ok(index.includes('styles-12.1.5.css'));
assert.ok(index.includes('Content-Security-Policy'));
assert.equal(fs.existsSync(new URL('../assets/bootstrap.js', import.meta.url)), false);
for (const path of Object.values(selection.runtime_files)) assert.ok(fs.existsSync(new URL(`../${path}`, import.meta.url)), `missing runtime file ${path}`);

console.log(JSON.stringify({
  version: config.version,
  sourcePoints: full.features.length,
  activePoints: active.features.length,
  counts: selection.actual_counts,
  sourceAnchors: riverReport.source_anchor_count,
  syntheticRidgeAnchors: riverReport.synthetic_ridge_anchor_count,
  chainTargetsPassed: riverReport.all_chain_targets_pass,
  fiveThousanderIcons: selection.five_thousander_icons,
  runtimeFiles: selection.runtime_files,
  maplibreBytes: Buffer.byteLength(maplibreBundle),
  appBytes: Buffer.byteLength(appBundle)
}, null, 2));
