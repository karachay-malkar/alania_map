// QA-only: probes live terrain continuity across zoom boundaries.
import { chromium } from 'playwright';

const URL = process.env.LIVE_URL || 'https://karachay-malkar.github.io/alania_map/';
const zoomsUp = [7,7.5,8,8.5,8.84,8.86,8.99,9,9.2,9.84,9.86,9.99,10,10.2,11,12,13,14,14.3];
const zoomsDown = [...zoomsUp].reverse();

const browser = await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const context = await browser.newContext({viewport:{width:1440,height:900}});
const page = await context.newPage();
await page.goto(URL,{waitUntil:'domcontentloaded',timeout:30000});
await page.waitForFunction(() => window.ALAN_MAP_INSTANCE?.map && typeof window.ALAN_MAP_DEM_LOD_DIAGNOSTICS === 'function',{timeout:30000});
await page.waitForTimeout(18000);

async function probe(zoom,direction) {
  await page.evaluate(({zoom}) => {
    const map = window.ALAN_MAP_INSTANCE.map;
    map.jumpTo({zoom,pitch:58,bearing:180});
  },{zoom});
  await page.waitForTimeout(1400);
  return page.evaluate(({zoom,direction}) => {
    const map = window.ALAN_MAP_INSTANCE.map;
    const center = map.getCenter();
    const diag = window.ALAN_MAP_DEM_LOD_DIAGNOSTICS?.() || null;
    const terrain = typeof map.getTerrain === 'function' ? map.getTerrain() : null;
    const sourceIds = ['terrain-dem','terrain-dem-medium','terrain-dem-high'];
    const sourceLoaded = Object.fromEntries(sourceIds.map((id) => {
      let loaded = null;
      try { loaded = Boolean(map.getSource(id)) && map.isSourceLoaded(id); } catch (_) {}
      return [id,loaded];
    }));
    let centerElevation = null;
    let sampleElevations = [];
    if (typeof map.queryTerrainElevation === 'function') {
      try { centerElevation = map.queryTerrainElevation(center,{exaggerated:false}); } catch (_) {}
      const offsets = [[0,0],[0.04,0],[0,0.04],[-0.04,0],[0,-0.04]];
      sampleElevations = offsets.map(([dx,dy]) => {
        try { return map.queryTerrainElevation({lng:center.lng+dx,lat:center.lat+dy},{exaggerated:false}); } catch (_) { return null; }
      });
    }
    const finiteElevationCount = sampleElevations.filter(Number.isFinite).length;
    const elevationSpread = finiteElevationCount >= 2 ? Math.max(...sampleElevations.filter(Number.isFinite)) - Math.min(...sampleElevations.filter(Number.isFinite)) : null;
    return {
      direction,
      requestedZoom:zoom,
      actualZoom:map.getZoom(),
      pitch:map.getPitch(),
      terrain,
      diag,
      sourceLoaded,
      mapLoaded:map.loaded(),
      tilesLoaded:typeof map.areTilesLoaded === 'function' ? map.areTilesLoaded() : null,
      centerElevation,
      sampleElevations,
      finiteElevationCount,
      elevationSpread
    };
  },{zoom,direction});
}

const results = [];
for (const zoom of zoomsUp) results.push(await probe(zoom,'up'));
for (const zoom of zoomsDown) results.push(await probe(zoom,'down'));

console.log('QA_TERRAIN_ZOOM_JSON_START');
console.log(JSON.stringify(results,null,2));
console.log('QA_TERRAIN_ZOOM_JSON_END');

await browser.close();
