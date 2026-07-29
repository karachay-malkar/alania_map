

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(typeof globalThis !== 'undefined' ? globalThis : root);
  else root.AlanMap = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  const VERSION = '8.0';
  const DEFAULT_STORAGE_KEY = 'alan-map-stage8.0-view';
  const STATE_SCHEMA_VERSION = 1;
  const STATE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  const LEGACY_STORAGE_KEYS = [
    'alan-map-stage7.0.22-view',
    'alan-map-stage7.0.21-view',
    'alan-map-stage7.0.20-view',
    'alan-map-stage7.0.19-view', 'alan-map-stage7.0.18-view', 'alan-map-stage7.0.17-view', 'alan-map-stage7.0.16-view', 'alan-map-stage7.0.15-view', 'alan-map-stage7.0.14-view', 'alan-map-stage7.0.12-view',
    'alan-map-stage7.0.11-view', 'alan-map-stage7.0.10-view',
    'alan-map-stage7.0.9-view', 'alan-map-stage7.0.8-view',
    'alan-map-stage7.0.7.1-view', 'alan-map-stage7.0.7-view',
    'alan-map-stage7.0.6-view', 'alan-map-stage7.0.5-view',
    'alan-map-stage7.0.4-view', 'alan-map-stage7.0.3-view',
    'alan-map-stage7.0.2-view', 'alan-map-stage7.0.1-view',
    'alan-map-stage7.0-view', 'alan-til-map-view'
  ];
  const VISIBILITY_ZOOM = Object.freeze({DISTANT: 7.0, MEDIUM: 8.0, CLOSE: 10.0, DETAIL: 12.0});
  const LABEL_ZOOM = Object.freeze({REGIONAL_FADE_START: 9.5, REGIONAL_MAX: 10.0});
  const CAMERA_LIMITS = Object.freeze({minZoom: 7.0, maxZoom: 14.3, minPitch: 0, maxPitch: 60});
  const POINT_STYLE = Object.freeze({
    large:Object.freeze({diameter:10, radius:4, strokeWidth:1}),
    small:Object.freeze({diameter:7, radius:2.5, strokeWidth:1})
  });
  const OBJECT_PRESENTATION = Object.freeze({
    fiveThousanders:Object.freeze({minZoom:7, pointStyle:'large'}),
    currentSettlements:Object.freeze({minZoom:8, pointStyle:'large'}),
    mountainObjects:Object.freeze({minZoom:8, pointStyle:'small'}),
    passes:Object.freeze({minZoom:8, pointStyle:'small'}),
    peaks:Object.freeze({minZoom:8, pointStyle:'small'}),
    historicSettlements:Object.freeze({minZoom:10, pointStyle:'large'}),
    historicObjects:Object.freeze({minZoom:10, pointStyle:'small'}),
    waterObjects:Object.freeze({minZoom:10, pointStyle:'small'}),
    naturalObjects:Object.freeze({minZoom:10, pointStyle:'small'}),
    modernObjects:Object.freeze({minZoom:10, pointStyle:'small'})
  });

  function requireElement(target) {
    if (typeof target === 'string') {
      const element = document.querySelector(target);
      if (!element) throw new Error(`AlanMap: container not found: ${target}`);
      return element;
    }
    if (typeof HTMLElement !== 'undefined' && target instanceof HTMLElement) return target;
    throw new Error('AlanMap: mount target must be a selector or HTMLElement.');
  }

  function safeStorageGet(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }

  function safeStorageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (_) {}
  }

  function safeStorageRemove(key) {
    try { localStorage.removeItem(key); } catch (_) {}
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[character]);
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function normalizeBearing(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 180;
    return ((numeric % 360) + 360) % 360;
  }

  function expandedBounds(bounds) {
    return [
      Number(bounds?.[0]) - 0.05,
      Number(bounds?.[1]) - 0.05,
      Number(bounds?.[2]) + 0.05,
      Number(bounds?.[3]) + 0.05
    ];
  }

  function softCameraBounds(bounds) {
    return [Number(bounds?.[0]), Number(bounds?.[1]), Number(bounds?.[2]), Number(bounds?.[3])];
  }

  function normalizePersistedState(candidate, defaults, bounds) {
    if (!candidate || typeof candidate !== 'object') return null;
    const center = Array.isArray(candidate.center) ? candidate.center.map(Number) : null;
    const safeBounds = expandedBounds(bounds);
    if (
      !center || center.length !== 2 || !center.every(Number.isFinite) ||
      center[0] < safeBounds[0] || center[0] > safeBounds[2] ||
      center[1] < safeBounds[1] || center[1] > safeBounds[3]
    ) return null;

    const zoom = Number(candidate.zoom);
    const pitch = Number(candidate.pitch);
    const relief = Number(candidate.relief);
    const rivers = Number(candidate.rivers);
    if (
      !Number.isFinite(zoom) || zoom < CAMERA_LIMITS.minZoom || zoom > CAMERA_LIMITS.maxZoom ||
      !Number.isFinite(pitch) || pitch < CAMERA_LIMITS.minPitch || pitch > CAMERA_LIMITS.maxPitch ||
      !Number.isFinite(relief) || relief < 1 || relief > 4.2 ||
      !Number.isFinite(rivers) || rivers < 0.7 || rivers > 2.2
    ) return null;

    const booleanValue = (key) => typeof candidate[key] === 'boolean' ? candidate[key] : defaults[key];
    return {
      ...defaults,
      center,
      zoom,
      bearing: normalizeBearing(candidate.bearing),
      pitch,
      relief,
      rivers,
      roads: booleanValue('roads'),
      riversVisible: booleanValue('riversVisible'),
      regions: booleanValue('regions'),
      labels: booleanValue('labels'),
      modern: booleanValue('modern'),
      toolbarCollapsed: booleanValue('toolbarCollapsed')
    };
  }

  function resolveQualityProfile(options = {}, environment = {}) {
    const requested = String(options.qualityMode || 'auto').toLowerCase();
    const devicePixelRatio = Number(environment.devicePixelRatio || 1);
    const deviceMemory = Number(environment.deviceMemory || 0);
    const hardwareConcurrency = Number(environment.hardwareConcurrency || 0);
    let mode = requested;
    if (!['low', 'balanced', 'high'].includes(mode)) {
      const explicitlyWeak =
        (deviceMemory > 0 && deviceMemory <= 2) ||
        (hardwareConcurrency > 0 && hardwareConcurrency <= 2);
      mode = explicitlyWeak ? 'low' : 'balanced';
    }
    const profiles = {
      low: {mode: 'low', pixelRatio: 1.25, maxTileCacheZoomLevels: 3, maxTileCacheSize: 64, maxCanvasSize: 6144, antialias: false, forestPattern: false},
      balanced: {mode: 'balanced', pixelRatio: 1.75, maxTileCacheZoomLevels: 4, maxTileCacheSize: 80, maxCanvasSize: 6144, antialias: false, forestPattern: true},
      high: {mode: 'high', pixelRatio: 2, maxTileCacheZoomLevels: 5, maxTileCacheSize: 96, maxCanvasSize: 8192, antialias: true, forestPattern: true}
    };
    return {...profiles[mode], detectedDevicePixelRatio: devicePixelRatio};
  }

  function taggedFeatureCollection(entries) {
    const features = [];
    for (const [tag, collection] of entries) {
      for (const feature of collection?.features || []) {
        features.push({
          ...feature,
          properties: {...(feature.properties || {}), alan_source: tag}
        });
      }
    }
    return {type: 'FeatureCollection', features};
  }

  function buildRuntimeSourceData(data) {
    return {
      polygons: taggedFeatureCollection([
        ['focus', data.focus],
        ['glaciers', data.glaciers],
        ['elbrusSnow', data.elbrusSnow],
        ['peakSnow', data.peakSnow]
      ]),
      lines: taggedFeatureCollection([
        ['rivers', data.rivers],
        ['ridges', data.ridges],
        ['regionalLabels', data.regionalLabels],
        ['boundaries', data.boundaries]
      ]),
      points: taggedFeatureCollection([
        ['objects', data.objects],
        ['modernObjects', data.modernObjects],
        ['peaks', data.peaks],
        ['highPeaks', data.highPeaks],
        ['passes', data.passes]
      ])
    };
  }

  function mapFramePointCount(data) {
    const geometry = data?.mapFrame?.features?.[0]?.geometry;
    const ring = geometry?.type === 'Polygon'
      ? geometry.coordinates?.[0]
      : geometry?.type === 'MultiPolygon'
        ? geometry.coordinates?.flat(1)?.sort((a, b) => b.length - a.length)?.[0]
        : null;
    if (!Array.isArray(ring)) return 0;
    const closed = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
    return closed ? ring.length - 1 : ring.length;
  }

  function sourceFilter(tag) {
    return ['==', ['get', 'alan_source'], tag];
  }

  function residentialLayerDefinitions() {
    const residentialClassFilter = ['any', ['==', ['get', 'class'], 'residential'], ['==', ['get', 'subclass'], 'residential']];
    return [
      {
        id:'residential-base-fill',
        type:'fill',
        source:'openmaptiles',
        'source-layer':'landuse',
        minzoom:VISIBILITY_ZOOM.DISTANT,
        filter:residentialClassFilter,
        paint:{'fill-color':'#ffffff','fill-opacity':0.5}
      }
    ];
  }

  function pointPaint(styleKey, color, strokeColor, opacity = 1) {
    const style = POINT_STYLE[styleKey];
    return {
      'circle-radius':style.radius,
      'circle-color':color,
      'circle-stroke-color':strokeColor,
      'circle-stroke-width':style.strokeWidth,
      'circle-opacity':opacity,
      'circle-pitch-alignment':'viewport',
      'circle-pitch-scale':'viewport'
    };
  }

  function supplementalLabelLayerDefinitions(labelName) {
    return [
      {id:'water-object-labels',type:'symbol',source:'points',minzoom:OBJECT_PRESENTATION.waterObjects.minZoom,filter:['all',sourceFilter('objects'),['==',['get','visible'],1],['==',['get','object_type'],'water']],layout:{'text-field':labelName,'text-font':['Noto Sans Regular'],'text-size':9.5,'text-offset':[0,1.05],'text-anchor':'top','text-allow-overlap':false},paint:{'text-color':'#126083','text-halo-color':'#f4ead6','text-halo-width':1.4}},
      {id:'natural-object-labels',type:'symbol',source:'points',minzoom:OBJECT_PRESENTATION.naturalObjects.minZoom,filter:['all',sourceFilter('objects'),['==',['get','visible'],1],['==',['get','object_type'],'natural']],layout:{'text-field':labelName,'text-font':['Noto Sans Regular'],'text-size':9.5,'text-offset':[0,1.0],'text-anchor':'top','text-allow-overlap':false},paint:{'text-color':'#566b50','text-halo-color':'#f4ead6','text-halo-width':1.35}},
      {id:'mountain-pass-labels',type:'symbol',source:'points',minzoom:OBJECT_PRESENTATION.passes.minZoom,filter:['all',sourceFilter('passes'),['==',['get','visible'],1]],layout:{'text-field':labelName,'text-font':['Noto Sans Regular'],'text-size':9.5,'text-offset':[0,1.05],'text-anchor':'top','text-allow-overlap':false},paint:{'text-color':'#62584d','text-halo-color':'#f4ead6','text-halo-width':1.4}}
    ];
  }

  function markup() {
    return `
      <div class="alan-map-canvas" data-role="map" aria-label="Интерактивная иллюстрированная карта"></div>
      <div class="alan-map-loading" data-role="loading"><div class="alan-map-loading-card"><div class="alan-map-spinner"></div><div class="alan-map-loading-title">Загрузка карты</div><div class="alan-map-loading-text" data-role="loading-text">Подготавливаются плоская карта и непрерывные рисованные хребты.</div></div></div>
      <div class="alan-map-toolbar" data-role="toolbar">
        <div class="alan-map-toolbar-head"><div class="alan-map-toolbar-titles"><div class="alan-map-title">Alan Map · 8.0</div><div class="alan-map-subtitle">Плоская иллюстрированная карта · автономные векторные данные</div></div><button class="alan-map-collapse-button" data-action="toggle-toolbar" type="button" aria-expanded="true" aria-label="Скрыть панель">−</button></div>
        <div class="alan-map-buttons alan-map-action-buttons"><button data-action="reset" type="button">Сброс</button><button class="alan-map-fullscreen-button" data-action="fullscreen" type="button" aria-pressed="false">На весь экран</button></div>
        <div class="alan-map-buttons alan-map-layer-buttons"><button data-toggle="roads" class="active" type="button">Дороги</button><button data-toggle="rivers" class="active" type="button">Вода</button><button data-toggle="regions" class="active" type="button">Районы</button><button data-toggle="labels" class="active" type="button">Подписи</button><button data-toggle="modern" type="button">Современные</button></div>
        <div class="alan-map-control-row"><label>Рельеф</label><input data-control="relief" type="range" min="1" max="4.2" step="0.05" value="2.55"><span data-value="relief" class="alan-map-value">2.6×</span></div>
        <div class="alan-map-control-row"><label>Реки</label><input data-control="rivers" type="range" min="0.7" max="2.2" step="0.05" value="1.25"><span data-value="rivers" class="alan-map-value">1.25×</span></div>
      </div>
      <div class="alan-map-legend" data-role="legend"><div data-legend-item="settlements"><span class="alan-map-swatch legend-settlements"></span>населённые пункты</div><div data-legend-item="history"><span class="alan-map-swatch legend-history"></span>исторические объекты</div><div data-legend-item="mountains"><span class="alan-map-swatch legend-mountains"></span>горы и хребты</div><div data-legend-item="water"><span class="alan-map-swatch legend-water"></span>вода</div><div data-legend-item="land"><span class="alan-map-swatch legend-land"></span>леса, снег и ледники</div></div>
      <div class="alan-map-dpad" data-role="dpad" aria-label="Перемещение карты"><button class="up" data-pan="0,-120" type="button">▲</button><button class="left" data-pan="-120,0" type="button">◀</button><button class="home" data-action="north" title="Ориентация север–юг" type="button">N↓</button><button class="right" data-pan="120,0" type="button">▶</button><button class="down" data-pan="0,120" type="button">▼</button></div>
      <div class="alan-map-status" data-role="status">Подготовка интерактивной карты…</div>
      <div class="alan-map-fallback" data-role="fallback"><div class="alan-map-fallback-card"><h2>Карта не запустилась</h2><p data-role="fallback-message">Проверьте поддержку WebGL и доступ к интернету.</p></div></div>`;
  }

  function mount(target, options = {}) {
    const host = requireElement(target);
    const maplibregl = options.maplibregl || root.maplibregl;
    const data = options.data || root.ALAN_MAP_DATA;
    const storageKey = options.storageKey || DEFAULT_STORAGE_KEY;
    const natureEnabled = options.natureEnabled !== false;
    const loadingTimeoutMs = Number(options.loadingTimeoutMs || 15000);
    const environment = {
      devicePixelRatio: root.devicePixelRatio || 1,
      deviceMemory: root.navigator?.deviceMemory || 0,
      hardwareConcurrency: root.navigator?.hardwareConcurrency || 0,
      viewportWidth: host.clientWidth || root.innerWidth || 900
    };
    const qualityProfile = resolveQualityProfile(options, environment);
    const runtimeSources = buildRuntimeSourceData(data);
    const cameraSoftBounds = softCameraBounds(data.bounds);

    const hadTabIndex = host.hasAttribute('tabindex');
    host.classList.add('alan-map-shell');
    host.dataset.quality = qualityProfile.mode;
    if (!hadTabIndex) host.tabIndex = 0;
    host.innerHTML = markup();
    if (options.showToolbar === false) host.classList.add('alan-map-no-toolbar');
    if (options.showLegend === false) host.classList.add('alan-map-no-legend');
    if (options.showDpad === false) host.classList.add('alan-map-no-dpad');

    const element = (selector) => host.querySelector(selector);
    const mapElement = element('[data-role="map"]');
    const loadingElement = element('[data-role="loading"]');
    const loadingText = element('[data-role="loading-text"]');
    const fallbackElement = element('[data-role="fallback"]');
    const fallbackMessage = element('[data-role="fallback-message"]');
    const statusElement = element('[data-role="status"]');
    const reliefInput = element('[data-control="relief"]');
    const riverInput = element('[data-control="rivers"]');
    const reliefValue = element('[data-value="relief"]');
    const riverValue = element('[data-value="rivers"]');
    const toolbarElement = element('[data-role="toolbar"]');
    const collapseButton = element('[data-action="toggle-toolbar"]');
    const fullscreenButton = element('[data-action="fullscreen"]');
    const toggleButtons = Object.fromEntries(['roads','rivers','regions','labels','modern'].map((name) => [name, element(`[data-toggle="${name}"]`)]));

    const defaults = {
      center: data.center,
      zoom: 7.0,
      bearing: 180,
      pitch: 0,
      relief: 2.55,
      rivers: 1.25,
      roads: true,
      riversVisible: true,
      regions: true,
      labels: true,
      modern: false,
      toolbarCollapsed: environment.viewportWidth <= 480
    };

    const layerIds = {
      roads: ['road-casing','road-main','road-minor','road-tunnel','road-bridge'],
      riverGeometry: ['osm-river-water-fill','osm-river-halo','osm-river-line'],
      riverLabels: ['osm-river-label-main','osm-river-label-regional'],
      regions: ['regional-labels-fallback'],
      modernGeometry: ['modern-objects'],
      modernLabels: ['modern-labels'],
      labels: ['osm-water-labels','osm-peak-labels','settlement-labels-current','settlement-labels-local','historic-object-labels','mountain-object-labels','water-object-labels','natural-object-labels','mountain-pass-labels'],
      detailPoints: ['settlement-current-points','settlement-historic-points','historic-object-points','mountain-object-points','water-object-points','natural-object-points','mountain-passes','osm-peak-points'],
      secondaryLabels: ['historic-object-labels','mountain-object-labels','water-object-labels','natural-object-labels','mountain-pass-labels','osm-peak-labels']
    };

    let map = null;
    let saveTimer = null;
    let loadingTimer = null;
    let reliefFrame = null;
    let destroyed = false;
    let regionalLabels3d = null;
    let regionalLabels3dFailed = false;
    let ready = false;
    let readyFrame = null;
    let resizeFrame = null;
    let resizeObserver = null;
    let correctingCamera = false;
    let moving = false;
    let regionalLabelsInitializationScheduled = false;
    let api = null;
    let stateMigrationNeeded = false;
    const sourceErrors = new Map();
    const sourceLoaded = new Set();
    let activeDemTemplate = '';
    let activeDemMode = 'local-pmtiles';
    let activeVectorMode = 'local-pmtiles';
    const uiAbort = new AbortController();
    let state = loadState();

    function parseStateRecord(raw, isCurrent) {
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        if (isCurrent && parsed?.schemaVersion === STATE_SCHEMA_VERSION) {
          const savedAt = Number(parsed.savedAt);
          if (!Number.isFinite(savedAt) || Date.now() - savedAt > STATE_TTL_MS) return null;
          return normalizePersistedState(parsed.state, defaults, data.bounds);
        }
        const legacyCandidate = parsed?.state && typeof parsed.state === 'object' ? parsed.state : parsed;
        return normalizePersistedState(legacyCandidate, defaults, data.bounds);
      } catch (_) {
        return null;
      }
    }

    function loadState() {
      const currentRaw = safeStorageGet(storageKey);
      const currentState = parseStateRecord(currentRaw, true);
      if (currentState) return currentState;
      if (currentRaw) safeStorageRemove(storageKey);
      for (const key of LEGACY_STORAGE_KEYS) {
        const raw = safeStorageGet(key);
        if (!raw) continue;
        const legacyState = parseStateRecord(raw, false);
        if (legacyState) {
          stateMigrationNeeded = true;
          return legacyState;
        }
      }
      return {...defaults};
    }

    function setStatus(text, isError = false) {
      statusElement.textContent = text;
      statusElement.classList.toggle('error', isError);
      if (typeof options.onStatus === 'function') options.onStatus({text, isError});
    }

    function updateNetworkStatus() {
      if (sourceErrors.size) {
        const sources = [...sourceErrors.keys()].join(', ');
        setStatus(`Карта работает. Ошибки сетевых источников: ${sources}.`, true);
        return;
      }
      const vectorReady = !natureEnabled || sourceLoaded.has('openmaptiles');
      if (vectorReady) setStatus(`Alan Map ${VERSION} готова · профиль ${qualityProfile.mode}.`);
      else setStatus('Базовая карта готова; локальные природные слои ещё загружаются.');
    }

    function showFallback(message) {
      clearTimeout(loadingTimer);
      loadingElement.classList.add('hidden');
      fallbackMessage.textContent = message;
      fallbackElement.style.display = 'grid';
      host.dispatchEvent(new CustomEvent('alan-map:error', {detail: {message}}));
      if (typeof options.onError === 'function') options.onError(new Error(message));
    }

    function saveStateNow() {
      if (!map || destroyed) return;
      const center = map.getCenter();
      state = {
        ...state,
        center: [center.lng, center.lat],
        zoom: clamp(map.getZoom(), CAMERA_LIMITS.minZoom, CAMERA_LIMITS.maxZoom),
        bearing: normalizeBearing(map.getBearing()),
        pitch: clamp(map.getPitch(), CAMERA_LIMITS.minPitch, CAMERA_LIMITS.maxPitch),
        relief: Number(reliefInput.value),
        rivers: Number(riverInput.value),
        roads: toggleButtons.roads.classList.contains('active'),
        riversVisible: toggleButtons.rivers.classList.contains('active'),
        regions: toggleButtons.regions.classList.contains('active'),
        labels: toggleButtons.labels.classList.contains('active'),
        modern: toggleButtons.modern.classList.contains('active'),
        toolbarCollapsed: toolbarElement.classList.contains('collapsed')
      };
      safeStorageSet(storageKey, JSON.stringify({schemaVersion: STATE_SCHEMA_VERSION, savedAt: Date.now(), state}));
      if (typeof options.onStateChange === 'function') options.onStateChange({...state});
    }

    function queueSave() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveStateNow, 180);
    }

    function riverTierValue(main, regional, local) {
      return ['match',['get','tier'],1,main,2,regional,local];
    }

    function riverWidth(scale, halo = false) {
      const scaledTierValue = (main, regional, local) => riverTierValue(
        main * Number(scale) + (halo ? 3.0 : 0),
        regional * Number(scale) + (halo ? 2.2 : 0),
        local * Number(scale) + (halo ? 1.6 : 0)
      );
      return [
        'interpolate',['linear'],['zoom'],
        7.0,scaledTierValue(1.15,0.15,0.03),
        8.2,scaledTierValue(2.1,0.35,0.05),
        9.0,scaledTierValue(2.45,1.15,0.08),
        11.2,scaledTierValue(3.5,2.3,0.72),
        14.3,scaledTierValue(4.6,3.2,2.2)
      ];
    }

    function riverOpacity(halo = false) {
      const main = halo ? 0.88 : 0.98;
      const regional = halo ? 0.82 : 0.94;
      const local = halo ? 0.70 : 0.82;
      return [
        'interpolate',['linear'],['zoom'],
        7.0,riverTierValue(main,0,0),
        8.2,riverTierValue(main,0,0),
        8.9,riverTierValue(main,regional,0),
        10.4,riverTierValue(main,regional,0),
        11.2,riverTierValue(main,regional,local)
      ];
    }

    function coreStyle() {
      const labelName = ['coalesce',['get','name_alan_latin'],['get','name_ru'],['get','name_map'],['get','name']];
      const demTileSize = Number(data.regionalDem?.tileSize || 256);
      const localArchiveUrl = (archivePath) => `pmtiles://${new URL(archivePath, document.baseURI).href}`;
      const demTemplate = localArchiveUrl(data.regionalDem.archivePath);
      const vectorTemplate = localArchiveUrl(data.regionalVector.archivePath);
      const glyphsTemplate = new URL('data/fonts/', document.baseURI).href + '{fontstack}/{range}.pbf';
      activeDemTemplate = demTemplate;
      activeDemMode = 'local-pmtiles';
      activeVectorMode = 'local-pmtiles';
      const sources = {
        'terrain-dem': {type:'raster-dem',url:demTemplate,tileSize:demTileSize,minzoom:Number(data.regionalDem.minzoom),maxzoom:Number(data.regionalDem.maxzoom),encoding:'terrarium',bounds:data.regionalDem.bounds,attribution:data.regionalDem.attribution},
        polygons: {type:'geojson',data:runtimeSources.polygons,maxzoom:14,tolerance:0.25,buffer:64},
        lines: {type:'geojson',data:runtimeSources.lines,maxzoom:14,tolerance:0.35,buffer:128},
        points: {type:'geojson',data:runtimeSources.points,maxzoom:14,tolerance:0.1,buffer:64}
      };
      if (natureEnabled) sources.openmaptiles = {type:'vector',url:vectorTemplate,minzoom:Number(data.regionalVector.minzoom),maxzoom:Number(data.regionalVector.maxzoom),bounds:data.regionalVector.bounds,attribution:data.regionalVector.attribution};

      const baseLayers = [
        {id:'background',type:'background',paint:{'background-color':'#25282a'}},
        {id:'focus-paper',type:'fill',source:'polygons',filter:sourceFilter('focus'),paint:{'fill-color':'#eadfc8','fill-opacity':0.98}},
        {id:'terrain-hillshade',type:'hillshade',source:'terrain-dem',layout:{'visibility':'none'},paint:{'hillshade-illumination-anchor':'viewport','hillshade-illumination-direction':315,'hillshade-exaggeration':0.62,'hillshade-shadow-color':'#294252','hillshade-highlight-color':'#f8efd9','hillshade-accent-color':'#806b50'}},
        {id:'ridge-lines',type:'line',source:'lines',layout:{'visibility':'none'},filter:['all',sourceFilter('ridges'),['==',['get','visible'],1]],paint:{'line-color':'#675f55','line-width':['interpolate',['linear'],['zoom'],6,0.48,10,1.12],'line-opacity':['interpolate',['linear'],['zoom'],6,0.24,10,0.40],'line-dasharray':[1.2,2.1]}}
      ];

      const natureLayers = [];
      const roadLayers = [];
      if (natureEnabled) {
        const roadClassFilter = ['match',['get','class'],['motorway','trunk','primary','secondary','tertiary'],true,false];
        const majorRoadAboveGround = ['all',roadClassFilter,['!=',['get','brunnel'],'tunnel']];
        const majorRoadTunnel = ['all',roadClassFilter,['==',['get','brunnel'],'tunnel']];
        const majorRoadBridge = ['all',roadClassFilter,['==',['get','brunnel'],'bridge']];
        natureLayers.push(
          {id:'osm-glacier-fill',type:'fill',source:'openmaptiles','source-layer':'landcover',minzoom:VISIBILITY_ZOOM.DISTANT,filter:['all',['==',['get','class'],'ice'],['==',['get','subclass'],'glacier']],paint:{'fill-color':'#f2f8f7','fill-opacity':['interpolate',['linear'],['zoom'],7,0.72,9,0.90,12,0.94],'fill-outline-color':'#8fb6c1'}},
          {id:'osm-snow-fill',type:'fill',source:'openmaptiles','source-layer':'landcover',minzoom:VISIBILITY_ZOOM.DISTANT,filter:['all',['==',['get','class'],'ice'],['==',['get','subclass'],'snow']],paint:{'fill-color':'#fbfdfc','fill-opacity':['interpolate',['linear'],['zoom'],7,0.58,9,0.78,12,0.86],'fill-outline-color':'#b8ced3'}},
          {id:'forest-fill',type:'fill',source:'openmaptiles','source-layer':'landcover',minzoom:VISIBILITY_ZOOM.DISTANT,filter:['==',['get','class'],'wood'],paint:{'fill-color':'#647b5b','fill-opacity':['interpolate',['linear'],['zoom'],7.0,0.20,8,0.26,11,0.32]}},
          {id:'forest-pattern',type:'fill',source:'openmaptiles','source-layer':'landcover',minzoom:10.5,filter:['==',['get','class'],'wood'],layout:{'visibility':qualityProfile.forestPattern?'visible':'none'},paint:{'fill-pattern':'forest-canopy','fill-opacity':['interpolate',['linear'],['zoom'],10.5,0.28,12,0.52]}},
          ...residentialLayerDefinitions(),
          {id:'osm-water-fill',type:'fill',source:'openmaptiles','source-layer':'water',minzoom:VISIBILITY_ZOOM.DISTANT,filter:['in',['get','class'],['literal',['lake','reservoir','pond']]],paint:{'fill-color':['match',['get','class'],'reservoir','#659db2','pond','#75a8b5','#6aa7bb'],'fill-opacity':['interpolate',['linear'],['zoom'],7.0,0.62,9.2,0.72,12,0.78]}},
          {id:'osm-water-outline',type:'line',source:'openmaptiles','source-layer':'water',minzoom:VISIBILITY_ZOOM.DISTANT,filter:['in',['get','class'],['literal',['lake','reservoir','pond']]],paint:{'line-color':'#79b6c9','line-width':['interpolate',['linear'],['zoom'],7.0,0.75,11,1.65],'line-opacity':['interpolate',['linear'],['zoom'],7.0,0.72,7.5,0.94]}},
          {id:'osm-river-water-fill',type:'fill',source:'openmaptiles','source-layer':'water',minzoom:VISIBILITY_ZOOM.DISTANT,filter:['==',['get','class'],'river'],paint:{'fill-color':'#6aa7bb','fill-opacity':['interpolate',['linear'],['zoom'],7,0.50,10,0.68,13,0.76]}}
        );
        roadLayers.push(
          {id:'road-casing',type:'line',source:'openmaptiles','source-layer':'transportation',minzoom:VISIBILITY_ZOOM.DISTANT,filter:majorRoadAboveGround,layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#f0dfbd','line-width':['interpolate',['linear'],['zoom'],7.0,0.35,8.0,1.45,10,4.8,13,8.1],'line-opacity':['interpolate',['linear'],['zoom'],7.0,0,7.45,0.35,8.0,0.9]}},
          {id:'road-main',type:'line',source:'openmaptiles','source-layer':'transportation',minzoom:VISIBILITY_ZOOM.DISTANT,filter:majorRoadAboveGround,layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':['match',['get','class'],'motorway','#9b7550','trunk','#9b7550','primary','#a98058','secondary','#b59368','#bea57e'],'line-width':['interpolate',['linear'],['zoom'],7.0,0.12,8.0,0.45,10,2.2,13,4.2],'line-opacity':['interpolate',['linear'],['zoom'],7.0,0,7.45,0.35,8.0,0.92]}},
          {id:'road-minor',type:'line',source:'openmaptiles','source-layer':'transportation',minzoom:9.5,filter:['==',['get','class'],'minor'],layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#b59d79','line-width':['interpolate',['linear'],['zoom'],9.5,0.15,10.0,0.45,13,1.6],'line-opacity':['interpolate',['linear'],['zoom'],9.5,0,10.2,0.48]}},
          {id:'road-tunnel',type:'line',source:'openmaptiles','source-layer':'transportation',minzoom:VISIBILITY_ZOOM.DISTANT,filter:majorRoadTunnel,paint:{'line-color':'#8b765b','line-width':['interpolate',['linear'],['zoom'],7.0,0.25,8.0,0.8,13,2.8],'line-dasharray':[2,2],'line-opacity':['interpolate',['linear'],['zoom'],7.0,0,7.6,0.72]}},
          {id:'road-bridge',type:'line',source:'openmaptiles','source-layer':'transportation',minzoom:VISIBILITY_ZOOM.DISTANT,filter:majorRoadBridge,paint:{'line-color':'#8b6544','line-width':['interpolate',['linear'],['zoom'],7.0,0.3,8.0,1.0,13,3.8],'line-opacity':['interpolate',['linear'],['zoom'],7.0,0,7.6,0.95]}}
        );
      }

      const lineLayers = [
        {id:'boundary-line',type:'line',source:'lines',minzoom:VISIBILITY_ZOOM.DISTANT,filter:sourceFilter('boundaries'),layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#554d45','line-width':['interpolate',['linear'],['zoom'],7.0,1.0,8.5,1.5,14.3,2.2],'line-opacity':0.9}},
        ...roadLayers,
        ...(natureEnabled ? [
          {id:'osm-river-halo',type:'line',source:'openmaptiles','source-layer':'waterway',minzoom:VISIBILITY_ZOOM.DISTANT,layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#f4ead6','line-width':riverWidth(state.rivers,true),'line-opacity':riverOpacity(true),'line-blur':0.4}},
          {id:'osm-river-line',type:'line',source:'openmaptiles','source-layer':'waterway',minzoom:VISIBILITY_ZOOM.DISTANT,layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#3f8dac','line-width':riverWidth(state.rivers,false),'line-opacity':riverOpacity(false)}}
        ] : [])
      ];

      const pointLayers = [
        {id:'settlement-current-points',type:'circle',source:'points',minzoom:OBJECT_PRESENTATION.currentSettlements.minZoom,filter:['all',sourceFilter('objects'),['==',['get','visible'],1],['==',['get','object_type'],'settlement'],['!=',['get','object_subtype'],'historic_settlement']],paint:pointPaint(OBJECT_PRESENTATION.currentSettlements.pointStyle,'#f3ead8','#5f4a36',0.98)},
        {id:'settlement-historic-points',type:'circle',source:'points',minzoom:OBJECT_PRESENTATION.historicSettlements.minZoom,filter:['all',sourceFilter('objects'),['==',['get','visible'],1],['==',['get','object_type'],'settlement'],['==',['get','object_subtype'],'historic_settlement']],paint:pointPaint(OBJECT_PRESENTATION.historicSettlements.pointStyle,'#b88a49','#5d4128',0.96)},
        {id:'historic-object-points',type:'circle',source:'points',minzoom:OBJECT_PRESENTATION.historicObjects.minZoom,filter:['all',sourceFilter('objects'),['==',['get','visible'],1],['in',['get','object_type'],['literal',['fortification','landmark']]]],paint:pointPaint(OBJECT_PRESENTATION.historicObjects.pointStyle,'#3f4144','#d9d6cf',0.95)},
        {id:'mountain-object-points',type:'circle',source:'points',minzoom:OBJECT_PRESENTATION.mountainObjects.minZoom,filter:['all',sourceFilter('objects'),['==',['get','visible'],1],['==',['get','object_type'],'mountain']],paint:pointPaint(OBJECT_PRESENTATION.mountainObjects.pointStyle,'#675f55','#f2e9d8',0.92)},
        {id:'water-object-points',type:'circle',source:'points',minzoom:OBJECT_PRESENTATION.waterObjects.minZoom,filter:['all',sourceFilter('objects'),['==',['get','visible'],1],['==',['get','object_type'],'water']],paint:pointPaint(OBJECT_PRESENTATION.waterObjects.pointStyle,'#3f8dac','#e8f3f1',0.94)},
        {id:'natural-object-points',type:'circle',source:'points',minzoom:OBJECT_PRESENTATION.naturalObjects.minZoom,filter:['all',sourceFilter('objects'),['==',['get','visible'],1],['==',['get','object_type'],'natural']],paint:pointPaint(OBJECT_PRESENTATION.naturalObjects.pointStyle,'#65795c','#efe8d8',0.9)},
        {id:'modern-objects',type:'circle',source:'points',minzoom:OBJECT_PRESENTATION.modernObjects.minZoom,filter:sourceFilter('modernObjects'),layout:{'visibility':state.modern?'visible':'none'},paint:pointPaint(OBJECT_PRESENTATION.modernObjects.pointStyle,'#8b8984','#f4ead6',0.72)},
        {id:'mountain-passes',type:'circle',source:'points',minzoom:OBJECT_PRESENTATION.passes.minZoom,filter:['all',sourceFilter('passes'),['==',['get','visible'],1]],paint:pointPaint(OBJECT_PRESENTATION.passes.pointStyle,'#7b6d5d','#f2e9d8')},
        ...(natureEnabled ? [
          {id:'osm-peak-points',type:'circle',source:'openmaptiles','source-layer':'peak',minzoom:VISIBILITY_ZOOM.DISTANT,filter:['!=',['get','hidden'],1],paint:{'circle-radius':['match',['get','peak_level'],1,4,2.5],'circle-color':['match',['get','peak_level'],1,'#514b44','#675f55'],'circle-stroke-color':'#f7efe0','circle-stroke-width':1,'circle-opacity':['interpolate',['linear'],['zoom'],7,['match',['get','peak_level'],1,1,0],9.8,['match',['get','peak_level'],1,1,0],10.2,1],'circle-stroke-opacity':['interpolate',['linear'],['zoom'],7,['match',['get','peak_level'],1,1,0],9.8,['match',['get','peak_level'],1,1,0],10.2,1],'circle-pitch-alignment':'viewport','circle-pitch-scale':'viewport'}}
        ] : [])
      ];

      const labelLayers = [
        ...(natureEnabled ? [
          {id:'osm-river-label-main',type:'symbol',source:'openmaptiles','source-layer':'waterway',minzoom:VISIBILITY_ZOOM.DISTANT,filter:['==',['get','tier'],1],layout:{'symbol-placement':'line','symbol-spacing':500,'text-field':labelName,'text-font':['Noto Sans Regular'],'text-size':['interpolate',['linear'],['zoom'],7,9.5,11,14.5],'text-letter-spacing':0.055,'text-rotation-alignment':'map','text-pitch-alignment':'viewport','text-keep-upright':true,'text-max-angle':38,'text-allow-overlap':false},paint:{'text-color':'#126083','text-halo-color':'#f5ead5','text-halo-width':1.7,'text-halo-blur':0.55}},
          {id:'osm-river-label-regional',type:'symbol',source:'openmaptiles','source-layer':'waterway',minzoom:9,filter:['==',['get','tier'],2],layout:{'symbol-placement':'line','symbol-spacing':440,'text-field':labelName,'text-font':['Noto Sans Regular'],'text-size':['interpolate',['linear'],['zoom'],9,9.1,12,12.7],'text-letter-spacing':0.04,'text-rotation-alignment':'map','text-pitch-alignment':'viewport','text-keep-upright':true,'text-max-angle':42,'text-allow-overlap':false},paint:{'text-color':'#126083','text-halo-color':'#f5ead5','text-halo-width':1.45,'text-halo-blur':0.45}},
          {id:'osm-water-labels',type:'symbol',source:'openmaptiles','source-layer':'water',minzoom:10,filter:['all',['in',['get','class'],['literal',['lake','reservoir','pond']]],['==',['get','label_primary'],1]],layout:{'text-field':labelName,'text-font':['Noto Sans Regular'],'text-size':10.5,'text-allow-overlap':false},paint:{'text-color':'#126083','text-halo-color':'#f5ead5','text-halo-width':1.75,'text-halo-blur':0.5}},
          {id:'osm-peak-labels',type:'symbol',source:'openmaptiles','source-layer':'peak',minzoom:VISIBILITY_ZOOM.DISTANT,filter:['!=',['get','hidden'],1],layout:{'text-field':['case',['==',['get','peak_level'],1],['format',labelName,{},'\n',{},['concat',['to-string',['get','ele']],' м'],{'font-scale':0.72}],labelName],'text-font':['Noto Sans Regular'],'text-size':['match',['get','peak_level'],1,11.5,9.7],'text-offset':[0,1.1],'text-anchor':'top','text-allow-overlap':false},paint:{'text-color':'#514a43','text-halo-color':'#f7efe0','text-halo-width':['match',['get','peak_level'],1,1.9,1.5],'text-opacity':['interpolate',['linear'],['zoom'],7,['match',['get','peak_level'],1,1,0],9.8,['match',['get','peak_level'],1,1,0],10.2,1]}}
        ] : []),
        {id:'regional-labels-fallback',type:'symbol',source:'lines',minzoom:VISIBILITY_ZOOM.DISTANT,maxzoom:LABEL_ZOOM.REGIONAL_MAX,filter:sourceFilter('regionalLabels'),layout:{'visibility':'none','symbol-placement':'line-center','icon-image':['get','icon_id'],'icon-size':0.58,'icon-rotation-alignment':'viewport','icon-pitch-alignment':'viewport','icon-keep-upright':true,'icon-allow-overlap':true,'icon-ignore-placement':true,'icon-padding':1,'symbol-sort-key':['get','placement_priority']},paint:{'icon-opacity':['interpolate',['linear'],['zoom'],7.0,1,9.5,1,10.0,0]}},
        {id:'settlement-labels-current',type:'symbol',source:'points',minzoom:OBJECT_PRESENTATION.currentSettlements.minZoom,filter:['all',sourceFilter('objects'),['==',['get','visible'],1],['==',['get','object_type'],'settlement'],['!=',['get','object_subtype'],'historic_settlement']],layout:{'text-field':labelName,'text-font':['Noto Sans Regular'],'text-size':['interpolate',['linear'],['zoom'],8.0,10.2,12.5,12.6],'text-offset':[0,1.08],'text-anchor':'top','text-allow-overlap':true,'text-ignore-placement':true,'text-optional':false,'text-max-width':100,'text-line-height':1.0},paint:{'text-color':'#304553','text-halo-color':'#f4ead6','text-halo-width':2.2,'text-halo-blur':0.35}},
        {id:'settlement-labels-local',type:'symbol',source:'points',minzoom:OBJECT_PRESENTATION.historicSettlements.minZoom,filter:['all',sourceFilter('objects'),['==',['get','visible'],1],['==',['get','object_type'],'settlement'],['==',['get','object_subtype'],'historic_settlement']],layout:{'text-field':labelName,'text-font':['Noto Sans Regular'],'text-size':9.5,'text-offset':[0,1.0],'text-anchor':'top','text-allow-overlap':true,'text-ignore-placement':true,'text-optional':false,'text-max-width':100,'text-line-height':1.0},paint:{'text-color':'#5a4128','text-halo-color':'#f4ead6','text-halo-width':2.0,'text-halo-blur':0.3}},
        {id:'historic-object-labels',type:'symbol',source:'points',minzoom:OBJECT_PRESENTATION.historicObjects.minZoom,filter:['all',sourceFilter('objects'),['==',['get','visible'],1],['in',['get','object_type'],['literal',['fortification','landmark']]]],layout:{'text-field':labelName,'text-font':['Noto Sans Regular'],'text-size':9.4,'text-offset':[0,1.1],'text-anchor':'top','text-allow-overlap':false},paint:{'text-color':'#34383b','text-halo-color':'#f4ead6','text-halo-width':1.35}},
        {id:'mountain-object-labels',type:'symbol',source:'points',minzoom:OBJECT_PRESENTATION.mountainObjects.minZoom,filter:['all',sourceFilter('objects'),['==',['get','visible'],1],['==',['get','object_type'],'mountain']],layout:{'text-field':labelName,'text-font':['Noto Sans Regular'],'text-size':9.7,'text-offset':[0,1.05],'text-anchor':'top','text-allow-overlap':false},paint:{'text-color':'#514a43','text-halo-color':'#f4ead6','text-halo-width':1.4}},
        ...supplementalLabelLayerDefinitions(labelName),
        {id:'modern-labels',type:'symbol',source:'points',minzoom:OBJECT_PRESENTATION.modernObjects.minZoom,filter:sourceFilter('modernObjects'),layout:{'visibility':state.modern?'visible':'none','text-field':labelName,'text-font':['Noto Sans Regular'],'text-size':9.5,'text-offset':[0,1],'text-anchor':'top'},paint:{'text-color':'#6b6965','text-halo-color':'#f4ead6','text-halo-width':1.2}}
      ];

      const layers = [
        ...baseLayers,
        ...natureLayers,
        ...lineLayers,
        ...pointLayers,
        ...labelLayers
      ];
      return {
        version: 8,
        glyphs: glyphsTemplate,
        sources,
        layers
      };
    }

    function forestPatternImage() {
      const size = 64;
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      const context = canvas.getContext('2d');
      context.clearRect(0,0,size,size);
      const clusters = [[6,7,1],[24,13,.82],[46,8,.96],[59,27,.78],[12,35,.88],[36,38,1.05],[53,51,.9],[19,58,.84]];
      const shades = ['rgba(55,85,58,.70)','rgba(82,112,72,.66)','rgba(111,137,92,.54)'];
      const canopy = (centerX,centerY,scale) => {
        [[-4,-1,6],[3,-3,7],[0,4,7],[-7,5,5],[7,5,5]].forEach((circle,index) => {context.beginPath();context.arc(centerX+circle[0]*scale,centerY+circle[1]*scale,circle[2]*scale,0,Math.PI*2);context.fillStyle=shades[index%shades.length];context.fill();});
        context.beginPath();context.arc(centerX,centerY,3.2*scale,0,Math.PI*2);context.fillStyle='rgba(158,171,125,.34)';context.fill();
      };
      clusters.forEach(([x,y,scale]) => [-size,0,size].forEach((dx) => [-size,0,size].forEach((dy) => canopy(x+dx,y+dy,scale))));
      return context.getImageData(0,0,size,size);
    }



    function showRegionalLabelsFallback(message) {
      regionalLabels3dFailed = true;
      if (regionalLabels3d) regionalLabels3d.setVisible(false);
      if (map?.getLayer('regional-labels-fallback')) map.setLayoutProperty('regional-labels-fallback','visibility',toggleButtons.regions.classList.contains('active')?'visible':'none');
      if (message) setStatus(message,true);
    }

    function initializeRegionalLabels3D() {
      if (destroyed || regionalLabels3d || regionalLabels3dFailed) return;
      const rendererFactory = options.regionalLabels3D || root.RegionalLabels3D;
      if (!rendererFactory?.create) {
        showRegionalLabelsFallback('3D-модуль районных названий не подключён; включён резервный слой.');
        return;
      }
      try {
        let initializationError = null;
        const renderer = rendererFactory.create({
          map,
          maplibregl,
          features:data.regionalLabels?.features || [],
          images:data.regionalLabelImages || {},
          altitudeM:7000,
          displayHeightPx:24,
          beforeId:'modern-labels',
          visible:toggleButtons.regions.classList.contains('active'),
          onError:(error) => {
            if (!regionalLabels3d) {initializationError=error;return;}
            if (!regionalLabels3dFailed) showRegionalLabelsFallback(`Ошибка 3D-названий районов: ${error.message}`);
          }
        });
        regionalLabels3d = renderer;
        if (initializationError) {showRegionalLabelsFallback(`Ошибка 3D-названий районов: ${initializationError.message}`);return;}
        regionalLabels3dFailed = false;
        if (map.getLayer('regional-labels-fallback')) map.setLayoutProperty('regional-labels-fallback','visibility','none');
      } catch (error) {
        showRegionalLabelsFallback(`3D-названия районов заменены резервным слоем: ${error.message}`);
      }
    }

    function scheduleRegionalLabels3D() {
      if (regionalLabelsInitializationScheduled || regionalLabels3d || regionalLabels3dFailed || !map) return;
      regionalLabelsInitializationScheduled = true;
      map.once('idle', () => {
        regionalLabelsInitializationScheduled = false;
        initializeRegionalLabels3D();
        applyLayerState();
      });
    }

    function setVisibility(ids, visible) {
      if (!map) return;
      ids.forEach((id) => {if (map.getLayer(id)) map.setLayoutProperty(id,'visibility',visible?'visible':'none');});
    }

    function setDetailLevel() {
      setStatus('Детализация объектов изменяется автоматически при приближении.');
      return 'automatic';
    }

    function applyLayerState() {
      const roadsVisible = toggleButtons.roads.classList.contains('active');
      const riversVisible = toggleButtons.rivers.classList.contains('active');
      const regionsVisible = toggleButtons.regions.classList.contains('active');
      const labelsVisible = toggleButtons.labels.classList.contains('active');
      const modernVisible = toggleButtons.modern.classList.contains('active');
      setVisibility(layerIds.roads,roadsVisible);
      setVisibility(layerIds.riverGeometry,riversVisible);
      setVisibility(layerIds.riverLabels,riversVisible && labelsVisible);
      if (regionalLabels3d && !regionalLabels3dFailed) regionalLabels3d.setVisible(regionsVisible);
      setVisibility(layerIds.regions,regionalLabels3dFailed && regionsVisible);
      setVisibility(layerIds.modernGeometry,modernVisible);
      setVisibility(layerIds.modernLabels,modernVisible && labelsVisible);
      setVisibility(layerIds.labels,labelsVisible);
      if (moving) setVisibility(layerIds.secondaryLabels,false);
      if (map?.getLayer('forest-pattern')) {
        map.setLayoutProperty('forest-pattern','visibility',qualityProfile.forestPattern && !moving ? 'visible' : 'none');
      }
    }

    function applyReliefNow(value) {
      const numericValue = clamp(Number(value),1,4.2);
      reliefValue.textContent = `${numericValue.toFixed(1)}×`;
      if (!map || !map.isStyleLoaded()) return;
      if (api?.isFantasyStyleEnabled?.()) {
        try { map.setTerrain(null); } catch (_) {}
        if (map.getLayer('terrain-hillshade')) map.setLayoutProperty('terrain-hillshade','visibility','none');
        if (map.getLayer('ridge-lines')) map.setLayoutProperty('ridge-lines','visibility','none');
        queueSave();
        return;
      }
      map.setTerrain({source:'terrain-dem',exaggeration:numericValue});
      if (map.getLayer('terrain-hillshade')) {
        map.setLayoutProperty('terrain-hillshade','visibility','visible');
        map.setPaintProperty('terrain-hillshade','hillshade-exaggeration',Math.min(.82,.34+numericValue*.12));
      }
      if (map.getLayer('ridge-lines')) map.setLayoutProperty('ridge-lines','visibility','visible');
      queueSave();
    }

    function applyRelief(value) {
      reliefInput.value = String(value);
      reliefValue.textContent = `${Number(value).toFixed(1)}×`;
      if (reliefFrame !== null) cancelAnimationFrame(reliefFrame);
      if (readyFrame !== null) cancelAnimationFrame(readyFrame);
      reliefFrame = requestAnimationFrame(() => {reliefFrame=null;applyReliefNow(value);});
    }

    function applyRivers(value) {
      const numericValue = clamp(Number(value),.7,2.2);
      riverValue.textContent = `${numericValue.toFixed(2)}×`;
      if (!map || !map.isStyleLoaded()) return;
      if (map.getLayer('osm-river-halo')) map.setPaintProperty('osm-river-halo','line-width',riverWidth(numericValue,true));
      if (map.getLayer('osm-river-line')) map.setPaintProperty('osm-river-line','line-width',riverWidth(numericValue,false));
      queueSave();
    }

    function resetView() {
      safeStorageRemove(storageKey);
      LEGACY_STORAGE_KEYS.forEach(safeStorageRemove);
      state = {...defaults};
      reliefInput.value = String(state.relief);
      riverInput.value = String(state.rivers);
      Object.entries({roads:true,rivers:true,regions:true,labels:true,modern:false}).forEach(([key,value]) => toggleButtons[key].classList.toggle('active',value));
      setToolbarCollapsed(false,false);
      applyRelief(state.relief);
      applyRivers(state.rivers);
      applyLayerState();
      map.easeTo({center:defaults.center,zoom:defaults.zoom,bearing:defaults.bearing,pitch:defaults.pitch,duration:900});
      setStatus('Карта сброшена к безопасному виду.');
    }

    function focusElbrus() {
      map?.easeTo({center:data.elbrusFocus,zoom:10.15,bearing:180,pitch:api?.isFantasyStyleEnabled?.()?0:60,duration:1400});
      setStatus('Фокус на Минги тау.');
    }

    function queueMapResize() {
      if (destroyed) return;
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null;
        map?.resize();
      });
    }

    function enforceSoftCameraBounds() {
      if (!map || correctingCamera) return false;
      const center = map.getCenter();
      const longitude = clamp(center.lng, cameraSoftBounds[0], cameraSoftBounds[2]);
      const latitude = clamp(center.lat, cameraSoftBounds[1], cameraSoftBounds[3]);
      if (Math.abs(longitude - center.lng) < 1e-7 && Math.abs(latitude - center.lat) < 1e-7) return false;
      correctingCamera = true;
      map.easeTo({center:[longitude,latitude],duration:320,essential:true});
      return true;
    }

    function fullscreenElement() {
      return document.fullscreenElement || document.webkitFullscreenElement || null;
    }

    function isMapFullscreen() {
      const activeElement = fullscreenElement();
      return Boolean(activeElement && (activeElement === host || host.contains(activeElement)));
    }

    function syncFullscreenButton() {
      const active = isMapFullscreen();
      fullscreenButton.classList.toggle('active', active);
      fullscreenButton.setAttribute('aria-pressed', String(active));
      fullscreenButton.textContent = active ? 'Выйти из полного экрана' : 'На весь экран';
      return active;
    }

    async function toggleFullscreen() {
      try {
        if (isMapFullscreen()) {
          const exit = document.exitFullscreen || document.webkitExitFullscreen;
          if (!exit) throw new Error('Выход из полноэкранного режима не поддерживается.');
          const result = exit.call(document);
          if (result && typeof result.then === 'function') await result;
        } else {
          const fullscreenTarget = options.fullscreenTarget || host;
          const request = fullscreenTarget.requestFullscreen || fullscreenTarget.webkitRequestFullscreen;
          if (!request) throw new Error('Полноэкранный режим не поддерживается этим браузером.');
          const result = request.call(fullscreenTarget);
          if (result && typeof result.then === 'function') await result;
        }
        syncFullscreenButton();
        queueMapResize();
        setTimeout(queueMapResize, 180);
        setStatus(isMapFullscreen() ? 'Карта открыта на весь экран.' : 'Полноэкранный режим закрыт.');
        return isMapFullscreen();
      } catch (error) {
        syncFullscreenButton();
        setStatus(`Не удалось переключить полноэкранный режим: ${error.message}`, true);
        return false;
      }
    }

    function setToolbarCollapsed(collapsed, save = true) {
      toolbarElement.classList.toggle('collapsed',collapsed);
      collapseButton.textContent = collapsed ? '☰' : '−';
      collapseButton.setAttribute('aria-expanded',String(!collapsed));
      collapseButton.setAttribute('aria-label',collapsed?'Показать панель':'Скрыть панель');
      if (map) setTimeout(() => map.resize(),180);
      if (save) queueSave();
    }

    function toggleLayer(name, forcedValue) {
      const button = toggleButtons[name];
      if (!button) throw new Error(`AlanMap: unknown layer toggle: ${name}`);
      const next = typeof forcedValue === 'boolean' ? forcedValue : !button.classList.contains('active');
      button.classList.toggle('active',next);
      applyLayerState();
      queueSave();
      return next;
    }

    function attachUiHandlers() {
      const on = (targetElement,eventName,handler) => targetElement.addEventListener(eventName,handler,{signal:uiAbort.signal});
      on(element('[data-action="reset"]'),'click',resetView);
      on(fullscreenButton,'click',toggleFullscreen);
      on(collapseButton,'click',() => setToolbarCollapsed(!toolbarElement.classList.contains('collapsed')));
      on(element('[data-action="north"]'),'click',() => map?.easeTo({bearing:180,pitch:api?.isFantasyStyleEnabled?.()?0:58,duration:700}));
      Object.entries(toggleButtons).forEach(([name,button]) => on(button,'click',() => toggleLayer(name)));
      on(reliefInput,'input',(event) => applyRelief(event.target.value));
      on(riverInput,'input',(event) => applyRivers(event.target.value));
      host.querySelectorAll('[data-pan]').forEach((button) => on(button,'click',() => {const [x,y]=button.dataset.pan.split(',').map(Number);map?.panBy([x,y],{duration:340});}));
      on(root,'resize',queueMapResize);
      on(root,'orientationchange',() => {queueMapResize();setTimeout(queueMapResize,180);});
      if (root.visualViewport) on(root.visualViewport,'resize',queueMapResize);
      on(document,'fullscreenchange',() => {syncFullscreenButton();queueMapResize();setTimeout(queueMapResize,180);});
      on(document,'webkitfullscreenchange',() => {syncFullscreenButton();queueMapResize();setTimeout(queueMapResize,180);});
      on(host,'keydown',(event) => {
        if (!map || ['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)) return;
        const step = event.shiftKey ? 220 : 110;
        if (event.key==='ArrowLeft') {event.preventDefault();map.panBy([-step,0]);}
        if (event.key==='ArrowRight') {event.preventDefault();map.panBy([step,0]);}
        if (event.key==='ArrowUp') {event.preventDefault();map.panBy([0,-step]);}
        if (event.key==='ArrowDown') {event.preventDefault();map.panBy([0,step]);}
      });
    }

    function popupForFeature(event) {
      const feature = event.features?.[0];
      if (!feature) return;
      const properties = feature.properties || {};
      const layerId = feature.layer?.id || '';
      const waterKind = properties.class === 'reservoir' ? 'водохранилище' : properties.class === 'pond' ? 'пруд' : 'озеро';
      const kind = layerId === 'osm-water-fill'
        ? waterKind
        : layerId === 'osm-river-line'
          ? (properties.class === 'canal' ? 'канал' : 'река')
          : layerId === 'osm-glacier-fill'
            ? 'ледник'
            : layerId === 'osm-snow-fill'
              ? 'постоянный снег'
              : layerId === 'osm-peak-points'
                ? 'вершина'
                : properties.object_type || (properties.pass_id ? 'перевал' : 'объект');
      const title = properties.name_alan_latin || properties.name_ru || properties.name_map || properties.name || properties.source_name || (kind === 'озеро' ? 'Озеро' : 'Объект');
      const body = properties.description_ru || '';
      const elevation = properties.ele || properties.elevation_m;
      const meta = elevation ? `Высота: ${escapeHtml(elevation)} м` : properties.system_id ? `Речная система: ${escapeHtml(properties.system_id)}` : '';
      new maplibregl.Popup({closeButton:true,maxWidth:'310px'}).setLngLat(event.lngLat).setHTML(`<div class="alan-map-popup-title">${escapeHtml(title)}</div><div class="alan-map-popup-kind">${escapeHtml(kind)}</div>${body?`<div class="alan-map-popup-body">${escapeHtml(body)}</div>`:''}${meta?`<div class="alan-map-popup-meta">${meta}</div>`:''}`).addTo(map);
    }

    function registerInteractiveLayers() {
      const clickableLayers = [
        'settlement-current-points','settlement-historic-points','historic-object-points',
        'mountain-object-points','water-object-points','natural-object-points','modern-objects',
        'mountain-passes','osm-peak-points','osm-river-line','osm-water-fill',
        'osm-glacier-fill','osm-snow-fill'
      ];
      clickableLayers.filter((id) => map.getLayer(id)).forEach((id) => {
        map.on('mouseenter',id,() => {map.getCanvas().style.cursor='pointer';});
        map.on('mouseleave',id,() => {map.getCanvas().style.cursor='';});
        map.on('click',id,popupForFeature);
      });
    }

    function finalizeReady(trigger = 'render') {
      if (ready || destroyed || !map || !map.getLayer('focus-paper')) return false;
      ready = true;
      clearTimeout(loadingTimer);
      if (readyFrame !== null) cancelAnimationFrame(readyFrame);
      scheduleRegionalLabels3D();
      applyLayerState();
      registerInteractiveLayers();
      loadingElement.classList.add('hidden');
      if (stateMigrationNeeded) saveStateNow();
      updateNetworkStatus();
      host.dispatchEvent(new CustomEvent('alan-map:ready',{detail:{map,api,trigger}}));
      if (typeof options.onReady === 'function') options.onReady(api);
      return true;
    }

    function queueFinalizeReady(trigger) {
      if (ready || readyFrame !== null) return;
      readyFrame = requestAnimationFrame(() => {
        readyFrame = null;
        finalizeReady(trigger);
      });
    }

    function initialize() {
      if (!data || !Array.isArray(data.bounds) || !Array.isArray(data.center)) {
        showFallback('Данные карты повреждены или не подключены.');
        return;
      }
      if (!maplibregl?.Map) {
        showFallback('MapLibre GL JS не подключён.');
        return;
      }
      if (typeof maplibregl.supported === 'function' && !maplibregl.supported()) {
        showFallback('На устройстве отключён или недоступен WebGL.');
        return;
      }

      reliefInput.value = String(state.relief);
      riverInput.value = String(state.rivers);
      reliefValue.textContent = `${Number(state.relief).toFixed(1)}×`;
      riverValue.textContent = `${Number(state.rivers).toFixed(2)}×`;
      toggleButtons.roads.classList.toggle('active',state.roads);
      toggleButtons.rivers.classList.toggle('active',state.riversVisible);
      toggleButtons.regions.classList.toggle('active',state.regions);
      toggleButtons.labels.classList.toggle('active',state.labels);
      toggleButtons.modern.classList.toggle('active',state.modern);
      setToolbarCollapsed(Boolean(state.toolbarCollapsed),false);
      syncFullscreenButton();
      attachUiHandlers();

      loadingTimer = setTimeout(() => {
        if (finalizeReady('verified-timeout')) {
          loadingText.textContent = 'Локальный стиль отрисован; сетевые тайлы продолжают загружаться.';
          updateNetworkStatus();
        } else {
          showFallback('Картографический стиль не смог выполнить первый кадр.');
        }
      },loadingTimeoutMs);

      try {
        map = new maplibregl.Map({
          container:mapElement,
          style:coreStyle(),
          center:state.center,
          zoom:state.zoom,
          bearing:state.bearing,
          pitch:state.pitch,
          minZoom:CAMERA_LIMITS.minZoom,
          maxZoom:CAMERA_LIMITS.maxZoom,
          maxPitch:CAMERA_LIMITS.maxPitch,
          renderWorldCopies:false,
          pixelRatio:Math.min(root.devicePixelRatio || 1,qualityProfile.pixelRatio),
          maxTileCacheZoomLevels:qualityProfile.maxTileCacheZoomLevels,
          maxTileCacheSize:qualityProfile.maxTileCacheSize,
          maxCanvasSize:qualityProfile.maxCanvasSize,
          canvasContextAttributes:{antialias:qualityProfile.antialias,powerPreference:'high-performance'},
          hash:false,
          attributionControl:false,
          dragRotate:true,
          pitchWithRotate:true,
          touchPitch:true
        });
      } catch (error) {
        showFallback(`MapLibre не смог создать карту: ${error.message}`);
        return;
      }


      map.on('styleimagemissing',(event) => {
        if (event.id==='forest-canopy' && !map.hasImage(event.id)) {map.addImage(event.id,forestPatternImage(),{pixelRatio:2});return;}
        const uri = data.regionalLabelImages?.[event.id];
        if (!uri || map.hasImage(event.id)) return;
        const image = new Image();
        image.onload = () => {if (!destroyed && map && !map.hasImage(event.id)) map.addImage(event.id,image,{pixelRatio:2});};
        image.src = uri;
      });

      if (typeof ResizeObserver === 'function') {
        resizeObserver = new ResizeObserver(queueMapResize);
        resizeObserver.observe(host);
      }

      map.addControl(new maplibregl.NavigationControl({showCompass:true,showZoom:true,visualizePitch:true}),'bottom-left');
      map.addControl(new maplibregl.AttributionControl({compact:true}),'bottom-left');
      map.addControl(new maplibregl.ScaleControl({unit:'metric',maxWidth:120}),'bottom-left');
      map.dragPan.enable(); map.touchZoomRotate.enable(); map.keyboard.enable(); map.doubleClickZoom.enable();

      map.once('render',() => queueFinalizeReady('first-render'));
      map.on('styledata',() => {
        if (!ready && map.getLayer('focus-paper')) queueFinalizeReady('styledata');
      });
      map.on('load',() => {
        finalizeReady('load');
        applyReliefNow(reliefInput.value);
        applyRivers(riverInput.value);
        updateNetworkStatus();
      });

      map.on('sourcedata',(event) => {
        if (event.isSourceLoaded && event.sourceId) {
          sourceLoaded.add(event.sourceId);
          sourceErrors.delete(event.sourceId);
          updateNetworkStatus();
        }
      });

      map.on('error',(event) => {
        const message = String(event?.error?.message || 'Ошибка загрузки карты');
        const sourceId = event?.sourceId || (/openfreemap|openmaptiles|\.pbf|vector/i.test(message) ? 'openmaptiles' : /terrain|elevation|terrarium/i.test(message) ? 'terrain-dem' : 'unknown');
        sourceErrors.set(sourceId,message);
        updateNetworkStatus();
      });

      document.addEventListener('alan-map:pmtiles-shard-loaded',(event) => {
        const archivePath = String(event.detail?.archivePath || '');
        const sourceId = archivePath.includes('dem') ? 'terrain-dem' : archivePath.includes('vector') ? 'openmaptiles' : '';
        if (sourceId && sourceErrors.delete(sourceId)) updateNetworkStatus();
      },{signal:uiAbort.signal});

      map.on('movestart',() => {
        moving = true;
        applyLayerState();
      });
      map.on('moveend',() => {
        moving = false;
        applyLayerState();
        if (correctingCamera) {correctingCamera=false;queueSave();return;}
        if (!enforceSoftCameraBounds()) queueSave();
      });
      map.on('pitchend',queueSave);
      map.on('rotateend',queueSave);
    }

    function destroy() {
      destroyed = true;
      uiAbort.abort();
      clearTimeout(saveTimer);
      clearTimeout(loadingTimer);
      if (reliefFrame !== null) cancelAnimationFrame(reliefFrame);
      if (readyFrame !== null) cancelAnimationFrame(readyFrame);
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      resizeObserver?.disconnect();
      if (regionalLabels3d) regionalLabels3d.destroy();
      if (map) map.remove();
      host.innerHTML = '';
      host.classList.remove('alan-map-shell','alan-map-no-toolbar','alan-map-no-legend','alan-map-no-dpad');
      delete host.dataset.quality;
      if (!hadTabIndex) host.removeAttribute('tabindex');
    }

    api = {
      version:VERSION,
      get map(){return map;},
      getState:() => ({...state}),
      getQualityProfile:() => ({...qualityProfile, actualPixelRatio: Math.min(root.devicePixelRatio || 1,qualityProfile.pixelRatio)}),
      setLayerVisibility:toggleLayer,
      setDetailLevel,
      setRelief:(value) => applyRelief(value),
      setRiverScale:(value) => {riverInput.value=String(value);applyRivers(value);},
      focusElbrus,
      getLabelDiagnostics:() => ({regional:regionalLabels3d?.getDiagnostics?regionalLabels3d.getDiagnostics():null,regionalFallback:regionalLabels3dFailed}),
      getFrameClipDiagnostics:() => ({
        active:true,
        ready:Boolean(map?.getLayer?.('focus-paper')),
        method:'physical-offline-data-clip',
        cssClipPath:false,
        runtimeFramePointCount:mapFramePointCount(data),
        outsideMaskLayer:false,
        runtimeMask:false,
        vectorWithinFilters:false,
        strictDataClip:true,
        vectorPhysicallyClipped:Boolean(data.regionalVector?.physicallyClipped),
        demPhysicallyClipped:Boolean(data.regionalDem?.physicallyClipped)
      }),
      getNetworkDiagnostics:() => ({loaded:[...sourceLoaded],errors:Object.fromEntries(sourceErrors),demMode:activeDemMode,vectorMode:activeVectorMode,demUrlTemplate:activeDemTemplate}),
      getStyleDiagnostics:() => {
        const style = map?.getStyle?.() || {sources:{},layers:[]};
        const layers = Array.isArray(style.layers) ? style.layers : [];
        const customLayerActive = Boolean(
          regionalLabels3d && !regionalLabels3dFailed && map?.getLayer?.('regional-labels-3d-hook')
        );
        const layerIds = layers.map((layer) => layer.id);
        if (customLayerActive && !layerIds.includes('regional-labels-3d-hook')) {
          layerIds.push('regional-labels-3d-hook');
        }
        return {
          sourceCount:Object.keys(style.sources || {}).length,
          layerCount:layers.length + (customLayerActive ? 1 : 0),
          normalLayerCount:layers.length,
          customLayerCount:customLayerActive ? 1 : 0,
          layerIds,
          sourceIds:Object.keys(style.sources || {})
        };
      },
      resetView,
      toggleFullscreen,
      getViewportDiagnostics:() => ({hostWidth:host.clientWidth,hostHeight:host.clientHeight,mapWidth:mapElement.clientWidth,mapHeight:mapElement.clientHeight,visualViewportHeight:root.visualViewport?.height || null,innerHeight:root.innerHeight || null,fullscreen:isMapFullscreen()}),
      resize:queueMapResize,
      destroy
    };

    initialize();
    return api;
  }

  return {
    version:VERSION,
    mount,
    __test:{
      visibilityZoom:VISIBILITY_ZOOM,
      labelZoom:LABEL_ZOOM,
      pointStyle:POINT_STYLE,
      objectPresentation:OBJECT_PRESENTATION,
      pointPaint,
      softCameraBounds,
      cameraLimits:CAMERA_LIMITS,
      stateSchemaVersion:STATE_SCHEMA_VERSION,
      stateTtlMs:STATE_TTL_MS,
      normalizePersistedState,
      resolveQualityProfile,
      buildRuntimeSourceData,
      residentialLayerDefinitions,
      supplementalLabelLayerDefinitions,
      mapFramePointCount,
    }
  };
});
