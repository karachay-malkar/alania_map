mRotate.enable = function () {
          const result = originalEnable();
          if (typeof map.touchZoomRotate.disableRotation === 'function') map.touchZoomRotate.disableRotation();
          return result;
        };
      }
      if (typeof map.touchZoomRotate.disableRotation === 'function') map.touchZoomRotate.disableRotation();
    }
    if (map.touchPitch && typeof map.touchPitch.disable === 'function') map.touchPitch.disable();

    const clearTerrain = () => {
      try {
        if (map.getTerrain && map.getTerrain() && originalSetTerrain) originalSetTerrain(null);
      } catch (_) {}
      try { map.jumpTo({bearing: 0, pitch: 0}); } catch (_) {}
    };
    map.on('load', clearTerrain);
    map.on('styledata', clearTerrain);
    return map;
  }

  function wrapMapConstructor() {
    const maplibregl = root.maplibregl;
    const OriginalMap = maplibregl && maplibregl.Map;
    if (!OriginalMap || OriginalMap.__alanSlippyWrapped) return;
    const WrappedMap = new Proxy(OriginalMap, {
      construct(Target, args) {
        const nextArgs = Array.from(args || []);
        nextArgs[0] = forceFlatOptions(nextArgs[0]);
        const map = Reflect.construct(Target, nextArgs, Target);
        return installFlatGuards(map);
      }
    });
    Object.defineProperty(WrappedMap, '__alanSlippyWrapped', {value: true});
    maplibregl.Map = WrappedMap;
  }

  function loadImage(map, id, uri) {
    return new Promise((resolve, reject) => {
      if (map.hasImage(id)) { resolve(); return; }
      const image = new Image();
      image.onload = () => {
        try {
          if (!map.hasImage(id)) map.addImage(id, image, {pixelRatio: 4});
          resolve();
        } catch (error) {
          reject(error);
        }
      };
      image.onerror = () => reject(new Error(`Не загружена иконка ${id}.`));
      image.src = uri;
    });
  }

  function iconSizeExpression(low, medium, high) {
    return ['interpolate', ['linear'], ['zoom'], 7, low, 10, medium, 14.3, high];
  }

  function mountainLayers() {
    const baseLayout = {
      'icon-image': ['get', 'mountain_icon'],
      'icon-anchor': 'top',
      'icon-rotation-alignment': 'viewport',
      'icon-pitch-alignment': 'viewport',
      'icon-keep-upright': true,
      'icon-ignore-placement': true,
      'icon-padding': 2,
      'symbol-z-order': 'source',
      'symbol-sort-key': ['get', 'mountain_priority']
    };
    return [
      {
        id: 'alan-mountain-icons-standard',
        type: 'symbol',
        source: SOURCE_ID,
        minzoom: 8.6,
        maxzoom: 14.31,
        filter: ['==', ['get', 'mountain_category'], 'standard'],
        layout: Object.assign({}, baseLayout, {
          'icon-size': iconSizeExpression(0.75, 1.0, 1.25),
          'icon-allow-overlap': false
        }),
        paint: {'icon-opacity': ['interpolate', ['linear'], ['zoom'], 8.6, 0, 9.0, 0.9, 14.3, 0.96]}
      },
      {
        id: 'alan-mountain-icons-high',
        type: 'symbol',
        source: SOURCE_ID,
        minzoom: 7.6,
        maxzoom: 14.31,
        filter: ['==', ['get', 'mountain_category'], 'high'],
        layout: Object.assign({}, baseLayout, {
          'icon-size': iconSizeExpression(0.90, 1.20, 1.50),
          'icon-allow-overlap': false
        }),
        paint: {'icon-opacity': ['interpolate', ['linear'], ['zoom'], 7.6, 0.72, 9.0, 0.94, 14.3, 0.98]}
      },
      {
        id: 'alan-mountain-icons-five-thousanders',
        type: 'symbol',
        source: SOURCE_ID,
        minzoom: 7,
        maxzoom: 14.31,
        filter: ['==', ['get', 'mountain_category'], 'five_thousander'],
        layout: Object.assign({}, baseLayout, {
          'icon-size': iconSizeExpression(1.20, 1.55, 2.00),
          'icon-allow-overlap': true,
          'icon-padding': 1
        }),
        paint: {'icon-opacity': 0.98}
      }
    ];
  }

  async function installMountainLayer(map, data) {
    if (!map || !data || map.__alanMountainIconsInstalled) return;
    map.__alanMountainIconsInstalled = true;
    const spriteIds = AVAILABLE_ICONS.slice();
    await Promise.all(spriteIds.map((id) => loadImage(
      map,
      id,
      new URL(`assets/mountains/${id}.png`, document.baseURI).href
    )));

    const collection = buildMountainCollection(data);
    if (!map.getSource(SOURCE_ID)) map.addSource(SOURCE_ID, {type: 'geojson', data: collection, maxzoom: 14, tolerance: 0.1, buffer: 256});
    const beforeId = [
      'settlement-current-points',
      'mountain-object-points',
      'mountain-passes',
      'osm-peak-points'
    ].find((id) => map.getLayer(id));
    for (const layer of mountainLayers()) {
      if (!map.getLayer(layer.id)) map.addLayer(layer, beforeId);
    }

    root.ALAN_SLIPPY_HYBRID_DIAGNOSTICS = () => ({
      version: VERSION,
      flat: map.getPitch() === 0 && map.getBearing() === 0 && !map.getTerrain(),
      sourceId: SOURCE_ID,
      layerIds: LAYER_IDS.slice(),
      featureCount: collection.features.length,
      spriteCount: spriteIds.length,
      mount1Loaded: map.hasImage('mount-1'),
      mount11Usage: collection.features.filter((feature) => feature.properties.mountain_icon === 'mount-11').length,
      categoryCounts: collection.features.reduce((result, feature) => {
        const key = feature.properties.mountain_category;
        result[key] = (result[key] || 0) + 1;
        return result;
      }, {})
    });
  }

  function updateUi(host) {
    if (!host) return;
    host.dataset.slippyMode = 'hybrid';
    const title = host.querySelector('.alan-map-title');
    const subtitle = host.querySelector('.alan-map-subtitle');
    const reliefLabel = host.querySelector('[data-control="relief"]')?.closest('.alan-map-control-row')?.querySelector('label');
    const north = host.querySelector('[data-action="north"]');
    if (title) title.textContent = 'Alan Map · 7.0.23 Slippy';
    if (subtitle) subtitle.textContent = 'Гибридная Slippy Map · плоская raster-dem основа + векторные слои';
    if (reliefLabel) reliefLabel.textContent = 'Тени';
    if (north) { north.textContent = 'N'; north.title = 'Север сверху'; }
  }

  function wrapAlanMapMount() {
    const AlanMap = root.AlanMap;
    if (!AlanMap || typeof AlanMap.mount !== 'function' || AlanMap.__alanSlippyWrapped) return;
    const originalMount = AlanMap.mount.bind(AlanMap);
    AlanMap.mount = function (target, options) {
      const host = typeof target === 'string' ? document.querySelector(target) : target;
      const originalOnReady = options && options.onReady;
      const nextOptions = Object.assign({}, options || {}, {
        regionalLabels3D: {},
        onReady(api) {
          const map = api && api.map;
          installMountainLayer(map, nextOptions.data || root.ALAN_MAP_DATA).catch((error) => {
            console.error('Alan Slippy Hybrid:', error);
            const status = host && host.querySelector('[data-role="status"]');
            if (status) {
              status.textContent = `Горы не загружены: ${error.message}`;
              status.classList.add('error');
            }
          });
          if (typeof originalOnReady === 'function') originalOnReady(api);
        }
      });
      const api = originalMount(target, nextOptions);
      updateUi(host);
      return api;
    };
    Object.defineProperty(AlanMap, '__alanSlippyWrapped', {value: true});
  }

  injectStyle();
  wrapMapConstructor();
  wrapAlanMapMount(