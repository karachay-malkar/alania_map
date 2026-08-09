import fs from 'node:fs';
import crypto from 'node:crypto';

const readJson = (path) => JSON.parse(fs.readFileSync(path, 'utf8'));
const categories = new Set(['rounded_hill','rounded_mountain','steep_mountain','isolated_peak','massif','ridge','rocky_peak','rocky_ridge','plateau']);

const boundary = readJson('data/map-boundary.geojson');
const mountains = readJson('data/mountains.geojson');
const icons = readJson('data/mountain-icons-1500.geojson');
const report = readJson('data/icon-layer-report.json');
const manifest = readJson('assets/mountains/atlas-manifest.json');
const atlasPath = 'assets/mountains/mountain-atlas.webp';

if (boundary.type !== 'FeatureCollection' || !boundary.features?.length) throw new Error('boundary invalid');
if (mountains.type !== 'FeatureCollection' || mountains.features.length !== 3798) throw new Error(`mountains: ${mountains.features?.length}`);
if (icons.type !== 'FeatureCollection' || icons.features.length !== 1500) throw new Error(`icon points: ${icons.features?.length}`);
if (manifest.version !== 'Slippy Map 1.0.1') throw new Error('atlas version mismatch');
if (manifest.source !== 'mountain_icons_final_9_categories(1).zip') throw new Error('atlas source mismatch');
if (manifest.optimization_reference !== 'mountain_icons_final_9_categories_optimized_webp_768(1).zip') throw new Error('optimization reference mismatch');
if (manifest.atlas !== atlasPath) throw new Error('atlas runtime path mismatch');
if (manifest.icons?.length !== 36) throw new Error(`atlas icons: ${manifest.icons?.length}`);
if (manifest.atlas_width !== 800 || manifest.atlas_height !== 1350 || manifest.cell_width !== 200 || manifest.cell_height !== 150) throw new Error('atlas geometry mismatch');
if (!fs.existsSync(atlasPath) || fs.statSync(atlasPath).size < 50000) throw new Error('atlas webp missing');
const atlasBytes = fs.readFileSync(atlasPath);
const atlasHash = crypto.createHash('sha256').update(atlasBytes).digest('hex');
if (!manifest.sha256_webp || manifest.sha256_webp !== atlasHash) throw new Error('atlas webp hash mismatch');

const canonical = new Map(mountains.features.map((f) => [f.properties.id, f]));
const ids = new Set();
for (const feature of icons.features) {
  const p = feature.properties || {};
  if (!p.id || ids.has(p.id)) throw new Error(`duplicate icon id: ${p.id}`);
  ids.add(p.id);
  if (!categories.has(p.category)) throw new Error(`bad category ${p.category}`);
  if (canonical.get(p.id)?.properties?.main) throw new Error(`main object has image: ${p.id}`);
  if (!canonical.has(p.id)) throw new Error(`unknown icon point: ${p.id}`);
  if (!String(p.icon).startsWith(`${p.category}_`)) throw new Error(`icon/category mismatch: ${p.id}`);
  if (![1,2,3].includes(Number(p.reveal_tier))) throw new Error(`bad reveal tier: ${p.id}`);
  if (!(Number(p.icon_size_ref) > 0)) throw new Error(`bad icon size: ${p.id}`);
}

const atlasIds = new Set();
const categoryCounts = Object.fromEntries([...categories].map((key) => [key, 0]));
for (const icon of manifest.icons) {
  if (!icon.id || atlasIds.has(icon.id)) throw new Error(`duplicate atlas icon: ${icon.id}`);
  if (!categories.has(icon.category)) throw new Error(`bad atlas category: ${icon.category}`);
  if (!icon.id.startsWith(`${icon.category}_`)) throw new Error(`atlas icon/category mismatch: ${icon.id}`);
  atlasIds.add(icon.id);
  categoryCounts[icon.category] += 1;
}
if (Object.values(categoryCounts).some((count) => count !== 4)) throw new Error('atlas category variants must be 4 each');

const mingi = mountains.features.filter((f) => f.properties.id === 'mingi_tau');
if (mingi.length !== 1 || mingi[0].properties.name !== 'Минги-тау' || mingi[0].properties.alias_ru !== 'Эльбрус') throw new Error('mingi_tau invalid');
if (report.selected_points !== 1500) throw new Error('report selected_points mismatch');
if (report.min_selected_spacing_m < 1500) throw new Error(`selected spacing too small: ${report.min_selected_spacing_m}`);
if (report.max_source_to_selected_m > 2000) throw new Error(`source coverage gap too large: ${report.max_source_to_selected_m}`);
if (Object.values(report.reveal_tiers).some((count) => count !== 500)) throw new Error('reveal tiers must be 500/500/500');

console.log(JSON.stringify({
  ok: true,
  mountains: mountains.features.length,
  icon_points: icons.features.length,
  main: mountains.features.filter((f) => f.properties.main).length,
  five_thousanders: mountains.features.filter((f) => f.properties.five_thousander).length,
  min_selected_spacing_m: report.min_selected_spacing_m,
  max_source_gap_m: report.max_source_to_selected_m,
  atlas_icons: manifest.icons.length,
  atlas_format: 'webp',
  atlas_bytes: atlasBytes.length,
  atlas_sha256: atlasHash
}, null, 2));
