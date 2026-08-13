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

// Regional names are fixed world objects 7000 m above the map plane.
const regional = require('../assets/map-core.js');
assert.equal(regional.config.altitudeM, 7000);
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
}, mockMapLibre, 7000);
assert.equal(quad.length, 30);
const zValues = Array.from({length:6}, (_,index) => quad[index * 5 + 2]);
assert.ok(zValues.every(value => Math.abs(value - 0.007) < 1e-6));
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
assert.equal(ring.length, 5);
const uniqueX = new Set(ring.map(p => p[0]));
const uniqueY = new Set(ring.map(p => p[1]));
assert.equal(uniqueX.size, 2);
assert.equal(uniqueY.size, 2);
assert.deepEqual(data.bounds, [Math.min(...uniqueX), Math.min(...uniqueY), Math.max(...uniqueX), Math.max(...uniqueY)]);
assert.deepEqual(data.bounds, [40.95,42.95,43.55,44.35]);
assert.deepEqual(data.center, [42.25,43.65]);
if (data.regionalLandcover?.available) {
  assert.equal(data.regionalLandcover.source, 'Copernicus CLMS LCM-10');
  assert.ok(data.regionalLandcover.archivePath.includes('landcover-7.0.25.pmtiles'));
}

console.log('runtime-contract: ok');
