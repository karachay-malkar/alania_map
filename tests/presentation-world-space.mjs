import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const presentation = require('../assets/map-presentation-r2.js');
const ui = require('../assets/map-ui.js');
const source = fs.readFileSync('assets/map-presentation-r2.js','utf8');
const dataSource = fs.readFileSync('assets/map-data.part-000.js','utf8') + fs.readFileSync('assets/map-data.part-001.js','utf8');
const marker = 'window.ALAN_MAP_DATA = ';
let payload = dataSource.slice(dataSource.indexOf(marker) + marker.length).trim();
if (payload.endsWith(';')) payload = payload.slice(0,-1);
const data = JSON.parse(payload);

assert.equal(presentation.version,'7.2.2-r5');
assert.equal(presentation.config.presentationSpace,'native-map-scene');
assert.equal(presentation.config.frameWidthM,2000);
assert.equal(presentation.config.ornamentRepeatM,4800);
assert.equal(presentation.config.compassRadiusM,22000);
assert.ok(!source.includes('map.project('));
assert.ok(!source.includes('requestAnimationFrame'));
assert.ok(!source.includes('createElementNS'));
assert.ok(!source.includes('MutationObserver'));
assert.ok(!source.includes("map.on('render'"));
assert.ok(!source.includes('AlanMapPresentation?.__test'));
assert.match(source,/addSource\(SOURCE/);
assert.match(source,/addLayer\(layer\)/);

const parchment = ui.__test.parchmentCornerCollections(data);
const diagnostics={parchmentAnchors:parchment.anchors,parchmentCompass:parchment.compassCoordinates};
const outer=presentation.__test.frameRingFromData(data);
const inner=presentation.__test.insetPolygonMeters(outer,2000);
const ornament=presentation.__test.buildWorldOrnamentGeometry(outer,inner,4800);
assert.equal(outer.length,4);
assert.equal(inner.length,4);
assert.ok(ornament.length>100);
assert.deepEqual(presentation.__test.buildWorldOrnamentGeometry(outer,inner,4800),ornament);

const geojson=presentation.buildGeoJSON(data,diagnostics);
assert.equal(geojson.type,'FeatureCollection');
assert.equal(geojson.metadata.coordinateSpace,'geographic-world');
assert.equal(geojson.metadata.frameWidthM,2000);
assert.equal(geojson.metadata.compassRadiusM,22000);
const kinds=new Set(geojson.features.map((feature)=>feature.properties.kind));
for(const kind of ['frame','frame_outer','frame_inner','frame_ornament','parchment','parchment_edge','compass_ring_outer','compass_needle','compass_letter']) assert.ok(kinds.has(kind),kind);
const frame=geojson.features.find((feature)=>feature.properties.kind==='frame');
assert.equal(frame.geometry.coordinates.length,2);
assert.deepEqual(frame.geometry.coordinates[0][0],[40.51784,43.41265]);
const definitions=presentation.definitions();
assert.equal(definitions.length,Object.keys(presentation.layers).length);
assert.ok(definitions.every((layer)=>layer.source==='alan-native-presentation'));
assert.ok(definitions.every((layer)=>['fill','line'].includes(layer.type)));

function flattenCoordinates(geometry) {
  const output=[];
  const visit=(value) => {
    if (Array.isArray(value) && value.length >= 2 && value.slice(0,2).every(Number.isFinite)) { output.push([value[0],value[1]]); return; }
    if (Array.isArray(value)) value.forEach(visit);
  };
  visit(geometry.coordinates);
  return output;
}
function pointInPolygon(point, ring) {
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const [xi,yi]=ring[i], [xj,yj]=ring[j];
    const intersect=((yi>point[1]) !== (yj>point[1])) && (point[0] < (xj-xi)*(point[1]-yi)/((yj-yi)||1e-12)+xi);
    if(intersect) inside=!inside;
  }
  return inside;
}
const projection=presentation.__test.metersProjection(outer);
const frameMeters=outer.map(projection.toMeters);
function segmentDistance(point,a,b) {
  const px=point[0],py=point[1],ax=a[0],ay=a[1],bx=b[0],by=b[1];
  const dx=bx-ax,dy=by-ay,length2=dx*dx+dy*dy||1;
  const t=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/length2));
  return Math.hypot(px-(ax+dx*t),py-(ay+dy*t));
}
const compassCoordinates=geojson.features
  .filter((feature)=>String(feature.properties.kind).startsWith('compass_'))
  .flatMap((feature)=>flattenCoordinates(feature.geometry));
assert.ok(compassCoordinates.length>100);
assert.ok(compassCoordinates.every((point)=>pointInPolygon(point,outer)), 'compass must remain inside mapFrame');
let minimumFrameDistance=Infinity;
for(const coordinate of compassCoordinates) {
  const point=projection.toMeters(coordinate);
  for(let index=0;index<frameMeters.length;index+=1) minimumFrameDistance=Math.min(minimumFrameDistance,segmentDistance(point,frameMeters[index],frameMeters[(index+1)%frameMeters.length]));
}
assert.ok(minimumFrameDistance>1500,`compass clearance is too small: ${minimumFrameDistance.toFixed(1)} m`);
assert.equal(parchment.layout.compassSafeEdgeMarginM,34000);

console.log('presentation-world-space: ok');
