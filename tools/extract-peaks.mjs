import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';

const [vectorPath, demPath, outputPath] = process.argv.slice(2);
if (!vectorPath || !demPath || !outputPath) throw new Error('Usage: node extract-peaks.mjs <vector.pmtiles> <dem.pmtiles> <output.geojson>');

class NodeFileSource {
  constructor(filePath) { this.filePath = path.resolve(filePath); this.handlePromise = fs.open(this.filePath, 'r'); }
  getKey() { return this.filePath; }
  async getBytes(offset, length) {
    const handle = await this.handlePromise;
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buffer, 0, length, offset);
    if (bytesRead !== length) throw new Error(`Short read at ${offset}: ${bytesRead}/${length}`);
    return { data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + bytesRead) };
  }
  async close() { const handle = await this.handlePromise; await handle.close(); }
}
function worldPosition(lon, lat, zoom) {
  const n = 2 ** zoom;
  const wx = ((lon + 180) / 360) * n;
  const radians = lat * Math.PI / 180;
  const wy = (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * n;
  return {x: Math.max(0, Math.min(n - Number.EPSILON, wx)), y: Math.max(0, Math.min(n - Number.EPSILON, wy))};
}
function tileBounds(header, zoom) {
  const nw = worldPosition(Number(header.minLon), Number(header.maxLat), zoom);
  const se = worldPosition(Number(header.maxLon), Number(header.minLat), zoom);
  return {minX: Math.floor(nw.x), maxX: Math.floor(se.x), minY: Math.floor(nw.y), maxY: Math.floor(se.y)};
}
function stableKey(feature, geometry) {
  const properties = feature.properties || {};
  const sourceId = properties.osm_id ?? properties.id ?? properties.node_id ?? feature.id;
  if (sourceId !== undefined && sourceId !== null && String(sourceId) !== '') return `id:${sourceId}`;
  const [lon, lat] = geometry.coordinates;
  return `coord:${Number(lon).toFixed(7)}:${Number(lat).toFixed(7)}:${properties.name ?? properties.name_ru ?? ''}`;
}

const vectorSource = new NodeFileSource(vectorPath);
const demSource = new NodeFileSource(demPath);
const vector = new PMTiles(vectorSource);
const dem = new PMTiles(demSource);
const vectorHeader = await vector.getHeader();
const demHeader = await dem.getHeader();
const zoom = Number(vectorHeader.maxZoom);
const bounds = tileBounds(vectorHeader, zoom);
const features = new Map();
let tilesRead = 0;
let tilesWithPeaks = 0;
for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    const tileResponse = await vector.getZxy(zoom, x, y);
    if (!tileResponse?.data) continue;
    tilesRead += 1;
    const layer = new VectorTile(new Pbf(new Uint8Array(tileResponse.data))).layers.peak;
    if (!layer) continue;
    tilesWithPeaks += 1;
    for (let index = 0; index < layer.length; index += 1) {
      const vectorFeature = layer.feature(index);
      const geometry = vectorFeature.toGeoJSON(x, y, zoom).geometry;
      if (!geometry || geometry.type !== 'Point') continue;
      const properties = { ...vectorFeature.properties };
      const feature = {type: 'Feature', id: vectorFeature.id ?? undefined, properties, geometry};
      const key = stableKey(feature, geometry);
      if (!features.has(key)) features.set(key, feature);
    }
  }
}

const demZoom = Number(demHeader.maxZoom);
const demTileCache = new Map();
async function loadDemTile(x, y) {
  const key = `${demZoom}/${x}/${y}`;
  if (!demTileCache.has(key)) {
    demTileCache.set(key, (async () => {
      const response = await dem.getZxy(demZoom, x, y);
      if (!response?.data) return null;
      const decoded = await sharp(Buffer.from(response.data)).ensureAlpha().raw().toBuffer({resolveWithObject: true});
      return {data: decoded.data, width: decoded.info.width, height: decoded.info.height, channels: decoded.info.channels};
    })());
  }
  return demTileCache.get(key);
}
async function sampleElevation(lon, lat) {
  const world = worldPosition(lon, lat, demZoom);
  const tileX = Math.floor(world.x);
  const tileY = Math.floor(world.y);
  const tile = await loadDemTile(tileX, tileY);
  if (!tile) return null;
  const px = Math.max(0, Math.min(tile.width - 1, Math.floor((world.x - tileX) * tile.width)));
  const py = Math.max(0, Math.min(tile.height - 1, Math.floor((world.y - tileY) * tile.height)));
  const offset = (py * tile.width + px) * tile.channels;
  const r = tile.data[offset];
  const g = tile.data[offset + 1];
  const b = tile.data[offset + 2];
  const elevation = (r * 256 + g + b / 256) - 32768;
  return Number.isFinite(elevation) && elevation > -500 && elevation < 9000 ? Math.round(elevation) : null;
}

let sampled = 0;
let missing = 0;
for (const feature of features.values()) {
  const [lon, lat] = feature.geometry.coordinates;
  const elevation = await sampleElevation(Number(lon), Number(lat));
  if (elevation === null) missing += 1;
  else { feature.properties.elevation_m = elevation; sampled += 1; }
}
await vectorSource.close();
await demSource.close();
const metadata = {source: 'data/alan-vector-7.0.23.pmtiles', source_layer: 'peak', elevation_source: 'data/alan-dem-7.0.21.pmtiles', elevation_encoding: 'terrarium', zoom, dem_zoom: demZoom, tiles_read: tilesRead, tiles_with_peaks: tilesWithPeaks, feature_count: features.size, elevations_sampled: sampled, elevations_missing: missing, dem_tiles_decoded: demTileCache.size};
const collection = {type: 'FeatureCollection', metadata, features: [...features.values()]};
await fs.writeFile(outputPath, JSON.stringify(collection));
console.log(JSON.stringify(metadata));
if (!features.size) throw new Error('The peak source layer yielded no points.');
