import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';

fs.mkdirSync('build', {recursive: true});
const browser = await chromium.launch({headless: true, args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist']});
const page = await browser.newPage({viewport: {width: 1440, height: 1000}, deviceScaleFactor: 1});
page.setDefaultTimeout(120000);
const errors = [];
const requests = [];
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
page.on('pageerror', (error) => errors.push(String(error)));
page.on('request', (request) => requests.push(request.url()));

try {
  const startedAt = Date.now();
  await page.goto('http://127.0.0.1:8000/index.html', {waitUntil: 'domcontentloaded'});
  await page.waitForFunction(() => window.ALAN_12_1_INSTANCE?.map?.isStyleLoaded?.());
  await page.waitForFunction(() => document.getElementById('loading')?.hasAttribute('hidden'));
  await page.waitForFunction(() => window.ALAN_12_1_INSTANCE?.diagnostics?.().imageDrawCalls > 0);

  const diagnostics = await page.evaluate(() => {
    const instance = window.ALAN_12_1_INSTANCE;
    const result = instance.diagnostics();
    const renderer = instance.map.__mountainImageLayer;
    const id = instance.data.iconBindings[0].point_id;
    const firstOrdinary = instance.data.icons.features.find((feature) => !['main_mountain', 'five_thousander'].includes(feature.properties.type));
    const firstMain = instance.data.icons.features.find((feature) => feature.properties.type === 'main_mountain');
    const firstFive = instance.data.icons.features.find((feature) => feature.properties.type === 'five_thousander');
    const order = renderer.drawOrder;
    return {
      ...result,
      status: document.getElementById('map-status')?.textContent || '',
      bindingPropertyKeys: [...new Set(instance.data.iconBindings.flatMap((binding) => Object.keys(binding || {})))].sort(),
      widthAt8: renderer.measureWidth(id, 8),
      widthAt9: renderer.measureWidth(id, 9),
      canvasWidth: instance.map.getCanvas().width,
      canvasHeight: instance.map.getCanvas().height,
      imageLayerRegistered: Boolean(instance.map.getLayer('mountain-images')),
      riverBufferRegistered: Boolean(instance.map.getLayer('river-buffer')),
      riverLineRegistered: Boolean(instance.map.getLayer('river-line')),
      firstOrdinaryIndex: order.indexOf(firstOrdinary.properties.point_id),
      firstMainIndex: order.indexOf(firstMain.properties.point_id),
      firstFiveIndex: order.indexOf(firstFive.properties.point_id)
    };
  });

  const clickable = await page.evaluate(async () => {
    const instance = window.ALAN_12_1_INSTANCE;
    const feature = instance.data.mountains.features.find((item) => item.properties.type === 'five_thousander');
    const point = instance.map.project(feature.geometry.coordinates);
    const rect = instance.map.getCanvas().getBoundingClientRect();
    return {x: rect.left + point.x, y: rect.top + point.y};
  });
  await page.mouse.click(clickable.x, clickable.y);
  await page.waitForFunction(() => document.getElementById('feature-card')?.hidden === false);

  const performanceSample = await page.evaluate(async () => {
    const map = window.ALAN_12_1_INSTANCE.map;
    let frames = 0;
    const count = () => { frames += 1; };
    map.on('render', count);
    const start = performance.now();
    map.easeTo({zoom: map.getZoom() + 1, duration: 700});
    await new Promise((resolve) => setTimeout(resolve, 900));
    map.stop();
    map.off('render', count);
    const elapsed = performance.now() - start;
    return {frames, elapsedMs: Math.round(elapsed), approximateFps: Number((frames / (elapsed / 1000)).toFixed(1))};
  });

  const external = requests.filter((url) => !url.startsWith('http://127.0.0.1:8000/') && !url.startsWith('blob:http://127.0.0.1:8000/'));
  const relevant = errors.filter((message) => !/favicon|WebGL performance caveat/i.test(message));
  assert.equal(diagnostics.version, '12.1.3');
  assert.equal(diagnostics.flat, true);
  assert.deepEqual(diagnostics.sourceIds.sort(), ['boundary', 'mountain-points', 'rivers']);
  assert.equal(diagnostics.pointCount, 1000);
  assert.equal(diagnostics.iconBindingCount, 1000);
  assert.equal(diagnostics.imageLayerCount, 1000);
  assert.equal(diagnostics.imageVertexCount, 6000);
  assert.equal(diagnostics.riverFeatureCount, 31);
  assert.equal(diagnostics.representedRiverSystems, 32);
  assert.ok(diagnostics.imageDrawCalls > 0);
  assert.equal(diagnostics.imageLayerRegistered, true);
  assert.equal(diagnostics.riverBufferRegistered, true);
  assert.equal(diagnostics.riverLineRegistered, true);
  assert.equal(diagnostics.imageLayerBeforeRiverBuffer, true);
  assert.equal(diagnostics.riverBufferBeforeRiverLine, true);
  assert.equal(diagnostics.pointLayersHidden, true);
  assert.ok(diagnostics.firstOrdinaryIndex >= 0 && diagnostics.firstMainIndex > diagnostics.firstOrdinaryIndex && diagnostics.firstFiveIndex > diagnostics.firstMainIndex);
  assert.deepEqual(diagnostics.bindingPropertyKeys, ['base_shift', 'icon_id', 'icon_scale', 'min_zoom', 'point_id', 'priority']);
  assert.equal(diagnostics.status, '1000 точек · 1000 фигурок · 32 речные системы');
  assert.ok(Math.abs(diagnostics.widthAt9 / diagnostics.widthAt8 - 2) < 0.0001);
  assert.equal(external.length, 0, `external requests: ${external.join(', ')}`);
  assert.equal(relevant.length, 0, `browser errors: ${relevant.join('\n')}`);
  assert.ok(performanceSample.frames >= 3, `render loop did not stay active: ${JSON.stringify(performanceSample)}`);
  assert.ok(performanceSample.elapsedMs < 1500, `zoom animation exceeded the allowed window: ${JSON.stringify(performanceSample)}`);

  const report = {firstUsefulFrameMs: Date.now() - startedAt, diagnostics, performanceSample, externalRequests: external, browserErrors: relevant, requestCount: requests.length};
  fs.writeFileSync('build/12.1-browser-diagnostics.json', JSON.stringify(report, null, 2));
  await page.screenshot({path: 'build/12.1-map.png', animations: 'disabled'});
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await page.screenshot({path: 'build/12.1-map-failed.png', animations: 'disabled'}).catch(() => {});
  fs.writeFileSync('build/12.1-browser-errors.json', JSON.stringify({error: String(error), errors, requests}, null, 2));
  throw error;
} finally {
  await browser.close();
}
