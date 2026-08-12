import fs from 'node:fs';
import assert from 'node:assert/strict';

const bootstrap = fs.readFileSync('assets/bootstrap.js','utf8');
const ui = fs.readFileSync('assets/map-ui.js','utf8');
const page = fs.readFileSync('assets/map-page.js','utf8');
const dataSource = fs.readFileSync('assets/map-data.part-000.js','utf8') + fs.readFileSync('assets/map-data.part-001.js','utf8');

assert.match(ui, /const VERSION = '7\.0\.24'/);
assert.ok(!bootstrap.includes('fantasy-relief.js'));
assert.ok(!bootstrap.includes('fantasy-style.js'));
assert.ok(!fs.existsSync('assets/fantasy-relief.js'));
assert.ok(!fs.existsSync('assets/fantasy-style.js'));
assert.match(ui, /data\.regionalDem\.encoding \|\| 'terrarium'/);
assert.match(ui, /copernicus-landcover/);
assert.match(page, /regionalLandcover\?\.archivePath/);

const marker = 'window.ALAN_MAP_DATA = ';
let payload = dataSource.slice(dataSource.indexOf(marker) + marker.length).trim();
if (payload.endsWith(';')) payload = payload.slice(0,-1);
const data = JSON.parse(payload);
assert.equal(data.version, '7.0.24');
assert.equal(data.applicationVersion, '7.0.24');
assert.equal(data.regionalDem.source, 'Copernicus DEM GLO-30');
assert.equal(data.regionalDem.encoding, 'mapbox');
const ring = data.mapFrame.features[0].geometry.coordinates[0];
assert.equal(ring.length, 5);
const uniqueX = new Set(ring.map(p => p[0]));
const uniqueY = new Set(ring.map(p => p[1]));
assert.equal(uniqueX.size, 2);
assert.equal(uniqueY.size, 2);
assert.deepEqual(data.bounds, [Math.min(...uniqueX), Math.min(...uniqueY), Math.max(...uniqueX), Math.max(...uniqueY)]);
if (data.regionalLandcover?.available) {
  assert.equal(data.regionalLandcover.source, 'Copernicus CLMS LCM-10');
  assert.ok(data.regionalLandcover.archivePath.includes('landcover-7.0.24.pmtiles'));
}
console.log('runtime-contract: ok');
