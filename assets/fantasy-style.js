(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AlanFantasyStyle = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  const VERSION = '2.0.0';
  const STORAGE_KEY = 'alan-map-stage8.0-fantasy-style';
  const MOUNTAIN_SOURCE_ID = 'fantasy-mountain-points';
  const LANDMARK_SOURCE_ID = 'fantasy-landmarks';
  const REFERENCE_ZOOM = 7;
  const MAX_ZOOM = 14.3;
  const SCALE_AT_MAX_ZOOM = Number((2 ** (MAX_ZOOM - REFERENCE_ZOOM)).toFixed(6));
  const FANTASY_LAYER_IDS = Object.freeze([
    'fantasy-paper-grain',
    'fantasy-mountains-primary',
    'fantasy-mountains-secondary',
    'fantasy-mountains-spur',
    'fantasy-elbrus-massif'
  ]);
  const HIDDEN_IN_FANTASY = Object.freeze([
    'terrain-hillshade',
    'ridge-lines',
    'mountain-object-points',
    'osm-peak-points'
  ]);

  const PAINT_OVERRIDES = Object.freeze({
    background: {'background-color':'#1f211d'},
    'focus-paper': {'fill-color':'#ddc99f','fill-opacity':0.995},
    'osm-glacier-fill': {'fill-color':'#efe8d2','fill-opacity':0.58,'fill-outline-color':'#9da7a1'},
    'osm-snow-fill': {'fill-color':'#f6efd9','fill-opacity':0.48,'fill-outline-color':'#b4b3a6'},
    'forest-fill': {'fill-color':'#526044','fill-opacity':['interpolate',['linear'],['zoom'],7,0.27,9,0.34,12,0.40]},
    'forest-pattern': {'fill-opacity':['interpolate',['linear'],['zoom'],10.5,0.18,12,0.38]},
    'residential-base-fill': {'fill-color':'#d8c59e','fill-opacity':0.50},
    'osm-water-fill': {'fill-color':['match',['get','class'],'reservoir','#6d8e95','pond','#76979c','#70919a']},
    'osm-water-outline': {'line-color':'#4f7279'},
    'osm-river-water-fill': {'fill-color':'#6d9099'},
    'osm-river-halo': {'line-color':'#e5d3aa'},
    'osm-river-line': {'line-color':'#4f7b84'},
    'boundary-line': {'line-color':'#58442f'},
    'road-casing': {'line-color':'#d9c59a'},
    'road-main': {'line-color':['match',['get','class'],'motorway','#755335','trunk','#755335','primary','#86613f','secondary','#96764f','#a68b66']},
    'road-minor': {'line-color':'#a28a68'},
    'road-tunnel': {'line-color':'#705c45'},
    'road-bridge': {'line-color':'#745035'},
    'settlement-current-points': {'circle-color':'#ead9b5','circle-stroke-color':'#57422f'},
    'settlement-historic-points': {'circle-color':'#a9783e','circle-stroke-color':'#50331e'},
    'historic-object-points': {'circle-color':'#4e473d','circle-stroke-color':'#e0d2b1'},
    'mountain-passes': {'circle-color':'#40545e','circle-stroke-color':'#eadbb8'},
    'osm-river-label-main': {'text-color':'#385e64','text-halo-color':'#dfcda5'},
    'osm-river-label-regional': {'text-color':'#3f686e','text-halo-color':'#dfcda5'},
    'osm-water-labels': {'text-color':'#3b6268','text-halo-color':'#dfcda5'},
    'osm-peak-labels': {'text-color':'#293d48','text-halo-color':'#eadbb7'},
    'settlement-labels-current': {'text-color':'#3d3529','text-halo-color':'#e3d2aa'},
    'settlement-labels-local': {'text-color':'#5a3b22','text-halo-color':'#e3d2aa'},
    'historic-object-labels': {'text-color':'#423a30','text-halo-color':'#e3d2aa'},
    'mountain-object-labels': {'text-color':'#293d48','text-halo-color':'#e3d2aa'},
    'water-object-labels': {'text-color':'#3b6268','text-halo-color':'#e3d2aa'},
    'natural-object-labels': {'text-color':'#4d5d3e','text-halo-color':'#e3d2aa'},
    'mountain-pass-labels': {'text-color':'#364c57','text-halo-color':'#e3d2aa'},
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

  function setStatus(host, text, isError = false) {
    const status = host?.querySelector?.('[data-role="status"]');
    if (!status) return;
    status.textContent = text;
    status.classList.toggle('error', Boolean(isError));
  }

  function injectUiStyle() {
    if (typeof document === 'undefined' || document.getElementById('alan-fantasy-ui-style')) return;
    const style = document.createElement('style');
    style.id = 'alan-fantasy-ui-style';
    style.textContent = `
      .alan-map-shell[data-fantasy-style="on"] .maplibregl-canvas { filter: saturate(.90) contrast(1.035); }
      .alan-map-layer-buttons [data-fantasy-toggle] { position: relative; padding-left: 24px; }
      .alan-map-layer-buttons [data-fantasy-toggle]::before { content: "⌁"; position: absolute; left: 9px; top: 50%; transform: translateY(-54%); font-size: 15px; line-height: 1; }
      .alan-map-layer-buttons [data-fantasy-toggle].active { box-shadow: inset 0 0 0 1px rgba(243,221,174,.42), 0 2px 10px rgba(54,39,24,.18); }
      .alan-map-shell[data-fantasy-style="on"] .alan-map-toolbar { backdrop-filter: blur(10px) sepia(.10); }
      .alan-map-control-row.fantasy-relief-disabled { display: none; }
    `;
    document.head.appendChild(style);
  }

  function iconSizeExpression() {
    return [
      'interpolate',['exponential',2],['zoom'],
      REFERENCE_ZOOM,['get','fantasy_size_z7'],
      MAX_ZOOM,['*',['get','fantasy_size_z7'],SCALE_AT_MAX_ZOOM]
    ];
  }

  function mountainLayer(id, tier, minzoom) {
    return {
      id,
      type:'symbol',
      source:MOUNTAIN_SOURCE_ID,
      minzoom,
      filter:['==',['get','fantasy_tier'],tier],
      layout:{
        'icon-image':['get','fantasy_icon'],
        'icon-size':iconSizeExpression(),
        'icon-anchor':'bottom',
        'icon-rotation-alignment':'viewport',
        'icon-pitch-alignment':'viewport',
        'icon-keep-upright':true,
        'icon-allow-overlap':true,
        'icon-ignore-placement':true,
        'icon-padding':0,
        'symbol-z-order':'viewport-y'
      },
      paint:{'icon-opacity':0.98}
    };
  }

  function createFantasyLayers() {
    return [
      {
        id:'fantasy-paper-grain',
        type:'fill',
        source:'polygons',
        filter:['==',['get','alan_source'],'focus'],
        paint:{'fill-pattern':'fantasy-paper-grain','fill-opacity':0.34}
      },
      mountainLayer('fantasy-mountains-primary',1,7),
      mountainLayer('fantasy-mountains-secondary',2,7.8),
      mountainLayer('fantasy-mountains-spur',3,8.8),
      {
        id:'fantasy-elbrus-massif',
        type:'symbol',
        source:LANDMARK_SOURCE_ID,
        minzoom:7,
        filter:['==',['get','fantasy_landmark'],'elbrus'],
        layout:{
          'icon-image':'fantasy-elbrus',
          'icon-size':iconSizeExpression(),
          'icon-anchor':'bottom',
          'icon-rotation-alignment':'viewport',
          'icon-pitch-alignment':'viewport',
          'icon-keep-upright':true,
          'icon-allow-overlap':true,
          'icon-ignore-placement':true,
          'icon-padding':0,
          'symbol-z-order':'viewport-y'
        },
        paint:{'icon-opacity':1}
      }
    ];
  }

  function createController({host, map, data, relief, getRelief}) {
    let installed = false;
    let destroyed = false;
    let enabled = safeStorageGet(STORAGE_KEY) !== '0';
    let installationError = '';
    let mountainDiagnostics = null;
    let loadedImageCount = 0;
    let button = null;
    let previousMaxPitch = 60;
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
          if (!paintSnapshots.has(key)) paintSnapshots.set(key,safeGetPaint(layerId,property));
        }
      }
      for (const [layerId, properties] of Object.entries(LAYOUT_OVERRIDES)) {
        if (!map.getLayer(layerId)) continue;
        for (const property of Object.keys(properties)) {
          const key = `${layerId}:${property}`;
          if (!layoutSnapshots.has(key)) layoutSnapshots.set(key,safeGetLayout(layerId,property));
        }
      }
      for (const layerId of HIDDEN_IN_FANTASY) {
        if (!map.getLayer(layerId)) continue;
        const key = `${layerId}:visibility`;
        if (!layoutSnapshots.has(key)) layoutSnapshots.set(key,safeGetLayout(layerId,'visibility'));
      }
    }

    function applyPalette() {
      snapshotPalette();
      for (const [layerId, properties] of Object.entries(PAINT_OVERRIDES)) {
        for (const [property,value] of Object.entries(properties)) safeSetPaint(layerId,property,value);
      }
      for (const [layerId, properties] of Object.entries(LAYOUT_OVERRIDES)) {
        for (const [property,value] of Object.entries(properties)) safeSetLayout(layerId,property,value);
      }
    }

    function restorePalette() {
      for (const [key,value] of paintSnapshots.entries()) {
        const separator = key.indexOf(':');
        safeSetPaint(key.slice(0,separator),key.slice(separator + 1),value);
      }
      for (const [key,value] of layoutSnapshots.entries()) {
        const separator = key.indexOf(':');
        safeSetLayout(key.slice(0,separator),key.slice(separator + 1),value);
      }
    }

    function setFantasyLayerVisibility(visible) {
      for (const layerId of FANTASY_LAYER_IDS) safeSetLayout(layerId,'visibility',visible ? 'visible' : 'none');
    }

    function syncReliefControl() {
      const row = host.querySelector('[data-control="relief"]')?.closest('.alan-map-control-row');
      row?.classList.toggle('fantasy-relief-disabled',enabled);
    }

    function applyFlatMapMode() {
      try { previousMaxPitch = Number(map.getMaxPitch?.() ?? previousMaxPitch); } catch (_) {}
      try { map.stop(); } catch (_) {}
      try { map.setMaxPitch(0); } catch (_) {}
      try { if (Math.abs(map.getPitch()) > 0.01) map.jumpTo({pitch:0}); } catch (_) {}
      try { map.setTerrain(null); } catch (_) {}
      for (const layerId of HIDDEN_IN_FANTASY) safeSetLayout(layerId,'visibility','none');
    }

    function restoreTopographicMode() {
      try { map.setMaxPitch(Math.max(60,previousMaxPitch || 60)); } catch (_) {}
      try {
        map.setTerrain({source:'terrain-dem',exaggeration:Number(getRelief?.() || 2.55)});
      } catch (_) {}
      restorePalette();
      for (const layerId of HIDDEN_IN_FANTASY) safeSetLayout(layerId,'visibility','visible');
    }

    function syncButton() {
      if (!button) return;
      button.classList.toggle('active',enabled);
      button.setAttribute('aria-pressed',String(enabled));
      button.title = enabled ? 'Выключить плоскую рисованную карту' : 'Включить плоскую рисованную карту';
    }

    function setEnabled(next, options = {}) {
      enabled = Boolean(next);
      host.dataset.fantasyStyle = enabled ? 'on' : 'off';
      host.classList.toggle('alan-map-fantasy-enabled',enabled);
      if (installed) {
        if (enabled) {
          applyPalette();
          applyFlatMapMode();
        } else {
          restoreTopographicMode();
        }
        setFantasyLayerVisibility(enabled);
        map.triggerRepaint?.();
      }
      syncButton();
      syncReliefControl();
      if (options.persist !== false) safeStorageSet(STORAGE_KEY,enabled ? '1' : '0');
      if (options.announce !== false) setStatus(host,enabled ? 'Плоская рисованная карта включена.' : 'Включён точный топографический режим.');
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
      button.setAttribute('aria-pressed',String(enabled));
      button.addEventListener('click',() => setEnabled(!enabled));
      container.appendChild(button);
      syncButton();
      syncReliefControl();
    }

    function beforeLayerFor(layerId) {
      if (layerId === 'fantasy-paper-grain') {
        return map.getLayer('forest-fill') ? 'forest-fill' : map.getLayer('osm-water-fill') ? 'osm-water-fill' : undefined;
      }
      return map.getLayer('osm-water-fill') ? 'osm-water-fill' : map.getLayer('boundary-line') ? 'boundary-line' : map.getLayer('settlement-current-points') ? 'settlement-current-points' : undefined;
    }

    async function addImagesSourcesAndLayers() {
      const localImages = relief.createImages();
      for (const [id,image] of Object.entries(localImages)) {
        if (image && !map.hasImage(id)) map.addImage(id,image,{pixelRatio:2});
      }
      loadedImageCount = (await relief.loadImages(map)).length;
      const mountains = relief.buildMountainPointCollection(data?.ridges || {type:'FeatureCollection',features:[]});
      mountainDiagnostics = mountains.diagnostics;
      if (!map.getSource(MOUNTAIN_SOURCE_ID)) {
        map.addSource(MOUNTAIN_SOURCE_ID,{type:'geojson',data:{type:'FeatureCollection',features:mountains.features},maxzoom:14,tolerance:0.05,buffer:256});
      }
      if (!map.getSource(LANDMARK_SOURCE_ID)) {
        map.addSource(LANDMARK_SOURCE_ID,{type:'geojson',data:relief.createLandmarkCollection(data),maxzoom:14,tolerance:0.05,buffer:256});
      }
      for (const layer of createFantasyLayers()) {
        if (!map.getLayer(layer.id)) map.addLayer(layer,beforeLayerFor(layer.id));
      }
    }

    async function install() {
      if (installed) return true;
      if (destroyed || !map?.isStyleLoaded?.()) return false;
      try {
        await addImagesSourcesAndLayers();
        injectToggle();
        installed = true;
        installationError = '';
        setEnabled(enabled,{persist:false,announce:false});
        setStatus(host,'Alan Map 8.0 готова · непрерывные рисованные хребты загружены.');
        return true;
      } catch (error) {
        installationError = String(error?.message || error);
        setStatus(host,`Фэнтезийная карта не установлена: ${installationError}`,true);
        throw error;
      }
    }

    function destroy() {
      destroyed = true;
      button?.remove();
      button = null;
    }

    function diagnostics() {
      return {
        version:VERSION,
        installed,
        enabled,
        installationError,
        loadedImageCount,
        terrainActive:Boolean(map?.getTerrain?.()),
        pitch:Number(map?.getPitch?.() || 0),
        sourcePresent:Boolean(map?.getSource?.(MOUNTAIN_SOURCE_ID)),
        landmarkSourcePresent:Boolean(map?.getSource?.(LANDMARK_SOURCE_ID)),
        layers:Object.fromEntries(FANTASY_LAYER_IDS.map((id) => [id,Boolean(map?.getLayer?.(id))])),
        mountain:mountainDiagnostics
      };
    }

    injectToggle();
    host.dataset.fantasyStyle = enabled ? 'on' : 'off';
    return {install,setEnabled,destroy,diagnostics};
  }

  function wrapAlanMap() {
    const AlanMap = root.AlanMap;
    const relief = root.AlanFantasyRelief;
    if (!AlanMap?.mount || !relief?.buildMountainPointCollection || AlanMap.__fantasyStyleWrapped) return false;
    const originalMount = AlanMap.mount;

    AlanMap.mount = function fantasyAwareMount(target, options = {}) {
      const host = resolveHost(target);
      const instance = originalMount.call(AlanMap,target,options);
      let controller = null;
      let pendingEnabled = null;
      let destroyed = false;
      let idleRetryScheduled = false;
      let installPromise = null;
      let wrapperError = '';

      const ensureController = async () => {
        idleRetryScheduled = false;
        if (destroyed || !host || !instance?.map) return controller;
        if (!controller) {
          controller = createController({
            host,
            map:instance.map,
            data:options.data || root.ALAN_MAP_DATA,
            relief,
            getRelief:() => Number(instance.getState?.().relief || 2.55)
          });
          if (pendingEnabled !== null) controller.setEnabled(pendingEnabled,{announce:false});
        }
        if (!instance.map.isStyleLoaded()) {
          if (!idleRetryScheduled) {
            idleRetryScheduled = true;
            instance.map.once('idle',() => { void ensureController(); });
          }
          return controller;
        }
        if (!installPromise) {
          installPromise = controller.install().catch((error) => {
            wrapperError = String(error?.message || error);
            console.error('Alan fantasy style installation failed:',error);
            return false;
          }).finally(() => { installPromise = null; });
        }
        const installed = await installPromise;
        if (installed) wrapperError = '';
        return controller;
      };

      if (host) host.addEventListener('alan-map:ready',() => { void ensureController(); },{once:true});
      if (instance?.map) {
        idleRetryScheduled = true;
        instance.map.once('idle',() => { void ensureController(); });
      }

      instance.getFantasyDiagnostics = () => {
        const diagnostics = controller?.diagnostics() || {
          version:VERSION,installed:false,enabled:pendingEnabled ?? safeStorageGet(STORAGE_KEY) !== '0',installationError:'',loadedImageCount:0,
          terrainActive:false,pitch:0,sourcePresent:false,landmarkSourcePresent:false,layers:{},mountain:null
        };
        return {...diagnostics,wrapperError,idleRetryScheduled,installing:Boolean(installPromise)};
      };
      instance.setFantasyStyle = async (value) => {
        pendingEnabled = Boolean(value);
        const activeController = await ensureController();
        return activeController?.setEnabled(pendingEnabled) ?? pendingEnabled;
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
    defaultEnabled:true,
    storageKey:STORAGE_KEY,
    layerIds:[...FANTASY_LAYER_IDS],
    hiddenLayerIds:[...HIDDEN_IN_FANTASY],
    scaleAtMaxZoom:SCALE_AT_MAX_ZOOM,
    createFantasyLayers,
    wrapAlanMap,
    __test:{paintOverrides:PAINT_OVERRIDES,layoutOverrides:LAYOUT_OVERRIDES,iconSizeExpression}
  };

  if (typeof document !== 'undefined') wrapAlanMap();
  return api;
});
