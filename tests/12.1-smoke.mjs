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

  const diagnostics = await page.evaluate(() => {
    const instance = window.ALAN_12_1_INSTANCE;
    const result = instance.diagnostics();
    const sourceFeatures = instance.map.querySourceFeatures('mountain-points');
    const propertyKeys = [...new Set(sourceFeatures.flatMap((feature) => Object.keys(feature.properties || {})))].sort();
    return {
      ...result,
      loadingHidden: document.getElementById('loading')?.hasAttribute('hidden') || false,
      status: document.getElementById('map-status')?.textContent || '',
      renderedSourceFeatureCount: sourceFeatures.length,
      propertyKeys,
      canvasWidth: instance.map.getCanvas().width,
      canvasHeight: instance.map.getCanvas().height
    };
  });

  const externalRequests = requests.filter((url) =>
    !url.startsWith('http://127.0.0.1:8000/') &&
    !url.startsWith('blob:http://127.0.0.1:8000/')
  );
  const relevantErrors = errors.filter((message) => !/favicon|WebGL performance caveat/i.test(message));

  assert.equal(diagnostics.version, '12.1.0');
  assert.equal(diagnostics.flat, true);
  assert.equal(diagnostics.pitch, 0);
  assert.equal(diagnostics.bearing, 0);
  assert.equal(diagnostics.maxPitch, 0);
  assert.deepEqual(diagnostics.sourceIds.sort(), ['boundary', 'mountain-points']);
  assert.ok(diagnostics.pointCount > 0);
  assert.ok(diagnostics.renderedSourceFeatureCount > 0);
  assert.deepEqual(diagnostics.propertyKeys, ['elevation_m', 'id', 'latitude', 'longitude', 'name', 'type']);
  assert.equal(diagnostics.loadingHidden, true);
  assert.ok(diagnostics.canvasWidth > 0 && diagnostics.canvasHeight > 0);
  assert.equal(externalRequests.length, 0, `external requests: ${externalRequests.join(', ')}`);
  assert.equal(relevantErrors.length, 0, `browser errors: ${relevantErrors.join('\n')}`);

  const report = {
    firstUsefulFrameMs: Date.now() - startedAt,
    diagnostics,
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
