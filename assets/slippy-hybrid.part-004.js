mountain-object-points',
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