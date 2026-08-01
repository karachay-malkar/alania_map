(function (root) {
  'use strict';

  const VERSION = '7.0.23-slippy-hybrid-icons.2';
  const VECTOR_SOURCE_ID = 'openmaptiles';
  const VECTOR_SOURCE_LAYER = 'peak';
  const LAYER_IDS = Object.freeze([
    'alan-mountain-icons-standard',
    'alan-mountain-icons-high',
    'alan-mountain-icons-five-thousanders'
  ]);
  const STANDARD_ICONS = Object.freeze([
    'mount-2','mount-3','mount-4','mount-5','mount-6','mount-7','mount-8','mount-9','mount-10',
    'mount-13','mount-14','mount-16','mount-17','mount-18','mount-19','mount-20','mount-22',
    'mount-24','mount-26','mount-28'
  ]);
  const HIGH_ICONS = Object.freeze(['mount-12','mount-15','mount-21','mount-23','mount-25','mount-27','mount-29','mount-30']);
  const AVAILABLE_ICONS = Object.freeze([...STANDARD_ICONS, ...HIGH_ICONS, 'mount-11']);
  const POINT_LAYER_IDS = Object.freeze([
    'settlement-current-points',
    'settlement-historic-points',
    'historic-object-points',
    'mountain-object-points',
    'water-object-points',
    'natural-object-points',
    'modern-objects',
    'mountain-passes',
    'osm-peak-points'
  ]);

  function injectStyle() {
    if (typeof document === 'undefined' || document.getElementById('alan-slippy-hybrid-style')) return;
    const style = document.createElement('style');
    style.id = 'alan-slippy-hybrid-style';
    style.textContent = `
      .alan-map-shell[data-slippy-mode="hybrid"] .maplibregl-ctrl-compass { display: none !important; }
      .alan-map-shell[data-slippy-mode="hybrid"] .maplibregl-canvas { filter: saturate(.94) contrast(1.02); }
      .alan-map-shell[data-slippy-mode="hybrid"] .alan-map-subtitle { max-width: 430px; }
    `;
    document.head.appendChild(style);
  }

  function forceFlatOptions(options) {
    const next = Object.assign({}, options || {}, {
      bearing: 0,
      pitch: 0,
      maxPitch: 0,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false
    });
    if (next.style && typeof next.style === 'object') delete next.style.terrain;
    return next;
  }

  function installFlatGuards(map) {
    if (!map || map.__alanSlippyFlatGuards) return map;
    Object.defineProperty(map, '__alanSlippyFlatGuards', {value: true});

    const constrainCamera = (methodName) => {
      const original = typeof map[methodName] === 'function' ? map[methodName].bind(map) : null;
      if (!original) return;
      map[methodName] = function (options, eventData) {
        const next = options && typeof options === 'object'
          ? Object.assign({}, options, {bearing: 0, pitch: 0})
          : {bearing: 0, pitch: 0};
        return original(next, eventData);
      };
    };
    constrainCamera('jumpTo');
    constrainCamera('easeTo');
    constrainCamera('flyTo');

    for (const methodName of ['setBearing', 'setPitch', 'rotateTo', 'resetNorth', 'resetNorthPitch']) {
      if (typeof map[methodName] === 'function') map[methodName] = function () { return map; };
    }

    const originalSetTerrain = typeof map.