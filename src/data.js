(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./config.js'));
  else root.ALAN_12_1_DATA = factory(root.ALAN_12_1_CONFIG);
})(typeof self !== 'undefined' ? self : this, function (config) {
  'use strict';

  const TYPE_ORDER = Object.freeze(['five_thousander', 'main_mountain', 'mountain', 'rock', 'ridge', 'hill']);
  const POINT_KEYS = Object.freeze(['elevation_m', 'id', 'latitude', 'longitude', 'name', 'type']);
  const BINDING_KEYS = Object.freeze(['base_shift', 'icon_id', 'icon_scale', 'min_zoom', 'point_id', 'priority']);
  const ID_PATTERN = /^(mount|rock|ridge|hill)(-(main|5000))?-\d{4}$/;
  const ICON_PATTERN = /^mount-(?:[2-9]|1\d|2\d|30)$/;

  function numberOrNull() {
    for (const value of arguments) {
      if (value === null || value === undefined || value === '') continue;
      const number = Number(value);
      if (Number.isFinite(number)) return number;
    }
    return null;
  }

  function cleanName(properties) {
    return String(properties.name || properties.name_ru || properties.name_map || properties.name_local || '').trim();
  }

  function classify(properties, elevation) {
    const rawType = String(properties.object_type || properties.type || '').toLowerCase();
    const rawCategory = String(properties.category || '').toLowerCase();
    const sourceId = String(properties.id || '').toLowerCase();
    if (elevation !== null && elevation >= 5000) return 'five_thousander';
    if (properties.main === true || Number(properties.main) === 1 || Number(properties.peak_level) === 1 || ['main', 'major', 'primary'].includes(rawCategory)) return 'main_mountain';
    if (rawType.includes('rock') || rawType.includes('cliff') || sourceId.startsWith('rock-')) return 'rock';
    if (rawType.includes('ridge') || rawType.includes('range') || sourceId.startsWith('ridge-')) return 'ridge';
    if (rawType.includes('hill') || sourceId.startsWith('hill-')) return 'hill';
    return 'mountain';
  }

  function pointInRing(point, ring) {
    let inside = false;
    const x = point[0];
    const y = point[1];
    for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
      const xi = Number(ring[index][0]);
      const yi = Number(ring[index][1]);
      const xj = Number(ring[previous][0]);
      const yj = Number(ring[previous][1]);
      const intersects = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi);
      if (intersects) inside = !inside;
    }
    return inside;
  }

  function pointInPolygon(point, rings) {
    if (!Array.isArray(rings) || !rings.length || !pointInRing(point, rings[0])) return false;
    for (let index = 1; index < rings.length; index += 1) if (pointInRing(point, rings[index])) return false;
    return true;
  }

  function pointInsideBoundary(point, boundary) {
    for (const feature of boundary.features || []) {
      const geometry = feature && feature.geometry;
      if (!geometry) continue;
      if (geometry.type === 'Polygon' && pointInPolygon(point, geometry.coordinates)) return true;
      if (geometry.type === 'MultiPolygon' && geometry.coordinates.some((polygon) => pointInPolygon(point, polygon))) return true;
    }
    return false;
  }

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
    for (const feature of collection.features || []) collectCoordinates(feature.geometry && feature.geometry.coordinates, coordinates);
    if (!coordinates.length) throw new Error('Граница карты не содержит координат.');
    return coordinates.reduce((bounds, coordinate) => [
      Math.min(bounds[0], coordinate[0]), Math.min(bounds[1], coordinate[1]),
      Math.max(bounds[2], coordinate[0]), Math.max(bounds[3], coordinate[1])
    ], [Infinity, Infinity, -Infinity, -Infinity]);
  }

  function normalizeBoundary(collection) {
    if (!collection || collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) throw new Error('Файл границы имеет неверный формат.');
    const features = collection.features
      .filter((feature) => ['Polygon', 'MultiPolygon'].includes(feature && feature.geometry && feature.geometry.type))
      .map((feature) => ({type: 'Feature', properties: {id: 'karachay-balkaria-nalsana'}, geometry: feature.geometry}));
    if (!features.length) throw new Error('В файле не найдена рабочая граница.');
    return {type: 'FeatureCollection', features};
  }

  function isNormalizedPoint(properties) {
    return Boolean(properties && ID_PATTERN.test(String(properties.id || '')) && Object.hasOwn(config.categories, properties.type) &&
      Object.hasOwn(properties, 'longitude') && Object.hasOwn(properties, 'latitude') && Object.hasOwn(properties, 'elevation_m') && Object.hasOwn(properties, 'name'));
  }

  function normalizedFeature(properties, longitude, latitude) {
    const type = String(properties.type);
    return {
      type: 'Feature',
      properties: {
        id: String(properties.id), type,
        longitude: Number(longitude.toFixed(6)), latitude: Number(latitude.toFixed(6)),
        elevation_m: numberOrNull(properties.elevation_m),
        name: ['main_mountain', 'five_thousander'].includes(type) ? cleanName(properties) : ''
      },
      geometry: {type: 'Point', coordinates: [Number(longitude.toFixed(6)), Number(latitude.toFixed(6))]}
    };
  }

  function normalizeMountainPoints(source, boundary) {
    if (!source || source.type !== 'FeatureCollection' || !Array.isArray(source.features)) throw new Error('Файл горных точек имеет неверный формат.');
    const directFeatures = [];
    const prepared = [];
    let invalid = 0;
    let outside = 0;
    source.features.forEach((feature, sourceIndex) => {
      const coordinates = feature && feature.geometry && feature.geometry.type === 'Point' ? feature.geometry.coordinates : null;
      const properties = feature && feature.properties ? feature.properties : {};
      const longitude = numberOrNull(properties.longitude, coordinates && coordinates[0]);
      const latitude = numberOrNull(properties.latitude, coordinates && coordinates[1]);
      if (longitude === null || latitude === null) { invalid += 1; return; }
      if (!pointInsideBoundary([longitude, latitude], boundary)) { outside += 1; return; }
      if (isNormalizedPoint(properties)) { directFeatures.push(normalizedFeature(properties, longitude, latitude)); return; }
      const elevation = numberOrNull(properties.elevation_m, properties.elevation, properties.ele, properties.height_m, properties.height);
      const type = classify(properties, elevation);
      prepared.push({sourceIndex, sourceId: String(properties.id || '').trim(), type, longitude: Number(longitude.toFixed(6)), latitude: Number(latitude.toFixed(6)), elevation_m: elevation === null ? null : Math.round(elevation), name: ['main_mountain', 'five_thousander'].includes(type) ? cleanName(properties) : ''});
    });
    if (directFeatures.length && prepared.length) throw new Error('Файл точек смешивает нормализованную и исходную схемы.');
    let features = directFeatures;
    if (prepared.length) {
      prepared.sort((left, right) => TYPE_ORDER.indexOf(left.type) - TYPE_ORDER.indexOf(right.type) || left.sourceId.localeCompare(right.sourceId, 'en', {numeric: true}) || left.longitude - right.longitude || left.latitude - right.latitude || left.sourceIndex - right.sourceIndex);
      const counters = Object.fromEntries(TYPE_ORDER.map((type) => [type, 0]));
      features = prepared.map((point) => {
        counters[point.type] += 1;
        return normalizedFeature({id: `${config.categories[point.type].prefix}-${String(counters[point.type]).padStart(4, '0')}`, type: point.type, elevation_m: point.elevation_m, name: point.name}, point.longitude, point.latitude);
      });
    }
    const ids = new Set();
    const counts = Object.fromEntries(TYPE_ORDER.map((type) => [type, 0]));
    for (const feature of features) {
      const properties = feature.properties;
      if (ids.has(properties.id)) throw new Error(`Повторяющийся ID точки: ${properties.id}`);
      ids.add(properties.id);
      counts[properties.type] += 1;
    }
    return {collection: {type: 'FeatureCollection', features}, summary: {total: features.length, counts, invalid, outside, named: features.filter((feature) => Boolean(feature.properties.name)).length, withElevation: features.filter((feature) => feature.properties.elevation_m !== null).length}};
  }

  function normalizeBindings(source, mountains) {
    if (!Array.isArray(source)) throw new Error('Файл привязок фигурок должен содержать массив.');
    const points = new Map(mountains.features.map((feature) => [feature.properties.id, feature]));
    const pointIds = new Set();
    const iconCounts = Object.fromEntries(TYPE_ORDER.map((type) => [type, 0]));
    const tierCounts = {};
    const bindings = source.map((binding) => {
      const keys = Object.keys(binding || {}).sort();
      if (JSON.stringify(keys) !== JSON.stringify(BINDING_KEYS)) throw new Error('Привязка фигурки содержит лишние или отсутствующие поля.');
      const pointId = String(binding.point_id || '');
      const iconId = String(binding.icon_id || '');
      const point = points.get(pointId);
      if (!point) throw new Error(`Привязка ссылается на отсутствующую точку: ${pointId}`);
      if (pointIds.has(pointId)) throw new Error(`Повторная привязка фигурки к точке: ${pointId}`);
      if (!ICON_PATTERN.test(iconId) || iconId === 'mount-1') throw new Error(`Недопустимая фигурка: ${iconId}`);
      const minZoom = numberOrNull(binding.min_zoom);
      const iconScale = numberOrNull(binding.icon_scale);
      const baseShift = numberOrNull(binding.base_shift);
      const priority = numberOrNull(binding.priority);
      if (minZoom === null || iconScale === null || iconScale <= 0 || baseShift === null || Math.abs(baseShift) > 0.2 || priority === null) throw new Error(`Некорректная привязка: ${pointId}`);
      pointIds.add(pointId);
      iconCounts[point.properties.type] += 1;
      tierCounts[String(minZoom)] = (tierCounts[String(minZoom)] || 0) + 1;
      const properties = {...point.properties, point_id: pointId, icon_id: iconId, min_zoom: minZoom, icon_scale: iconScale, base_shift: baseShift, priority};
      return {binding: {point_id: pointId, icon_id: iconId, min_zoom: minZoom, icon_scale: iconScale, base_shift: baseShift, priority}, feature: {type: 'Feature', properties, geometry: point.geometry}};
    });
    const missing = [...points.keys()].filter((pointId) => !pointIds.has(pointId));
    if (missing.length) throw new Error(`Не все горные точки имеют фигурки: ${missing.length}`);
    return {bindings: bindings.map((item) => item.binding), collection: {type: 'FeatureCollection', features: bindings.map((item) => item.feature)}, summary: {total: bindings.length, counts: iconCounts, tiers: tierCounts}};
  }

  function normalizeIconManifest(source) {
    if (!source || !Array.isArray(source.icons) || !source.atlas) throw new Error('Манифест фигурок имеет неверный формат.');
    const ids = new Set();
    const icons = source.icons.map((icon) => {
      const id = String(icon.id || '');
      if (!ICON_PATTERN.test(id) || id === 'mount-1') throw new Error(`Недопустимая фигурка в манифесте: ${id}`);
      if (ids.has(id)) throw new Error(`Повторяющаяся фигурка в манифесте: ${id}`);
      ids.add(id);
      const x = numberOrNull(icon.x); const y = numberOrNull(icon.y); const width = numberOrNull(icon.width); const height = numberOrNull(icon.height);
      if ([x, y, width, height].some((value) => value === null) || width <= 0 || height <= 0) throw new Error(`Некорректная область фигурки: ${id}`);
      return {id, x, y, width, height};
    });
    return {version: String(source.version || config.version), atlas: String(source.atlas), atlas_width: Number(source.atlas_width), atlas_height: Number(source.atlas_height), pixel_ratio: Number(source.pixel_ratio || 2), icons};
  }

  function normalizeRivers(source) {
    if (!source || source.type !== 'FeatureCollection' || !Array.isArray(source.features)) throw new Error('Файл рек имеет неверный формат.');
    const ids = new Set();
    const tiers = {1: 0, 2: 0, 3: 0};
    const features = source.features.map((feature) => {
      const geometry = feature && feature.geometry;
      if (!geometry || !['LineString', 'MultiLineString'].includes(geometry.type)) throw new Error('Речной объект не является линией.');
      const properties = feature.properties || {};
      const systemId = String(properties.system_id || '');
      const name = String(properties.name_ru || '').trim();
      const tier = Number(properties.tier);
      if (!systemId || !name || ![1, 2, 3].includes(tier)) throw new Error('Речной объект не содержит system_id, name_ru или tier.');
      if (ids.has(systemId)) throw new Error(`Повторяющаяся речная система: ${systemId}`);
      ids.add(systemId); tiers[tier] += 1;
      return {type: 'Feature', properties: {system_id: systemId, name_ru: name, tier, width_class: tier === 1 ? 'major' : tier === 2 ? 'medium' : 'minor'}, geometry};
    });
    if (features.length !== 31) throw new Error(`Ожидалась 31 геометрия речных систем, получено ${features.length}.`);
    return {collection: {type: 'FeatureCollection', features}, summary: {features: features.length, representedSystems: 32, tiers, coverageAliases: [{id: 'ullukam', covered_by: 'kuban'}]}};
  }

  async function loadJson(url) {
    const response = await fetch(url, {cache: 'no-cache'});
    if (!response.ok) throw new Error(`Не загружен ${url} (HTTP ${response.status}).`);
    return response.json();
  }

  async function loadStageData() {
    const [rawBoundary, rawMountains, rawBindings, rawManifest, ...rawRiverParts] = await Promise.all([
      loadJson(config.boundaryUrl), loadJson(config.mountainSourceUrl), loadJson(config.iconBindingsUrl), loadJson(config.iconManifestUrl),
      ...config.riverSourceUrls.map(loadJson)
    ]);
    const boundary = normalizeBoundary(rawBoundary);
    const normalized = normalizeMountainPoints(rawMountains, boundary);
    const icons = normalizeBindings(rawBindings, normalized.collection);
    const iconManifest = normalizeIconManifest(rawManifest);
    const rivers = normalizeRivers({type: 'FeatureCollection', features: rawRiverParts.flatMap((part) => part.features || [])});
    return {boundary, mountains: normalized.collection, icons: icons.collection, iconBindings: icons.bindings, iconManifest, rivers: rivers.collection, summary: {...normalized.summary, icons: icons.summary, rivers: rivers.summary}, bounds: calculateBounds(boundary)};
  }

  return Object.freeze({TYPE_ORDER, POINT_KEYS, BINDING_KEYS, classify, calculateBounds, normalizeBoundary, normalizeMountainPoints, normalizeBindings, normalizeIconManifest, normalizeRivers, loadStageData});
});
