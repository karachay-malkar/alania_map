(() => {
  'use strict';

  const VERSION = '7.3.3';
  const SOURCE_LOW = 'terrain-dem';
  const SOURCE_MEDIUM = 'terrain-dem-medium';
  const SOURCE_HIGH = 'terrain-dem-high';
  const HILLSHADE_LOW = 'terrain-hillshade';
  const HILLSHADE_MEDIUM = 'terrain-hillshade-medium';
  const HILLSHADE_HIGH = 'terrain-hillshade-high';
  const ARCHIVE_PATH = 'data/alan-dem-7.3.3.pmtiles';
  const PREFETCH_MARGIN_TILES = 1;
  const MAX_PREFETCH_TILES = 25;
  const SWITCH_HYSTERESIS = Object.freeze({lowToMedium:9.0,mediumToLow:8.85,mediumToHigh:10.0,highToMedium:9.85});
  const LODS = Object.freeze([
    Object.freeze({id:'low',source:SOURCE_LOW,nativeZoom:7,minMapZoom:7,maxMapZoom:9}),
    Object.freeze({id:'medium',source:SOURCE_MEDIUM,nativeZoom:9,minMapZoom:9,maxMapZoom:10}),
    Object.freeze({id:'high',source:SOURCE_HIGH,nativeZoom:10,minMapZoom:10,maxMapZoom:14.3})
  ]);

  const data = window.ALAN_MAP_DATA;
  const alanMap = window.AlanMap;
  const maplibregl = window.maplibregl;
  if (!data?.regionalDem || !alanMap?.mount || !maplibregl?.Map) return;

  const originalDem = {...data.regionalDem};
  const originalMount = alanMap.mount.bind(alanMap);

  const expandedBounds = (bounds, collarM = 4500) => {
    const west = Number(bounds?.[0]);
    const south = Number(bounds?.[1]);
    const east = Number(bounds?.[2]);
    const north = Number(bounds?.[3]);
    if (![west,south,east,north].every(Number.isFinite)) return bounds;
    const centerLat = (south + north) / 2;
    const dLat = collarM / 110574;
    const dLon = collarM / Math.max(1,111320 * Math.cos(centerLat * Math.PI / 180));
    return [west - dLon,south - dLat,east + dLon,north + dLat];
  };

  data.regionalDem.archivePath = ARCHIVE_PATH;
  data.regionalDem.minzoom = 7;
  data.regionalDem.maxzoom = 10;
  data.regionalDem.highestNativeZoom = 10;
  data.regionalDem.overzoomFrom = 10;
  data.regionalDem.physicalNativeZooms = [7,9,10];
  data.regionalDem.nativeZ8 = false;
  data.regionalDem.runtimeNativeZooms = [7,9,10];
  data.regionalDem.runtimeNetworkLevels = 3;
  data.regionalDem.runtimeLods = LODS.map((lod) => ({...lod}));
  data.regionalDem.z8RuntimeMode = 'overzoom-z7-native-z8-absent';
  data.regionalDem.z8RequestsEnabled = false;
  data.regionalDem.transitionMode = 'prefetch-visible-tiles-then-switch-on-zoomend';

  const sourceForExactZoom = (zoom) => Number(zoom) >= 10 ? SOURCE_HIGH : Number(zoom) >= 9 ? SOURCE_MEDIUM : SOURCE_LOW;
  const nativeZoomForSource = (sourceId) => sourceId === SOURCE_HIGH ? 10 : sourceId === SOURCE_MEDIUM ? 9 : 7;
  const lodForSource = (sourceId) => LODS.find((lod) => lod.source === sourceId) || LODS[0];

  function desiredWithHysteresis(zoom, activeSource) {
    const numeric = Number(zoom);
    if (activeSource === SOURCE_HIGH) {
      if (numeric >= SWITCH_HYSTERESIS.highToMedium) return SOURCE_HIGH;
      return numeric >= SWITCH_HYSTERESIS.mediumToLow ? SOURCE_MEDIUM : SOURCE_LOW;
    }
    if (activeSource === SOURCE_MEDIUM) {
      if (numeric >= SWITCH_HYSTERESIS.mediumToHigh) return SOURCE_HIGH;
      if (numeric >= SWITCH_HYSTERESIS.mediumToLow) return SOURCE_MEDIUM;
      return SOURCE_LOW;
    }
    if (numeric >= SWITCH_HYSTERESIS.mediumToHigh) return SOURCE_HIGH;
    if (numeric >= SWITCH_HYSTERESIS.lowToMedium) return SOURCE_MEDIUM;
    return SOURCE_LOW;
  }

  function makeSource(base, nativeZoom) {
    return {
      ...base,
      url:`pmtiles://${new URL(ARCHIVE_PATH,document.baseURI).href}`,
      tileSize:Number(originalDem.tileSize || base.tileSize || 512),
      minzoom:nativeZoom,
      maxzoom:nativeZoom,
      encoding:String(originalDem.encoding || base.encoding || 'mapbox'),
      bounds:expandedBounds(originalDem.bounds || base.bounds),
      attribution:originalDem.attribution || base.attribution
    };
  }

  function patchStyle(style) {
    if (!style || typeof style !== 'object' || !style.sources?.[SOURCE_LOW]) return style;
    const next = {...style,sources:{...style.sources},layers:Array.isArray(style.layers)?style.layers.map((layer)=>({...layer})):[]};
    const baseSource = {...next.sources[SOURCE_LOW]};
    next.sources[SOURCE_LOW] = makeSource(baseSource,7);
    next.sources[SOURCE_MEDIUM] = makeSource(baseSource,9);
    next.sources[SOURCE_HIGH] = makeSource(baseSource,10);

    const index = next.layers.findIndex((layer) => layer.id === HILLSHADE_LOW);
    if (index >= 0) {
      const baseLayer = next.layers[index];
      const low = {...baseLayer,source:SOURCE_LOW,minzoom:7,maxzoom:9};
      const medium = {...baseLayer,id:HILLSHADE_MEDIUM,source:SOURCE_MEDIUM,minzoom:9,maxzoom:10};
      const high = {...baseLayer,id:HILLSHADE_HIGH,source:SOURCE_HIGH,minzoom:10};
      next.layers.splice(index,1,low,medium,high);
    }
    if (next.terrain?.source === SOURCE_LOW) next.terrain = {...next.terrain,source:SOURCE_LOW};
    return next;
  }

  class LodAwareMap extends maplibregl.Map {
    constructor(options = {}) {
      super({...options,style:patchStyle(options.style)});
    }
  }

  const maplibreProxy = Object.create(maplibregl);
  Object.defineProperty(maplibreProxy,'Map',{value:LodAwareMap,enumerable:true,configurable:false,writable:false});

  function lonToTileX(lon, zoom) {
    const count = 2 ** zoom;
    return Math.max(0,Math.min(count - 1,Math.floor((Number(lon) + 180) / 360 * count)));
  }

  function latToTileY(lat, zoom) {
    const count = 2 ** zoom;
    const clipped = Math.max(-85.05112878,Math.min(85.05112878,Number(lat)));
    const radians = clipped * Math.PI / 180;
    const value = (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * count;
    return Math.max(0,Math.min(count - 1,Math.floor(value)));
  }

  function visibleTileCoordinates(map, nativeZoom) {
    const bounds = map.getBounds?.();
    if (!bounds) return [];
    const count = 2 ** nativeZoom;
    const west = bounds.getWest();
    const east = bounds.getEast();
    const north = bounds.getNorth();
    const south = bounds.getSouth();
    let minX = lonToTileX(west,nativeZoom);
    let maxX = lonToTileX(east,nativeZoom);
    let minY = latToTileY(north,nativeZoom);
    let maxY = latToTileY(south,nativeZoom);
    minX = Math.max(0,minX - PREFETCH_MARGIN_TILES);
    maxX = Math.min(count - 1,maxX + PREFETCH_MARGIN_TILES);
    minY = Math.max(0,minY - PREFETCH_MARGIN_TILES);
    maxY = Math.min(count - 1,maxY + PREFETCH_MARGIN_TILES);
    const result = [];
    for (let y=minY; y<=maxY; y+=1) {
      for (let x=minX; x<=maxX; x+=1) {
        result.push({z:nativeZoom,x,y});
        if (result.length >= MAX_PREFETCH_TILES) return result;
      }
    }
    return result;
  }

  alanMap.mount = function mountWithDemLods(target, options = {}) {
    const api = originalMount(target,{...options,maplibregl:maplibreProxy});
    const map = api?.map;
    if (!map) return api;

    const nativeSetTerrain = map.setTerrain.bind(map);
    const nativeSetPaintProperty = map.setPaintProperty.bind(map);
    let activeSource = SOURCE_LOW;
    let pendingSource = null;
    let transitionToken = 0;
    let switches = 0;
    let prefetchRuns = 0;
    let prefetchedTiles = 0;
    let prefetchFailures = 0;
    let cancelledTransitions = 0;
    let lastTransitionMs = null;
    let lastTransitionReason = 'initial';
    let lastRelief = Number(api.getState?.().relief || 2.55);
    const warmed = new Set();

    map.setTerrain = (terrain, optionsArg) => {
      if (terrain?.exaggeration !== undefined) lastRelief = Number(terrain.exaggeration);
      if (terrain?.source === SOURCE_LOW) {
        return nativeSetTerrain({...terrain,source:activeSource},optionsArg);
      }
      if (terrain?.source) activeSource = terrain.source;
      return nativeSetTerrain(terrain,optionsArg);
    };

    map.setPaintProperty = (layerId, name, value, optionsArg) => {
      if (layerId === HILLSHADE_LOW && name === 'hillshade-exaggeration') {
        for (const id of [HILLSHADE_LOW,HILLSHADE_MEDIUM,HILLSHADE_HIGH]) {
          if (map.getLayer(id)) nativeSetPaintProperty(id,name,value,optionsArg);
        }
        return map;
      }
      return nativeSetPaintProperty(layerId,name,value,optionsArg);
    };

    async function prefetchSource(sourceId, token) {
      const prefetch = window.ALAN_MAP_PREFETCH_PM_TILE;
      if (typeof prefetch !== 'function') return {available:false,completed:0,failed:0};
      const nativeZoom = nativeZoomForSource(sourceId);
      const tiles = visibleTileCoordinates(map,nativeZoom).filter(({z,x,y}) => {
        const key = `${z}/${x}/${y}`;
        if (warmed.has(key)) return false;
        warmed.add(key);
        return true;
      });
      if (!tiles.length) return {available:true,completed:0,failed:0};
      prefetchRuns += 1;
      const started = performance.now();
      const results = await Promise.allSettled(tiles.map(({z,x,y}) => prefetch({archivePath:ARCHIVE_PATH,z,x,y,reason:'terrain-lod'})));
      if (token !== transitionToken) {
        cancelledTransitions += 1;
        return {available:true,cancelled:true,completed:0,failed:0};
      }
      const completed = results.filter((result) => result.status === 'fulfilled').length;
      const failed = results.length - completed;
      prefetchedTiles += completed;
      prefetchFailures += failed;
      lastTransitionMs = performance.now() - started;
      return {available:true,completed,failed};
    }

    async function syncTerrainLod(reason = 'zoomend') {
      const desired = desiredWithHysteresis(map.getZoom(),activeSource);
      if (desired === activeSource) {
        pendingSource = null;
        return;
      }
      const token = ++transitionToken;
      pendingSource = desired;
      const prefetchResult = await prefetchSource(desired,token);
      if (token !== transitionToken) return;
      const currentDesired = desiredWithHysteresis(map.getZoom(),activeSource);
      if (currentDesired !== desired) {
        cancelledTransitions += 1;
        pendingSource = null;
        return;
      }
      if (prefetchResult.failed && prefetchResult.completed === 0) {
        pendingSource = null;
        lastTransitionReason = 'prefetch-failed-kept-current-lod';
        return;
      }
      if (!map.getSource(desired)) {
        pendingSource = null;
        lastTransitionReason = 'desired-source-missing';
        return;
      }
      nativeSetTerrain({source:desired,exaggeration:lastRelief});
      activeSource = desired;
      pendingSource = null;
      switches += 1;
      lastTransitionReason = reason;
    }

    map.on('zoomend',() => { void syncTerrainLod('zoomend'); });
    map.on('load',() => { void syncTerrainLod('load'); });

    api.getDemLodDiagnostics = () => ({
      version:VERSION,
      archivePath:ARCHIVE_PATH,
      physicalNativeZooms:[7,9,10],
      nativeZ8:false,
      runtimeNativeZooms:[7,9,10],
      runtimeNetworkLevels:3,
      z8RequestsEnabled:false,
      z8RuntimeMode:'overzoom-z7-native-z8-absent',
      transitionMode:'prefetch-visible-tiles-then-switch-on-zoomend',
      hysteresis:{...SWITCH_HYSTERESIS},
      activeSource,
      activeLod:lodForSource(activeSource).id,
      exactLodForMapZoom:lodForSource(sourceForExactZoom(map.getZoom())).id,
      pendingSource,
      mapZoom:map.getZoom(),
      switches,
      prefetchRuns,
      prefetchedTiles,
      prefetchFailures,
      cancelledTransitions,
      lastTransitionMs,
      lastTransitionReason
    });
    window.ALAN_MAP_DEM_LOD_DIAGNOSTICS = api.getDemLodDiagnostics;
    return api;
  };

  window.ALAN_MAP_DEM_LOD_CONTRACT = Object.freeze({
    version:VERSION,
    archivePath:ARCHIVE_PATH,
    physicalNativeZooms:Object.freeze([7,9,10]),
    nativeZ8:false,
    runtimeNativeZooms:Object.freeze([7,9,10]),
    runtimeNetworkLevels:3,
    z8RequestsEnabled:false,
    z8RuntimeMode:'overzoom-z7-native-z8-absent',
    transitionMode:'prefetch-visible-tiles-then-switch-on-zoomend',
    effectiveGroundMPerInformationPixelAtCenter:Object.freeze({'7':442.574,'8':442.574,'9':221.287,'10':110.644})
  });
})();
