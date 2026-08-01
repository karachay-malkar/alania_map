import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';

fs.mkdirSync('build', {recursive: true});
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist']
});
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
  await page.waitForFunction(() => window.ALAN_12_1_INSTANCE?.diagnostics?.().registeredImages === 29);

  const diagnostics = await page.evaluate(() => {
    const instance = window.ALAN_12_1_INSTANCE;
    const result = instance.diagnostics();
    const pointFeatures = instance.map.querySourceFeatures('mountain-points');
    const iconLayers = ['mountain-icons-primary', 'mountain-icons-high', 'mountain-icons-medium', 'mountain-icons-detail'];
    const visibleIconFeatures = instance.map.queryRenderedFeatures({layers: iconLayers});
    return {
      ...result,
      loadingHidden: document.getElementById('loading')?.hasAttribute('hidden') || false,
      status: document.getElementById('map-status')?.textContent || '',
      pointSourceFeatureCount: pointFeatures.length,
      iconDataFeatureCount: instance.data.icons.features.length,
      visibleIconFeatureCount: visibleIconFeatures.length,
      dataPropertyKeys: [...new Set(instance.data.mountains.features.flatMap((feature) => Object.keys(feature.properties || {})))].sort(),
      bindingPropertyKeys: [...new Set(instance.data.iconBindings.flatMap((binding) => Object.keys(binding || {})))].sort(),
      canvasWidth: instance.map.getCanvas().width,
      canvasHeight: instance.map.getCanvas().height
    };
  });

  const externalRequests = requests.filter((url) =>
    !url.startsWith('http://127.0.0.1:8000/') &&
    !url.startsWith('blob:http://127.0.0.1:8000/')
  );
  const relevantErrors = errors.filter((message) => !/favicon|WebGL performance caveat/i.test(message));

  assert.equal(diagnostics.version, '12.1.1');
  assert.equal(diagnostics.flat, true);
  assert.equal(diagnostics.pitch, 0);
  assert.equal(diagnostics.bearing, 0);
  assert.equal(diagnostics.maxPitch, 0);
  assert.deepEqual(diagnostics.sourceIds.sort(), ['boundary', 'mountain-icons', 'mountain-points']);
  assert.equal(diagnostics.pointCount, 1000);
  assert.equal(diagnostics.iconBindingCount, 300);
  assert.equal(diagnostics.registeredImages, 29);
  assert.equal(diagnostics.layerIds.filter((id) => id.startsWith('mountain-icons-')).length, 4);
  assert.ok(diagnostics.pointSourceFeatureCount > 0);
  assert.equal(diagnostics.iconDataFeatureCount, 300);
  assert.deepEqual(diagnostics.dataPropertyKeys, ['elevation_m', 'id', 'latitude', 'longitude', 'name', 'type']);
  assert.deepEqual(diagnostics.bindingPropertyKeys, ['icon_id', 'icon_scale', 'min_zoom', 'point_id', 'priority']);
  assert.equal(diagnostics.loadingHidden, true);
  assert.equal(diagnostics.status, '1000 точек · 300 фигурок');
  assert.ok(diagnostics.canvasWidth > 0 && diagnostics.canvasHeight > 0);
  assert.equal(externalRequests.length, 0, `external requests: ${externalRequests.join(', ')}`);
  assert.equal(relevantErrors.length, 0, `browser errors: ${relevantErrors.join('\n')}`);

  await page.evaluate(() => {
    const map = window.ALAN_12_1_INSTANCE.map;
    map.setZoom(9.8);
    map.triggerRepaint();
  });
  await page.waitForFunction(() => {
    try {
      const map = window.ALAN_12_1_INSTANCE?.map;
      if (!map?.isStyleLoaded?.()) return false;
      return map.queryRenderedFeatures({
        layers: ['mountain-icons-primary', 'mountain-icons-high', 'mountain-icons-medium']
      }).length > 0;
    } catch {
      return false;
    }
  });
  const visibleIcons = await page.evaluate(() => window.ALAN_12_1_INSTANCE.map.queryRenderedFeatures({layers: ['mountain-icons-primary', 'mountain-icons-high', 'mountain-icons-medium']}).length);
  assert.ok(visibleIcons > 0, 'no mountain icons are visible at zoom 9.8');

  const report = {
    firstUsefulFrameMs: Date.now() - startedAt,
    diagnostics,
    visibleIconsAtZoom9_8: visibleIcons,
    externalRequests,
    browserErrors: relevantErrors,
    requestCount: requests.length
  };
  fs.writeFileSync('build/12.1-browser-diagnostics.json', JSON.stringify(report, null, 2));
  await page.screenshot({path: 'build/12.1-map.png', fullPage: false, animations: 'disabled'});
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await page.screenshot({path: 'build/12.1-map-failed.png', fullPage: false, animations: 'disabled'}).catch(() => {});
  fs.writeFileSync('build/12.1-browser-errors.json', JSON.stringify({error: String(error), errors, requests}, null, 2));
  throw error;
} finally {
  await browser.close();
}
