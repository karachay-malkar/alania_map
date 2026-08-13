import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const server = spawn('python3',['-m','http.server','4173','--bind','127.0.0.1'],{stdio:'ignore'});
await new Promise(r => setTimeout(r,1200));
const browser = await chromium.launch({headless:true});
try {
  const page = await browser.newPage({viewport:{width:1280,height:900}});
  const errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  await page.goto('http://127.0.0.1:4173/',{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(()=>Boolean(window.ALAN_MAP_INSTANCE?.map?.isStyleLoaded?.()),{timeout:60000});
  assert.equal(await page.locator('[data-fantasy-toggle], .fantasy-toggle').count(),0);

  const diagnostics = await page.evaluate(() => {
    const api = window.ALAN_MAP_INSTANCE;
    const map = api?.map;
    const style = map?.getStyle?.() || {sources:{},layers:[]};
    const byId = Object.fromEntries((style.layers || []).map(layer => [layer.id, layer]));
    return {
      sourceIds:Object.keys(style.sources || {}),
      labels:api?.getLabelDiagnostics?.(),
      layers:{
        currentSettlement:byId['settlement-current-points'],
        historicSettlement:byId['settlement-historic-points'],
        historicObject:byId['historic-object-points'],
        peakPoint:byId['osm-peak-points'],
        peakLabel:byId['osm-peak-labels']
      }
    };
  });

  assert.ok(diagnostics.sourceIds.includes('terrain-dem'));
  assert.equal(diagnostics.layers.currentSettlement.minzoom,10);
  assert.equal(diagnostics.layers.historicSettlement.minzoom,12);
  assert.equal(diagnostics.layers.historicObject.minzoom,12);
  assert.equal(diagnostics.layers.peakPoint.minzoom,10);
  assert.equal(diagnostics.layers.peakLabel.minzoom,10);
  assert.ok(JSON.stringify(diagnostics.layers.peakPoint.filter).includes('peak_level'));
  assert.ok(JSON.stringify(diagnostics.layers.peakLabel.filter).includes('peak_level'));

  await page.waitForFunction(() => Boolean(window.ALAN_MAP_INSTANCE?.getLabelDiagnostics?.().regional), {timeout:30000});
  const regional = await page.evaluate(() => window.ALAN_MAP_INSTANCE.getLabelDiagnostics().regional);
  assert.equal(regional.altitudeM,7000);
  assert.equal(regional.mapPlaneAligned,true);
  assert.equal(regional.billboard,false);
  assert.equal(regional.fixedGroundScale,true);
  assert.equal(regional.fixedScreenScale,false);
  assert.equal(regional.sizingModel,'fixed-world-axis-length');

  assert.ok(errors.length === 0, errors.join('\n'));
  console.log('map-smoke: ok');
} finally {
  await browser.close();
  server.kill('SIGTERM');
}
