(() => {
  'use strict';

  const data = window.ALAN_MAP_DATA;
  if (!data?.regionalDem) {
    throw new Error('Alan Map 7.3.5: DEM config is missing.');
  }

  data.regionalDem = {
    ...data.regionalDem,
    available: true,
    archivePath: 'data/alan-dem-7.3.5.pmtiles',
    tileSize: 256,
    minzoom: 7,
    maxzoom: 12,
    encoding: 'mapbox',
    lodModel: 'single-pyramid-z7-z12',
    highestNativeZoom: 12,
    overzoomFrom: 12,
    physicalNativeZooms: [7, 8, 9, 10, 11, 12],
    nativeZ8: true,
    runtimeNativeZooms: [7, 8, 9, 10, 11, 12],
    runtimeNetworkLevels: 6,
    z8RuntimeMode: 'native',
    z8RequestsEnabled: true,
    transitionMode: 'maplibre-native-single-source',
    archiveBytes: 56681035,
    terrainRuntime: 'maplibre-native-single-source',
    terrainController: false,
    geometryGeneralization: 'single-pyramid-native-z7-z12',
    horizontalGroundResolutionApproxM: 27.7,
    effectiveGroundMPerInformationPixelAtCenter: {
      7: 885.148,
      8: 442.574,
      9: 221.287,
      10: 110.644,
      11: 55.322,
      12: 27.661
    },
    archiveSha: '301dd6c9a415e67951f63846e4ea5bc253774c0d',
    reusedFrom: '7.2.5-known-good-dem'
  };

  window.ALAN_MAP_TERRAIN_RESET_DIAGNOSTICS = () => ({
    release: '7.3.5',
    architecture: 'maplibre-native-single-source',
    source: 'terrain-dem',
    archivePath: data.regionalDem.archivePath,
    tileSize: data.regionalDem.tileSize,
    minzoom: data.regionalDem.minzoom,
    maxzoom: data.regionalDem.maxzoom,
    physicalNativeZooms: [...data.regionalDem.physicalNativeZooms],
    customTerrainController: false
  });
})();
