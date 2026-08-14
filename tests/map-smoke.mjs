import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const server = spawn('python3',['tools/range_http_server.py','4173','--bind','127.0.0.1'],{stdio:'ignore'});
await new Promise(r => setTimeout(r,1200));
const browser = await chromium.launch({headless:true});
try {
  const page = await browser.newPage({viewport:{width:1280,height:900}});
  const errors=[];
  page.on('pageerror',e=>errors.push(String(e)));

  const rangeProbe = await page.request.get('http://127.0.0.1:4173/data/alan-dem-7.2.pmtiles',{
    headers:{Range:'bytes=0-126'}
  });
  assert.equal(rangeProbe.status(),206);
  assert.equal((await rangeProbe.body()).byteLength,127);
  assert.match(rangeProbe.headers()['content-range'] || '',/^bytes 0-126\//);

  await page.goto('http://127.0.0.1:4173/',{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(()=>Boolean(window.ALAN_MAP_INSTANCE?.map?.getLayer?.('focus-paper')),undefined,{timeout:60000});
  await page.waitForFunction(()=>Boolean(window.ALAN_MAP_PRESENTATION_7025?.frameReady?.()),undefined,{timeout:30000});
  assert.equal(await page.locator('[data-fantasy-toggle], .fantasy-toggle').count(),0);

  const diagnostics = await page.evaluate(() => {
    const api = window.ALAN_MAP_INSTANCE;
    const map = api?.map;
    const style = map?.getStyle?.() || {sources:{},layers:[]};
    const byId = Object.fromEntries((style.layers || []).map(layer => [layer.id, layer]));
    return {
      sourceIds:Object.keys(style.sources || {}),
      layers:{
        currentSettlement:byId['settlement-current-points'],
        historicSettlement:byId['settlement-historic-points'],
        historicObject:byId['historic-object-points'],
        peakPoint:byId['osm-peak-points'],
        peakLabel:byId['osm-peak-labels'],
        settlementBeamHalo:byId['settlement-beam-halo'] || null,
        settlementBeamCore:byId['settlement-beam-core'] || null,
        forestPattern:byId['forest-pattern'] || null
      },
      overlay:{
        version:window.ALAN_MAP_PRESENTATION_7025?.version,
        frameWidthM:window.ALAN_MAP_PRESENTATION_7025?.frameWidthM,
        compassRadiusM:window.ALAN_MAP_PRESENTATION_7025?.compassRadiusM,
        beamLayersRemoved:window.ALAN_MAP_PRESENTATION_7025?.beamLayersRemoved?.(),
        compassMapPlaneAligned:window.ALAN_MAP_PRESENTATION_7025?.compassMapPlaneAligned?.()
      },
      transport:window.ALAN_MAP_PMTILES_RANGE_DIAGNOSTICS?.()
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
  assert.equal(diagnostics.layers.settlementBeamHalo,null);
  assert.equal(diagnostics.layers.settlementBeamCore,null);
  assert.equal(diagnostics.overlay.beamLayersRemoved,true);

  assert.equal(diagnostics.transport.mode,'http-range');
  assert.ok(diagnostics.transport.archives.length >= 2);
  assert.ok(diagnostics.transport.archives.every(item => item.mode === 'http-range'));
  assert.ok(diagnostics.transport.archives.some(item => item.archivePath === 'data/alan-dem-7.2.pmtiles'));
  assert.ok(diagnostics.transport.archives.some(item => item.archivePath === 'data/alan-vector-7.2.pmtiles'));
  assert.ok(diagnostics.transport.archives.reduce((sum,item) => sum + item.networkBytes,0) > 0);

  await page.waitForFunction(() => Boolean(window.ALAN_MAP_INSTANCE?.getLabelDiagnostics?.().regional), {timeout:30000});
  const regional = await page.evaluate(() => window.ALAN_MAP_INSTANCE.getLabelDiagnostics().regional);
  assert.equal(regional.altitudeM,10000);
  assert.equal(regional.mapPlaneAligned,true);
  assert.equal(regional.billboard,false);
  assert.equal(regional.fixedGroundScale,true);
  assert.equal(regional.fixedScreenScale,false);
  assert.equal(regional.sizingModel,'fixed-world-axis-length');

  const presentation = await page.evaluate(() => window.ALAN_MAP_INSTANCE.getPresentationDiagnostics());
  assert.equal(presentation.regionalLabelAltitudeM,10000);
  assert.equal(presentation.regionalLabelScale,0.666667);
  assert.equal(presentation.historicalEthnographicBoundaryVisible,false);
  assert.deepEqual(presentation.parchmentAnchors.corner,[44.184003,43.85642]);
  assert.equal(presentation.parchmentOverlayReady,true);
  assert.equal(diagnostics.overlay.version,'7.2-r1');
  assert.equal(diagnostics.overlay.frameWidthM,2000);
  assert.equal(diagnostics.overlay.compassRadiusM,22000);
  assert.equal(diagnostics.overlay.compassMapPlaneAligned,true);

  const overlayState = await page.evaluate(() => {
    const parchment = document.querySelector('[data-role="parchment-overlay"]');
    const compass = parchment?.querySelector('[data-role="parchment-compass"]');
    const fill = parchment?.querySelector('[data-role="parchment-fill"]');
    const frame = document.querySelector('[data-role="map-perimeter-frame"]');
    const frameBase = frame?.querySelector('[data-role="map-perimeter-frame-base"]');
    const frameOrnament = frame?.querySelector('[data-role="map-perimeter-frame-ornament"]');
    return {
      parchmentCount:document.querySelectorAll('[data-role="parchment-overlay"]').length,
      parchmentPointerEvents:parchment?.style.pointerEvents,
      fillPath:fill?.getAttribute('d') || '',
      cornerOrnamentCount:parchment?.querySelectorAll('[data-role="parchment-ornament"]').length || 0,
      compassTransform:compass?.getAttribute('transform') || '',
      compassWorldRadius:compass?.getAttribute('data-world-radius-m') || '',
      frameCount:document.querySelectorAll('[data-role="map-perimeter-frame"]').length,
      framePointerEvents:frame?.style.pointerEvents,
      framePath:frameBase?.getAttribute('d') || '',
      frameFill:frameBase?.getAttribute('fill') || '',
      ornamentStroke:frameOrnament?.getAttribute('stroke') || ''
    };
  });
  assert.equal(overlayState.parchmentCount,1);
  assert.equal(overlayState.parchmentPointerEvents,'none');
  assert.ok(overlayState.fillPath.startsWith('M'));
  assert.equal(overlayState.cornerOrnamentCount,0);
  assert.match(overlayState.compassTransform,/^matrix\(/);
  assert.equal(overlayState.compassWorldRadius,'22000');
  assert.equal(overlayState.frameCount,1);
  assert.equal(overlayState.framePointerEvents,'none');
  assert.ok(overlayState.framePath.startsWith('M'));
  assert.equal(overlayState.frameFill,'#ead7ad');
  assert.equal(overlayState.ornamentStroke,'#68482f');

  // Motion must not hide visual layers in 7.2.
  const visibilityBefore = await page.evaluate(() => ({
    labels:window.ALAN_MAP_INSTANCE.map.getLayoutProperty('historic-object-labels','visibility') || 'visible',
    forest:window.ALAN_MAP_INSTANCE.map.getLayer('forest-pattern')
      ? (window.ALAN_MAP_INSTANCE.map.getLayoutProperty('forest-pattern','visibility') || 'visible')
      : null
  }));
  await page.evaluate(() => window.ALAN_MAP_INSTANCE.map.panBy([180,0],{duration:450}));
  await page.waitForTimeout(180);
  const visibilityDuring = await page.evaluate(() => ({
    labels:window.ALAN_MAP_INSTANCE.map.getLayoutProperty('historic-object-labels','visibility') || 'visible',
    forest:window.ALAN_MAP_INSTANCE.map.getLayer('forest-pattern')
      ? (window.ALAN_MAP_INSTANCE.map.getLayoutProperty('forest-pattern','visibility') || 'visible')
      : null
  }));
  assert.deepEqual(visibilityDuring,visibilityBefore);
  await page.waitForTimeout(550);

  await page.waitForFunction(() => {
    const metrics = window.ALAN_MAP_PERFORMANCE_DIAGNOSTICS?.();
    return metrics && metrics.totalNetworkRequests > 0 && metrics.renderFrames > 0;
  },undefined,{timeout:30000});
  const performanceMetrics = await page.evaluate(() => window.ALAN_MAP_PERFORMANCE_DIAGNOSTICS());
  assert.equal(performanceMetrics.version,'7.2');
  assert.ok(performanceMetrics.totalNetworkBytes > 0);
  assert.ok(performanceMetrics.totalNetworkRequests > 0);
  assert.ok(performanceMetrics.renderFrames > 0);
  assert.equal(performanceMetrics.transport.mode,'http-range');
  assert.ok(performanceMetrics.transport.cache.maxBytes >= 12 * 1024 * 1024);

  assert.ok(errors.length === 0, errors.join('\n'));
  console.log('map-smoke: ok');
} finally {
  await browser.close();
  server.kill('SIGTERM');
}
