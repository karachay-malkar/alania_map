(() => {
  'use strict';

  const VERSION = '7.3.4';
  const SOURCE_ID = 'terrain-dem';
  const HILLSHADE_ID = 'terrain-hillshade';
  const ARCHIVE_PATH = 'data/alan-dem-7.3.4.pmtiles';
  const MIN_NATIVE_ZOOM = 7;
  const MAX_NATIVE_ZOOM = 10;
  const MAX_INITIAL_PREFETCH_TILES = 9;
  const SOURCE_READY_TIMEOUT_MS = 30000;

  const data = window.ALAN_MAP_DATA;
  const alanMap = window.AlanMap;
  if (!data?.regionalDem || !alanMap?.mount) return;

  Object.assign(data.regionalDem, {
    archivePath: ARCHIVE_PATH,
    tileSize: 256,
    minzoom: MIN_NATIVE_ZOOM,
    maxzoom: MAX_NATIVE_ZOOM,
    highestNativeZoom: MAX_NATIVE_ZOOM,
    overzoomFrom: MAX_NATIVE_ZOOM,
    physicalNativeZooms: [7, 8, 9, 10],
    nativeZ8: true,
    runtimeNativeZooms: [7, 8, 9, 10],
    runtimeNetworkLevels: 1,
    runtimeTerrainSources: 1,
    z8RuntimeMode: 'physical-z8-derived-numerically-from-z7',
    z8RequestsEnabled: true,
    transitionMode: 'single-source-enable-once-after-initial-dem-ready'
  });

  const originalMount = alanMap.mount.bind(alanMap);
  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

  function lonToTileX(lon, zoom) {
    const count = 2 ** zoom;
    return clamp(Math.floor((Number(lon) + 180) / 360 * count), 0, count - 1);
  }

  function latToTileY(lat, zoom) {
    const count = 2 ** zoom;
    const clipped = clamp(Number(lat), -85.05112878, 85.05112878);
    const radians = clipped * Math.PI / 180;
    return clamp(Math.floor((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * count), 0, count - 1);
  }

  function nativeZoomForMap(map) {
    return clamp(Math.floor(Number(map.getZoom?.() || MIN_NATIVE_ZOOM)), MIN_NATIVE_ZOOM, MAX_NATIVE_ZOOM);
  }

  function visibleNativeTiles(map, nativeZoom) {
    const bounds = map.getBounds?.();
    const center = map.getCenter?.();
    if (!bounds || !center) return [];
    const minX = lonToTileX(bounds.getWest(), nativeZoom);
    const maxX = lonToTileX(bounds.getEast(), nativeZoom);
    const minY = latToTileY(bounds.getNorth(), nativeZoom);
    const maxY = latToTileY(bounds.getSouth(), nativeZoom);
    const centerX = lonToTileX(center.lng, nativeZoom);
    const centerY = latToTileY(center.lat, nativeZoom);
    const tiles = [];
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        tiles.push({z:nativeZoom,x,y,distance:Math.abs(x-centerX)+Math.abs(y-centerY)});
      }
    }
    if (!tiles.some(tile => tile.x === centerX && tile.y === centerY)) {
      tiles.push({z:nativeZoom,x:centerX,y:centerY,distance:0});
    }
    tiles.sort((a,b) => a.distance-b.distance || a.y-b.y || a.x-b.x);
    return tiles.slice(0,MAX_INITIAL_PREFETCH_TILES).map(({z,x,y}) => ({z,x,y}));
  }

  const nextPaint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  function waitForMovementEnd(map) {
    if (!map.isMoving?.()) return Promise.resolve();
    return new Promise(resolve => map.once('moveend',resolve));
  }

  function waitForSourceReady(map) {
    if (map.isSourceLoaded?.(SOURCE_ID)) return Promise.resolve(true);
    return new Promise(resolve => {
      let finished = false;
      const finish = ready => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        map.off?.('sourcedata',onSourceData);
        map.off?.('error',onError);
        resolve(Boolean(ready));
      };
      const onSourceData = event => {
        if (event?.sourceId === SOURCE_ID && map.isSourceLoaded?.(SOURCE_ID)) finish(true);
      };
      const onError = event => {
        if (event?.sourceId === SOURCE_ID) finish(false);
      };
      const timer = setTimeout(() => finish(map.isSourceLoaded?.(SOURCE_ID)),SOURCE_READY_TIMEOUT_MS);
      map.on?.('sourcedata',onSourceData);
      map.on?.('error',onError);
    });
  }

  async function prefetchInitialTiles(map, diagnostics) {
    const prefetch = window.ALAN_MAP_PREFETCH_PM_TILE;
    if (typeof prefetch !== 'function') return false;
    const nativeZoom = nativeZoomForMap(map);
    const tiles = visibleNativeTiles(map,nativeZoom);
    diagnostics.initialNativeZoom = nativeZoom;
    diagnostics.initialPrefetchTiles = tiles.map(tile => ({...tile}));
    if (!tiles.length) return false;
    diagnostics.prefetchRuns += 1;
    const started = performance.now();
    const results = await Promise.allSettled(tiles.map(({z,x,y}) => prefetch({archivePath:ARCHIVE_PATH,z,x,y,reason:'terrain-initial'})));
    diagnostics.prefetchedTiles += results.filter(result => result.status === 'fulfilled').length;
    diagnostics.prefetchFailures += results.filter(result => result.status === 'rejected').length;
    diagnostics.initialPrefetchMs = performance.now() - started;
    return diagnostics.prefetchedTiles > 0;
  }

  class TerrainController {
    constructor(map, exaggeration) {
      this.map = map;
      this.enabled = false;
      this.enabling = false;
      this.exaggeration = clamp(Number(exaggeration) || 2.55,1,4.2);
      this.initialDemReady = false;
      this._enablePromise = null;
      this._diagnostics = {
        version:VERSION,
        source:SOURCE_ID,
        archivePath:ARCHIVE_PATH,
        enableCalls:0,
        exaggerationUpdates:0,
        sourceChanges:0,
        prefetchRuns:0,
        prefetchedTiles:0,
        prefetchFailures:0,
        initialPrefetchMs:null,
        initialNativeZoom:null,
        initialPrefetchTiles:[],
        sourceReadyBeforeEnable:false,
        delayedForMovement:false,
        enabledAtMs:null,
        lastError:''
      };
    }

    enable() {
      if (this.enabled) return Promise.resolve(true);
      if (this._enablePromise) return this._enablePromise;
      this.enabling = true;
      this._enablePromise = this._enableInternal().finally(() => {
        this.enabling = false;
        this._enablePromise = null;
      });
      return this._enablePromise;
    }

    async _enableInternal() {
      try {
        await nextPaint();
        await prefetchInitialTiles(this.map,this._diagnostics);
        const ready = await waitForSourceReady(this.map);
        this.initialDemReady = ready;
        this._diagnostics.sourceReadyBeforeEnable = ready;
        if (!ready) {
          this._diagnostics.lastError = 'terrain-dem did not become source-loaded before the initial terrain deadline';
          return false;
        }
        if (this.map.isMoving?.()) {
          this._diagnostics.delayedForMovement = true;
          await waitForMovementEnd(this.map);
        }
        if (this.enabled) return true;
        this.map.setTerrain({source:SOURCE_ID,exaggeration:this.exaggeration});
        this.enabled = true;
        this._diagnostics.enableCalls += 1;
        this._diagnostics.enabledAtMs = performance.now();
        document.dispatchEvent(new CustomEvent('alan-map:terrain-ready',{detail:this.diagnostics()}));
        return true;
      } catch (error) {
        this._diagnostics.lastError = String(error?.message || error || 'Terrain initialization failed');
        console.error('Alan Map terrain initialization failed.',error);
        return false;
      }
    }

    setExaggeration(value) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return this.exaggeration;
      this.exaggeration = clamp(numeric,1,4.2);
      if (this.enabled) {
        const terrain = this.map.getTerrain?.();
        if (terrain?.source && terrain.source !== SOURCE_ID) this._diagnostics.sourceChanges += 1;
        this.map.setTerrain({source:SOURCE_ID,exaggeration:this.exaggeration});
        this._diagnostics.exaggerationUpdates += 1;
      }
      return this.exaggeration;
    }

    diagnostics() {
      return {
        ...this._diagnostics,
        enabled:this.enabled,
        enabling:this.enabling,
        exaggeration:this.exaggeration,
        initialDemReady:this.initialDemReady,
        mapTerrain:this.map.getTerrain?.() || null,
        hillshadePresent:Boolean(this.map.getLayer?.(HILLSHADE_ID))
      };
    }
  }

  alanMap.mount = function mountWithTerrainController(target,options={}) {
    const api = originalMount(target,options);
    const map = api?.map;
    if (!map) return api;
    const controller = new TerrainController(map,api.getState?.().relief);
    api.terrainController = controller;
    api.getTerrainDiagnostics = () => controller.diagnostics();
    window.ALAN_MAP_TERRAIN_CONTROLLER = controller;
    window.ALAN_MAP_DEM_LOD_DIAGNOSTICS = api.getTerrainDiagnostics;
    const start = () => { void controller.enable(); };
    if (map.loaded?.()) requestAnimationFrame(start);
    else map.once('load',() => requestAnimationFrame(start));
    return api;
  };

  window.ALAN_MAP_DEM_LOD_CONTRACT = Object.freeze({
    version:VERSION,
    archivePath:ARCHIVE_PATH,
    source:SOURCE_ID,
    hillshade:HILLSHADE_ID,
    tileSize:256,
    minzoom:MIN_NATIVE_ZOOM,
    maxzoom:MAX_NATIVE_ZOOM,
    highestNativeZoom:MAX_NATIVE_ZOOM,
    overzoomFrom:MAX_NATIVE_ZOOM,
    physicalNativeZooms:Object.freeze([7,8,9,10]),
    nativeZ8:true,
    runtimeTerrainSources:1,
    sourceSwitching:false,
    initialTerrainInStyle:false,
    z8RuntimeMode:'physical-z8-derived-numerically-from-z7',
    transitionMode:'single-source-enable-once-after-initial-dem-ready',
    maxInitialPrefetchTiles:MAX_INITIAL_PREFETCH_TILES,
    effectiveGroundMPerInformationPixelAtCenter:Object.freeze({'7':885.148,'8':885.148,'9':221.287,'10':110.644})
  });
})();
