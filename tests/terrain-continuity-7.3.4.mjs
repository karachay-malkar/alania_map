import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const PORT = 4175;
const CONTROL = [42.4392,43.3499];
const ZOOMS = [7,8,8.99,9.01,9.99,10.01,11,12,13,14,14.3,14,12,10,9,8,7];
const server = spawn('python3',['tools/range_http_server.py',String(PORT),'--bind','127.0.0.1'],{stdio:'ignore'});
await new Promise(resolve => setTimeout(resolve,1200));

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
    }),{zoom,center:CONTROL});

    await page.waitForFunction(({control}) => {
      const map = window.ALAN_MAP_INSTANCE?.map;
      if (!map || !map.getTerrain?.() || map.getTerrain().source !== 'terrain-dem') return false;
      if (!map.isSourceLoaded?.('terrain-dem')) return false;
      const elevation = map.queryTerrainElevation?.(control,{exaggerated:false});
      return Number.isFinite(elevation) && elevation > 500;
    },{control:CONTROL},{timeout:30000});

    const sample = await page.evaluate(({control}) => {
      const map = window.ALAN_MAP_INSTANCE.map;
      const terrain = map.getTerrain?.();
      const elevation = map.queryTerrainElevation?.(control,{exaggerated:false});
      const diagnostics = window.ALAN_MAP_TERRAIN_CONTROLLER?.diagnostics?.();
      return {
        requestedZoom:map.getZoom(),
        pitch:map.getPitch(),
        terrain,
        elevation,
        sourceLoaded:map.isSourceLoaded?.('terrain-dem'),
        enableCalls:diagnostics?.enableCalls,
        sourceChanges:diagnostics?.sourceChanges
      };
    },{control:CONTROL});

    assert.ok(Math.abs(sample.requestedZoom - zoom) < 0.011,`zoom drift at ${zoom}: ${sample.requestedZoom}`);
    assert.ok(Math.abs(sample.pitch - 58) < 0.01,`pitch drift at ${zoom}: ${sample.pitch}`);
    assert.equal(sample.terrain?.source,'terrain-dem',`terrain source missing at z${zoom}`);
    assert.equal(sample.sourceLoaded,true,`terrain-dem not loaded at z${zoom}`);
    assert.ok(Number.isFinite(sample.elevation) && sample.elevation > 500,`invalid terrain elevation at z${zoom}: ${sample.elevation}`);
    assert.equal(sample.enableCalls,1,`terrain was re-enabled at z${zoom}`);
    assert.equal(sample.sourceChanges,0,`terrain source changed at z${zoom}`);
    samples.push(sample);
  }

  const gaps = await page.evaluate(() => window.__ALAN_TERRAIN_GAPS || []);
  assert.deepEqual(gaps,[],`terrain disappeared during render/move: ${JSON.stringify(gaps.slice(0,5))}`);

  const finalDiagnostics = await page.evaluate(() => window.ALAN_MAP_TERRAIN_CONTROLLER.diagnostics());
  assert.equal(finalDiagnostics.enabled,true);
  assert.equal(finalDiagnostics.enableCalls,1);
  assert.equal(finalDiagnostics.sourceChanges,0);
  assert.equal(finalDiagnostics.mapTerrain?.source,'terrain-dem');
  assert.deepEqual(pageErrors,[]);

  console.log(JSON.stringify({control:CONTROL,zooms:ZOOMS,samples,finalDiagnostics,gaps},null,2));
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
