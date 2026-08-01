(function (root) {
  'use strict';

  const VERSION = '7.0.23-slippy-hybrid-icons';
  const SOURCE_ID = 'alan-mountain-icons';
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

  function finiteNumber() {
    for (const value of arguments) {
      const number = Number(value);
      if (Number.isFinite(number)) return number;
    }
    return null;
  }

  function pointCoordinates(feature) {
    const geometry = feature && feature.geometry;
    if (!geometry || geometry.type !== 'Point' || !Array.isArray(geometry.coordinates)) return null;
    const coordinates = geometry.coordinates.slice(0, 2).map(Number);
    return coordinates.length === 2 && coordinates.every(Number.isFinite) ? coordinates : null;
  }

  function stringHash(value) {
    let hash = 2166136261;
    const text = String(value || '');
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function featureKey(feature, coordinates) {
    const properties = feature.properties || {};
    return [
      properties.name_alan_latin,
      properties.name_ru,
      properties.name_map,
      properties.name,
      properties.osm_id,
      coordinates[0].toFixed(5),
      coordinates[1].toFixed(5)
    ].filter(Boolean).join('|');
  }

  function elevationOf(feature) {
    const properties = feature.properties || {};
    return finiteNumber(
      properties.ele,
      properties.elevation_m,
      properties.altitude_m,
      properties.height_m,
      properties.height
    );
  }

  function chooseIcon(category, key) {
    if (category === 'five_thousander') return 'mount-11';
    const pool = category === 'high' ? HIGH_ICONS : STANDARD_ICONS;
    return pool[stringHash(key) % pool.length];
  }

 