import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const AlanMap = require('../assets/map-ui.js');
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

const adapterParts = Array.from({length: 6}, (_, index) =>
  fs.readFileSync(new URL(`../assets/slippy-hybrid.part-${String(index).padStart(3, '0')}.js`, import.meta.url), 'utf8')
);
const adapterSource = adapterParts.join('');
const sandbox = {
  console,
  URL,
  Object,
  Array,
  Number,
  String,
  Math,
  Promise,
  Map,
  Set,
  Proxy,
  Reflect,
  AlanMap: {mount() { return {}; }}
};
sandbox.self = sandbox;
vm.createContext(sandbox);
new vm.Script(adapterSource, {filename: 'slippy-hybrid.js'}).runInContext(sandbox);
const SlippyHybrid = sandbox.AlanSlippyHybrid;
assert.ok(SlippyHybrid);
assert.equal(SlippyHybrid.version, '7.0.23-slippy-hybrid-icons');

const point = (coordinates, properties = {}) => ({
  type: 'Feature',
  properties,
  geometry: {type: 'Point', coordinates}
});
const mountains = SlippyHybrid.buildMountainCollection({
  highPeaks: {
    type: 'FeatureCollection',
    features: [
      point([42.10, 43.10], {name_ru: 'Пятитысячник', ele: 5100, peak_level: 1}),
      point([42.20, 43.20], {name_ru: 'Высокая', ele: 4500, peak_level: 1})
    ]
  },
  peaks: {
    type: 'FeatureCollection',
    features: [
      point([42.10, 43.10], {name_ru: 'Дубликат', ele: 3000}),
      point([42.30, 43.30], {name_ru: 'Обычная', ele: 3300})
    ]
  },
  objects: {
    type: 'FeatureCollection',
    features: [
      point([42.40, 43.40], {name_ru: 'Горный объект', object_type: 'mountain', elevation_m: 3600}),
      point([42.50, 43.50], {name_ru: 'Не гора', object_type: 'water'})
    ]
  }
});
assert.equal(mountains.features.length, 4, 'mountain points must be deduplicated and non-mountain objects excluded');
const fiveThousander = mountains.features.find((feature) => feature.properties.source_name === 'Пятитысячник');
assert.equal(fiveThousander.properties.mountain_category, 'five_thousander');
assert.equal(fiveThousander.properties.mountain_icon, 'mount-11');
for (const feature of mountains.features) {
  assert.notEqual(feature.properties.mountain_icon, 'mount-1');
  if (feature.properties.mountain_icon === 'mount-11') {
    assert.ok(feature.properties.elevation_m >= 5000, 'mount-11 must be restricted to real five-thousanders');
  }
}
assert.equal(
  mountains.features.filter((feature) => feature.properties.mountain_icon === 'mount-11').length,
  1
);
assert.equal(
  mountains.features.find((feature) => feature.properties.source_name === 'Высокая').properties.mountain_category,
  'high'
);
assert.equal(
  mountains.features.find((feature) => feature.properties.source_name === 'Обычная').properties.mountain_category,
  'standard'
);

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
assert.equal(bootstrap.includes("loadScript('fantasy-relief.js')"), false);
assert.equal(bootstrap.includes("loadScript('fantasy-style.js')"), false);
const mapUiPosition = bootstrap.indexOf("loadScript('map-ui.js')");
const adapterPosition = bootstrap.indexOf('slippy-hybrid.part-000.js');
const pagePosition = bootstrap.indexOf("loadScript('map-page.js')");
assert.ok(mapUiPosition >= 0 && adapterPosition > mapUiPosition && pagePosition > adapterPosition);
for (let index = 0; index < 6; index += 1) {
  assert.ok(bootstrap.includes(`slippy-hybrid.part-${String(index).padStart(3, '0')}.js`));
}

assert.equal(/https?:\/\//.test(adapterSource), false, 'Slippy adapter must not use external resources');
assert.ok(adapterSource.includes("bearing: 0"));
assert.ok(adapterSource.includes("pitch: 0"));
assert.ok(adapterSource.includes("maxPitch: 0"));
assert.ok(adapterSource.includes("dragRotate: false"));
assert.ok(adapterSource.includes("delete next.style.terrain"));
assert.ok(adapterSource.includes("'settlement-current-points'"));
assert.ok(adapterSource.includes("'osm-peak-points'"));
assert.ok(adapterSource.includes("map.addLayer(layer, beforeId)"));

const mountainDirectory = new URL('../assets/mountains/', import.meta.url);
const mountainFiles = fs.readdirSync(mountainDirectory).filter((name) => /^mount-\d+\.png$/.test(name)).sort();
assert.equal(mountainFiles.length, 29);
assert.equal(mountainFiles.includes('mount-1.png'), false);
for (let index = 2; index <= 30; index += 1) {
  assert.ok(mountainFiles.includes(`mount-${index}.png`), `missing mount-${index}.png`);
}

console.log(JSON.stringify({
  version: AlanMap.version,
  balanced,
  slippy: {
    version: SlippyHybrid.version,
    mountainCount: mountains.features.length,
    mountainFiles: mountainFiles.length,
    categories: mountains.features.reduce((result, feature) => {
      const category = feature.properties.mountain_category;
      result[category] = (result[category] || 0) + 1;
      return result;
    }, {})
  }
}, null, 2));
