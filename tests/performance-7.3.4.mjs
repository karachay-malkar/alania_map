import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const BASELINE_ROOT = path.resolve(process.env.ALAN_MAP_BASELINE_ROOT || 'baseline-7.3.3');
const CURRENT_ROOT = path.resolve(process.env.ALAN_MAP_CURRENT_ROOT || '.');
const OUTPUT = path.resolve(process.env.ALAN_MAP_BENCHMARK_OUTPUT || 'data/performance-benchmark-7.3.4.json');
const VIEWPORT = {width:1280,height:900};
const BASELINE_PORT = 4180;
const CURRENT_PORT = 4181;

if (!fs.existsSync(path.join(BASELINE_ROOT,'index.html'))) throw new Error(`7.3.3 baseline checkout missing: ${BASELINE_ROOT}`);
if (!fs.existsSync(path.join(CURRENT_ROOT,'index.html'))) throw new Error(`7.3.4 current checkout missing: ${CURRENT_ROOT}`);

const servers = [
  spawn('python3',['tools/range_http_server.py',String(BASELINE_PORT),'--bind','127.0.0.1'],{cwd:BASELINE_ROOT,stdio:'ignore'}),
  spawn('python3',['tools/range_http_server.py',String(CURRENT_PORT),'--bind','127.0.0.1'],{cwd:CURRENT_ROOT,stdio:'ignore'})
];
await new Promise(resolve => setTimeout(resolve,1400));

const observerInit = () => {
  window.__ALAN_BENCH = {
    navigationStart:performance.now(),
    canvasMs:null,
    usableMs:null,
    terrainMs:null,
    fcpMs:null,
    lcpMs:null,
    longTasks:[],
    observerErrors:[]
  };

  const safeObserve = (type, callback) => {
    try {
      const observer = new PerformanceObserver(list => callback(list.getEntries()));
      observer.observe({type,buffered:true});
    } catch (error) {
      window.__ALAN_BENCH.observerErrors.push(`${type}:${String(error)}`);
    }
  };

  safeObserve('longtask', entries => {
    for (const entry of entries) window.__ALAN_BENCH.longTasks.push({startTime:entry.startTime,duration:entry.duration});
  });
  safeObserve('paint', entries => {
    for (const entry of entries) {
      if (entry.name === 'first-contentful-paint') window.__ALAN_BENCH.fcpMs = entry.startTime;
    }
  });
  safeObserve('largest-contentful-paint', entries => {
    const last = entries.at(-1);
    if (last) window.__ALAN_BENCH.lcpMs = last.startTime;
  });

  const probe = () => {
    const state = window.__ALAN_BENCH;
    if (!state) return;
    if (state.canvasMs === null && document.querySelector('canvas')) state.canvasMs = performance.now();
    const map = window.ALAN_MAP_INSTANCE?.map;
    if (state.usableMs === null && map && document.querySelector('canvas')) state.usableMs = performance.now();
    if (state.terrainMs === null && map?.getTerrain?.()) {
      try {
        const center = map.getCenter?.();
        const elevation = center ? map.queryTerrainElevation?.(center,{exaggerated:false}) : null;
        if (Number.isFinite(elevation) && Math.abs(elevation) > 1) state.terrainMs = performance.now();
      } catch (_) {}
    }
    requestAnimationFrame(probe);
  };
  requestAnimationFrame(probe);
};

async function benchmark(browser, {label,version,port,demPath}) {
  const context = await browser.newContext({viewport:VIEWPORT,deviceScaleFactor:1});
  await context.addInitScript(observerInit);
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror',error => pageErrors.push(String(error)));

  await page.goto(`http://127.0.0.1:${port}/`,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(() => Boolean(window.ALAN_MAP_INSTANCE?.map),undefined,{timeout:60000});
  await page.waitForFunction(() => window.__ALAN_BENCH?.terrainMs !== null,undefined,{timeout:90000});
  await page.waitForTimeout(1800);

  const result = await page.evaluate(({label,version,demPath}) => {
    const bench = window.__ALAN_BENCH || {};
    const app = window.ALAN_MAP_PERFORMANCE_DIAGNOSTICS?.() || {};
    const transport = window.ALAN_MAP_PMTILES_RANGE_DIAGNOSTICS?.() || app.transport || {};
    const dem = (transport.archives || []).find(item => item.archivePath === demPath) || null;
    const longTasks = Array.isArray(bench.longTasks) ? bench.longTasks : [];
    const durations = longTasks.map(item => Number(item.duration || 0));
    const fcpEntry = performance.getEntriesByName('first-contentful-paint')[0];
    const memory = performance.memory ? {
      usedJSHeapSize:performance.memory.usedJSHeapSize,
      totalJSHeapSize:performance.memory.totalJSHeapSize,
      jsHeapSizeLimit:performance.memory.jsHeapSizeLimit
    } : null;
    return {
      label,
      version,
      domElements:document.getElementsByTagName('*').length,
      fcpMs:Number(bench.fcpMs ?? fcpEntry?.startTime ?? 0) || null,
      lcpMs:Number(bench.lcpMs ?? 0) || null,
      canvasMs:Number(bench.canvasMs ?? 0) || null,
      firstUsableFrameMs:Number(bench.usableMs ?? 0) || null,
      readyMs:Number(app.readyMs ?? 0) || null,
      firstIdleMs:Number(app.firstIdleMs ?? 0) || null,
      firstTerrainFrameMs:Number(bench.terrainMs ?? 0) || null,
      maxLongTaskMs:durations.length ? Math.max(...durations) : 0,
      totalLongTaskMs:durations.reduce((sum,value) => sum + value,0),
      longTaskCount:durations.length,
      demNetworkBytes:Number(dem?.networkBytes || 0),
      demRangeRequests:Number(dem?.requests || 0),
      rangeCacheHits:Number(transport.cache?.hits || 0),
      rangeCacheMisses:Number(transport.cache?.misses || 0),
      memory,
      renderFrames:Number(app.renderFrames || 0),
      stabilizedFps:Number(app.renderFps || 0) || null,
      totalNetworkBytes:Number(app.totalNetworkBytes || 0),
      totalNetworkRequests:Number(app.totalNetworkRequests || 0),
      terrain:window.ALAN_MAP_INSTANCE?.map?.getTerrain?.() || null,
      terrainDiagnostics:window.ALAN_MAP_TERRAIN_CONTROLLER?.diagnostics?.() || null,
      observerErrors:bench.observerErrors || []
    };
  },{label,version,demPath});

  result.pageErrors = pageErrors;
  await context.close();
  return result;
}

let browser = null;
try {
  browser = await chromium.launch({headless:true});
  const baseline = await benchmark(browser,{
    label:'7.3.3',
    version:'7.3.3',
    port:BASELINE_PORT,
    demPath:'data/alan-dem-7.3.3.pmtiles'
  });
  const current = await benchmark(browser,{
    label:'7.3.4',
    version:'7.3.4',
    port:CURRENT_PORT,
    demPath:'data/alan-dem-7.3.4.pmtiles'
  });

  const delta = {
    canvasMs:(current.canvasMs ?? 0) - (baseline.canvasMs ?? 0),
    firstUsableFrameMs:(current.firstUsableFrameMs ?? 0) - (baseline.firstUsableFrameMs ?? 0),
    firstTerrainFrameMs:(current.firstTerrainFrameMs ?? 0) - (baseline.firstTerrainFrameMs ?? 0),
    maxLongTaskMs:current.maxLongTaskMs - baseline.maxLongTaskMs,
    totalLongTaskMs:current.totalLongTaskMs - baseline.totalLongTaskMs,
    demNetworkBytes:current.demNetworkBytes - baseline.demNetworkBytes,
    demRangeRequests:current.demRangeRequests - baseline.demRangeRequests
  };

  const report = {
    benchmark:'Alan Map 7.3.3 vs 7.3.4',
    chromiumProfile:{viewport:VIEWPORT,deviceScaleFactor:1,headless:true,sameBrowserProcess:true},
    baseline,
    current,
    delta,
    acceptance:{
      firstScreenTargetMs:1500,
      maxSingleLongTaskTargetMs:500,
      firstScreenPass:Number(current.canvasMs || Infinity) <= 1500,
      firstUsablePass:Number(current.firstUsableFrameMs || Infinity) <= 1500,
      maxLongTaskPass:current.maxLongTaskMs < 500
    }
  };

  fs.mkdirSync(path.dirname(OUTPUT),{recursive:true});
  fs.writeFileSync(OUTPUT,JSON.stringify(report,null,2)+'\n');

  assert.deepEqual(current.pageErrors,[]);
  assert.ok(Number(current.canvasMs) <= 1500,`7.3.4 canvas ${current.canvasMs}ms exceeds 1500ms target`);
  assert.ok(Number(current.firstUsableFrameMs) <= 1500,`7.3.4 usable frame ${current.firstUsableFrameMs}ms exceeds 1500ms target`);
  assert.ok(current.maxLongTaskMs < 500,`7.3.4 max Long Task ${current.maxLongTaskMs}ms exceeds 500ms target`);
  assert.equal(current.terrain?.source,'terrain-dem');
  assert.equal(current.terrainDiagnostics?.enableCalls,1);
  assert.equal(current.terrainDiagnostics?.sourceChanges,0);

  console.log(JSON.stringify(report,null,2));
} finally {
  if (browser) await browser.close();
  for (const server of servers) server.kill('SIGTERM');
}
