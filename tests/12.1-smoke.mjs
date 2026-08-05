import {chromium, devices} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';

fs.mkdirSync('build', {recursive: true});
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist']
});

function observe(page, requests, errors) {
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

async function samplePerformance(page) {
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
    const onFrame = (time) => {
      rafTimes.push(time);
      if (performance.now() - started < 1000) requestAnimationFrame(onFrame);
    };
    requestAnimationFrame(onFrame);
    map.easeTo({zoom: map.getZoom() + 1, duration: 700});
    await new Promise((resolve) => setTimeout(resolve, 1000));
    map.stop();
    map.off('render', onRender);
    observer?.disconnect();
    const elapsed = performance.now() - started;
    const gaps = (values) => values.slice(1).map((time, index) => time - values[index]);
    const rafGaps = gaps(rafTimes);
    const renderGaps = gaps(renderTimes);
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

function assertNoStall(sample, mobile = false) {
  // SwiftShader FPS varies widely on shared CI runners. A real regression is a
  // stalled animation, a large frame gap, or a blocking main-thread task.
  const maxGap = mobile ? 550 : 500;
  assert.ok(sample.elapsedMs < 1500, JSON.stringify(sample));
  assert.ok(sample.renderFrames >= 3, JSON.stringify(sample));
  assert.ok(sample.rafFrames >= 3, JSON.stringify(sample));
  assert.ok(sample.longestRafGapMs < maxGap, JSON.stringify(sample));
  assert.ok(sample.longestRenderGapMs < maxGap, JSON.stringify(sample));
  assert.ok(sample.longestLongTaskMs < 500, JSON.stringify(sample));
}

async function captureZone(page, filename, systemIds) {
  const bounds = await page.evaluate((ids) => {
    const points = [];
    const collect = (value) => {
      if (!Array.isArray(value)) return;
      if (value.length >= 2 && Number.isFinite(+value[0]) && Number.isFinite(+value[1])) points.push([+value[0], +value[1]]);
      else value.forEach(collect);
    };
    window.ALAN_12_1_INSTANCE.data.rivers.features
      .filter((feature) => ids.includes(feature.properties.system_id))
      .forEach((feature) => collect(feature.geometry.coordinates));
    return points.reduce((result, point) => [
      Math.min(result[0], point[0]), Math.min(result[1], point[1]),
      Math.max(result[2], point[0]), Math.max(result[3], point[1])
    ], [Infinity, Infinity, -Infinity, -Infinity]);
  }, systemIds);
  await page.evaluate((value) => new Promise((resolve) => {
    const map = window.ALAN_12_1_INSTANCE.map;
    map.fitBounds([[value[0], value[1]], [value[2], value[3]]], {padding: 90, duration: 0, maxZoom: 11.4});
    map.once('idle', resolve);
  }), bounds);
  await page.screenshot({path: `build/${filename}`, animations: 'disabled'});
}

const outsideRequests = (requests) => requests.filter((url) =>
  !url.startsWith('http://127.0.0.1:8000/') && !url.startsWith('blob:http://127.0.0.1:8000/'));
const relevantErrors = (errors) => errors.filter((message) => !/favicon|WebGL performance caveat/i.test(message));

try {
  const desktopRequests = [];
  const desktopErrors = [];
  const page = await browser.newPage({viewport: {width: 1440, height: 1000}, deviceScaleFactor: 1});
  page.setDefaultTimeout(120000);
  observe(page, desktopRequests, desktopErrors);
  const desktopStart = Date.now();
  await waitForMap(page);
  const desktopReadyMs = Date.now() - desktopStart;

  const diagnostics = await page.evaluate(() => {
    const instance = window.ALAN_12_1_INSTANCE;
    const result = instance.diagnostics();
    const renderer = instance.map.__mountainImageLayer;
    const first = instance.data.icons.features[0];
    const ordinary = instance.data.icons.features.find((feature) => !['main_mountain', 'five_thousander'].includes(feature.properties.type));
    const main = instance.data.icons.features.find((feature) => feature.properties.type === 'main_mountain');
    const five = instance.data.icons.features.find((feature) => feature.properties.type === 'five_thousander');
    return {
      ...result,
      status: document.getElementById('map-status')?.textContent || '',
      widthAt8: renderer.measureWidth(first.properties.point_id, 8),
      widthAt9: renderer.measureWidth(first.properties.point_id, 9),
      firstOrdinaryIndex: renderer.drawOrder.indexOf(ordinary.properties.point_id),
      firstMainIndex: renderer.drawOrder.indexOf(main.properties.point_id),
      firstFiveIndex: renderer.drawOrder.indexOf(five.properties.point_id),
      featureCardPresent: Boolean(document.getElementById('feature-card'))
    };
  });
  const desktopPerformance = await samplePerformance(page);
  const cursor = await page.evaluate(() => getComputedStyle(window.ALAN_12_1_INSTANCE.map.getCanvas()).cursor);
  const desktopExternal = outsideRequests(desktopRequests);
  const desktopRelevantErrors = relevantErrors(desktopErrors);

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
  assert.equal(desktopExternal.length, 0, desktopExternal.join(', '));
  assert.equal(desktopRelevantErrors.length, 0, desktopRelevantErrors.join('\n'));
  assert.ok(desktopRequests.length <= 12, `too many desktop requests: ${desktopRequests.length}`);
  assertNoStall(desktopPerformance);

  await page.evaluate(() => {
    const instance = window.ALAN_12_1_INSTANCE;
    instance.map.fitBounds([[instance.data.bounds[0], instance.data.bounds[1]], [instance.data.bounds[2], instance.data.bounds[3]]], {padding: 48, duration: 0});
  });
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
  observe(mobile, mobileRequests, mobileErrors);
  const mobileStart = Date.now();
  await waitForMap(mobile);
  const mobileReadyMs = Date.now() - mobileStart;
  const mobileDiagnostics = await mobile.evaluate(() => window.ALAN_12_1_INSTANCE.diagnostics());
  const mobilePerformance = await samplePerformance(mobile);
  const mobileExternal = outsideRequests(mobileRequests);
  const mobileRelevantErrors = relevantErrors(mobileErrors);

  assert.equal(mobileDiagnostics.version, '12.1.5');
  assert.equal(mobileDiagnostics.imageLayerCount, 1000);
  assert.ok(mobileDiagnostics.pixelRatio <= 1.5);
  assert.equal(mobileExternal.length, 0, mobileExternal.join(', '));
  assert.equal(mobileRelevantErrors.length, 0, mobileRelevantErrors.join('\n'));
  assert.ok(mobileRequests.length <= 12, `too many mobile requests: ${mobileRequests.length}`);
  assertNoStall(mobilePerformance, true);
  await mobile.screenshot({path: 'build/12.1-map-android.png', animations: 'disabled'});

  const report = {
    version: '12.1.5',
    desktop: {firstUsefulFrameMs: desktopReadyMs, diagnostics, performance: desktopPerformance, requestCount: desktopRequests.length, externalRequests: desktopExternal, browserErrors: desktopRelevantErrors},
    android: {firstUsefulFrameMs: mobileReadyMs, diagnostics: mobileDiagnostics, performance: mobilePerformance, requestCount: mobileRequests.length, externalRequests: mobileExternal, browserErrors: mobileRelevantErrors}
  };
  fs.writeFileSync('build/12.1-browser-diagnostics.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  fs.writeFileSync('build/12.1-browser-errors.json', JSON.stringify({error: String(error)}, null, 2));
  throw error;
} finally {
  await browser.close();
}
