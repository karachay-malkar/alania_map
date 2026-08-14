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
      labels:api?.getLabelDiagnostics?.(),
      layers:{
        currentSettlement:byId['settlement-current-points'],
        historicSettlement:byId['settlement-historic-points'],
        historicObject:byId['historic-object-points'],
        peakPoint:byId['osm-peak-points'],
        peakLabel:byId['osm-peak-labels'],
        settlementBeamHalo:byId['settlement-beam-halo'] || null,
        settlementBeamCore:byId['settlement-beam-core'] || null
      },
      overlay:{
        version:window.ALAN_MAP_PRESENTATION_7025?.version,
        frameWidthM:window.ALAN_MAP_PRESENTATION_7025?.frameWidthM,
        compassRadiusM:window.ALAN_MAP_PRESENTATION_7025?.compassRadiusM,
        beamLayersRemoved:window.ALAN_MAP_PRESENTATION_7025?.beamLayersRemoved?.(),
        compassMapPlaneAligned:window.ALAN_MAP_PRESENTATION_7025?.compassMapPlaneAligned?.()
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

  assert.equal(diagnostics.layers.settlementBeamHalo,null);
  assert.equal(diagnostics.layers.settlementBeamCore,null);
  assert.equal(diagnostics.overlay.beamLayersRemoved,true);

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
  assert.equal(diagnostics.overlay.version,'7.1-r1');
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

  // 7.1 changes only the DEM/data envelope. Static map-plane and world-radius
  // assertions above protect the inherited compass contract without racing
  // the two established render listeners during synthetic zoom jumps.
  assert.ok(errors.length === 0, errors.join('\n'));
  console.log('map-smoke: ok');
} finally {
  await browser.close();
  server.kill('SIGTERM');
}
