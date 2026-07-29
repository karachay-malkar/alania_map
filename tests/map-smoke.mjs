import {chromium} from 'playwright';
import fs from 'node:fs';

const browser = await chromium.launch({
  headless:true,
  args:['--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']
});
const page = await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
page.setDefaultTimeout(120000);
page.setDefaultNavigationTimeout(120000);

const consoleErrors = [];
const requests = [];
page.on('console',(message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
page.on('pageerror',(error) => consoleErrors.push(String(error)));
page.on('request',(request) => requests.push(request.url()));

async function saveViewportScreenshot(path) {
  await page.screenshot({path,fullPage:false,animations:'disabled',timeout:120000});
}

const startedAt = Date.now();
await page.goto('http://127.0.0.1:8000/index.html',{waitUntil:'domcontentloaded',timeout:120000});
try {
  await page.waitForFunction(() => window.ALAN_MAP_INSTANCE?.map?.isStyleLoaded?.(),null,{timeout:120000});
} catch (error) {
  const startupDiagnostics = await page.evaluate(() => ({
    fatalError:document.querySelector('.alan-map-fatal-error')?.textContent || '',
    rootText:document.getElementById('alan-map-root')?.textContent?.slice(0,1000) || '',
    hasInstance:Boolean(window.ALAN_MAP_INSTANCE),
    hasManifestDiagnostics:Boolean(window.ALAN_MAP_PMTILES_SHARD_DIAGNOSTICS),
    shard:window.ALAN_MAP_PMTILES_SHARD_DIAGNOSTICS?.() || null,
    readyState:document.readyState
  }));
  fs.mkdirSync('build',{recursive:true});
  fs.writeFileSync('build/browser-diagnostics.json',JSON.stringify({startupDiagnostics,consoleErrors,requests},null,2));
  await saveViewportScreenshot('build/map-smoke.png');
  throw error;
}

await page.waitForFunction(() => document.querySelector('.alan-map-loading')?.classList.contains('hidden'),null,{timeout:120000});
await page.waitForFunction(() => window.ALAN_MAP_INSTANCE?.getFantasyDiagnostics?.().installed === true,null,{timeout:120000});
const firstUsefulFrameMs = Date.now() - startedAt;

const checkpoints = [
  {id:'babugent',center:[43.55,43.28],zoom:10.8,layer:'waterway',property:'system_id',expected:'cherek-balkarsky'},
  {id:'nalchik',center:[43.62,43.48],zoom:10.8,layer:'waterway',property:'system_id',expected:'nalchik'},
  {id:'baksan',center:[43.54,43.69],zoom:10.5,layer:'waterway',property:'system_id',expected:'baksan'},
  {id:'teberda',center:[41.74,43.44],zoom:10.5,layer:'waterway',property:'system_id',expected:'teberda'},
  {id:'kuban',center:[41.91,43.77],zoom:10.2,layer:'waterway',property:'system_id',expected:'kuban'},
  {id:'blue-lakes',center:[43.538,43.234],zoom:12,layer:'water',property:'class',expected:'lake'}
];

const checkpointResults = {};
for (const checkpoint of checkpoints) {
  checkpointResults[checkpoint.id] = await page.evaluate(async (current) => {
    const map = window.ALAN_MAP_INSTANCE.map;
    map.stop();
    map.jumpTo({center:current.center,zoom:current.zoom,pitch:0,bearing:180});
    const deadline = performance.now() + 30000;
    let sourceFeatures = [];
    let values = [];
    do {
      await new Promise((resolve) => setTimeout(resolve,250));
      sourceFeatures = map.querySourceFeatures('openmaptiles',{sourceLayer:current.layer});
      values = [...new Set(sourceFeatures.map((feature) => feature.properties?.[current.property]).filter(Boolean))];
      if (values.includes(current.expected)) break;
    } while (performance.now() < deadline);
    return {featureCount:sourceFeatures.length,values,matched:values.includes(current.expected)};
  },checkpoint);
}

const performanceSample = await page.evaluate(async () => {
  const map = window.ALAN_MAP_INSTANCE.map;
  let frameCount = 0;
  const start = performance.now();
  const sample = () => { frameCount += 1; };
  map.on('render',sample);
  map.easeTo({center:[42.35,43.55],zoom:8.5,bearing:90,pitch:0,duration:1200});
  await new Promise((resolve) => setTimeout(resolve,1400));
  map.stop();
  map.off('render',sample);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const elapsed = performance.now() - start;
  return {
    elapsedMs:Math.round(elapsed),
    frameCount,
    approximateFps:Number((frameCount / (elapsed / 1000)).toFixed(1)),
    visibilityState:document.visibilityState
  };
});

const diagnostics = await page.evaluate(() => {
  const instance = window.ALAN_MAP_INSTANCE;
  const map = instance.map;
  const fantasy = instance.getFantasyDiagnostics?.() || null;
  const requiredLayers = [
    'osm-glacier-fill','osm-snow-fill','osm-water-fill','osm-river-water-fill',
    'osm-river-halo','osm-river-line','osm-peak-labels'
  ];
  const requiredFantasyLayers = [
    'fantasy-paper-grain','fantasy-mountains-primary','fantasy-mountains-secondary',
    'fantasy-mountains-spur','fantasy-elbrus-massif'
  ];
  const imageIds = [...Array.from({length:30},(_,index) => `mount-${index + 1}`),'fantasy-elbrus'];
  return {
    version:instance.version,
    requiredLayers:Object.fromEntries(requiredLayers.map((id) => [id,Boolean(map.getLayer(id))])),
    requiredFantasyLayers:Object.fromEntries(requiredFantasyLayers.map((id) => [id,Boolean(map.getLayer(id))])),
    mountainImages:Object.fromEntries(imageIds.map((id) => [id,map.hasImage(id)])),
    fantasy,
    fantasyButton:{
      present:Boolean(document.querySelector('[data-fantasy-toggle]')),
      active:document.querySelector('[data-fantasy-toggle]')?.classList.contains('active') || false,
      pressed:document.querySelector('[data-fantasy-toggle]')?.getAttribute('aria-pressed') || null
    },
    mountainLayouts:Object.fromEntries(['fantasy-mountains-primary','fantasy-mountains-secondary','fantasy-mountains-spur','fantasy-elbrus-massif'].map((id) => [id,{
      rotation:map.getLayoutProperty(id,'icon-rotation-alignment'),
      pitch:map.getLayoutProperty(id,'icon-pitch-alignment'),
      anchor:map.getLayoutProperty(id,'icon-anchor'),
      size:map.getLayoutProperty(id,'icon-size')
    }])),
    hiddenRelief:{
      hillshade:map.getLayoutProperty('terrain-hillshade','visibility'),
      ridgeLines:map.getLayoutProperty('ridge-lines','visibility'),
      terrain:map.getTerrain?.() || null,
      pitch:map.getPitch(),
      maxPitch:map.getMaxPitch?.()
    },
    style:instance.getStyleDiagnostics(),
    frame:instance.getFrameClipDiagnostics(),
    network:instance.getNetworkDiagnostics(),
    shard:window.ALAN_MAP_PMTILES_SHARD_DIAGNOSTICS?.() || null,
    quality:instance.getQualityProfile(),
    title:document.title,
    status:document.querySelector('[data-role="status"]')?.textContent || ''
  };
});

await page.evaluate(async () => {
  const map = window.ALAN_MAP_INSTANCE.map;
  map.stop();
  map.jumpTo({center:[42.45,43.50],zoom:8.25,bearing:180,pitch:0});
  await new Promise((resolve) => setTimeout(resolve,1200));
});

const localOrigin = 'http://127.0.0.1:8000/';
const localBlobOrigin = `blob:${localOrigin}`;
const externalRequests = requests.filter((url) => !url.startsWith(localOrigin) && !url.startsWith(localBlobOrigin));
const unversionedShardRequests = requests.filter((url) => /\/data\/shards\/(?:vector|dem)\/part-\d+\.bin(?:\?|$)/.test(url));
const mountainAssetRequests = [...new Set(requests.filter((url) => /\/assets\/mountains\/(?:mount-\d+|elbrus)\.png(?:\?|$)/.test(url)))];

const report = {
  ...diagnostics,
  firstUsefulFrameMs,
  performanceSample,
  checkpoints:checkpointResults,
  requestCount:requests.length,
  mountainAssetRequestCount:mountainAssetRequests.length,
  externalRequests,
  unversionedShardRequests,
  consoleErrors
};

fs.mkdirSync('build',{recursive:true});
fs.writeFileSync('build/browser-diagnostics.json',JSON.stringify(report,null,2));
await saveViewportScreenshot('build/map-smoke.png');
await browser.close();

if (diagnostics.version !== '8.0') throw new Error(`Unexpected runtime version: ${diagnostics.version}`);
for (const [layer,present] of Object.entries(diagnostics.requiredLayers)) if (!present) throw new Error(`Required layer is missing: ${layer}`);
for (const [layer,present] of Object.entries(diagnostics.requiredFantasyLayers)) if (!present) throw new Error(`Required fantasy layer is missing: ${layer}`);
for (const [image,present] of Object.entries(diagnostics.mountainImages)) if (!present) throw new Error(`Mountain image is missing: ${image}`);
if (!diagnostics.fantasy?.installed || !diagnostics.fantasy?.enabled || !diagnostics.fantasy?.sourcePresent || !diagnostics.fantasy?.landmarkSourcePresent) {
  throw new Error(`Fantasy controller regression: ${JSON.stringify(diagnostics.fantasy)}`);
}
if (diagnostics.fantasy?.installationError || diagnostics.fantasy?.wrapperError) throw new Error(`Fantasy installation error: ${JSON.stringify(diagnostics.fantasy)}`);
if (diagnostics.fantasy.loadedImageCount !== 31) throw new Error(`Unexpected mountain image count: ${diagnostics.fantasy.loadedImageCount}`);
if (!diagnostics.fantasy.mountain || diagnostics.fantasy.mountain.mountainPointCount < 100) throw new Error(`Mountain point source is too small: ${JSON.stringify(diagnostics.fantasy.mountain)}`);
if (diagnostics.fantasy.mountain.maximumGapRatio > 0.7) throw new Error(`Mountain chain gap regression: ${JSON.stringify(diagnostics.fantasy.mountain)}`);
if (!diagnostics.fantasyButton.present || !diagnostics.fantasyButton.active || diagnostics.fantasyButton.pressed !== 'true') throw new Error(`Fantasy toggle regression: ${JSON.stringify(diagnostics.fantasyButton)}`);
for (const [layer,layout] of Object.entries(diagnostics.mountainLayouts)) {
  if (layout.rotation !== 'viewport' || layout.pitch !== 'viewport' || layout.anchor !== 'bottom') throw new Error(`Static mountain alignment regression in ${layer}: ${JSON.stringify(layout)}`);
}
if (diagnostics.hiddenRelief.hillshade !== 'none' || diagnostics.hiddenRelief.ridgeLines !== 'none' || diagnostics.hiddenRelief.terrain) throw new Error(`Relief is still active: ${JSON.stringify(diagnostics.hiddenRelief)}`);
if (Math.abs(Number(diagnostics.hiddenRelief.pitch)) > 0.01 || Number(diagnostics.hiddenRelief.maxPitch) !== 0) throw new Error(`Fantasy camera is not flat: ${JSON.stringify(diagnostics.hiddenRelief)}`);
for (const [checkpoint,result] of Object.entries(checkpointResults)) if (!result.matched) throw new Error(`Real feature missing at ${checkpoint}: ${JSON.stringify(result)}`);
if (!diagnostics.frame.strictDataClip || diagnostics.frame.cssClipPath || diagnostics.frame.runtimeMask) throw new Error(`Frame clipping regression: ${JSON.stringify(diagnostics.frame)}`);
if (diagnostics.network.errors && Object.keys(diagnostics.network.errors).length) throw new Error(`Source errors remain: ${JSON.stringify(diagnostics.network.errors)}`);
if (!diagnostics.shard || diagnostics.shard.cache.entries > 16) throw new Error(`Shard LRU regression: ${JSON.stringify(diagnostics.shard)}`);
if (mountainAssetRequests.length !== 31) throw new Error(`Not all local mountain PNGs were requested: ${mountainAssetRequests.length}`);
if (externalRequests.length) throw new Error(`External cartographic requests detected: ${externalRequests.join('\n')}`);
if (unversionedShardRequests.length) throw new Error(`Unversioned shard requests detected: ${unversionedShardRequests.join('\n')}`);
const relevantErrors = consoleErrors.filter((message) => !/favicon|WebGL performance caveat/i.test(message));
if (relevantErrors.length) throw new Error(`Browser errors:\n${relevantErrors.join('\n')}`);
console.log(JSON.stringify(report,null,2));
