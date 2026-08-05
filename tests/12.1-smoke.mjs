import {chromium, devices} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';

fs.mkdirSync('build', {recursive: true});
const browser = await chromium.launch({headless: true, args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist']});
const browserErrors = [];

function watch(page, requests, errors) {
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('request', (request) => requests.push(request.url()));
}

async function waitForMap(page) {
  await page.goto('http://127.0.0.1:8000/index.html', {waitUntil: 'domcontentloaded'});
  await page.waitForFunction(() => window.ALAN_12_1_INSTANCE?.map?.isStyleLoaded?.());
  await page.waitForFunction(() => document.getElementById('loading')?.hasAttribute('hidden'));
  await page.waitForFunction(() => window.ALAN_12_1_INSTANCE?.diagnostics?.().imageDrawCalls > 0);
}

async function performanceSample(page) {
  return page.evaluate(async () => {
    const map = window.ALAN_12_1_INSTANCE.map;
    const renderTimes = [];
    const rafTimes = [];
    const longTasks = [];
    const onRender = () => renderTimes.push(performance.now());
    map.on('render', onRender);
    let observer;
    if ('PerformanceObserver' in window) {
      observer = new PerformanceObserver((list) => longTasks.push(...list.getEntries().map((entry) => entry.duration)));
      try { observer.observe({entryTypes: ['longtask']}); } catch {}
    }
    const started = performance.now();
    const raf = (time) => {
      rafTimes.push(time);
      if (performance.now() - started < 1000) requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);
    map.easeTo({zoom: map.getZoom() + 1, duration: 700});
    await new Promise((resolve) => setTimeout(resolve, 1000));
    map.stop();
    map.off('render', onRender);
    observer?.disconnect();
    const elapsed = performance.now() - started;
    const rafGaps = rafTimes.slice(1).map((time, index) => time - rafTimes[index]);
    const renderGaps = renderTimes.slice(1).map((time, index) => time - renderTimes[index]);
    return {
      elapsedMs: Math.round(elapsed),
      renderFrames: renderTimes.length,
      renderFps: Number((renderTimes.length / (elapsed / 1000)).toFixed(1)),
      rafFrames: rafTimes.length,
      rafFps: Number((rafTimes.length / (elapsed / 1000)).toFixed(1)),
      longestRafGapMs: Math.round(Math.max(0, ...rafGaps)),
      longestRenderGapMs: Math.round(Math.max(0, ...renderGaps)),
      longestLongTaskMs: Math.round(Math.max(0, ...longTasks))
    };
  });
}

async function zoneBounds(page, systemIds) {
  return page.evaluate((ids) => {
    const features = window.ALAN_12_1_INSTANCE.data.rivers.features.filter((feature) => ids.includes(feature.properties.system_id));
    const values = [];
    const collect = (item) => {
      if (!Array.isArray(item)) return;
      if (item.length >= 2 && Number.isFinite(Number(item[0])) && Number.isFinite(Number(item[1]))) values.push([Number(item[0]), Number(item[1])]);
      else item.forEach(collect);
    };
    features.forEach((feature) => collect(feature.geometry.coordinates));
    return values.reduce((bounds, point) => [Math.min(bounds[0], point[0]), Math.min(bounds[1], point[1]), Math.max(bounds[2], point[0]), Math.max(bounds[3], point[1])], [Infinity, Infinity, -Infinity, -Infinity]);
  }, systemIds);
}

async function captureZone(page, filename, systemIds) {
  const bounds = await zoneBounds(page, systemIds);
  await page.evaluate((value) => new Promise((resolve) => {
    const map = window.ALAN_12_1_INSTANCE.map;
    map.fitBounds([[value[0], value[1]], [value[2], value[3]]], {padding: 90, duration: 0, maxZoom: 11.4});
    map.once('idle', resolve);
  }), bounds);
  await page.screenshot({path: `build/${filename}`, animations: 'disabled'});
}

try {
  const desktopRequests = [];
  const desktopErrors = [];
  const page = await browser.newPage({viewport: {width: 1440, height: 1000}, deviceScaleFactor: 1});
  page.setDefaultTimeout(120000);
  watch(page, desktopRequests, desktopErrors);
  const startedAt = Date.now();
  await waitForMap(page);

  const diagnostics = await page.evaluate(() => {
    const instance = window.ALAN_12_1_INSTANCE;
    const result = instance.diagnostics();
    const renderer = instance.map.__mountainImageLayer;
    const first = instance.data.icons.features[0];
    const firstOrdinary = instance.data.icons.features.find((feature) => !['main_mountain', 'five_thousander'].includes(feature.properties.type));
    const firstMain = instance.data.icons.features.find((feature) => feature.properties.type === 'main_mountain');
    const firstFive = instance.data.icons.features.find((feature) => feature.properties.type === 'five_thousander');
    const order = renderer.drawOrder;
    return {
      ...result,
      status: document.getElementById('map-status')?.textContent || '',
      widthAt8: renderer.measureWidth(first.properties.point_id, 8),
      widthAt9: renderer.measureWidth(first.properties.point_id, 9),
      canvasWidth: instance.map.getCanvas().width,
      canvasHeight: instance.map.getCanvas().height,
      firstOrdinaryIndex: order.indexOf(firstOrdinary.properties.point_id),
      firstMainIndex: order.indexOf(firstMain.properties.point_id),
      firstFiveIndex: order.indexOf(firstFive.properties.point_id),
      featureCardPresent: Boolean(document.getElementById('feature-card'))
    };
  });
  const desktopPerformance = await performanceSample(page);
  const cursor = await page.evaluate(() => getComputedStyle(window.ALAN_12_1_INSTANCE.map.getCanvas()).cursor);
  const externalDesktop = desktopRequests.filter((url) => !url.startsWith('http://127.0.0.1:8000/') && !url.startsWith('blob:http://127.0.0.1:8000/'));
  const relevantDesktopErrors = desktopErrors.filter((message) => !/favicon|WebGL performance caveat/i.test(message));

  assert.equal(diagnostics.version, '12.1.5');
  assert.equal(diagnostics.flat, true);
  assert.deepEqual(diagnostics.sourceIds.sort(), ['boundary', 'rivers']);
  assert.equal(diagnostics.pointCount, 1000);
  assert.ok(diagnostics.counts.ridge > 0);
  assert.equal(diagnostics.imageLayerCount, 1000);
  assert.equal(diagnostics.imageVertexCount, 6000);
  assert.equal(diagnostics.riverFeatureCount, 31);
  assert.equal(diagnostics.representedRiverSystems, 32);
  assert.equal(diagnostics.imageLayerBeforeRiverBuffer, true);
  assert.equal(diagnostics.riverBufferBeforeRiverLine, true);
  assert.equal(diagnostics.imageAnchorMode, 'center');
  assert.equal(diagnostics.imageSizeMultiplier, 2);
  assert.equal(diagnostics.pointSourceRegistered, false);
  assert.equal(diagnostics.pointInteractionEnabled, false);
  assert.equal(diagnostics.featureCardPresent, false);
  assert.ok(diagnostics.firstOrdinaryIndex >= 0 && diagnostics.firstMainIndex > diagnostics.firstOrdinaryIndex && diagnostics.firstFiveIndex > diagnostics.firstMainIndex);
  assert.equal(diagnostics.status, '1000 фигурок · 32 речные системы');
  assert.ok(Math.abs(diagnostics.widthAt9 / diagnostics.widthAt8 - 2) < 0.0001);
  assert.notEqual(cursor, 'pointer');
  assert.equal(externalDesktop.length, 0, `external requests: ${externalDesktop.join(', ')}`);
  assert.equal(relevantDesktopErrors.length, 0, `browser errors: ${relevantDesktopErrors.join('\n')}`);
  assert.ok(desktopRequests.length <= 12, `too many desktop requests: ${desktopRequests.length}`);
  assert.ok(desktopPerformance.renderFrames >= 6, JSON.stringify(desktopPerformance));
  assert.ok(desktopPerformance.rafFps >= 20, JSON.stringify(desktopPerformance));
  assert.ok(desktopPerformance.longestRafGapMs < 300, JSON.stringify(desktopPerformance));
  assert.ok(desktopPerformance.longestLongTaskMs < 500, JSON.stringify(desktopPerformance));

  await page.evaluate(() => window.ALAN_12_1_INSTANCE.map.fitBounds([[window.ALAN_12_1_INSTANCE.data.bounds[0], window.ALAN_12_1_INSTANCE.data.bounds[1]], [window.ALAN_12_1_INSTANCE.data.bounds[2], window.ALAN_12_1_INSTANCE.data.bounds[3]]], {padding: 48, duration: 0}));
  await page.screenshot({path: 'build/12.1-map.png', animations: 'disabled'});
  await captureZone(page, '12.1-zone-cherek-bezengi.png', ['cherek-balkarsky', 'cherek-bezengiysky']);
  await captureZone(page, '12.1-zone-kuban.png', ['kuban']);
  await captureZone(page, '12.1-zone-teberda.png', ['teberda']);
  await captureZone(page, '12.1-zone-malka.png', ['malka']);
  await captureZone(page, '12.1-zone-baksan.png', ['baksan']);
  await captureZone(page, '12.1-zone-dombay.png', ['dombay-ulgen', 'alibek']);

  const mobileRequests = [];
  const mobileErrors = [];
  const mobile = await browser.newPage({...devices['Pixel 7']});
  mobile.setDefaultTimeout(120000);
  watch(mobile, mobileRequests, mobileErrors);
  const mobileStarted = Date.now();
  await waitForMap(mobile);
  const mobileDiagnostics = await mobile.evaluate(() => window.ALAN_12_1_INSTANCE.diagnostics());
  const mobilePerformance = await performanceSample(mobile);
  const externalMobile = mobileRequests.filter((url) => !url.startsWith('http://127.0.0.1:8000/') && !url.startsWith('blob:http://127.0.0.1:8000/'));
  const relevantMobileErrors = mobileErrors.filter((message) => !/favicon|WebGL performance caveat/i.test(message));
  assert.equal(mobileDiagnostics.version, '12.1.5');
  assert.equal(mobileDiagnostics.imageLayerCount, 1000);
  assert.ok(mobileDiagnostics.pixelRatio <= 1.5);
  assert.equal(externalMobile.length, 0);
  assert.equal(relevantMobileErrors.length, 0, relevantMobileErrors.join('\n'));
  assert.ok(mobileRequests.length <= 12, `too many mobile requests: ${mobileRequests.length}`);
  assert.ok(mobilePerformance.renderFrames >= 5, JSON.stringify(mobilePerformance));
  assert.ok(mobilePerformance.rafFps >= 18, JSON.stringify(mobilePerformance));
  assert.ok(mobilePerformance.longestRafGapMs < 350, JSON.stringify(mobilePerformance));
  await mobile.screenshot({path: 'build/12.1-map-android.png', animations: 'disabled'});

  const report = {
    version: '12.1.5',
    desktop: {
      firstUsefulFrameMs: Date.now() - startedAt,
      diagnostics,
      performance: desktopPerformance,
      requestCount: desktopRequests.length,
      externalRequests: externalDesktop,
      browserErrors: relevantDesktopErrors
    },
    android: {
      firstUsefulFrameMs: Date.now() - mobileStarted,
      diagnostics: mobileDiagnostics,
      performance: mobilePerformance,
      requestCount: mobileRequests.length,
      externalRequests: externalMobile,
      browserErrors: relevantMobileErrors
    }
  };
  browserErrors.push(...relevantDesktopErrors, ...relevantMobileErrors);
  fs.writeFileSync('build/12.1-browser-diagnostics.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  fs.writeFileSync('build/12.1-browser-errors.json', JSON.stringify({error: String(error), browserErrors}, null, 2));
  throw error;
} finally {
  await browser.close();
}
