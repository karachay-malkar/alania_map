import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const PORT = 4175;
const CONTROL = [42.4392,43.3499];
const ZOOMS = [7,8,8.99,9.01,9.99,10.01,11,12,13,14,14.3,14,12,10,9,8,7];
const AREA_ZOOMS = [7,8,9,10,12,14.3];
const LOCATIONS = [
  {name:'Mingi-Tau',center:[42.4392,43.3499]},
  {name:'Dombay',center:[41.6274,43.2916]},
  {name:'Bezengi',center:[43.0830,43.0200]},
  {name:'Upper Balkaria',center:[43.4550,43.0830]},
  {name:'Arkhyz',center:[41.2780,43.5660]},
  {name:'West map',center:[40.9500,43.2500]}
];
const server = spawn('python3',['tools/range_http_server.py',String(PORT),'--bind','127.0.0.1'],{stdio:'ignore'});
await new Promise(resolve => setTimeout(resolve,1200));

async function jumpAndWait(page, center, zoom) {
  await page.evaluate(({zoom,center}) => new Promise(resolve => {
    const map = window.ALAN_MAP_INSTANCE.map;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish,1500);
    map.once('moveend',finish);
    map.jumpTo({center,zoom,pitch:58,bearing:180});
  }),{zoom,center});
}

async function waitForElevation(page, center) {
  await page.waitForFunction(({control}) => {
    const map = window.ALAN_MAP_INSTANCE?.map;
    if (!map || !map.getTerrain?.() || map.getTerrain().source !== 'terrain-dem') return false;
    if (!map.isSourceLoaded?.('terrain-dem')) return false;
    const elevation = map.queryTerrainElevation?.(control,{exaggerated:false});
    return Number.isFinite(elevation) && Math.abs(elevation) > 100;
  },{control:center},{timeout:30000});
}

async function readSample(page, center) {
  return page.evaluate(({control}) => {
    const map = window.ALAN_MAP_INSTANCE.map;
    const diagnostics = window.ALAN_MAP_TERRAIN_CONTROLLER?.diagnostics?.();
    return {
      requestedZoom:map.getZoom(),
      pitch:map.getPitch(),
      terrain:map.getTerrain?.(),
      elevation:map.queryTerrainElevation?.(control,{exaggerated:false}),
      sourceLoaded:map.isSourceLoaded?.('terrain-dem'),
      enableCalls:diagnostics?.enableCalls,
      sourceChanges:diagnostics?.sourceChanges
    };
  },{control:center});
}

function assertTerrainSample(sample, expectedZoom, label) {
  assert.ok(Math.abs(sample.requestedZoom - expectedZoom) < 0.011,`${label}: zoom drift at ${expectedZoom}: ${sample.requestedZoom}`);
  assert.ok(Math.abs(sample.pitch - 58) < 0.01,`${label}: pitch drift at ${expectedZoom}: ${sample.pitch}`);
  assert.equal(sample.terrain?.source,'terrain-dem',`${label}: terrain source missing at z${expectedZoom}`);
  assert.equal(sample.sourceLoaded,true,`${label}: terrain-dem not loaded at z${expectedZoom}`);
  assert.ok(Number.isFinite(sample.elevation) && Math.abs(sample.elevation) > 100,`${label}: invalid terrain elevation at z${expectedZoom}: ${sample.elevation}`);
  assert.equal(sample.enableCalls,1,`${label}: terrain was re-enabled at z${expectedZoom}`);
  assert.equal(sample.sourceChanges,0,`${label}: terrain source changed at z${expectedZoom}`);
}

let browser = null;
try {
  browser = await chromium.launch({headless:true});
  const page = await browser.newPage({viewport:{width:1280,height:900}});
  const pageErrors = [];
  page.on('pageerror',error => pageErrors.push(String(error)));

  await page.goto(`http://127.0.0.1:${PORT}/`,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(() => Boolean(window.ALAN_MAP_INSTANCE?.map),undefined,{timeout:60000});
  await page.waitForFunction(() => window.ALAN_MAP_TERRAIN_CONTROLLER?.enabled === true,undefined,{timeout:60000});

  await page.evaluate(({center}) => {
    const map = window.ALAN_MAP_INSTANCE.map;
    window.__ALAN_TERRAIN_GAPS = [];
    window.__ALAN_TERRAIN_CHECK = () => {
      const terrain = map.getTerrain?.();
      if (!terrain || terrain.source !== 'terrain-dem') {
        window.__ALAN_TERRAIN_GAPS.push({
          zoom:map.getZoom(),
          pitch:map.getPitch(),
          terrain:terrain || null,
          at:performance.now()
        });
      }
    };
    map.on('render',window.__ALAN_TERRAIN_CHECK);
    map.on('move',window.__ALAN_TERRAIN_CHECK);
    map.jumpTo({center,zoom:7,pitch:58,bearing:180});
  },{center:CONTROL});

  const samples = [];
  for (const zoom of ZOOMS) {
    await jumpAndWait(page,CONTROL,zoom);
    await waitForElevation(page,CONTROL);
    const sample = await readSample(page,CONTROL);
    assertTerrainSample(sample,zoom,'Mingi-Tau continuity');
    samples.push(sample);
  }

  const areaSamples = [];
  for (const location of LOCATIONS) {
    for (const zoom of AREA_ZOOMS) {
      await jumpAndWait(page,location.center,zoom);
      await waitForElevation(page,location.center);
      const sample = await readSample(page,location.center);
      assertTerrainSample(sample,zoom,location.name);
      areaSamples.push({name:location.name,center:location.center,zoom,elevation:sample.elevation});
    }
  }

  const gaps = await page.evaluate(() => window.__ALAN_TERRAIN_GAPS || []);
  assert.deepEqual(gaps,[],`terrain disappeared during render/move: ${JSON.stringify(gaps.slice(0,5))}`);

  const finalDiagnostics = await page.evaluate(() => window.ALAN_MAP_TERRAIN_CONTROLLER.diagnostics());
  assert.equal(finalDiagnostics.enabled,true);
  assert.equal(finalDiagnostics.enableCalls,1);
  assert.equal(finalDiagnostics.sourceChanges,0);
  assert.equal(finalDiagnostics.mapTerrain?.source,'terrain-dem');
  assert.deepEqual(pageErrors,[]);

  console.log(JSON.stringify({control:CONTROL,zooms:ZOOMS,areaZooms:AREA_ZOOMS,locations:LOCATIONS,samples,areaSamples,finalDiagnostics,gaps},null,2));
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
