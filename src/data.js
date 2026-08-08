import { CONFIG } from './config.js';

const CATEGORY_SET = new Set(Object.keys(CONFIG.categories));

async function loadJson(url) {
  const response = await fetch(url, {cache: 'no-store'});
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

function validateBoundary(value) {
  if (value?.type !== 'FeatureCollection' || !Array.isArray(value.features) || !value.features.length) {
    throw new Error('Некорректный map-boundary.geojson');
  }
  const valid = value.features.every((feature) => ['Polygon', 'MultiPolygon'].includes(feature?.geometry?.type));
  if (!valid) throw new Error('Граница должна содержать только Polygon/MultiPolygon.');
  return value;
}

function validateMountains(value) {
  if (value?.type !== 'FeatureCollection' || !Array.isArray(value.features)) {
    throw new Error('Некорректный mountains.geojson');
  }
  const ids = new Set();
  let mingi = 0;
  for (const feature of value.features) {
    if (feature?.geometry?.type !== 'Point') throw new Error('Все горные объекты должны быть Point.');
    const [lon, lat] = feature.geometry.coordinates || [];
    const p = feature.properties || {};
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90) {
      throw new Error(`Некорректные координаты: ${p.id || 'без id'}`);
    }
    if (!p.id || ids.has(p.id)) throw new Error(`Пустой или повторный id: ${p.id || 'без id'}`);
    if (!CATEGORY_SET.has(p.category)) throw new Error(`Неизвестная категория ${p.category}: ${p.id}`);
    ids.add(p.id);
    if (p.id === 'mingi_tau') mingi += 1;
    if (/эльбрус/i.test(String(p.name || '')) && p.id !== 'mingi_tau') {
      throw new Error(`Обнаружен отдельный дубль Эльбруса: ${p.id}`);
    }
  }
  if (mingi !== 1) throw new Error(`Ожидалась одна точка mingi_tau, получено ${mingi}.`);
  return value;
}

function collectCoordinates(geometry, target) {
  const value = geometry?.coordinates;
  const walk = (node) => {
    if (!Array.isArray(node)) return;
    if (node.length >= 2 && Number.isFinite(node[0]) && Number.isFinite(node[1])) {
      target.push([node[0], node[1]]);
      return;
    }
    node.forEach(walk);
  };
  walk(value);
}

export function boundsOf(collection) {
  const points = [];
  collection.features.forEach((feature) => collectCoordinates(feature.geometry, points));
  if (!points.length) throw new Error('Невозможно вычислить границы карты.');
  return points.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [Infinity, Infinity, -Infinity, -Infinity]);
}

export function summarizeMountains(collection) {
  const categories = Object.fromEntries(Object.keys(CONFIG.categories).map((key) => [key, 0]));
  let main = 0;
  let five = 0;
  for (const feature of collection.features) {
    categories[feature.properties.category] += 1;
    if (feature.properties.main) main += 1;
    if (feature.properties.five_thousander) five += 1;
  }
  return {total: collection.features.length, categories, main, five};
}

export async function loadCanonicalData() {
  const [boundary, mountains] = await Promise.all([loadJson(CONFIG.boundaryUrl), loadJson(CONFIG.mountainsUrl)]);
  return {boundary: validateBoundary(boundary), mountains: validateMountains(mountains)};
}
