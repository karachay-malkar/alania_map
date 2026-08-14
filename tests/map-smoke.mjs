import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const server = spawn('python3',['tools/range_http_server.py','4173','--bind','127.0.0.1'],{stdio:'ignore'});
await new Promise(r => setTimeout(r,1200));
let browser=null;
try {
  browser = await chromium.launch({
    headless:true,
    executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined
  });
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
  await page.waitForFunction(()=>Boolean(window.ALAN_MAP_PRESENTATION_723?.nativeLayersReady?.()),undefined,{timeout:30000});
  await page.waitForFunction(()=>Boolean(window.ALAN_MAP_INSTANCE?.map?.isSourceLoaded?.('openmaptiles')),undefined,{timeout:30000});
  await page.waitForFunction(()=>Boolean(window.ALAN_MAP_GRANITE_FRAME?.ready?.()),undefined,{timeout:30000});
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
        forestPattern:byId['forest-pattern'] || null,
        roadMain:byId['road-main'] || null,
        riverLine:byId['osm-river-line'] || null,
        waterFill:byId['osm-water-fill'] || null,
        glacierFill:byId['osm-glacier-fill'] || null,
        snowFill:byId['osm-snow-fill'] || null
      },
      presentation:{
        version:window.ALAN_MAP_PRESENTATION_723?.version,
        presentationSpace:window.ALAN_MAP_PRESENTATION_723?.presentationSpace,
        nativeMapScene:window.ALAN_MAP_PRESENTATION_723?.nativeMapScene,
        usesMapProject:window.ALAN_MAP_PRESENTATION_723?.usesMapProject,
        usesSvgOverlay:window.ALAN_MAP_PRESENTATION_723?.usesSvgOverlay,
        renderLoopInstalled:window.ALAN_MAP_PRESENTATION_723?.renderLoopInstalled,
        mutationObserverInstalled:window.ALAN_MAP_PRESENTATION_723?.mutationObserverInstalled,
        legacyPresentationLoaded:Boolean(window.AlanMapPresentation),
        sourceId:window.ALAN_MAP_PRESENTATION_723?.sourceId,
        layerIds:window.ALAN_MAP_PRESENTATION_723?.layerIds,
        frameWidthM:window.ALAN_MAP_PRESENTATION_723?.frameWidthM,
        compassRadiusM:window.ALAN_MAP_PRESENTATION_723?.compassRadiusM,
        compassScaleFrom722:window.ALAN_MAP_PRESENTATION_723?.compassScaleFrom722,
        beamLayersRemoved:window.ALAN_MAP_PRESENTATION_723?.beamLayersRemoved?.(),
        nativeSourceReady:window.ALAN_MAP_PRESENTATION_723?.nativeSourceReady?.(),
        nativeLayersReady:window.ALAN_MAP_PRESENTATION_723?.nativeLayersReady?.(),
        legacySvgCount:window.ALAN_MAP_PRESENTATION_723?.legacySvgCount?.()
      },
      frameClip:api?.getFrameClipDiagnostics?.(),
      transport:window.ALAN_MAP_PMTILES_RANGE_DIAGNOSTICS?.(),
      granite:{...window.ALAN_MAP_GRANITE_FRAME,ready:window.ALAN_MAP_GRANITE_FRAME?.ready?.(),drawCalls:window.ALAN_MAP_GRANITE_FRAME?.drawCalls?.()}
    };
  });

  assert.ok(diagnostics.sourceIds.includes('terrain-dem'));
  assert.ok(diagnostics.sourceIds.includes('openmaptiles'));
  for (const layer of [diagnostics.layers.roadMain,diagnostics.layers.riverLine,diagnostics.layers.waterFill,diagnostics.layers.forestPattern,diagnostics.layers.glacierFill,diagnostics.layers.snowFill]) assert.ok(layer);
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
  assert.equal(diagnostics.presentation.version,'7.2.3-r1');
  assert.equal(diagnostics.presentation.presentationSpace,'native-map-scene');
  assert.equal(diagnostics.presentation.nativeMapScene,true);
  assert.equal(diagnostics.presentation.usesMapProject,false);
  assert.equal(diagnostics.presentation.usesSvgOverlay,false);
  assert.equal(diagnostics.presentation.renderLoopInstalled,false);
  assert.equal(diagnostics.presentation.mutationObserverInstalled,false);
  assert.equal(diagnostics.presentation.legacyPresentationLoaded,false);
  assert.equal(diagnostics.presentation.nativeSourceReady,true);
  assert.equal(diagnostics.presentation.nativeLayersReady,true);
  assert.equal(diagnostics.presentation.legacySvgCount,0);
  assert.ok(diagnostics.sourceIds.includes(diagnostics.presentation.sourceId));
  assert.equal(diagnostics.granite.version,'7.2.3-r1');
  assert.equal(diagnostics.granite.renderer,'custom-webgl-static-world-mesh');
  assert.equal(diagnostics.granite.topM,4000);
  assert.equal(diagnostics.granite.bottomM,-4000);
  assert.equal(diagnostics.granite.ready,true);
  assert.equal(diagnostics.frameClip.demEdgeCollarM,4500);
  assert.equal(diagnostics.frameClip.demEdgeSafeMaxM,1000);
  assert.equal(diagnostics.frameClip.demEdgeInnerBandM,900);
  assert.equal(diagnostics.frameClip.demEdgeOuterSkirtM,3200);
  assert.equal(diagnostics.frameClip.demTechnicalBaseM,-10000);

  assert.equal(diagnostics.transport.mode,'adaptive-http-range');
  assert.ok(diagnostics.transport.archives.length >= 2);
  assert.ok(diagnostics.transport.archives.every(item => ['http-range','full-file-fallback'].includes(item.mode)));
  const vectorTransport=diagnostics.transport.archives.find(item=>item.sourceId==='openmaptiles');
  assert.ok(vectorTransport);
  assert.equal(vectorTransport.fullFileFallbackAllowed,true);
  assert.ok(vectorTransport.concurrency.limit >= 3);
  assert.ok(diagnostics.transport.archives.every(item => Number.isInteger(item.retries) && Number.isInteger(item.failures)));
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
  assert.equal(regional.sizingModel,'fixed-world-shared-chegem-font-scale');
  assert.equal(regional.sharedSizeReferenceId,'region_chegem');
  assert.ok(regional.sharedLabelMetersPerPixel > 0);

  const presentation = await page.evaluate(() => window.ALAN_MAP_INSTANCE.getPresentationDiagnostics());
  assert.equal(presentation.regionalLabelAltitudeM,10000);
  assert.equal(presentation.regionalLabelScale,0.666667);
  assert.equal(presentation.historicalEthnographicBoundaryVisible,false);
  assert.deepEqual(presentation.parchmentAnchors.edgeA,[43.959202,43.298704]);
  assert.deepEqual(presentation.parchmentAnchors.corner,[44.184003,43.85642]);
  assert.deepEqual(presentation.parchmentAnchors.edgeC,[42.946104,44.117789]);
  assert.deepEqual(presentation.parchmentCompass,[43.82900045,43.71487991]);
  assert.equal(presentation.parchmentLayout.maskGeometry,'fixed-7.2');
  assert.equal(presentation.parchmentLayout.compassIndependent,true);
  assert.equal(presentation.parchmentOverlayReady,false);
  assert.equal(diagnostics.presentation.frameWidthM,2000);
  assert.equal(diagnostics.presentation.compassRadiusM,14300);
  assert.equal(diagnostics.presentation.compassScaleFrom722,.65);

  const nativePresentationState = await page.evaluate(() => {
    const map=window.ALAN_MAP_INSTANCE.map;
    const diagnostics=window.ALAN_MAP_PRESENTATION_723;
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
  const fixedGeometryAfter=await page.evaluate(() => JSON.stringify(window.ALAN_MAP_PRESENTATION_723.geometry()));
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
  assert.equal(performanceMetrics.transport.mode,'adaptive-http-range');
  assert.ok(performanceMetrics.transport.cache.maxBytes >= 12 * 1024 * 1024);

  const mobile = await browser.newPage({viewport:{width:412,height:915},isMobile:true,hasTouch:true});
  let forcedVectorFailures=0;
  await mobile.route('**/data/alan-vector-7.2.pmtiles',async(route) => {
    const range=route.request().headers()['range'];
    if (range && forcedVectorFailures < 4) {
      forcedVectorFailures += 1;
      await route.fulfill({status:503,body:'temporary vector range failure'});
      return;
    }
    await route.continue();
  });
  await mobile.goto('http://127.0.0.1:4173/',{waitUntil:'domcontentloaded',timeout:30000});
  await mobile.waitForFunction(()=>Boolean(window.ALAN_MAP_INSTANCE?.map?.getLayer?.('road-main')),undefined,{timeout:60000});
  await mobile.waitForFunction(()=>Boolean(window.ALAN_MAP_INSTANCE?.map?.isSourceLoaded?.('openmaptiles')),undefined,{timeout:60000});
  const fallbackDiagnostics=await mobile.evaluate(() => window.ALAN_MAP_PMTILES_RANGE_DIAGNOSTICS?.());
  const fallbackVector=fallbackDiagnostics.archives.find(item=>item.sourceId==='openmaptiles');
  assert.ok(forcedVectorFailures >= 4);
  assert.equal(fallbackDiagnostics.mobileProfile,true);
  assert.equal(fallbackVector.fullFileFallbackActive,true);
  assert.equal(fallbackVector.mode,'full-file-fallback');
  assert.equal(fallbackVector.concurrency.limit,3);
  assert.ok(fallbackVector.fullFileFallbackBytes >= 16_000_000);
  await mobile.close();

  assert.ok(errors.length === 0, errors.join('\n'));
  console.log('map-smoke: ok');
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
