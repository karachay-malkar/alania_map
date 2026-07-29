(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AlanFantasyStyle = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  const VERSION = '1.0.0';
  const STORAGE_KEY = 'alan-map-stage7.0.23-fantasy-style';
  const SOURCE_ID = 'fantasy-ridges';
  const FANTASY_LAYER_IDS = Object.freeze([
    'fantasy-paper-grain',
    'fantasy-ridge-shadow',
    'fantasy-slope-hachures',
    'fantasy-mountains-main',
    'fantasy-mountains-secondary',
    'fantasy-mountains-spur'
  ]);
  const TRANSIENT_LAYER_IDS = Object.freeze([
    'fantasy-slope-hachures',
    'fantasy-mountains-secondary',
    'fantasy-mountains-spur'
  ]);

  const PAINT_OVERRIDES = Object.freeze({
    background: {'background-color':'#1e201b'},
    'focus-paper': {'fill-color':'#d9c397','fill-opacity':0.99},
    'terrain-hillshade': {
      'hillshade-illumination-direction':320,
      'hillshade-shadow-color':'#493829',
      'hillshade-highlight-color':'#f2e4bd',
      'hillshade-accent-color':'#8a6b45'
    },
    'ridge-lines': {'line-color':'#5b4633','line-opacity':0.18,'line-dasharray':[1.1,2.8]},
    'osm-glacier-fill': {'fill-color':'#efe9d6','fill-outline-color':'#9caeaa'},
    'osm-snow-fill': {'fill-color':'#f7f1dc','fill-outline-color':'#b8b6a3'},
    'forest-fill': {'fill-color':'#46543a','fill-opacity':['interpolate',['linear'],['zoom'],7,0.28,9,0.36,12,0.42]},
    'forest-pattern': {'fill-opacity':['interpolate',['linear'],['zoom'],10.5,0.22,12,0.46]},
    'residential-base-fill': {'fill-color':'#d8c49a','fill-opacity':0.46},
    'osm-water-fill': {'fill-color':['match',['get','class'],'reservoir','#708f96','pond','#789a9e','#7295a0']},
    'osm-water-outline': {'line-color':'#526f73'},
    'osm-river-water-fill': {'fill-color':'#71949d'},
    'osm-river-halo': {'line-color':'#dfcda5'},
    'osm-river-line': {'line-color':'#577c84'},
    'boundary-line': {'line-color':'#57422f'},
    'road-casing': {'line-color':'#d4bf92'},
    'road-main': {'line-color':['match',['get','class'],'motorway','#7c5938','trunk','#7c5938','primary','#8b6844','secondary','#9b7c55','#aa916d']},
    'road-minor': {'line-color':'#a68c68'},
    'road-tunnel': {'line-color':'#735f46'},
    'road-bridge': {'line-color':'#785337'},
    'settlement-current-points': {'circle-color':'#ead9b5','circle-stroke-color':'#57422f'},
    'settlement-historic-points': {'circle-color':'#a9783e','circle-stroke-color':'#50331e'},
    'historic-object-points': {'circle-color':'#4e473d','circle-stroke-color':'#e0d2b1'},
    'mountain-object-points': {'circle-color':'#654c35','circle-stroke-color':'#eadbb8'},
    'mountain-passes': {'circle-color':'#725b42','circle-stroke-color':'#eadbb8'},
    'osm-peak-points': {'circle-color':['match',['get','peak_level'],1,'#4d3a2c','#67503c'],'circle-stroke-color':'#eee0ba'},
    'osm-river-label-main': {'text-color':'#385e64','text-halo-color':'#dfcda5'},
    'osm-river-label-regional': {'text-color':'#3f686e','text-halo-color':'#dfcda5'},
    'osm-water-labels': {'text-color':'#3b6268','text-halo-color':'#dfcda5'},
    'osm-peak-labels': {'text-color':'#4b392b','text-halo-color':'#eadbb7'},
    'settlement-labels-current': {'text-color':'#3d3529','text-halo-color':'#e3d2aa'},
    'settlement-labels-local': {'text-color':'#5a3b22','text-halo-color':'#e3d2aa'},
    'historic-object-labels': {'text-color':'#423a30','text-halo-color':'#e3d2aa'},
    'mountain-object-labels': {'text-color':'#4d3a2c','text-halo-color':'#e3d2aa'},
    'water-object-labels': {'text-color':'#3b6268','text-halo-color':'#e3d2aa'},
    'natural-object-labels': {'text-color':'#4d5d3e','text-halo-color':'#e3d2aa'},
    'mountain-pass-labels': {'text-color':'#584431','text-halo-color':'#e3d2aa'},
    'modern-labels': {'text-color':'#5f584b','text-halo-color':'#e3d2aa'}
  });

  const LAYOUT_OVERRIDES = Object.freeze({
    'osm-river-label-main': {'text-letter-spacing':0.09},
    'osm-river-label-regional': {'text-letter-spacing':0.07},
    'settlement-labels-current': {'text-letter-spacing':0.045},
    'settlement-labels-local': {'text-letter-spacing':0.035},
    'osm-peak-labels': {'text-letter-spacing':0.025},
    'mountain-object-labels': {'text-letter-spacing':0.035}
  });

  function safeStorageGet(key) {
    try { return root.localStorage?.getItem(key) ?? null; } catch (_) { return null; }
  }

  function safeStorageSet(key, value) {
    try { root.localStorage?.setItem(key, value); } catch (_) {}
  }

  function resolveHost(target) {
    if (typeof document === 'undefined') return null;
    if (typeof target === 'string') return document.querySelector(target);
    return target && typeof target.querySelector === 'function' ? target : null;
  }

  function setStatus(host, text) {
    const status = host?.querySelector?.('[data-role="status"]');
    if (status) status.textContent = text;
  }

  function injectUiStyle() {
    if (typeof document === 'undefined' || document.getElementById('alan-fantasy-ui-style')) return;
    const style = document.createElement('style');
    style.id = 'alan-fantasy-ui-style';
    style.textContent = `
      .alan-map-shell[data-fantasy-style="on"] .maplibregl-canvas { filter: saturate(.88) contrast(1.03); }
      .alan-map-layer-buttons [data-fantasy-toggle] { position: relative; padding-left: 24px; }
      .alan-map-layer-buttons [data-fantasy-toggle]::before { content: "⌁"; position: absolute; left: 9px; top: 50%; transform: translateY(-54%); font-size: 15px; line-height: 1; }
      .alan-map-layer-buttons [data-fantasy-toggle].active { box-shadow: inset 0 0 0 1px rgba(243,221,174,.42), 0 2px 10px rgba(54,39,24,.18); }
      .alan-map-shell[data-fantasy-style="on"] .alan-map-toolbar { backdrop-filter: blur(10px) sepia(.10); }
    `;
    document.head.appendChild(style);
  }

  function createFantasyLayers() {
    const classFilter = (ridgeClass) => ['==',['get','fantasy_class'],ridgeClass];
    return [
      {
        id:'fantasy-paper-grain',
        type:'fill',
        source:'polygons',
        filter:['==',['get','alan_source'],'focus'],
        paint:{'fill-pattern':'fantasy-paper-grain','fill-opacity':0.38}
      },
      {
        id:'fantasy-ridge-shadow',
        type:'line',
        source:SOURCE_ID,
        minzoom:7,
        maxzoom:12.8,
        filter:['in',['get','fantasy_class'],['literal',['main','secondary']]],
        layout:{'line-cap':'round','line-join':'round'},
        paint:{
          'line-color':'rgba(78,57,39,.72)',
          'line-width':['match',['get','fantasy_class'],'main',['interpolate',['linear'],['zoom'],7,1.25,10,2.4],['interpolate',['linear'],['zoom'],8,0.7,11,1.45]],
          'line-opacity':['interpolate',['linear'],['zoom'],7,0.26,9.5,0.38,12.8,0],
          'line-blur':0.55
        }
      },
      {
        id:'fantasy-slope-hachures',
        type:'symbol',
        source:SOURCE_ID,
        minzoom:9,
        maxzoom:13.2,
        filter:['in',['get','fantasy_class'],['literal',['main','secondary']]],
        layout:{
          'symbol-placement':'line',
          'symbol-spacing':72,
          'icon-image':'fantasy-hachure',
          'icon-size':['interpolate',['linear'],['zoom'],9,0.35,11.5,0.52,13.2,0.60],
          'icon-rotate':90,
          'icon-rotation-alignment':'map',
          'icon-pitch-alignment':'viewport',
          'icon-allow-overlap':false,
          'icon-ignore-placement':true,
          'icon-padding':1
        },
        paint:{'icon-opacity':['interpolate',['linear'],['zoom'],9,0,9.5,0.36,11.8,0.48,13.2,0]}
      },
      {
        id:'fantasy-mountains-main',
        type:'symbol',
        source:SOURCE_ID,
        minzoom:7,
        maxzoom:11.35,
        filter:classFilter('main'),
        layout:{
          'symbol-placement':'line',
          'symbol-spacing':['interpolate',['linear'],['zoom'],7,118,9.5,146,11.35,178],
          'icon-image':['get','fantasy_icon'],
          'icon-size':['interpolate',['linear'],['zoom'],7,0.52,8.8,0.70,10.7,0.88],
          'icon-rotation-alignment':'viewport',
          'icon-pitch-alignment':'viewport',
          'icon-keep-upright':true,
          'icon-allow-overlap':false,
          'icon-ignore-placement':false,
          'icon-padding':4,
          'symbol-sort-key':['get','fantasy_sort_key']
        },
        paint:{'icon-opacity':['interpolate',['linear'],['zoom'],7,0.88,9.8,0.92,10.8,0.64,11.35,0]}
      },
      {
        id:'fantasy-mountains-secondary',
        type:'symbol',
        source:SOURCE_ID,
        minzoom:8.15,
        maxzoom:11.9,
        filter:classFilter('secondary'),
        layout:{
          'symbol-placement':'line',
          'symbol-spacing':['interpolate',['linear'],['zoom'],8.15,145,10,168,11.9,205],
          'icon-image':['get','fantasy_icon'],
          'icon-size':['interpolate',['linear'],['zoom'],8.15,0.46,10.4,0.67,11.9,0.76],
          'icon-rotation-alignment':'viewport',
          'icon-pitch-alignment':'viewport',
          'icon-keep-upright':true,
          'icon-allow-overlap':false,
          'icon-ignore-placement':false,
          'icon-padding':4,
          'symbol-sort-key':['get','fantasy_sort_key']
        },
        paint:{'icon-opacity':['interpolate',['linear'],['zoom'],8.15,0,8.55,0.76,10.9,0.78,11.9,0]}
      },
      {
        id:'fantasy-mountains-spur',
        type:'symbol',
        source:SOURCE_ID,
        minzoom:9.25,
        maxzoom:12.65,
        filter:classFilter('spur'),
        layout:{
          'symbol-placement':'line',
          'symbol-spacing':['interpolate',['linear'],['zoom'],9.25,176,11,212,12.65,250],
          'icon-image':['get','fantasy_icon'],
          'icon-size':['interpolate',['linear'],['zoom'],9.25,0.42,11.5,0.60,12.65,0.67],
          'icon-rotation-alignment':'viewport',
          'icon-pitch-alignment':'viewport',
          'icon-keep-upright':true,
          'icon-allow-overlap':false,
          'icon-ignore-placement':false,
          'icon-padding':3,
          'symbol-sort-key':['get','fantasy_sort_key']
        },
        paint:{'icon-opacity':['interpolate',['linear'],['zoom'],9.25,0,9.7,0.58,11.8,0.62,12.65,0]}
      }
    ];
  }

  function createController({host, map, data, relief}) {
    let installed = false;
    let destroyed = false;
    let moving = false;
    let enabled = safeStorageGet(STORAGE_KEY) !== '0';
    let ridgeDiagnostics = null;
    let button = null;
    const paintSnapshots = new Map();
    const layoutSnapshots = new Map();

    const safeGetPaint = (layerId, property) => {
      try { return map.getPaintProperty(layerId, property); } catch (_) { return undefined; }
    };
    const safeGetLayout = (layerId, property) => {
      try { return map.getLayoutProperty(layerId, property); } catch (_) { return undefined; }
    };
    const safeSetPaint = (layerId, property, value) => {
      try { if (map.getLayer(layerId)) map.setPaintProperty(layerId, property, value); } catch (_) {}
    };
    const safeSetLayout = (layerId, property, value) => {
      try { if (map.getLayer(layerId)) map.setLayoutProperty(layerId, property, value); } catch (_) {}
    };

    function snapshotPalette() {
      for (const [layerId, properties] of Object.entries(PAINT_OVERRIDES)) {
        if (!map.getLayer(layerId)) continue;
        for (const property of Object.keys(properties)) {
          const key = `${layerId}:${property}`;
          if (!paintSnapshots.has(key)) paintSnapshots.set(key, safeGetPaint(layerId, property));
        }
      }
      for (const [layerId, properties] of Object.entries(LAYOUT_OVERRIDES)) {
        if (!map.getLayer(layerId)) continue;
        for (const property of Object.keys(properties)) {
          const key = `${layerId}:${property}`;
          if (!layoutSnapshots.has(key)) layoutSnapshots.set(key, safeGetLayout(layerId, property));
        }
      }
    }

    function applyPalette() {
      snapshotPalette();
      for (const [layerId, properties] of Object.entries(PAINT_OVERRIDES)) {
        for (const [property, value] of Object.entries(properties)) safeSetPaint(layerId, property, value);
      }
      for (const [layerId, properties] of Object.entries(LAYOUT_OVERRIDES)) {
        for (const [property, value] of Object.entries(properties)) safeSetLayout(layerId, property, value);
      }
    }

    function restorePalette() {
      for (const [key, value] of paintSnapshots.entries()) {
        const separator = key.indexOf(':');
        safeSetPaint(key.slice(0, separator), key.slice(separator + 1), value);
      }
      for (const [key, value] of layoutSnapshots.entries()) {
        const separator = key.indexOf(':');
        safeSetLayout(key.slice(0, separator), key.slice(separator + 1), value);
      }
    }

    function addImages() {
      const images = relief.createImages();
      for (const [id, image] of Object.entries(images)) {
        if (!image || map.hasImage(id)) continue;
        map.addImage(id, image, {pixelRatio:2});
      }
    }

    function addSourceAndLayers() {
      const ridges = relief.buildRidgeCollection(data?.ridges || {type:'FeatureCollection',features:[]});
      ridgeDiagnostics = ridges.diagnostics;
      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, {type:'geojson',data:{type:'FeatureCollection',features:ridges.features},maxzoom:14,tolerance:0.35,buffer:128});
      }
      const layers = createFantasyLayers();
      for (const layer of layers) {
        if (map.getLayer(layer.id)) continue;
        const beforeId = layer.id === 'fantasy-paper-grain'
          ? (map.getLayer('terrain-hillshade') ? 'terrain-hillshade' : undefined)
          : (map.getLayer('boundary-line') ? 'boundary-line' : map.getLayer('settlement-current-points') ? 'settlement-current-points' : undefined);
        map.addLayer(layer, beforeId);
      }
    }

    function setFantasyLayerVisibility(visible) {
      for (const layerId of FANTASY_LAYER_IDS) safeSetLayout(layerId, 'visibility', visible ? 'visible' : 'none');
      if (visible && moving) {
        for (const layerId of TRANSIENT_LAYER_IDS) safeSetLayout(layerId, 'visibility', 'none');
      }
    }

    function syncButton() {
      if (!button) return;
      button.classList.toggle('active', enabled);
      button.setAttribute('aria-pressed', String(enabled));
      button.title = enabled ? 'Выключить художественный рельеф' : 'Включить художественный рельеф';
    }

    function setEnabled(next, options = {}) {
      enabled = Boolean(next);
      host.dataset.fantasyStyle = enabled ? 'on' : 'off';
      host.classList.toggle('alan-map-fantasy-enabled', enabled);
      if (installed) {
        if (enabled) applyPalette(); else restorePalette();
        setFantasyLayerVisibility(enabled);
        map.triggerRepaint?.();
      }
      syncButton();
      if (options.persist !== false) safeStorageSet(STORAGE_KEY, enabled ? '1' : '0');
      if (options.announce !== false) setStatus(host, enabled ? 'Фэнтезийный стиль включён.' : 'Включён точный топографический стиль.');
      return enabled;
    }

    function injectToggle() {
      injectUiStyle();
      if (button || !host) return;
      const container = host.querySelector('.alan-map-layer-buttons');
      if (!container) return;
      button = document.createElement('button');
      button.type = 'button';
      button.dataset.fantasyToggle = '1';
      button.textContent = 'Фэнтези';
      button.setAttribute('aria-pressed', String(enabled));
      button.addEventListener('click', () => setEnabled(!enabled));
      container.appendChild(button);
      syncButton();
    }

    function onMoveStart() {
      moving = true;
      if (enabled) setFantasyLayerVisibility(true);
    }

    function onMoveEnd() {
      moving = false;
      if (enabled) setFantasyLayerVisibility(true);
    }

    function install() {
      if (installed || destroyed || !map?.isStyleLoaded?.()) return false;
      addImages();
      addSourceAndLayers();
      injectToggle();
      map.on('movestart', onMoveStart);
      map.on('moveend', onMoveEnd);
      installed = true;
      setEnabled(enabled, {persist:false,announce:false});
      setStatus(host, 'Гибридный фэнтезийный рельеф готов. Детализация меняется автоматически при приближении.');
      return true;
    }

    function destroy() {
      destroyed = true;
      try { map.off('movestart', onMoveStart); } catch (_) {}
      try { map.off('moveend', onMoveEnd); } catch (_) {}
      button?.remove();
      button = null;
    }

    function diagnostics() {
      return {
        version:VERSION,
        installed,
        enabled,
        moving,
        sourcePresent:Boolean(map?.getSource?.(SOURCE_ID)),
        layers:Object.fromEntries(FANTASY_LAYER_IDS.map((id) => [id, Boolean(map?.getLayer?.(id))])),
        ridge:ridgeDiagnostics
      };
    }

    injectToggle();
    host.dataset.fantasyStyle = enabled ? 'on' : 'off';
    return {install,setEnabled,destroy,diagnostics};
  }

  function wrapAlanMap() {
    const AlanMap = root.AlanMap;
    const relief = root.AlanFantasyRelief;
    if (!AlanMap?.mount || !relief?.buildRidgeCollection || AlanMap.__fantasyStyleWrapped) return false;
    const originalMount = AlanMap.mount;

    AlanMap.mount = function fantasyAwareMount(target, options = {}) {
      const host = resolveHost(target);
      const instance = originalMount.call(AlanMap, target, options);
      let controller = null;
      let pendingEnabled = null;
      let destroyed = false;

      const ensureController = () => {
        if (destroyed || controller || !host || !instance?.map) return controller;
        controller = createController({host,map:instance.map,data:options.data || root.ALAN_MAP_DATA,relief});
        if (pendingEnabled !== null) controller.setEnabled(pendingEnabled, {announce:false});
        controller.install();
        return controller;
      };

      if (host) {
        host.addEventListener('alan-map:ready', ensureController, {once:true});
        if (instance?.map?.isStyleLoaded?.()) root.requestAnimationFrame?.(ensureController);
      }

      instance.getFantasyDiagnostics = () => controller?.diagnostics() || {
        version:VERSION,installed:false,enabled:pendingEnabled ?? safeStorageGet(STORAGE_KEY) !== '0',moving:false,sourcePresent:false,layers:{},ridge:null
      };
      instance.setFantasyStyle = (value) => {
        pendingEnabled = Boolean(value);
        return ensureController()?.setEnabled(pendingEnabled) ?? pendingEnabled;
      };
      instance.isFantasyStyleEnabled = () => controller?.diagnostics().enabled ?? (pendingEnabled ?? safeStorageGet(STORAGE_KEY) !== '0');

      const originalDestroy = instance.destroy?.bind(instance);
      instance.destroy = () => {
        destroyed = true;
        controller?.destroy();
        return originalDestroy?.();
      };
      return instance;
    };

    AlanMap.__fantasyStyleWrapped = true;
    AlanMap.fantasyStyleVersion = VERSION;
    return true;
  }

  const api = {
    version:VERSION,
    storageKey:STORAGE_KEY,
    layerIds:[...FANTASY_LAYER_IDS],
    transientLayerIds:[...TRANSIENT_LAYER_IDS],
    createFantasyLayers,
    wrapAlanMap,
    __test:{paintOverrides:PAINT_OVERRIDES,layoutOverrides:LAYOUT_OVERRIDES}
  };

  if (typeof document !== 'undefined') wrapAlanMap();
  return api;
});
