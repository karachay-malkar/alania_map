(() => {
  'use strict';

  const VERSION = '7.3.2';
  const SOURCE_LOW = 'terrain-dem';
  const SOURCE_MEDIUM = 'terrain-dem-medium';
  const SOURCE_HIGH = 'terrain-dem-high';
  const HILLSHADE_LOW = 'terrain-hillshade';
  const HILLSHADE_MEDIUM = 'terrain-hillshade-medium';
  const HILLSHADE_HIGH = 'terrain-hillshade-high';
  const ARCHIVE_PATH = 'data/alan-dem-7.3.pmtiles';
  const LODS = Object.freeze([
    Object.freeze({id:'low', source:SOURCE_LOW, nativeZoom:7, minMapZoom:7, maxMapZoom:9}),
    Object.freeze({id:'medium', source:SOURCE_MEDIUM, nativeZoom:9, minMapZoom:9, maxMapZoom:10}),
    Object.freeze({id:'high', source:SOURCE_HIGH, nativeZoom:10, minMapZoom:10, maxMapZoom:14.3})
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

  // Runtime exposes only the three information levels required by 7.3.2.
  // The verified 7.3.1 PMTiles archive is retained as the storage container;
  // its physical z8 tiles are intentionally unreachable by the runtime sources.
  data.regionalDem.archivePath = ARCHIVE_PATH;
  data.regionalDem.runtimeNativeZoom = 7;
  data.regionalDem.runtimeMaxzoom = Number(originalDem.highestNativeZoom || originalDem.maxzoom || 10);
  data.regionalDem.minzoom = 7;
  data.regionalDem.maxzoom = 7;
  data.regionalDem.runtimeNativeZooms = [7,9,10];
  data.regionalDem.runtimeNetworkLevels = 3;
  data.regionalDem.runtimeLods = LODS.map((lod) => ({...lod}));
  data.regionalDem.z8RuntimeMode = 'overzoom-z7-no-native-z8-request';
  data.regionalDem.z8RequestsEnabled = false;

  const sourceForZoom = (zoom) => Number(zoom) >= 10 ? SOURCE_HIGH : Number(zoom) >= 9 ? SOURCE_MEDIUM : SOURCE_LOW;
  const lodForZoom = (zoom) => LODS.find((lod) => lod.source === sourceForZoom(zoom)) || LODS[0];

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

  alanMap.mount = function mountWithDemLods(target, options = {}) {
    const api = originalMount(target,{...options,maplibregl:maplibreProxy});
    const map = api?.map;
    if (!map) return api;

    const nativeSetTerrain = map.setTerrain.bind(map);
    const nativeSetPaintProperty = map.setPaintProperty.bind(map);
    let activeSource = SOURCE_LOW;
    let switches = 0;

    map.setTerrain = (terrain, optionsArg) => {
      if (terrain?.source === SOURCE_LOW) {
        const desired = sourceForZoom(map.getZoom());
        activeSource = desired;
        return nativeSetTerrain({...terrain,source:desired},optionsArg);
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

    const syncTerrainLod = () => {
      const desired = sourceForZoom(map.getZoom());
      if (desired === activeSource || !map.getSource(desired)) return;
      const relief = Number(api.getState?.().relief || 2.55);
      nativeSetTerrain({source:desired,exaggeration:relief});
      activeSource = desired;
      switches += 1;
    };

    map.on('zoom',syncTerrainLod);
    map.on('load',syncTerrainLod);
    map.on('styledata',syncTerrainLod);

    api.getDemLodDiagnostics = () => ({
      version:VERSION,
      archivePath:ARCHIVE_PATH,
      runtimeNativeZooms:[7,9,10],
      runtimeNetworkLevels:3,
      z8RequestsEnabled:false,
      z8RuntimeMode:'overzoom-z7-no-native-z8-request',
      activeSource,
      activeLod:lodForZoom(map.getZoom()).id,
      mapZoom:map.getZoom(),
      switches,
      runtimeBands:LODS.map((lod) => ({...lod}))
    });
    window.ALAN_MAP_DEM_LOD_DIAGNOSTICS = api.getDemLodDiagnostics;
    return api;
  };

  window.ALAN_MAP_DEM_LOD_CONTRACT = Object.freeze({
    version:VERSION,
    archivePath:ARCHIVE_PATH,
    runtimeNativeZooms:Object.freeze([7,9,10]),
    runtimeNetworkLevels:3,
    z8RequestsEnabled:false,
    z8RuntimeMode:'overzoom-z7-no-native-z8-request',
    effectiveGroundMPerInformationPixelAtCenter:Object.freeze({'7':442.574,'8':442.574,'9':221.287,'10':110.644})
  });
})();
