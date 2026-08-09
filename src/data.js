import { CONFIG } from './config.js';

const CATEGORY_SET = new Set(Object.keys(CONFIG.categories));
const ICON_ID = /^(rounded_hill|rounded_mountain|steep_mountain|isolated_peak|massif|ridge|rocky_peak|rocky_ridge|plateau)_0[1-4]$/;

async function loadJson(url) {
  const response = await fetch(url);
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

function validateIconMountains(value, mountains) {
  if (value?.type !== 'FeatureCollection' || !Array.isArray(value.features) || value.features.length !== 1500) {
    throw new Error(`Ожидалось ровно 1500 точек фигурок, получено ${value?.features?.length ?? 0}.`);
  }
  const canonical = new Map(mountains.features.map((feature) => [feature.properties.id, feature]));
  const ids = new Set();
  for (const feature of value.features) {
    const p = feature.properties || {};
    if (feature?.geometry?.type !== 'Point') throw new Error(`Объект фигурки ${p.id || '?'} не Point.`);
    if (!p.id || ids.has(p.id)) throw new Error(`Повторный id фигурки: ${p.id || '?'}`);
    if (!CATEGORY_SET.has(p.category)) throw new Error(`Неизвестная категория фигурки ${p.category}: ${p.id}`);
    if (!ICON_ID.test(String(p.icon || '')) || !String(p.icon).startsWith(`${p.category}_`)) {
      throw new Error(`Неверная иконка ${p.icon}: ${p.id}`);
    }
    if (![1, 2, 3].includes(Number(p.reveal_tier))) throw new Error(`Неверный reveal_tier: ${p.id}`);
    if (!(Number(p.icon_size_ref) > 0)) throw new Error(`Неверный icon_size_ref: ${p.id}`);
    const source = canonical.get(p.id);
    if (!source || source.properties.main) throw new Error(`Точка фигурки не является обычной канонической горой: ${p.id}`);
    if (source.properties.category !== p.category) throw new Error(`Категория фигурки не совпадает с каноном: ${p.id}`);
    ids.add(p.id);
  }
  return value;
}

function validateAtlasManifest(value) {
  if (!value || value.atlas_width !== 800 || value.atlas_height !== 1350 || value.cell_width !== 200 || value.cell_height !== 150) {
    throw new Error('Некорректная геометрия atlas-manifest.json');
  }
  if (value.source !== 'mountain_icons_final_9_categories(1).zip') {
    throw new Error('Неверный исходный источник атласа гор.');
  }
  if (value.optimization_reference !== 'mountain_icons_final_9_categories_optimized_webp_768(1).zip') {
    throw new Error('Неверная ссылка на оптимизированную библиотеку гор.');
  }
  if (value.atlas !== 'assets/mountains/mountain-atlas.webp') {
    throw new Error('Runtime должен использовать единый WebP-атлас.');
  }
  if (!Array.isArray(value.icons) || value.icons.length !== 36) throw new Error('Атлас должен содержать 36 фигурок.');
  const ids = new Set();
  const categoryCounts = Object.fromEntries([...CATEGORY_SET].map((key) => [key, 0]));
  for (const icon of value.icons) {
    if (!ICON_ID.test(icon.id) || ids.has(icon.id)) throw new Error(`Некорректный icon id: ${icon.id}`);
    if (!CATEGORY_SET.has(icon.category)) throw new Error(`Некорректная категория атласа: ${icon.id}`);
    ids.add(icon.id);
    categoryCounts[icon.category] += 1;
  }
  if (Object.values(categoryCounts).some((count) => count !== 4)) throw new Error('В каждой категории атласа должно быть 4 варианта.');
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

export function summarizeMountains(mountains, iconMountains) {
  const categories = Object.fromEntries(Object.keys(CONFIG.categories).map((key) => [key, 0]));
  let main = 0;
  let five = 0;
  for (const feature of mountains.features) {
    if (feature.properties.main) main += 1;
    if (feature.properties.five_thousander) five += 1;
  }
  for (const feature of iconMountains.features) categories[feature.properties.category] += 1;
  return {total: mountains.features.length, iconTotal: iconMountains.features.length, categories, main, five};
}

export async function loadCanonicalData() {
  const [boundaryRaw, mountainsRaw, iconMountainsRaw, atlasManifestRaw] = await Promise.all([
    loadJson(CONFIG.boundaryUrl),
    loadJson(CONFIG.mountainsUrl),
    loadJson(CONFIG.iconMountainsUrl),
    loadJson(CONFIG.atlasManifestUrl)
  ]);
  const boundary = validateBoundary(boundaryRaw);
  const mountains = validateMountains(mountainsRaw);
  const iconMountains = validateIconMountains(iconMountainsRaw, mountains);
  const atlasManifest = validateAtlasManifest(atlasManifestRaw);
  return {boundary, mountains, iconMountains, atlasManifest};
}
