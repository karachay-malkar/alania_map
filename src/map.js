(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./config.js'));
  } else {
    root.ALAN_12_1_MAP = factory(root.ALAN_12_1_CONFIG);
  }
})(typeof self !== 'undefined' ? self : this, function (config) {
  'use strict';

  const CATEGORY_ORDER = Object.freeze([
    'mountain',
    'rock',
    'ridge',
    'hill',
    'main_mountain',
    'five_thousander'
  ]);

  function categoryLayerId(type) {
    return `mountain-points-${type.replaceAll('_', '-')}`;
  }

  function iconLayerId(tier) {
    return `mountain-icons-${tier.id}`;
  }

  function pointLayer(type) {
    const category = config.categories[type];
    return {
      id: categoryLayerId(type),
      type: 'circle',
      source: 'mountain-points',
      minzoom: config.minZoom,
      filter: ['==', ['get', 'type'], type],
      paint: {
        'circle-radius': [
          'interpolate', ['linear'], ['zoom'],
          config.minZoom, Math.max(1.8, category.radius - 1.1),
          10, category.radius,
          15, category.radius + 1.5
        ],
        'circle-color': category.color,
        'circle-stroke-color': '#f6eddc',
        'circle-stroke-width': type === 'five_thousander' ? 1.5 : 1,
        'circle-opacity': 0.88,
        'circle-stroke-opacity': 0.94,
        'circle-pitch-alignment': 'viewport',
        'circle-pitch-scale': 'viewport'
      }
    };
  }

  function createIconLayer(tier) {
    return {
      id: iconLayerId(tier),
      type: 'symbol',
      source: 'mountain-icons',
      minzoom: tier.minZoom,
      filter: tier.filter,
      layout: {
        'symbol-placement': 'point',
        'symbol-sort-key': ['get', 'sort_key'],
        'icon-image': ['get', 'icon_id'],
        'icon-size': ['get', 'icon_scale'],
        'icon-anchor': 'bottom',
        'icon-allow-overlap': false,
        'icon-ignore-placement': false,
        'icon-optional': false,
        'icon-padding': 4,
        'icon-rotation-alignment': 'viewport',
        'icon-pitch-alignment': 'viewport'
      },
      paint: {'icon-opacity': 0.98}
    };
  }

  function createStyle(data) {
    return {
      version: 8,
      sources: {
        boundary: {
          type: 'geojson',
          data: data.boundary,
          tolerance: 0.1,
          buffer: 16
        },
        'mountain-points': {
          type: 'geojson',
          data: data.mountains,
          maxzoom: 15,
          tolerance: 0,
          buffer: 64
        },
        'mountain-icons': {
          type: 'geojson',
          data: data.icons,
          maxzoom: 15,
          tolerance: 0,
          buffer: 128
        }
      },
      layers: [
        {
          id: 'background',
          type: 'background',
          paint: {'background-color': '#d8c8a8'}
        },
        {
          id: 'territory-fill',
          type: 'fill',
          source: 'boundary',
          paint: {
            'fill-color': '#efe2c8',
            'fill-opacity': 1
          }
        },
        {
          id: 'territory-outline',
          type: 'line',
          source: 'boundary',
          layout: {'line-cap': 'round', 'line-join': 'round'},
          paint: {
            'line-color': '#5e5143',
            'line-width': ['interpolate', ['linear'], ['zoom'], config.minZoom, 1.1, 12, 2.2],
            'line-opacity': 0.92
          }
        },
        ...CATEGORY_ORDER.map(pointLayer)
      ]
    };
  }

  function expandedBounds(bounds, longitudePadding = 0.12, latitudePadding = 0.08) {
    return [
      [bounds[0] - longitudePadding, bounds[1] - latitudePadding],
      [bounds[2] + longitudePadding, bounds[3] + latitudePadding]
    ];
  }

  function updateSummary(summary) {
    const total = document.querySelector('[data-total-points]');
    const icons = document.querySelector('[data-total-icons]');
    if (total) total.textContent = String(summary.total);
    if (icons) icons.textContent = String(summary.icons.total);
    for (const type of CATEGORY_ORDER) {
      const target = document.querySelector(`[data-count="${type}"]`);
      if (target) target.textContent = String(summary.counts[type] || 0);
    }
  }

  function valueRow(label, value) {
    const row = document.createElement('div');
    row.className = 'feature-row';
    const term = document.createElement('span');
    term.className = 'feature-term';
    term.textContent = label;
    const description = document.createElement('span');
    description.className = 'feature-value';
    description.textContent = value;
    row.append(term, description);
    return row;
  }

  function showFeatureCard(feature) {
    const card = document.getElementById('feature-card');
    const body = document.getElementById('feature-card-body');
    if (!card || !body) return;
    const properties = feature.properties || {};
    const category = config.categories[properties.type] || config.categories.mountain;
    body.replaceChildren();
    body.append(valueRow('ID', String(properties.id || properties.point_id || '—')));
    body.append(valueRow('Тип', category.label));
    if (properties.elevation_m !== null && properties.elevation_m !== undefined && properties.elevation_m !== '') {
      body.append(valueRow('Высота', `${properties.elevation_m} м`));
    }
    body.append(valueRow('Долгота', Number(properties.longitude).toFixed(6)));
    body.append(valueRow('Широта', Number(properties.latitude).toFixed(6)));
    if (properties.name) body.append(valueRow('Название', String(properties.name)));
    card.hidden = false;
  }

  function bindControls(map, data) {
    document.querySelector('[data-action="zoom-in"]')?.addEventListener('click', () => map.zoomIn({duration: 180}));
    document.querySelector('[data-action="zoom-out"]')?.addEventListener('click', () => map.zoomOut({duration: 180}));
    document.querySelector('[data-action="reset"]')?.addEventListener('click', () => {
      map.fitBounds([[data.bounds[0], data.bounds[1]], [data.bounds[2], data.bounds[3]]], {
        padding: config.fitPadding,
        duration: 420,
        bearing: 0,
        pitch: 0
      });
    });
    document.querySelector('[data-action="close-card"]')?.addEventListener('click', () => {
      const card = document.getElementById('feature-card');
      if (card) card.hidden = true;
    });
  }

  function bindLayerInteraction(map, layerIds) {
    for (const layerId of layerIds) {
      map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
      map.on('click', layerId, (event) => {
        const feature = event.features && event.features[0];
        if (feature) showFeatureCard(feature);
      });
    }
  }

  async function registerAtlasIcons(map, manifest) {
    const image = new Image();
    image.decoding = 'async';
    image.src = manifest.atlas;
    await image.decode();
    for (const icon of manifest.icons) {
      if (map.hasImage(icon.id)) continue;
      const canvas = document.createElement('canvas');
      canvas.width = icon.width;
      canvas.height = icon.height;
      const context = canvas.getContext('2d', {alpha: true, willReadFrequently: true});
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, icon.x, icon.y, icon.width, icon.height, 0, 0, icon.width, icon.height);
      map.addImage(icon.id, context.getImageData(0, 0, icon.width, icon.height), {pixelRatio: manifest.pixel_ratio});
    }
  }

  function createMap(maplibregl, data) {
    if (!maplibregl || typeof maplibregl.Map !== 'function') throw new Error('Локальный MapLibre не подключён.');
    const center = [(data.bounds[0] + data.bounds[2]) / 2, (data.bounds[1] + data.bounds[3]) / 2];
    const map = new maplibregl.Map({
      container: 'map',
      style: createStyle(data),
      center,
      zoom: config.minZoom,
      minZoom: config.minZoom,
      maxZoom: config.maxZoom,
      maxBounds: expandedBounds(data.bounds),
      pitch: 0,
      maxPitch: 0,
      bearing: 0,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      renderWorldCopies: false,
      attributionControl: false,
      antialias: false,
      fadeDuration: 0,
      preserveDrawingBuffer: false
    });

    map.dragRotate?.disable();
    map.touchZoomRotate?.disableRotation();
    map.touchPitch?.disable();

    map.once('load', async () => {
      try {
        await registerAtlasIcons(map, data.iconManifest);
        const iconLayers = config.iconTiers.map(createIconLayer);
        for (const layer of iconLayers) map.addLayer(layer);
        map.fitBounds([[data.bounds[0], data.bounds[1]], [data.bounds[2], data.bounds[3]]], {
          padding: config.fitPadding,
          duration: 0,
          bearing: 0,
          pitch: 0
        });
        bindLayerInteraction(map, [
          ...CATEGORY_ORDER.map(categoryLayerId),
          ...config.iconTiers.map(iconLayerId)
        ]);
        document.getElementById('loading')?.setAttribute('hidden', '');
        const status = document.getElementById('map-status');
        if (status) status.textContent = `${data.summary.total} точек · ${data.summary.icons.total} фигурок`;
      } catch (error) {
        console.error(error);
        const status = document.getElementById('map-status');
        if (status) {
          status.textContent = `Фигурки не загрузились: ${error.message || error}`;
          status.dataset.failed = 'true';
        }
        const loadingText = document.querySelector('#loading .loading-text');
        if (loadingText) loadingText.textContent = String(error.message || error);
      }
    });

    bindControls(map, data);
    updateSummary(data.summary);
    return map;
  }

  function diagnostics(map, data) {
    const style = map.getStyle();
    return {
      version: config.version,
      flat: map.getPitch() === 0 && map.getBearing() === 0 && map.getMaxPitch() === 0,
      pitch: map.getPitch(),
      bearing: map.getBearing(),
      maxPitch: map.getMaxPitch(),
      sourceIds: Object.keys(style.sources || {}),
      layerIds: (style.layers || []).map((layer) => layer.id),
      pointCount: data.summary.total,
      counts: data.summary.counts,
      iconBindingCount: data.summary.icons.total,
      iconCounts: data.summary.icons.counts,
      iconTierCounts: data.summary.icons.tiers,
      registeredImages: data.iconManifest.icons.filter((icon) => map.hasImage(icon.id)).length,
      invalidSourcePoints: data.summary.invalid,
      excludedOutsideBoundary: data.summary.outside
    };
  }

  return Object.freeze({
    CATEGORY_ORDER,
    categoryLayerId,
    iconLayerId,
    createIconLayer,
    createStyle,
    createMap,
    diagnostics
  });
});
