import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const AlanMap = require('../assets/map-ui.js');
const FantasyRelief = require('../assets/fantasy-relief.js');
const FantasyStyle = require('../assets/fantasy-style.js');
const test = AlanMap.__test;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

assert.equal(AlanMap.version, '8.0');
const balanced = test.resolveQualityProfile({}, {
  devicePixelRatio: 3,
  deviceMemory: 8,
  hardwareConcurrency: 12
});
assert.equal(balanced.mode, 'balanced');
assert.equal(balanced.pixelRatio, 1.75);
assert.equal(balanced.antialias, false);
assert.ok(balanced.maxTileCacheSize <= 96);

const empty = {type:'FeatureCollection',features:[]};
const runtime = test.buildRuntimeSourceData({
  focus:empty,glaciers:empty,elbrusSnow:empty,peakSnow:empty,rivers:empty,ridges:empty,
  regionalLabels:empty,boundaries:empty,objects:empty,modernObjects:empty,peaks:empty,highPeaks:empty,passes:empty,
  mainLakes:{type:'FeatureCollection',features:[{type:'Feature',properties:{lake_id:'must-not-be-a-point'},geometry:{type:'Point',coordinates:[43,43]}}]}
});
assert.equal(runtime.points.features.some((feature) => feature.properties?.alan_source === 'mainLakes'),false);

assert.equal(FantasyRelief.version,'2.0.0');
assert.equal(FantasyStyle.version,'2.0.0');
assert.equal(FantasyRelief.catalog.length,30);
assert.equal(new Set(FantasyRelief.catalog.map((icon) => icon.id)).size,30);
assert.equal(FantasyRelief.imageDefinitions().length,31);
assert.equal(FantasyStyle.layerIds.length,5);
assert.deepEqual(
  FantasyStyle.createFantasyLayers().map((layer) => layer.id),
  FantasyStyle.layerIds
);
for (const expected of [
  'fantasy-paper-grain','fantasy-mountains-primary','fantasy-mountains-secondary',
  'fantasy-mountains-spur','fantasy-elbrus-massif'
]) assert.ok(FantasyStyle.layerIds.includes(expected));

const sampleRidges = {
  type:'FeatureCollection',
  features:[
    {type:'Feature',properties:{axis_id:'ridge_main_caucasus',name_ru:'Главный Кавказский хребет',visible:1},geometry:{type:'LineString',coordinates:[[41.0,43.1],[41.4,43.22],[41.8,43.18],[42.2,43.3]]}},
    {type:'Feature',properties:{axis_id:'axis_baksan_malka_side',name_ru:'Баксано-Малкинский борт',visible:1},geometry:{type:'LineString',coordinates:[[42.4,43.6],[42.7,43.72],[43.0,43.74]]}},
    {type:'Feature',properties:{axis_id:'axis_balkbashi_spur',name_ru:'Балкбашинский отрог',visible:1},geometry:{type:'LineString',coordinates:[[42.0,43.4],[42.12,43.48],[42.24,43.5]]}}
  ]
};
const mountainPoints = FantasyRelief.buildMountainPointCollection(sampleRidges);
assert.ok(mountainPoints.features.length >= 15);
assert.equal(mountainPoints.diagnostics.groupedRidgeCount,3);
assert.equal(mountainPoints.diagnostics.chainCount,3);
assert.ok(mountainPoints.diagnostics.maximumGapRatio <= 0.7);
assert.ok(mountainPoints.features.every((feature) => feature.geometry.type === 'Point'));
assert.ok(mountainPoints.features.every((feature) => /^mount-\d+$/.test(feature.properties.fantasy_icon)));
assert.ok(mountainPoints.features.every((feature) => Number(feature.properties.fantasy_size_z7) > 0));
assert.ok(new Set(mountainPoints.features.map((feature) => feature.properties.fantasy_profile)).has('massif'));
assert.ok(new Set(mountainPoints.features.map((feature) => feature.properties.fantasy_profile)).has('gentle'));
assert.ok(new Set(mountainPoints.features.map((feature) => feature.properties.fantasy_profile)).has('spur'));

const landmark = FantasyRelief.createLandmarkCollection({elbrusFocus:[42.445874,43.349602]});
assert.equal(landmark.features.length,1);
assert.equal(landmark.features[0].properties.fantasy_icon,'fantasy-elbrus');
assert.ok(landmark.features[0].properties.fantasy_size_z7 > 0);
assert.equal(FantasyRelief.createLandmarkCollection({elbrusFocus:null}).features.length,0);

const catalogPath = path.join(root,'assets/mountains/catalog.json');
const catalog = JSON.parse(fs.readFileSync(catalogPath,'utf8'));
assert.equal(catalog.version,'8.0');
assert.equal(catalog.mountains.length,30);
assert.equal(catalog.pixel_ratio,4);

function pngMetadata(filePath) {
  const buffer = fs.readFileSync(filePath);
  assert.equal(buffer.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  return {
    width:buffer.readUInt32BE(16),
    height:buffer.readUInt32BE(20),
    bitDepth:buffer[24],
    colorType:buffer[25]
  };
}

for (let index = 1; index <= 30; index += 1) {
  const metadata = pngMetadata(path.join(root,`assets/mountains/mount-${index}.png`));
  assert.ok(metadata.width > 100 && metadata.height > 70);
  assert.ok([3,6].includes(metadata.colorType),`mount-${index}.png must preserve PNG transparency`);
}
const elbrusMetadata = pngMetadata(path.join(root,'assets/mountains/elbrus.png'));
assert.ok(elbrusMetadata.width > 700);
assert.ok(elbrusMetadata.height > 350);
assert.ok([3,6].includes(elbrusMetadata.colorType));

const mapUi = fs.readFileSync(path.join(root,'assets/map-ui.js'),'utf8');
assert.ok(mapUi.includes("const VERSION = '8.0'"));
assert.ok(mapUi.includes("const DEFAULT_STORAGE_KEY = 'alan-map-stage8.0-view'"));
assert.ok(mapUi.includes("pitch: 0"));
assert.ok(mapUi.includes("layout:{'visibility':'none'},paint:{'hillshade"));
assert.equal(mapUi.includes("terrain: {source:'terrain-dem'"),false);
assert.ok(mapUi.includes('api?.isFantasyStyleEnabled?.()'));

const pageLoader = fs.readFileSync(path.join(root,'assets/map-page.js'),'utf8');
assert.ok(pageLoader.includes("const VERSION = '8.0'"));
assert.ok(pageLoader.includes('MAX_CACHED_SHARDS = 16'));
assert.ok(pageLoader.includes("cache: index === 0 ? 'no-cache' : 'default'"));
assert.equal(pageLoader.includes("'force-cache'"),false);

const bootstrap = fs.readFileSync(path.join(root,'assets/bootstrap.js'),'utf8');
const mapUiPosition = bootstrap.indexOf("loadScript('map-ui.js')");
const reliefPosition = bootstrap.indexOf("loadScript('fantasy-relief.js')");
const stylePosition = bootstrap.indexOf("loadScript('fantasy-style.js')");
const pagePosition = bootstrap.indexOf("loadScript('map-page.js')");
assert.ok(mapUiPosition >= 0 && reliefPosition > mapUiPosition && stylePosition > reliefPosition && pagePosition > stylePosition);

for (const file of ['assets/fantasy-relief.js','assets/fantasy-style.js']) {
  const content = fs.readFileSync(path.join(root,file),'utf8');
  assert.equal(/https?:\/\//.test(content),false,`external dependency in ${file}`);
}
const reliefSource = fs.readFileSync(path.join(root,'assets/fantasy-relief.js'),'utf8');
assert.equal(reliefSource.includes('mountainImage('),false);
assert.equal(reliefSource.includes('smoothMountainOutline'),false);
assert.ok(reliefSource.includes('buildMountainPointCollection'));
assert.ok(reliefSource.includes('stitchRidgeParts'));
const styleSource = fs.readFileSync(path.join(root,'assets/fantasy-style.js'),'utf8');
assert.ok(styleSource.includes("'icon-rotation-alignment':'viewport'"));
assert.ok(styleSource.includes("'icon-pitch-alignment':'viewport'"));
assert.ok(styleSource.includes("'icon-anchor':'bottom'"));
assert.ok(styleSource.includes("['exponential',2]"));
assert.ok(styleSource.includes('map.setTerrain(null)'));
assert.ok(styleSource.includes('map.setMaxPitch(0)'));

const dataScript = (
  fs.readFileSync(path.join(root,'assets/map-data.part-000.js'),'utf8') +
  fs.readFileSync(path.join(root,'assets/map-data.part-001.js'),'utf8')
).trim();
const data = JSON.parse(dataScript.slice('window.ALAN_MAP_DATA = '.length,-1));
assert.equal(data.applicationVersion,'7.0.23');
assert.equal(data.version,'7.0.23');
assert.equal(data.stage,'7.0.23');
assert.equal(data.dataVersion,'7.0.23-osm-natural.2');
assert.equal(data.regionalVector.archivePath,'data/alan-vector-7.0.23.pmtiles');

console.log(JSON.stringify({
  version:AlanMap.version,
  balanced,
  fantasy:{
    reliefVersion:FantasyRelief.version,
    styleVersion:FantasyStyle.version,
    mountainLibraryCount:FantasyRelief.catalog.length,
    sampleDiagnostics:mountainPoints.diagnostics,
    layerIds:FantasyStyle.layerIds,
    elbrus:elbrusMetadata
  }
},null,2));
