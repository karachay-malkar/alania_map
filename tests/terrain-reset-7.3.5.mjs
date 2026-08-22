import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const PORT = 4173;
const ROOT_URL = `http://127.0.0.1:${PORT}/`;
const DEM_PATH = 'data/alan-dem-7.3.5.pmtiles';
const ZOOM_SEQUENCE = [7, 8, 8.99, 9.01, 9.99, 10.01, 11, 12, 13, 14, 14.3, 14, 12, 10, 9, 8, 7];
const LOCATIONS = [
  ['Mingi-Tau', 42.4392, 43.3499],
  ['Dombay', 41.6266, 43.2906],
  ['Bezengi', 43.079, 43.053],
  ['Upper Balkaria', 43.45, 43.08],
  ['Arkhyz', 41.278, 43.566],
  ['West', 41.0, 43.45]
];

const server = spawn('python3', ['tools/range_http_server.py', String(PORT), '--bind', '127.0.0.1'], {stdio: 'ignore'});
await new Promise(resolve => setTimeout(resolve, 1200));
let browser;

async function settle(page, timeout = 30000) {
  await page.waitForFunction(() => {
    const map = window.ALAN_MAP_INSTANCE?.map;
    return Boolean(map && map.loaded() && !map.isMoving() && map.getTerrain()?.source === 'terrain-dem');
  }, undefined, {timeout});
  await page.waitForTimeout(120);
}

try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined
  });
  const page = await browser.newPage({viewport: {width: 1280, height: 900}});
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));

  const rangeProbe = await page.request.get(`${ROOT_URL}${DEM_PATH}`, {headers: {Range: 'bytes=0-126'}});
  assert.equal(rangeProbe.status(), 206);
  assert.equal((await rangeProbe.body()).byteLength, 127);
  assert.match(rangeProbe.headers()['content-range'] || '', /^bytes 0-126\//);

  await page.goto(ROOT_URL, {waitUntil: 'domcontentloaded', timeout: 30000});
  await page.waitForFunction(() => Boolean(window.ALAN_MAP_INSTANCE?.map?.getSource?.('terrain-dem')), undefined, {timeout: 60000});
  await page.waitForFunction(() => window.ALAN_MAP_INSTANCE?.map?.getTerrain?.()?.source === 'terrain-dem', undefined, {timeout: 60000});
  await settle(page, 60000);

  const startup = await page.evaluate(() => {
    const map = window.ALAN_MAP_INSTANCE.map;
    const style = map.getStyle();
    const demSources = Object.entries(style.sources || {}).filter(([, source]) => source.type === 'raster-dem');
    const hillshades = (style.layers || []).filter(layer => layer.type === 'hillshade');
    return {
      bootstrap: window.ALAN_MAP_BOOTSTRAP_DIAGNOSTICS?.(),
      reset: window.ALAN_MAP_TERRAIN_RESET_DIAGNOSTICS?.(),
      terrain: map.getTerrain(),
      demSources: demSources.map(([id, source]) => ({id, tileSize: source.tileSize, minzoom: source.minzoom, maxzoom: source.maxzoom})),
      hillshades: hillshades.map(layer => ({id: layer.id, source: layer.source})),
      hasCustomController: Boolean(window.ALAN_MAP_TERRAIN_CONTROLLER),
      transport: window.ALAN_MAP_PMTILES_RANGE_DIAGNOSTICS?.()
    };
  });

  assert.equal(startup.bootstrap.version, '7.3.5');
  assert.equal(startup.bootstrap.terrainRuntime, 'maplibre-native-single-source');
  assert.ok(startup.bootstrap.scripts.includes('terrain-reset-config-7.3.5.js'));
  assert.equal(startup.bootstrap.scripts.some(name => name.startsWith('dem-lod-')), false);
  assert.deepEqual(startup.reset.physicalNativeZooms, [7, 8, 9, 10, 11, 12]);
  assert.equal(startup.reset.archivePath, DEM_PATH);
  assert.equal(startup.reset.tileSize, 256);
  assert.equal(startup.reset.minzoom, 7);
  assert.equal(startup.reset.maxzoom, 12);
  assert.equal(startup.reset.customTerrainController, false);
  assert.equal(startup.hasCustomController, false);
  assert.equal(startup.demSources.length, 1);
  assert.equal(startup.demSources[0].id, 'terrain-dem');
  assert.equal(startup.demSources[0].tileSize, 256);
  assert.equal(startup.demSources[0].minzoom, 7);
  assert.equal(startup.demSources[0].maxzoom, 12);
  assert.equal(startup.terrain.source, 'terrain-dem');
  assert.ok(startup.hillshades.length >= 1);
  assert.ok(startup.hillshades.every(layer => layer.source === 'terrain-dem'));
  assert.ok(startup.transport?.archives?.some(item => item.archivePath === DEM_PATH));
  assert.equal(startup.transport?.archives?.some(item => /alan-dem-7\.3\.[34]\.pmtiles$/.test(item.archivePath)), false);

  await page.evaluate(() => window.ALAN_MAP_INSTANCE.map.jumpTo({center: [42.4392, 43.3499], zoom: 7, pitch: 58, bearing: 0}));
  await settle(page, 60000);

  await page.evaluate(() => {
    window.__ALAN_TERRAIN_GAPS = [];
    const map = window.ALAN_MAP_INSTANCE.map;
    map.on('render', () => {
      if (map.getTerrain()?.source !== 'terrain-dem') {
        window.__ALAN_TERRAIN_GAPS.push({zoom: map.getZoom(), time: performance.now()});
      }
    });
  });

  const sequenceResults = [];
  for (const zoom of ZOOM_SEQUENCE) {
    await page.evaluate(value => window.ALAN_MAP_INSTANCE.map.jumpTo({zoom: value, pitch: 58}), zoom);
    await settle(page, 60000);
    const result = await page.evaluate(() => {
      const map = window.ALAN_MAP_INSTANCE.map;
      return {
        zoom: map.getZoom(),
        terrainSource: map.getTerrain()?.source || null,
        sourcePresent: Boolean(map.getSource('terrain-dem')),
        pitch: map.getPitch(),
        elevation: map.queryTerrainElevation({lng: 42.4392, lat: 43.3499})
      };
    });
    assert.equal(result.terrainSource, 'terrain-dem');
    assert.equal(result.sourcePresent, true);
    assert.ok(result.pitch > 50);
    assert.ok(Number.isFinite(result.elevation));
    assert.ok(result.elevation > 500);
    sequenceResults.push(result);
  }

  const locationResults = [];
  for (const [name, lng, lat] of LOCATIONS) {
    for (const zoom of [7, 8, 9, 10, 12, 14.3]) {
      await page.evaluate(({lng, lat, zoom}) => window.ALAN_MAP_INSTANCE.map.jumpTo({center: [lng, lat], zoom, pitch: 58}), {lng, lat, zoom});
      await settle(page, 60000);
      const result = await page.evaluate(({lng, lat}) => {
        const map = window.ALAN_MAP_INSTANCE.map;
        return {
          terrainSource: map.getTerrain()?.source || null,
          elevation: map.queryTerrainElevation({lng, lat})
        };
      }, {lng, lat});
      assert.equal(result.terrainSource, 'terrain-dem');
      assert.ok(Number.isFinite(result.elevation));
      assert.ok(Math.abs(result.elevation) > 25);
      locationResults.push({name, zoom, elevation: result.elevation});
    }
  }

  const reliefBefore = await page.evaluate(() => window.ALAN_MAP_INSTANCE.map.getTerrain());
  await page.evaluate(() => window.ALAN_MAP_INSTANCE.setRelief(1.25));
  await page.waitForTimeout(200);
  const reliefAfter = await page.evaluate(() => window.ALAN_MAP_INSTANCE.map.getTerrain());
  assert.equal(reliefBefore.source, 'terrain-dem');
  assert.equal(reliefAfter.source, 'terrain-dem');
  assert.equal(Number(reliefAfter.exaggeration), 1.25);

  const gaps = await page.evaluate(() => window.__ALAN_TERRAIN_GAPS || []);
  assert.deepEqual(gaps, []);
  assert.deepEqual(errors, []);

  const report = {
    version: '7.3.5',
    passed: true,
    architecture: startup.reset.architecture,
    dem: startup.reset,
    sourceCount: startup.demSources.length,
    hillshadeCount: startup.hillshades.length,
    zoomSequence: sequenceResults,
    locations: locationResults,
    terrainGapsAfterInitialLoad: gaps.length,
    browserErrors: errors
  };
  await mkdir('build', {recursive: true});
  await writeFile('build/terrain-reset-runtime-7.3.5.json', `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
