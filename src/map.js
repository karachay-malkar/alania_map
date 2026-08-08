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

function waitForLoad(map) {
  return new Promise((resolve, reject) => {
    map.once('load', resolve);
    map.once('error', (event) => reject(event?.error || new Error('Ошибка MapLibre')));
  });
}

function loadHtmlImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Не удалось загрузить атлас: ${url}`));
    image.src = url;
  });
}

async function installAtlas(map, manifest) {
  const atlas = await loadHtmlImage(CONFIG.iconAtlasUrl);
  if (atlas.naturalWidth !== manifest.atlas_width || atlas.naturalHeight !== manifest.atlas_height) {
    throw new Error(`Размер атласа ${atlas.naturalWidth}×${atlas.naturalHeight} не совпадает с manifest.`);
  }
  const canvas = document.createElement('canvas');
  canvas.width = manifest.cell_width;
  canvas.height = manifest.cell_height;
  const context = canvas.getContext('2d', {willReadFrequently: true});
  if (!context) throw new Error('Canvas 2D недоступен для атласа гор.');

  for (const icon of manifest.icons) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(atlas, icon.x, icon.y, icon.width, icon.height, 0, 0, canvas.width, canvas.height);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    if (!map.hasImage(icon.id)) map.addImage(icon.id, imageData, {pixelRatio: manifest.pixel_ratio || 1});
  }
}

function zoomScaleExpression() {
  const expression = ['interpolate', ['linear'], ['zoom']];
  const stops = [];
  for (let zoom = CONFIG.minZoom; zoom <= CONFIG.maxZoom + 0.001; zoom += 0.5) stops.push(Number(zoom.toFixed(2)));
  if (stops.at(-1) !== CONFIG.maxZoom) stops.push(CONFIG.maxZoom);
  for (const zoom of stops) {
    expression.push(zoom, Math.pow(2, zoom - CONFIG.iconReferenceZoom));
  }
  return expression;
}

function iconSizeExpression() {
  return ['*', ['get', 'icon_size_ref'], zoomScaleExpression()];
}

function addIconLayers(map, iconMountains) {
  map.addSource('mountain-icons', {type: 'geojson', data: iconMountains, promoteId: 'id'});
  for (const definition of CONFIG.revealTiers) {
    const fadeStart = definition.zoom - 0.32;
    const fadeEnd = definition.zoom + 0.08;
    map.addLayer({
      id: `mountain-icons-tier-${definition.tier}`,
      type: 'symbol',
      source: 'mountain-icons',
      minzoom: fadeStart,
      filter: ['==', ['get', 'reveal_tier'], definition.tier],
      layout: {
        'icon-image': ['get', 'icon'],
        'icon-size': iconSizeExpression(),
        'icon-anchor': 'bottom',
        'icon-rotation-alignment': 'viewport',
        'icon-pitch-alignment': 'viewport',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'symbol-sort-key': ['get', 'sort_key']
      },
      paint: {
        'icon-opacity': ['interpolate', ['linear'], ['zoom'], fadeStart, 0, fadeEnd, 1]
      }
    });
  }
}

function addMainLayers(map, mountains) {
  map.addSource('mountains', {type: 'geojson', data: mountains, promoteId: 'id'});

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

function setupMainLabels(map, mountains) {
  const host = document.getElementById('main-labels');
  const entries = mountains.features
    .filter((feature) => feature.properties?.main && feature.properties?.name)
    .map((feature) => {
      const element = document.createElement('div');
      element.className = 'main-label';
      element.textContent = feature.properties.name;
      host.appendChild(element);
      return {feature, element};
    })
    .sort((a, b) => {
      const ap = a.feature.properties;
      const bp = b.feature.properties;
      const aPriority = ap.id === 'mingi_tau' ? 3 : ap.five_thousander ? 2 : 1;
      const bPriority = bp.id === 'mingi_tau' ? 3 : bp.five_thousander ? 2 : 1;
      return bPriority - aPriority || Number(bp.elevation_m || 0) - Number(ap.elevation_m || 0) || String(ap.id).localeCompare(String(bp.id));
    });

  let scheduled = false;
  const render = () => {
    scheduled = false;
    const zoom = map.getZoom();
    if (zoom < CONFIG.labelMinZoom) {
      entries.forEach(({element}) => { element.hidden = true; });
      return;
    }
    const canvas = map.getCanvas();
    const placed = [];
    for (const {feature, element} of entries) {
      const point = map.project(feature.geometry.coordinates);
      if (point.x < -120 || point.y < -40 || point.x > canvas.clientWidth + 120 || point.y > canvas.clientHeight + 40) {
        element.hidden = true;
        continue;
      }
      const name = String(feature.properties.name || '');
      const width = Math.min(190, Math.max(58, 18 + name.length * 7.1));
      const height = 22;
      const box = {left: point.x - width / 2 - 4, right: point.x + width / 2 + 4, top: point.y - 42, bottom: point.y - 42 + height + 8};
      const collides = placed.some((other) => !(box.right < other.left || box.left > other.right || box.bottom < other.top || box.top > other.bottom));
      if (collides) {
        element.hidden = true;
        continue;
      }
      placed.push(box);
      element.hidden = false;
      element.style.left = `${point.x}px`;
      element.style.top = `${point.y - 12}px`;
    }
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(render);
  };
  map.on('move', schedule);
  map.on('zoom', schedule);
  map.on('resize', schedule);
  render();
}

function setupMainInteraction(map) {
  const card = document.getElementById('feature-card');
  const close = document.getElementById('feature-card-close');
  const role = document.getElementById('feature-role');
  const name = document.getElementById('feature-name');
  const elevation = document.getElementById('feature-elevation');
  const note = document.getElementById('feature-note');

  const hide = () => { card.hidden = true; };
  close.addEventListener('click', hide);

  const show = (feature) => {
    const p = feature.properties || {};
    role.textContent = p.id === 'mingi_tau' ? 'Особая гора' : p.five_thousander ? 'Пятитысячник' : 'Главная гора';
    name.textContent = p.name || p.id || 'Гора';
    elevation.textContent = Number(p.elevation_m) ? `${Math.round(Number(p.elevation_m))} м` : '';
    note.textContent = p.id === 'mingi_tau' ? 'Минги-тау · Эльбрус' : '';
    note.hidden = !note.textContent;
    card.hidden = false;
  };

  const layers = ['mountains-main', 'mingi-tau'];
  for (const layer of layers) {
    map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
    map.on('click', layer, (event) => {
      const feature = event.features?.[0];
      if (feature) show(feature);
    });
  }
}

export async function createMap({boundary, mountains, iconMountains, atlasManifest}) {
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
  await waitForLoad(map);
  await installAtlas(map, atlasManifest);
  addIconLayers(map, iconMountains);
  addMainLayers(map, mountains);
  map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], {
    padding: CONFIG.fitPadding,
    bearing: CONFIG.bearing,
    pitch: CONFIG.pitch,
    duration: 0
  });
  map.setMaxBounds([[bounds[0] - .25, bounds[1] - .20], [bounds[2] + .25, bounds[3] + .20]]);
  setupMainLabels(map, mountains);
  setupMainInteraction(map);
  return map;
}
