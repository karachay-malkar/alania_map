import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const AlanMap = require('../assets/map-ui.js');
const FantasyRelief = require('../assets/fantasy-relief.js');
const FantasyStyle = require('../assets/fantasy-style.js');
const test = AlanMap.__test;

assert.equal(AlanMap.version, '7.0.23');
const balanced = test.resolveQualityProfile({}, {
  devicePixelRatio: 3,
  deviceMemory: 8,
  hardwareConcurrency: 12
});
assert.equal(balanced.mode, 'balanced');
assert.equal(balanced.pixelRatio, 1.75);
assert.equal(balanced.antialias, false);
assert.ok(balanced.maxTileCacheSize <= 96);

const empty = {type: 'FeatureCollection', features: []};
const runtime = test.buildRuntimeSourceData({
  focus: empty,
  glaciers: empty,
  elbrusSnow: empty,
  peakSnow: empty,
  rivers: empty,
  ridges: empty,
  regionalLabels: empty,
  boundaries: empty,
  objects: empty,
  modernObjects: empty,
  peaks: empty,
  highPeaks: empty,
  passes: empty,
  mainLakes: {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {lake_id: 'must-not-be-a-point'},
      geometry: {type: 'Point', coordinates: [43, 43]}
    }]
  }
});
assert.equal(
  runtime.points.features.some((feature) => feature.properties?.alan_source === 'mainLakes'),
  false
);

assert.equal(FantasyRelief.version, '1.0.0');
assert.equal(FantasyStyle.version, '1.0.0');
const fantasyRidges = FantasyRelief.buildRidgeCollection({
  type: 'FeatureCollection',
  features: [
    {type:'Feature',properties:{tier:1},geometry:{type:'LineString',coordinates:[[41.2,43.1],[42.2,43.6]]}},
    {type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[[42.0,43.1],[42.45,43.28]]}},
    {type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[[42.2,43.2],[42.25,43.23]]}}
  ]
});
assert.equal(fantasyRidges.features.length, 3);
assert.deepEqual(
  new Set(fantasyRidges.features.map((feature) => feature.properties.fantasy_class)),
  new Set(['main','secondary','spur'])
);
assert.ok(fantasyRidges.features.every((feature) => /^fantasy-mountain-(main|secondary|spur)-\d$/.test(feature.properties.fantasy_icon)));
assert.deepEqual(
  FantasyStyle.createFantasyLayers().map((layer) => layer.id),
  FantasyStyle.layerIds
);
assert.ok(FantasyStyle.layerIds.includes('fantasy-paper-grain'));
assert.ok(FantasyStyle.layerIds.includes('fantasy-mountains-main'));
assert.ok(FantasyStyle.layerIds.includes('fantasy-slope-hachures'));

const mapUi = fs.readFileSync(new URL('../assets/map-ui.js', import.meta.url), 'utf8');
for (const obsolete of [
  "id:'glacier-fill'", "id:'peak-snow'", "id:'elbrus-snow-",
  "id:'river-halo'", "id:'river-main'", "id:'main-lake-points'"
]) {
  assert.equal(mapUi.includes(obsolete), false, `obsolete layer remains: ${obsolete}`);
}
assert.ok(mapUi.includes("id:'osm-river-halo'"));
assert.ok(mapUi.includes("id:'osm-river-line'"));
assert.ok(mapUi.includes("minzoom:10.5"));

const pageLoader = fs.readFileSync(new URL('../assets/map-page.js', import.meta.url), 'utf8');
assert.ok(pageLoader.includes('MAX_CACHED_SHARDS = 16'));
assert.ok(pageLoader.includes("cache: index === 0 ? 'no-cache' : 'default'"));
assert.equal(pageLoader.includes("'force-cache'"), false);
assert.ok(pageLoader.includes('shards-manifest.json'));

const bootstrap = fs.readFileSync(new URL('../assets/bootstrap.js', import.meta.url), 'utf8');
assert.equal(bootstrap.includes('map-natural.js'), false);
const mapUiPosition = bootstrap.indexOf("loadScript('map-ui.js')");
const reliefPosition = bootstrap.indexOf("loadScript('fantasy-relief.js')");
const stylePosition = bootstrap.indexOf("loadScript('fantasy-style.js')");
const pagePosition = bootstrap.indexOf("loadScript('map-page.js')");
assert.ok(mapUiPosition >= 0 && reliefPosition > mapUiPosition && stylePosition > reliefPosition && pagePosition > stylePosition);

for (const file of ['../assets/fantasy-relief.js','../assets/fantasy-style.js']) {
  const content = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  assert.equal(/https?:\/\//.test(content), false, `external dependency in ${file}`);
}

console.log(JSON.stringify({
  version: AlanMap.version,
  balanced,
  fantasy: {
    reliefVersion: FantasyRelief.version,
    styleVersion: FantasyStyle.version,
    ridgeDiagnostics: fantasyRidges.diagnostics,
    layerIds: FantasyStyle.layerIds
  }
}, null, 2));
