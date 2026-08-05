(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./config.js'));
  else root.ALAN_12_1_DATA = factory(root.ALAN_12_1_CONFIG);
})(typeof self !== 'undefined' ? self : this, function (config) {
  'use strict';

  const TYPE_ORDER = Object.freeze(['five_thousander', 'main_mountain', 'ridge', 'mountain', 'rock', 'hill']);
  const ID_PATTERN = /^(mount|rock|ridge|hill)(-(main|5000))?-\d{4}$/;
  const ICON_PATTERN = /^mount-(?:[2-9]|1\d|2\d|30)$/;

  function collectCoordinates(value, output) {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) {
      output.push([Number(value[0]), Number(value[1])]);
      return;
    }
    value.forEach((child) => collectCoordinates(child, output));
  }

  function calculateBounds(collection) {
    const coordinates = [];
    for (const feature of collection.features || []) collectCoordinates(feature.geometry?.coordinates, coordinates);
    if (!coordinates.length) throw new Error('Граница карты не содержит координат.');
    return coordinates.reduce((bounds, coordinate) => [
      Math.min(bounds[0], coordinate[0]), Math.min(bounds[1], coordinate[1]),
      Math.max(bounds[2], coordinate[0]), Math.max(bounds[3], coordinate[1])
    ], [Infinity, Infinity, -Infinity, -Infinity]);
  }

  function normalizeBoundary(collection) {
    if (!collection || collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) throw new Error('Файл границы имеет неверный формат.');
    const features = collection.features
      .filter((feature) => ['Polygon', 'MultiPolygon'].includes(feature?.geometry?.type))
      .map((feature) => ({type: 'Feature', properties: {id: 'karachay-balkaria-nalsana'}, geometry: feature.geometry}));
    if (!features.length) throw new Error('В файле не найдена рабочая граница.');
    return {type: 'FeatureCollection', features};
  }

  function normalizeRender(collection) {
    if (!collection || collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) throw new Error('Файл рендера гор имеет неверный формат.');
    const ids = new Set();
    const counts = Object.fromEntries(TYPE_ORDER.map((type) => [type, 0]));
    const features = collection.features.map((feature) => {
      const properties = feature?.properties || {};
      const coordinates = feature?.geometry?.type === 'Point' ? feature.geometry.coordinates : null;
      const id = String(properties.point_id || properties.id || '');
      const type = String(properties.type || '');
      const iconId = String(properties.icon_id || '');
      const longitude = Number(properties.longitude ?? coordinates?.[0]);
      const latitude = Number(properties.latitude ?? coordinates?.[1]);
      const iconScale = Number(properties.icon_scale);
      const baseShift = Number(properties.base_shift);
      const priority = Number(properties.priority);
      if (!ID_PATTERN.test(id) || !Object.hasOwn(config.categories, type) || ids.has(id)) throw new Error(`Некорректный или повторяющийся ID горного объекта: ${id}`);
      if (!ICON_PATTERN.test(iconId) || iconId === 'mount-1') throw new Error(`Недопустимая фигурка: ${iconId}`);
      if (![longitude, latitude, iconScale, baseShift, priority].every(Number.isFinite) || iconScale <= 0 || Math.abs(baseShift) > 0.2) throw new Error(`Некорректные параметры рендера: ${id}`);
      ids.add(id);
      counts[type] += 1;
      return {
        type: 'Feature',
        properties: {
          id,
          point_id: id,
          type,
          longitude,
          latitude,
          elevation_m: properties.elevation_m === null ? null : Number(properties.elevation_m),
          name: String(properties.name || ''),
          icon_id: iconId,
          icon_scale: iconScale,
          base_shift: baseShift,
          priority
        },
        geometry: {type: 'Point', coordinates: [longitude, latitude]}
      };
    });
    if (features.length !== 1000) throw new Error(`Ожидалось 1000 горных фигурок, получено ${features.length}.`);
    return {collection: {type: 'FeatureCollection', features}, summary: {total: features.length, counts}};
  }

  function normalizeIconManifest(source) {
    if (!source || !Array.isArray(source.icons) || !source.atlas) throw new Error('Манифест фигурок имеет неверный формат.');
    if (String(source.version) !== config.version) throw new Error(`Версия манифеста ${source.version} не совпадает с ${config.version}.`);
    const ids = new Set();
    const icons = source.icons.map((icon) => {
      const id = String(icon.id || '');
      const x = Number(icon.x);
      const y = Number(icon.y);
      const width = Number(icon.width);
      const height = Number(icon.height);
      if (!ICON_PATTERN.test(id) || id === 'mount-1' || ids.has(id)) throw new Error(`Недопустимая или повторяющаяся фигурка: ${id}`);
      if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) throw new Error(`Некорректная область фигурки: ${id}`);
      ids.add(id);
      return {id, x, y, width, height, roles: Array.isArray(icon.roles) ? [...icon.roles] : []};
    });
    return {
      version: config.version,
      atlas: String(source.atlas),
      atlas_width: Number(source.atlas_width),
      atlas_height: Number(source.atlas_height),
      pixel_ratio: Number(source.pixel_ratio || 2),
      icons
    };
  }

  function normalizeRivers(source) {
    if (!source || source.type !== 'FeatureCollection' || !Array.isArray(source.features)) throw new Error('Файл рек имеет неверный формат.');
    const ids = new Set();
    const tiers = {1: 0, 2: 0, 3: 0};
    const features = source.features.map((feature) => {
      const geometry = feature?.geometry;
      const properties = feature?.properties || {};
      const systemId = String(properties.system_id || '');
      const name = String(properties.name_ru || '').trim();
      const tier = Number(properties.tier);
      if (!geometry || !['LineString', 'MultiLineString'].includes(geometry.type) || !systemId || !name || ![1, 2, 3].includes(tier) || ids.has(systemId)) throw new Error(`Некорректная речная система: ${systemId || 'без ID'}`);
      ids.add(systemId);
      tiers[tier] += 1;
      return {type: 'Feature', properties: {system_id: systemId, name_ru: name, tier, width_class: tier === 1 ? 'major' : tier === 2 ? 'medium' : 'minor'}, geometry};
    });
    if (features.length !== 31) throw new Error(`Ожидалась 31 геометрия речных систем, получено ${features.length}.`);
    return {collection: {type: 'FeatureCollection', features}, summary: {features: features.length, representedSystems: 32, tiers}};
  }

  async function loadJson(url) {
    const response = await fetch(url, {cache: 'no-cache'});
    if (!response.ok) throw new Error(`Не загружен ${url} (HTTP ${response.status}).`);
    return response.json();
  }

  async function loadStageData() {
    const [rawBoundary, rawRender, rawManifest, rawRivers] = await Promise.all([
      loadJson(config.boundaryUrl),
      loadJson(config.mountainRenderUrl),
      loadJson(config.iconManifestUrl),
      loadJson(config.riversUrl)
    ]);
    const boundary = normalizeBoundary(rawBoundary);
    const render = normalizeRender(rawRender);
    const iconManifest = normalizeIconManifest(rawManifest);
    const rivers = normalizeRivers(rawRivers);
    return {
      boundary,
      icons: render.collection,
      iconManifest,
      rivers: rivers.collection,
      summary: {total: render.summary.total, counts: render.summary.counts, icons: render.summary, rivers: rivers.summary},
      bounds: calculateBounds(boundary)
    };
  }

  return Object.freeze({TYPE_ORDER, calculateBounds, normalizeBoundary, normalizeRender, normalizeIconManifest, normalizeRivers, loadStageData});
});
