import { CONFIG } from './config.js';
import { boundsOf } from './data.js';

function baseStyle(boundary) {
  return {
    version: 8,
    sources: {
      boundary: {type: 'geojson', data: boundary}
    },
    layers: [
      {id: 'background', type: 'background', paint: {'background-color': CONFIG.colors.outside}},
      {id: 'territory', type: 'fill', source: 'boundary', paint: {'fill-color': CONFIG.colors.territory, 'fill-opacity': 1}},
      {id: 'boundary', type: 'line', source: 'boundary', paint: {'line-color': CONFIG.colors.boundary, 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1.1, 12, 2.1], 'line-opacity': .9}}
    ]
  };
}

function ordinaryRadius() {
  return ['interpolate', ['linear'], ['zoom'], 6, 1.8, 9, 3.3, 13, 5.2, 15.5, 7.0];
}

function addMountainLayers(map, mountains) {
  map.addSource('mountains', {type: 'geojson', data: mountains, promoteId: 'id'});

  for (const [category, definition] of Object.entries(CONFIG.categories)) {
    map.addLayer({
      id: `mountains-${category}`,
      type: 'circle',
      source: 'mountains',
      minzoom: definition.minZoom,
      filter: ['all', ['==', ['get', 'category'], category], ['!=', ['get', 'main'], true]],
      paint: {
        'circle-radius': ordinaryRadius(),
        'circle-color': CONFIG.colors.ordinary,
        'circle-opacity': ['interpolate', ['linear'], ['zoom'], definition.minZoom, .25, definition.minZoom + .55, .82],
        'circle-stroke-color': '#efe2c5',
        'circle-stroke-width': .7
      }
    });
  }

  map.addLayer({
    id: 'mountains-main',
    type: 'circle',
    source: 'mountains',
    minzoom: CONFIG.minZoom,
    filter: ['all', ['==', ['get', 'main'], true], ['!=', ['get', 'id'], 'mingi_tau']],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 3.6, 10, 5.8, 15.5, 9.0],
      'circle-color': CONFIG.colors.main,
      'circle-stroke-color': '#f2e5c8',
      'circle-stroke-width': 1.2
    }
  });

  map.addLayer({
    id: 'mountains-five-thousander-ring',
    type: 'circle',
    source: 'mountains',
    minzoom: CONFIG.minZoom,
    filter: ['all', ['==', ['get', 'five_thousander'], true], ['!=', ['get', 'id'], 'mingi_tau']],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 5.2, 10, 7.6, 15.5, 11.5],
      'circle-color': 'rgba(0,0,0,0)',
      'circle-stroke-color': CONFIG.colors.five,
      'circle-stroke-width': 1.6
    }
  });

  map.addLayer({
    id: 'mingi-tau',
    type: 'circle',
    source: 'mountains',
    minzoom: CONFIG.minZoom,
    filter: ['==', ['get', 'id'], 'mingi_tau'],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 6.5, 10, 9.5, 15.5, 14],
      'circle-color': CONFIG.colors.mingi,
      'circle-stroke-color': '#fff2cf',
      'circle-stroke-width': 2
    }
  });
}

export function createMap({boundary, mountains}) {
  const bounds = boundsOf(boundary);
  const map = new maplibregl.Map({
    container: 'map',
    style: baseStyle(boundary),
    center: [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2],
    zoom: CONFIG.minZoom,
    minZoom: CONFIG.minZoom,
    maxZoom: CONFIG.maxZoom,
    bearing: CONFIG.bearing,
    pitch: CONFIG.pitch,
    dragRotate: false,
    pitchWithRotate: false,
    attributionControl: false,
    antialias: true
  });

  map.touchZoomRotate.disableRotation();
  map.on('load', () => {
    addMountainLayers(map, mountains);
    map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], {
      padding: CONFIG.fitPadding,
      bearing: CONFIG.bearing,
      pitch: CONFIG.pitch,
      duration: 0
    });
    map.setMaxBounds([[bounds[0] - .25, bounds[1] - .20], [bounds[2] + .25, bounds[3] + .20]]);
  });
  return map;
}
