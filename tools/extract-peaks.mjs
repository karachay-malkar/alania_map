import fs from 'node:fs/promises';
import path from 'node:path';
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';

const [archivePath, outputPath] = process.argv.slice(2);
if (!archivePath || !outputPath) throw new Error('Usage: node extract-peaks.mjs <archive.pmtiles> <output.geojson>');

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
function lonToTileX(lon, zoom) { const n = 2 ** zoom; return Math.max(0, Math.min(n - 1, Math.floor(((lon + 180) / 360) * n))); }
function latToTileY(lat, zoom) { const n = 2 ** zoom; const radians = lat * Math.PI / 180; return Math.max(0, Math.min(n - 1, Math.floor((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * n))); }
function stableKey(feature, geometry) {
  const properties = feature.properties || {};
  const sourceId = properties.osm_id ?? properties.id ?? properties.node_id ?? feature.id;
  if (sourceId !== undefined && sourceId !== null && String(sourceId) !== '') return `id:${sourceId}`;
  const [lon, lat] = geometry.coordinates;
  return `coord:${Number(lon).toFixed(7)}:${Number(lat).toFixed(7)}:${properties.name ?? properties['name:ru'] ?? ''}`;
}

const source = new NodeFileSource(archivePath);
const archive = new PMTiles(source);
const header = await archive.getHeader();
const zoom = Number(header.maxZoom);
const minX = lonToTileX(Number(header.minLon), zoom);
const maxX = lonToTileX(Number(header.maxLon), zoom);
const minY = latToTileY(Number(header.maxLat), zoom);
const maxY = latToTileY(Number(header.minLat), zoom);
const features = new Map();
const propertyKeys = new Set();
const propertySamples = [];
let tilesRead = 0;
let tilesWithPeaks = 0;
for (let x = minX; x <= maxX; x += 1) {
  for (let y = minY; y <= maxY; y += 1) {
    const tileResponse = await archive.getZxy(zoom, x, y);
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
      Object.keys(properties).forEach(key => propertyKeys.add(key));
      if (propertySamples.length < 8) propertySamples.push(properties);
      const feature = { type: 'Feature', id: vectorFeature.id ?? undefined, properties, geometry };
      const key = stableKey(feature, geometry);
      if (!features.has(key)) features.set(key, feature);
    }
  }
}
await source.close();
const metadata = { source: 'data/alan-vector-7.0.23.pmtiles', source_layer: 'peak', zoom, tiles_read: tilesRead, tiles_with_peaks: tilesWithPeaks, feature_count: features.size, property_keys: [...propertyKeys].sort(), property_samples: propertySamples };
const collection = { type: 'FeatureCollection', metadata, features: [...features.values()] };
await fs.writeFile(outputPath, JSON.stringify(collection));
console.log(JSON.stringify(metadata));
if (!features.size) throw new Error('The peak source layer yielded no points.');
