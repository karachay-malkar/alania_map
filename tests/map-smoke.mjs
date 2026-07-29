import { chromium } from 'playwright';
import fs from 'node:fs';

const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist']
});
const page = await browser.newPage({
  viewport: {width: 1440, height: 1000},
  deviceScaleFactor: 1
});
const consoleErrors = [];
const requests = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => consoleErrors.push(String(error)));
page.on('request', (request) => requests.push(request.url()));

const startedAt = Date.now();
await page.goto('http://127.0.0.1:8000/index.html', {
  waitUntil: 'domcontentloaded',
  timeout: 120000
});
try {
  await page.waitForFunction(
    () => window.ALAN_MAP_INSTANCE?.map?.isStyleLoaded?.(),
    null,
    {timeout: 120000}
  );
} catch (error) {
  const startupDiagnostics = await page.evaluate(() => ({
    fatalError: document.querySelector('.alan-map-fatal-error')?.textContent || '',
    rootText: document.getElementById('alan-map-root')?.textContent?.slice(0, 1000) || '',
    hasInstance: Boolean(window.ALAN_MAP_INSTANCE),
    hasManifestDiagnostics: Boolean(window.ALAN_MAP_PMTILES_SHARD_DIAGNOSTICS),
    shard: window.ALAN_MAP_PMTILES_SHARD_DIAGNOSTICS?.() || null,
    readyState: document.readyState
  }));
  fs.mkdirSync('build', {recursive: true});
  fs.writeFileSync(
    'build/browser-diagnostics.json',
    JSON.stringify({startupDiagnostics, consoleErrors, requests}, null, 2)
  );
  await page.screenshot({path: 'build/map-smoke.png', fullPage: true});
  console.error(JSON.stringify({startupDiagnostics, consoleErrors}, null, 2));
  throw error;
}
await page.waitForFunction(
  () => document.querySelector('.alan-map-loading')?.classList.contains('hidden'),
  null,
  {timeout: 120000}
);
const firstUsefulFrameMs = Date.now() - startedAt;

const checkpoints = [
  {id: 'babugent', center: [43.55, 43.28], zoom: 10.8, layer: 'waterway', property: 'system_id', expected: 'cherek-balkarsky'},
  {id: 'nalchik', center: [43.62, 43.48], zoom: 10.8, layer: 'waterway', property: 'system_id', expected: 'nalchik'},
  {id: 'baksan', center: [43.54, 43.69], zoom: 10.5, layer: 'waterway', property: 'system_id', expected: 'baksan'},
  {id: 'teberda', center: [41.74, 43.44], zoom: 10.5, layer: 'waterway', property: 'system_id', expected: 'teberda'},
  {id: 'kuban', center: [41.91, 43.77], zoom: 10.2, layer: 'waterway', property: 'system_id', expected: 'kuban'},
  {id: 'blue-lakes', center: [43.538, 43.234], zoom: 12, layer: 'water', property: 'class', expected: 'lake'}
];

const checkpointResults = {};
for (const checkpoint of checkpoints) {
  checkpointResults[checkpoint.id] = await page.evaluate(async (current) => {
    const map = window.ALAN_MAP_INSTANCE.map;
    map.jumpTo({center: current.center, zoom: current.zoom, pitch: 0, bearing: 180});
    await new Promise((resolve) => {
      if (map.areTilesLoaded()) {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
        return;
      }
      const timeout = setTimeout(resolve, 15000);
      map.once('idle', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    const sourceFeatures = map.querySourceFeatures('openmaptiles', {sourceLayer: current.layer});
    const values = [...new Set(sourceFeatures.map((feature) => feature.properties?.[current.property]).filter(Boolean))];
    return {
      featureCount: sourceFeatures.length,
      values,
      matched: values.includes(current.expected)
    };
  }, checkpoint);
}

const performanceSample = await page.evaluate(async () => {
  const map = window.ALAN_MAP_INSTANCE.map;
  let frameCount = 0;
  const start = performance.now();
  const sample = () => {
    frameCount += 1;
  };
  map.on('render', sample);
  map.easeTo({center: [42.35, 43.55], zoom: 8.5, pitch: 45, duration: 1200});
  await new Promise((resolve) => setTimeout(resolve, 1400));
  map.off('render', sample);
  const elapsed = performance.now() - start;
  return {
    elapsedMs: Math.round(elapsed),
    frameCount,
    approximateFps: Number((frameCount / (elapsed / 1000)).toFixed(1)),
    visibilityState: document.visibilityState
  };
});

const diagnostics = await page.evaluate(() => {
  const instance = window.ALAN_MAP_INSTANCE;
  const map = instance.map;
  const style = instance.getStyleDiagnostics();
  const frame = instance.getFrameClipDiagnostics();
  const network = instance.getNetworkDiagnostics();
  const shard = window.ALAN_MAP_PMTILES_SHARD_DIAGNOSTICS?.() || null;
  const requiredLayers = [
    'osm-glacier-fill', 'osm-snow-fill', 'osm-water-fill', 'osm-river-water-fill',
    'osm-river-halo', 'osm-river-line', 'osm-peak-points', 'osm-peak-labels'
  ];
  return {
    version: instance.version,
    requiredLayers: Object.fromEntries(requiredLayers.map((id) => [id, Boolean(map.getLayer(id))])),
    style,
    frame,
    network,
    shard,
    quality: instance.getQualityProfile(),
    title: document.title,
    status: document.querySelector('[data-role="status"]')?.textContent || ''
  };
});

const localOrigin = 'http://127.0.0.1:8000/';
const localBlobOrigin = `blob:${localOrigin}`;
const externalRequests = requests.filter((url) =>
  !url.startsWith(localOrigin) && !url.startsWith(localBlobOrigin)
);
const unversionedShardRequests = requests.filter((url) =>
  /\/data\/shards\/(?:vector|dem)\/part-\d+\.bin(?:\?|$)/.test(url)
);

const report = {
  ...diagnostics,
  firstUsefulFrameMs,
  performanceSample,
  checkpoints: checkpointResults,
  requestCount: requests.length,
  externalRequests,
  unversionedShardRequests,
  consoleErrors
};

fs.mkdirSync('build', {recursive: true});
fs.writeFileSync('build/browser-diagnostics.json', JSON.stringify(report, null, 2));
await page.screenshot({path: 'build/map-smoke.png', fullPage: true});
await browser.close();

if (diagnostics.version !== '7.0.23') {
  throw new Error(`Unexpected runtime version: ${diagnostics.version}`);
}
for (const [layer, present] of Object.entries(diagnostics.requiredLayers)) {
  if (!present) throw new Error(`Required layer is missing: ${layer}`);
}
for (const [checkpoint, result] of Object.entries(checkpointResults)) {
  if (!result.matched) {
    throw new Error(`Real feature missing at ${checkpoint}: ${JSON.stringify(result)}`);
  }
}
if (!diagnostics.frame.strictDataClip || diagnostics.frame.cssClipPath || diagnostics.frame.runtimeMask) {
  throw new Error(`Frame clipping regression: ${JSON.stringify(diagnostics.frame)}`);
}
if (diagnostics.network.errors && Object.keys(diagnostics.network.errors).length) {
  throw new Error(`Source errors remain after successful loads: ${JSON.stringify(diagnostics.network.errors)}`);
}
if (!diagnostics.shard || diagnostics.shard.cache.entries > 16) {
  throw new Error(`Shard LRU regression: ${JSON.stringify(diagnostics.shard)}`);
}
if (externalRequests.length) {
  throw new Error(`External cartographic requests detected: ${externalRequests.join('\n')}`);
}
if (unversionedShardRequests.length) {
  throw new Error(`Unversioned shard requests detected: ${unversionedShardRequests.join('\n')}`);
}
const relevantErrors = consoleErrors.filter((message) => !/favicon|WebGL performance caveat/i.test(message));
if (relevantErrors.length) {
  throw new Error(`Browser errors:\n${relevantErrors.join('\n')}`);
}
console.log(JSON.stringify(report, null, 2));
