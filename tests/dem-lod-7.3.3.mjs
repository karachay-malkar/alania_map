import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const PORT = 4174;
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
  await page.waitForFunction(() => Boolean(window.ALAN_MAP_DEM_LOD_CONTRACT),undefined,{timeout:30000});

  const contract = await page.evaluate(() => window.ALAN_MAP_DEM_LOD_CONTRACT);
  assert.equal(contract.version,'7.3.3');
  assert.equal(contract.archivePath,'data/alan-dem-7.3.3.pmtiles');
  assert.deepEqual(contract.physicalNativeZooms,[7,9,10]);
  assert.equal(contract.nativeZ8,false);
  assert.equal(contract.z8RequestsEnabled,false);
  assert.equal(contract.transitionMode,'prefetch-visible-tiles-then-switch-on-zoomend');

  const styleInfo = await page.evaluate(() => {
    const map = window.ALAN_MAP_INSTANCE.map;
    const style = map.getStyle();
    return {
      sourceIds:Object.keys(style.sources || {}),
      sources:Object.fromEntries(Object.entries(style.sources || {}).filter(([id]) => id.startsWith('terrain-dem')))
    };
  });
  assert.ok(styleInfo.sourceIds.includes('terrain-dem'));
  assert.ok(styleInfo.sourceIds.includes('terrain-dem-medium'));
  assert.ok(styleInfo.sourceIds.includes('terrain-dem-high'));
  for (const source of Object.values(styleInfo.sources)) {
    assert.match(String(source.url || ''),/alan-dem-7\.3\.3\.pmtiles/);
  }

  const initial = await page.evaluate(() => window.ALAN_MAP_DEM_LOD_DIAGNOSTICS());
  assert.equal(initial.activeSource,'terrain-dem');
  assert.equal(initial.activeLod,'low');
  const initialSwitches = initial.switches;

  const setZoomAndWait = async (zoom, source) => {
    await page.evaluate(value => window.ALAN_MAP_INSTANCE.map.jumpTo({zoom:value}),zoom);
    await page.waitForFunction(expected => {
      const diagnostics = window.ALAN_MAP_DEM_LOD_DIAGNOSTICS?.();
      return diagnostics?.activeSource === expected && !diagnostics?.pendingSource;
    },source,{timeout:30000});
    return page.evaluate(() => window.ALAN_MAP_DEM_LOD_DIAGNOSTICS());
  };

  const z8 = await setZoomAndWait(8,'terrain-dem');
  assert.equal(z8.switches,initialSwitches);
  assert.equal(z8.exactLodForMapZoom,'low');

  const z9 = await setZoomAndWait(9,'terrain-dem-medium');
  assert.equal(z9.activeLod,'medium');
  assert.equal(z9.switches,initialSwitches + 1);
  assert.ok(z9.prefetchRuns >= 1);
  assert.ok(z9.prefetchedTiles > 0);

  const z10 = await setZoomAndWait(10,'terrain-dem-high');
  assert.equal(z10.activeLod,'high');
  assert.equal(z10.switches,initialSwitches + 2);
  assert.ok(z10.prefetchRuns >= 2);

  const z14 = await setZoomAndWait(14,'terrain-dem-high');
  assert.equal(z14.activeLod,'high');
  assert.equal(z14.switches,z10.switches);

  const nearBoundary = await setZoomAndWait(9.90,'terrain-dem-high');
  assert.equal(nearBoundary.switches,z14.switches);
  assert.equal(nearBoundary.activeLod,'high');

  const mediumAgain = await setZoomAndWait(9.80,'terrain-dem-medium');
  assert.equal(mediumAgain.activeLod,'medium');
  assert.equal(mediumAgain.switches,z14.switches + 1);

  const transport = await page.evaluate(() => window.ALAN_MAP_PMTILES_RANGE_DIAGNOSTICS?.());
  assert.ok(transport);
  assert.ok(transport.archives.some(item => item.archivePath === 'data/alan-dem-7.3.3.pmtiles'));
  assert.ok(!transport.archives.some(item => item.archivePath === 'data/alan-dem-7.3.pmtiles'));
  assert.equal(await page.evaluate(() => typeof window.ALAN_MAP_PREFETCH_PM_TILE),'function');

  assert.deepEqual(pageErrors,[]);
  console.log(JSON.stringify({contract,z8,z9,z10,z14,nearBoundary,mediumAgain},null,2));
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
