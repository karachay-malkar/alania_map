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
  assert.equal(contract.version,'7.3.4');
  assert.equal(contract.archivePath,'data/alan-dem-7.3.4.pmtiles');
  assert.equal(contract.source,'terrain-dem');
  assert.equal(contract.hillshade,'terrain-hillshade');
  assert.equal(contract.tileSize,256);
  assert.deepEqual(contract.physicalNativeZooms,[7,8,9,10]);
  assert.equal(contract.nativeZ8,true);
  assert.equal(contract.highestNativeZoom,10);
  assert.equal(contract.overzoomFrom,10);
  assert.equal(contract.runtimeTerrainSources,1);
  assert.equal(contract.sourceSwitching,false);
  assert.equal(contract.initialTerrainInStyle,false);
  assert.equal(contract.maxInitialPrefetchTiles,9);
  assert.equal(contract.z8RuntimeMode,'physical-z8-derived-numerically-from-z7');

  const styleInfo = await page.evaluate(() => {
    const map = window.ALAN_MAP_INSTANCE.map;
    const style = map.getStyle();
    const sourceIds = Object.keys(style.sources || {});
    const terrainSourceIds = sourceIds.filter(id => id.startsWith('terrain-dem'));
    const hillshadeLayers = (style.layers || []).filter(layer => layer.type === 'hillshade');
    return {
      sourceIds,
      terrainSourceIds,
      hillshadeLayers:hillshadeLayers.map(layer => ({id:layer.id,source:layer.source})),
      terrainSource:style.sources?.['terrain-dem'] || null
    };
  });
  assert.deepEqual(styleInfo.terrainSourceIds,['terrain-dem']);
  assert.deepEqual(styleInfo.hillshadeLayers,[{id:'terrain-hillshade',source:'terrain-dem'}]);
  assert.ok(styleInfo.terrainSource);
  assert.equal(styleInfo.terrainSource.tileSize,256);
  assert.equal(styleInfo.terrainSource.minzoom,7);
  assert.equal(styleInfo.terrainSource.maxzoom,10);
  assert.match(String(styleInfo.terrainSource.url || ''),/alan-dem-7\.3\.4\.pmtiles/);

  await page.waitForFunction(() => window.ALAN_MAP_TERRAIN_CONTROLLER?.enabled === true,undefined,{timeout:60000});
  const enabled = await page.evaluate(() => window.ALAN_MAP_TERRAIN_CONTROLLER.diagnostics());
  assert.equal(enabled.enabled,true);
  assert.equal(enabled.enabling,false);
  assert.equal(enabled.initialDemReady,true);
  assert.equal(enabled.enableCalls,1);
  assert.equal(enabled.sourceChanges,0);
  assert.ok(enabled.prefetchRuns <= 1);
  assert.ok(enabled.prefetchedTiles <= contract.maxInitialPrefetchTiles);
  assert.equal(enabled.mapTerrain?.source,'terrain-dem');
  assert.equal(enabled.hillshadePresent,true);

  const beforeExaggeration = enabled.exaggeration;
  const after = await page.evaluate(() => {
    const controller = window.ALAN_MAP_TERRAIN_CONTROLLER;
    controller.setExaggeration(3.1);
    return controller.diagnostics();
  });
  assert.notEqual(beforeExaggeration,3.1);
  assert.equal(after.exaggeration,3.1);
  assert.equal(after.mapTerrain?.source,'terrain-dem');
  assert.equal(after.enableCalls,1);
  assert.equal(after.exaggerationUpdates,1);
  assert.equal(after.sourceChanges,0);

  const transport = await page.evaluate(() => window.ALAN_MAP_PMTILES_RANGE_DIAGNOSTICS?.());
  assert.ok(transport);
  const demTransports = transport.archives.filter(item => item.archivePath === 'data/alan-dem-7.3.4.pmtiles');
  assert.equal(demTransports.length,1);
  assert.ok(!transport.archives.some(item => item.archivePath === 'data/alan-dem-7.3.3.pmtiles'));
  assert.equal(await page.evaluate(() => typeof window.ALAN_MAP_PREFETCH_PM_TILE),'function');

  assert.deepEqual(pageErrors,[]);
  console.log(JSON.stringify({contract,styleInfo,enabled,after,demTransport:demTransports[0]},null,2));
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
