import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const bootstrap = fs.readFileSync('assets/bootstrap.js','utf8');
const coreSource = fs.readFileSync('assets/map-core.js','utf8');
const uiSource = fs.readFileSync('assets/map-ui.js','utf8');
const page = fs.readFileSync('assets/map-page.js','utf8');
const dataSource = fs.readFileSync('assets/map-data.part-000.js','utf8') + fs.readFileSync('assets/map-data.part-001.js','utf8');

assert.match(uiSource, /const VERSION = '7\.0\.25'/);
assert.ok(!bootstrap.includes('fantasy-relief.js'));
assert.ok(!bootstrap.includes('fantasy-style.js'));
assert.ok(!fs.existsSync('assets/fantasy-relief.js'));
assert.ok(!fs.existsSync('assets/fantasy-style.js'));
assert.match(uiSource, /data\.regionalDem\.encoding \|\| 'terrarium'/);
assert.match(uiSource, /copernicus-landcover/);
assert.match(page, /regionalLandcover\?\.archivePath/);

// Presentation contract: three visual scales only.
const ui = require('../assets/map-ui.js');
const presentation = ui.__test.objectPresentation;
assert.equal(ui.__test.visibilityZoom.DISTANT, 7);
assert.equal(ui.__test.visibilityZoom.CLOSE, 10);
assert.equal(ui.__test.visibilityZoom.DETAIL, 12);
assert.equal(presentation.currentSettlements.minZoom, 10);
assert.equal(presentation.fiveThousanders.minZoom, 10);
assert.equal(presentation.historicSettlements.minZoom, 12);
assert.equal(presentation.historicObjects.minZoom, 12);
assert.equal(presentation.mountainObjects.minZoom, 12);
assert.equal(presentation.passes.minZoom, 12);
assert.equal(presentation.waterObjects.minZoom, 12);
assert.equal(presentation.naturalObjects.minZoom, 12);
assert.equal(presentation.modernObjects.minZoom, 12);

// Point sizes are screen-space constants at every zoom.
assert.deepEqual(ui.__test.pointStyle.large, {diameter:10, radius:4, strokeWidth:1});
assert.deepEqual(ui.__test.pointStyle.small, {diameter:7, radius:2.5, strokeWidth:1});
const fixedPointPaint = ui.__test.pointPaint('large','#000','#fff');
assert.equal(fixedPointPaint['circle-radius'], 4);
assert.equal(fixedPointPaint['circle-stroke-width'], 1);
assert.equal(fixedPointPaint['circle-pitch-scale'], 'viewport');
assert.equal(fixedPointPaint['circle-pitch-alignment'], 'viewport');

// Only five-thousanders from the OSM peak source are rendered, starting at z10.
assert.match(uiSource, /id:'osm-peak-points'.*?minzoom:OBJECT_PRESENTATION\.fiveThousanders\.minZoom.*?\['==',\['get','peak_level'\],1\]/s);
assert.match(uiSource, /id:'osm-peak-labels'.*?minzoom:OBJECT_PRESENTATION\.fiveThousanders\.minZoom.*?\['==',\['get','peak_level'\],1\]/s);
assert.ok(!uiSource.includes("'circle-radius':['match',['get','peak_level']"));

// Regional names are fixed world objects 10000 m above the map plane.
const regional = require('../assets/map-core.js');
assert.equal(regional.config.altitudeM, 10000);
assert.equal(regional.config.minZoom, 7);
assert.equal(regional.config.maxZoom, 10);
assert.equal(regional.config.mapPlaneAligned, true);
assert.equal(regional.config.billboard, false);
assert.equal(regional.config.fixedGroundScale, true);
assert.equal(regional.config.fixedScreenScale, false);
assert.equal(regional.config.sizingModel, 'fixed-world-axis-length');
assert.match(coreSource, /attribute vec3 a_position/);
assert.ok(!coreSource.includes('u_viewport'));
assert.ok(!coreSource.includes('constant-css-pixel-height'));

const mockMapLibre = {
  MercatorCoordinate: {
    fromLngLat({lng,lat}, altitude) {
      return {x:lng / 360, y:lat / 180, z:altitude / 1_000_000};
    }
  }
};
const quad = regional.__test.buildLabelQuad({
  line:[[42,43],[42.2,43.1]],
  midpoint:[42.1,43.05],
  imageWidth:400,
  imageHeight:100,
  worldScale:0.6,
  uv:{left:0,right:1,top:1,bottom:0}
}, mockMapLibre, 10000);
assert.equal(quad.length, 30);
const zValues = Array.from({length:6}, (_,index) => quad[index * 5 + 2]);
assert.ok(zValues.every(value => Math.abs(value - 0.01) < 1e-6));
assert.notEqual(quad[0], quad[5]);
assert.notEqual(quad[1], quad[6]);

const marker = 'window.ALAN_MAP_DATA = ';
let payload = dataSource.slice(dataSource.indexOf(marker) + marker.length).trim();
if (payload.endsWith(';')) payload = payload.slice(0,-1);
const data = JSON.parse(payload);
assert.equal(data.version, '7.0.25');
assert.equal(data.applicationVersion, '7.0.25');
assert.equal(data.regionalDem.source, 'Copernicus DEM GLO-30');
assert.equal(data.regionalDem.encoding, 'mapbox');
const ring = data.mapFrame.features[0].geometry.coordinates[0];
const expectedRing = [
  [40.51784,43.41265],
  [43.731622,42.734095],
  [44.184003,43.85642],
  [40.970221,44.534975],
  [40.51784,43.41265]
];
assert.deepEqual(ring, expectedRing);
const xs = ring.slice(0,-1).map(p => p[0]);
const ys = ring.slice(0,-1).map(p => p[1]);
assert.deepEqual(data.bounds, [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
assert.deepEqual(data.bounds, [40.51784,42.734095,44.184003,44.534975]);
assert.deepEqual(data.center, [42.350921,43.634535]);
assert.deepEqual(data.focus.features[0].geometry.coordinates[0], expectedRing);
assert.equal(data.frameMask.features[0].geometry.coordinates.length, 2);
assert.deepEqual(data.frameMask.features[0].geometry.coordinates[1], [...expectedRing].reverse());
const runtimeSources = ui.__test.buildRuntimeSourceData(data);
assert.ok(runtimeSources.polygons.features.some(feature => feature.properties?.alan_source === 'frameMask'));
assert.match(uiSource, /id:'frame-mask'.*?sourceFilter\('frameMask'\)/s);
assert.ok(!uiSource.includes('osm-river-halo'));
assert.equal(ui.__test.regionalLabelAltitudeM, 10000);
assert.equal(ui.__test.regionalLabelNarsanaScale, 0.666667);
const regionalScales = new Set((data.regionalLabels?.features || []).map(feature => Number(feature.properties?.display_icon_scale)));
assert.deepEqual([...regionalScales], [0.666667]);
assert.ok(!(data.boundaries?.features || []).some(feature => feature.properties?.boundary_id === 'karachay_balkaria_historical_ethnographic_divide'));
assert.ok(!(data.boundaries?.features || []).some(feature => feature.properties?.boundary_type === 'historical_ethnographic'));
assert.ok(runtimeSources.presentation.beamCount > 0);
assert.ok(runtimeSources.polygons.features.some(feature => feature.properties?.alan_source === 'settlementBeamHalo'));
assert.ok(runtimeSources.polygons.features.some(feature => feature.properties?.alan_source === 'settlementBeamCore'));
assert.deepEqual(ui.__test.parchmentCorner.edgeA, [43.959202,43.298704]);
assert.deepEqual(ui.__test.parchmentCorner.corner, [44.184003,43.856420]);
assert.deepEqual(ui.__test.parchmentCorner.edgeC, [42.946104,44.117789]);
const parchment = ui.__test.parchmentCornerCollections();
assert.deepEqual(parchment.tornEdge[0], [42.946104,44.117789]);
assert.deepEqual(parchment.tornEdge.at(-1), [43.959202,43.298704]);
assert.equal(parchment.ornament.features.length,5);
const parchmentMarkup = ui.__test.parchmentOverlayMarkup();
assert.match(parchmentMarkup, /data-role=\"parchment-fill\"/);
assert.match(parchmentMarkup, /filter:blur\(9px\)/);
assert.match(parchmentMarkup, /data-role=\"parchment-compass\"/);
assert.match(parchmentMarkup, /pointer-events:none/);
assert.match(uiSource, /id:'settlement-beam-halo'.*?maxzoom:OBJECT_PRESENTATION\.currentSettlements\.minZoom/s);
assert.match(uiSource, /id:'settlement-beam-core'.*?fill-extrusion-height':10000/s);
if (data.regionalLandcover?.available) {
  assert.equal(data.regionalLandcover.source, 'Copernicus CLMS LCM-10');
  assert.ok(data.regionalLandcover.archivePath.includes('landcover-7.0.25.pmtiles'));
}

console.log('runtime-contract: ok');
