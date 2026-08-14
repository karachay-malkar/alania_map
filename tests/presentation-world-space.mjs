import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require=createRequire(import.meta.url);
const base=require('../assets/map-presentation.js');
const source=fs.readFileSync('assets/map-presentation-r2.js','utf8');
assert.match(source,/7\.2\.2-r2/);
assert.match(source,/native-map-scene/);
assert.match(source,/alan-native-presentation/);
assert.ok(!source.includes('map.project('));
assert.ok(!source.includes('requestAnimationFrame'));
assert.ok(!source.includes('createElementNS'));
assert.match(source,/MutationObserver/);
assert.match(source,/addSource\(SOURCE/);
assert.match(source,/addLayer\(layer\)/);

class MockObserver{constructor(cb){this.cb=cb;}observe(){}}
const host={querySelectorAll:()=>[],addEventListener:()=>{}};
const root={
  document:{getElementById:()=>host},
  MutationObserver:MockObserver,
  AlanMapPresentation:base,
  ALAN_MAP_DATA:null,
  ALAN_MAP_INSTANCE:null
};
vm.runInNewContext(source,{self:root,MutationObserver:MockObserver,console});
const r2=root.AlanMapPresentationR2;
assert.ok(r2);
assert.equal(r2.version,'7.2.2-r2');
assert.equal(r2.sourceId,'alan-native-presentation');

const data={mapFrame:{features:[{geometry:{type:'Polygon',coordinates:[[
  [40.51784,43.41265],[43.731622,42.734095],[44.184003,43.85642],[40.970221,44.534975],[40.51784,43.41265]
]]}}]}};
const diag={
  parchmentAnchors:{edgeA:[43.959202,43.298704],corner:[44.184003,43.856420],edgeC:[42.946104,44.117789]},
  parchmentCompass:[43.75,43.78]
};
const geojson=r2.buildGeoJSON(data,diag,base.__test);
assert.equal(geojson.type,'FeatureCollection');
assert.equal(geojson.metadata.coordinateSpace,'geographic-world');
assert.equal(geojson.metadata.frameWidthM,2000);
assert.equal(geojson.metadata.compassRadiusM,22000);
const kinds=new Set(geojson.features.map(f=>f.properties.kind));
for(const kind of ['frame','frame_outer','frame_inner','frame_ornament','parchment','parchment_edge','compass_ring_outer','compass_needle','compass_letter'])assert.ok(kinds.has(kind),kind);
const frame=geojson.features.find(f=>f.properties.kind==='frame');
assert.equal(frame.geometry.coordinates.length,2);
assert.equal(JSON.stringify(frame.geometry.coordinates[0][0]),JSON.stringify([40.51784,43.41265]));
const definitions=r2.definitions();
assert.equal(definitions.length,Object.keys(r2.layers).length);
assert.ok(definitions.every(layer=>layer.source==='alan-native-presentation'));
assert.ok(definitions.every(layer=>['fill','line'].includes(layer.type)));
console.log('presentation-world-space: ok');
