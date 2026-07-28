import { chromium } from 'playwright';
import fs from 'node:fs';

const browser = await chromium.launch({headless: true, args: ['--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const page = await browser.newPage({viewport: {width: 1440, height: 1000}, deviceScaleFactor: 1});
const consoleErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => consoleErrors.push(String(error)));

await page.goto('http://127.0.0.1:8000/index.html', {waitUntil: 'domcontentloaded', timeout: 120000});
await page.waitForFunction(() => window.ALAN_MAP_INSTANCE?.map?.isStyleLoaded?.(), null, {timeout: 120000});
await page.waitForFunction(() => document.querySelector('.alan-map-loading')?.classList.contains('hidden'), null, {timeout: 120000});
await page.waitForTimeout(4000);

const diagnostics = await page.evaluate(() => {
  const instance = window.ALAN_MAP_INSTANCE;
  const map = instance.map;
  const style = instance.getStyleDiagnostics();
  const frame = instance.getFrameClipDiagnostics();
  const network = instance.getNetworkDiagnostics();
  const requiredLayers = [
    'osm-glacier-fill','osm-snow-fill','osm-lake-fill','osm-river-water-fill',
    'osm-river-main','osm-river-regional','osm-river-local',
    'osm-peak-high','osm-peak-points'
  ];
  return {
    version: instance.version,
    requiredLayers: Object.fromEntries(requiredLayers.map((id) => [id, Boolean(map.getLayer(id))])),
    style,
    frame,
    network,
    natural: window.ALAN_MAP_NATURAL?.version || null,
    title: document.title,
    status: document.querySelector('[data-role="status"]')?.textContent || ''
  };
});

fs.mkdirSync('build', {recursive: true});
fs.writeFileSync('build/browser-diagnostics.json', JSON.stringify(diagnostics, null, 2));
await page.screenshot({path: 'build/map-smoke.png', fullPage: true});
await browser.close();

if (diagnostics.version !== '7.0.22' || diagnostics.natural !== '7.0.22') {
  throw new Error(`Unexpected runtime version: ${JSON.stringify({version: diagnostics.version, natural: diagnostics.natural})}`);
}
for (const [layer, present] of Object.entries(diagnostics.requiredLayers)) {
  if (!present) throw new Error(`Required layer is missing: ${layer}`);
}
if (!diagnostics.frame.strictDataClip || diagnostics.frame.cssClipPath || diagnostics.frame.runtimeMask) {
  throw new Error(`Frame clipping regression: ${JSON.stringify(diagnostics.frame)}`);
}
const relevantErrors = consoleErrors.filter((message) => !/favicon|WebGL performance caveat/i.test(message));
if (relevantErrors.length) {
  throw new Error(`Browser errors:\n${relevantErrors.join('\n')}`);
}
console.log(JSON.stringify(diagnostics, null, 2));
