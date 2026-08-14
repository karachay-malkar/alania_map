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
  await page.waitForFunction(()=>Boolean(window.ALAN_MAP_PRESENTATION_722?.nativeLayersReady?.()),undefined,{timeout:30000});
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
      presentation:{
        version:window.ALAN_MAP_PRESENTATION_722?.version,
        presentationSpace:window.ALAN_MAP_PRESENTATION_722?.presentationSpace,
        nativeMapScene:window.ALAN_MAP_PRESENTATION_722?.nativeMapScene,
        usesMapProject:window.ALAN_MAP_PRESENTATION_722?.usesMapProject,
        usesSvgOverlay:window.ALAN_MAP_PRESENTATION_722?.usesSvgOverlay,
        sourceId:window.ALAN_MAP_PRESENTATION_722?.sourceId,
        layerIds:window.ALAN_MAP_PRESENTATION_722?.layerIds,
        frameWidthM:window.ALAN_MAP_PRESENTATION_722?.frameWidthM,
        compassRadiusM:window.ALAN_MAP_PRESENTATION_722?.compassRadiusM,
        beamLayersRemoved:window.ALAN_MAP_PRESENTATION_722?.beamLayersRemoved?.(),
        nativeSourceReady:window.ALAN_MAP_PRESENTATION_722?.nativeSourceReady?.(),
        nativeLayersReady:window.ALAN_MAP_PRESENTATION_722?.nativeLayersReady?.(),
        legacySvgCount:window.ALAN_MAP_PRESENTATION_722?.legacySvgCount?.()
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
  assert.equal(diagnostics.presentation.beamLayersRemoved,true);
  assert.equal(diagnostics.presentation.version,'7.2.2-r2');
  assert.equal(diagnostics.presentation.presentationSpace,'native-map-scene');
  assert.equal(diagnostics.presentation.nativeMapScene,true);
  assert.equal(diagnostics.presentation.usesMapProject,false);
  assert.equal(diagnostics.presentation.usesSvgOverlay,false);
  assert.equal(diagnostics.presentation.nativeSourceReady,true);
  assert.equal(diagnostics.presentation.nativeLayersReady,true);
  assert.equal(diagnostics.presentation.legacySvgCount,0);
  assert.ok(diagnostics.sourceIds.includes(diagnostics.presentation.sourceId));

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
  assert.equal(presentation.parchmentOverlayReady,false);
  assert.equal(diagnostics.presentation.frameWidthM,2000);
  assert.equal(diagnostics.presentation.compassRadiusM,22000);

  const nativePresentationState = await page.evaluate(() => {
    const map=window.ALAN_MAP_INSTANCE.map;
    const diagnostics=window.ALAN_MAP_PRESENTATION_722;
    const style=map.getStyle();
    const layerIds=Object.values(diagnostics.layerIds);
    return {
      legacyParchmentCount:document.querySelectorAll('[data-role="parchment-overlay"]').length,
      legacyFrameCount:document.querySelectorAll('[data-role="map-perimeter-frame"]').length,
      sourcePresent:Boolean(map.getSource(diagnostics.sourceId)),
      layersPresent:layerIds.every(id=>Boolean(map.getLayer(id))),
      sourceInStyle:Boolean(style.sources?.[diagnostics.sourceId]),
      geometry:diagnostics.geometry()
    };
  });
  assert.equal(nativePresentationState.legacyParchmentCount,0);
  assert.equal(nativePresentationState.legacyFrameCount,0);
  assert.equal(nativePresentationState.sourcePresent,true);
  assert.equal(nativePresentationState.layersPresent,true);
  assert.equal(nativePresentationState.sourceInStyle,true);
  assert.equal(nativePresentationState.geometry.metadata.coordinateSpace,'geographic-world');
  const fixedGeometryBefore=JSON.stringify(nativePresentationState.geometry);
  await page.evaluate(() => window.ALAN_MAP_INSTANCE.map.easeTo({zoom:7.7,bearing:145,pitch:48,duration:350}));
  await page.waitForTimeout(450);
  const fixedGeometryAfter=await page.evaluate(() => JSON.stringify(window.ALAN_MAP_PRESENTATION_722.geometry()));
  assert.equal(fixedGeometryAfter,fixedGeometryBefore);

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
