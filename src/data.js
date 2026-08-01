(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./config.js'));
  } else {
    root.ALAN_12_1_DATA = factory(root.ALAN_12_1_CONFIG);
  }
})(typeof self !== 'undefined' ? self : this, function (config) {
  'use strict';

  const TYPE_ORDER = Object.freeze([
    'five_thousander',
    'main_mountain',
    'mountain',
    'rock',
    'ridge',
    'hill'
  ]);

  function numberOrNull() {
    for (const value of arguments) {
      if (value === null || value === undefined || value === '') continue;
      const number = Number(value);
      if (Number.isFinite(number)) return number;
    }
    return null;
  }

  function cleanName(properties) {
    return String(
      properties.name ||
      properties.name_ru ||
      properties.name_map ||
      properties.name_local ||
      ''
    ).trim();
  }

  function classify(properties, elevation) {
    const rawType = String(properties.object_type || properties.type || '').toLowerCase();
    const rawCategory = String(properties.category || '').toLowerCase();
    const sourceId = String(properties.id || '').toLowerCase();

    if (elevation !== null && elevation >= 5000) return 'five_thousander';
    if (
      properties.main === true || Number(properties.main) === 1 ||
      Number(properties.peak_level) === 1 ||
      ['main', 'major', 'primary'].includes(rawCategory)
    ) return 'main_mountain';
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
      const intersects = ((yi > y) !== (yj > y)) &&
        (x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi);
      if (intersects) inside = !inside;
    }
    return inside;
  }

  function pointInPolygon(point, rings) {
    if (!Array.isArray(rings) || !rings.length || !pointInRing(point, rings[0])) return false;
    for (let index = 1; index < rings.length; index += 1) {
      if (pointInRing(point, rings[index])) return false;
    }
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
      Math.min(bounds[0], coordinate[0]),
      Math.min(bounds[1], coordinate[1]),
      Math.max(bounds[2], coordinate[0]),
      Math.max(bounds[3], coordinate[1])
    ], [Infinity, Infinity, -Infinity, -Infinity]);
  }

  function normalizeBoundary(collection) {
    if (!collection || collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
      throw new Error('Файл границы имеет неверный формат.');
    }
    const features = collection.features
      .filter((feature) => ['Polygon', 'MultiPolygon'].includes(feature && feature.geometry && feature.geometry.type))
      .map((feature) => ({
        type: 'Feature',
        properties: {id: 'karachay-balkaria-nalsana'},
        geometry: feature.geometry
      }));
    if (!features.length) throw new Error('В файле не найдена рабочая граница.');
    return {type: 'FeatureCollection', features};
  }

  function normalizeMountainPoints(source, boundary) {
    if (!source || source.type !== 'FeatureCollection' || !Array.isArray(source.features)) {
      throw new Error('Файл горных точек имеет неверный формат.');
    }

    const prepared = [];
    let invalid = 0;
    let outside = 0;

    source.features.forEach((feature, sourceIndex) => {
      const coordinates = feature && feature.geometry && feature.geometry.type === 'Point'
        ? feature.geometry.coordinates
        : null;
      const longitude = coordinates ? numberOrNull(coordinates[0]) : null;
      const latitude = coordinates ? numberOrNull(coordinates[1]) : null;
      if (longitude === null || latitude === null) {
        invalid += 1;
        return;
      }
      const point = [longitude, latitude];
      if (!pointInsideBoundary(point, boundary)) {
        outside += 1;
        return;
      }
      const properties = feature.properties || {};
      const elevation = numberOrNull(properties.elevation_m, properties.ele, properties.height_m, properties.height);
      const type = classify(properties, elevation);
      prepared.push({
        sourceIndex,
        sourceId: String(properties.id || '').trim(),
        type,
        longitude: Number(longitude.toFixed(6)),
        latitude: Number(latitude.toFixed(6)),
        elevation_m: elevation === null ? null : Math.round(elevation),
        name: ['main_mountain', 'five_thousander'].includes(type) ? cleanName(properties) : ''
      });
    });

    prepared.sort((left, right) => {
      const typeDifference = TYPE_ORDER.indexOf(left.type) - TYPE_ORDER.indexOf(right.type);
      if (typeDifference) return typeDifference;
      const idDifference = left.sourceId.localeCompare(right.sourceId, 'en', {numeric: true});
      if (idDifference) return idDifference;
      if (left.longitude !== right.longitude) return left.longitude - right.longitude;
      if (left.latitude !== right.latitude) return left.latitude - right.latitude;
      return left.sourceIndex - right.sourceIndex;
    });

    const counters = Object.fromEntries(TYPE_ORDER.map((type) => [type, 0]));
    const counts = Object.fromEntries(TYPE_ORDER.map((type) => [type, 0]));
    const features = prepared.map((point) => {
      counters[point.type] += 1;
      counts[point.type] += 1;
      const prefix = config.categories[point.type].prefix;
      const id = `${prefix}-${String(counters[point.type]).padStart(4, '0')}`;
      return {
        type: 'Feature',
        properties: {
          id,
          type: point.type,
          longitude: point.longitude,
          latitude: point.latitude,
          elevation_m: point.elevation_m,
          name: point.name
        },
        geometry: {
          type: 'Point',
          coordinates: [point.longitude, point.latitude]
        }
      };
    });

    return {
      collection: {type: 'FeatureCollection', features},
      summary: {
        total: features.length,
        counts,
        invalid,
        outside,
        named: features.filter((feature) => Boolean(feature.properties.name)).length
      }
    };
  }

  async function loadJson(url) {
    const response = await fetch(url, {cache: 'no-cache'});
    if (!response.ok) throw new Error(`Не загружен ${url} (HTTP ${response.status}).`);
    return response.json();
  }

  async function loadStageData() {
    const [rawBoundary, rawMountains] = await Promise.all([
      loadJson(config.boundaryUrl),
      loadJson(config.mountainSourceUrl)
    ]);
    const boundary = normalizeBoundary(rawBoundary);
    const normalized = normalizeMountainPoints(rawMountains, boundary);
    return {
      boundary,
      mountains: normalized.collection,
      summary: normalized.summary,
      bounds: calculateBounds(boundary)
    };
  }

  return Object.freeze({
    TYPE_ORDER,
    classify,
    calculateBounds,
    normalizeBoundary,
    normalizeMountainPoints,
    loadStageData
  });
});
