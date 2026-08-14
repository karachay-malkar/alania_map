(() => {
  'use strict';

  const VERSION = '7.1';
  const MANIFEST_PATH = 'data/shards-manifest.json';
  const MAX_CACHED_SHARDS = 16;

  const root = document.getElementById('alan-map-root');
  if (!root) throw new Error('Alan Map root container was not found.');

  document.documentElement.classList.add('alan-map-document');
  document.body.classList.add('alan-map-document');
  root.classList.add('alan-map-viewport-root');

  let resizeFrame = null;
  let orientationTimer = null;
  let mapInstance = null;

  class ShardLruCache {
    constructor(maxEntries) {
      this.maxEntries = maxEntries;
      this.entries = new Map();
      this.hits = 0;
      this.misses = 0;
      this.evictions = 0;
    }

    getOrCreate(key, factory) {
      if (this.entries.has(key)) {
        const existing = this.entries.get(key);
        this.entries.delete(key);
        this.entries.set(key, existing);
        this.hits += 1;
        return existing;
      }

      this.misses += 1;
      const promise = Promise.resolve()
        .then(factory)
        .catch((error) => {
          if (this.entries.get(key) === promise) this.entries.delete(key);
          throw error;
        });
      this.entries.set(key, promise);
      while (this.entries.size > this.maxEntries) {
        const oldestKey = this.entries.keys().next().value;
        if (oldestKey === undefined) break;
        this.entries.delete(oldestKey);
        this.evictions += 1;
      }
      return promise;
    }

    diagnostics() {
      return {
        maxEntries: this.maxEntries,
        entries: this.entries.size,
        hits: this.hits,
        misses: this.misses,
        evictions: this.evictions
      };
    }
  }

  class ShardedPmtilesSource {
    constructor(archivePath, archiveManifest, cache) {
      this.archivePath = archivePath;
      this.archiveUrl = new URL(archivePath, document.baseURI).href;
      this.partsUrl = new URL(archiveManifest.parts_path, document.baseURI);
      this.byteLength = Number(archiveManifest.byte_length);
      this.shardSize = Number(archiveManifest.shard_size);
      this.shards = archiveManifest.shards;
      this.cache = cache;
      this.requests = 0;
      this.loaded = new Set();
      this.validateManifest();
    }

    validateManifest() {
      if (!Number.isSafeInteger(this.byteLength) || this.byteLength <= 0) {
        throw new Error(`Alan Map: неверный размер архива ${this.archivePath} в манифесте.`);
      }
      if (!Number.isSafeInteger(this.shardSize) || this.shardSize <= 0 || !Array.isArray(this.shards) || !this.shards.length) {
        throw new Error(`Alan Map: повреждён список фрагментов ${this.archivePath}.`);
      }
      let total = 0;
      this.shards.forEach((shard, index) => {
        const expectedName = `part-${String(index).padStart(3, '0')}.bin`;
        if (shard.file !== expectedName || !Number.isSafeInteger(Number(shard.size)) || Number(shard.size) <= 0) {
          throw new Error(`Alan Map: неверная запись фрагмента ${expectedName} в ${MANIFEST_PATH}.`);
        }
        total += Number(shard.size);
      });
      if (total !== this.byteLength) {
        throw new Error(`Alan Map: сумма фрагментов ${this.archivePath} (${total}) не совпадает с размером архива (${this.byteLength}).`);
      }
    }

    getKey() {
      return this.archiveUrl;
    }

    async loadShard(index) {
      const descriptor = this.shards[index];
      if (!descriptor) {
        throw new Error(`Alan Map: фрагмент part-${String(index).padStart(3, '0')}.bin отсутствует в манифесте ${this.archivePath}.`);
      }
      const cacheKey = `${this.archivePath}:${descriptor.file}`;
      return this.cache.getOrCreate(cacheKey, async () => {
        this.requests += 1;
        const url = new URL(descriptor.file, this.partsUrl).href;
        const response = await fetch(url, {cache: index === 0 ? 'no-cache' : 'default'});
        if (!response.ok) {
          throw new Error(`Alan Map: не загружен ${this.archivePath} / ${descriptor.file} (HTTP ${response.status}).`);
        }
        const buffer = await response.arrayBuffer();
        const expectedSize = Number(descriptor.size);
        if (buffer.byteLength !== expectedSize) {
          throw new Error(
            `Alan Map: повреждён ${this.archivePath} / ${descriptor.file}: получено ${buffer.byteLength} байт, ожидалось ${expectedSize}.`
          );
        }
        this.loaded.add(index);
        document.dispatchEvent(new CustomEvent('alan-map:pmtiles-shard-loaded', {
          detail: {archivePath: this.archivePath, file: descriptor.file, size: buffer.byteLength}
        }));
        return buffer;
      });
    }

    async getBytes(offset, length, signal) {
      if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
      if (
        !Number.isSafeInteger(offset) || !Number.isSafeInteger(length) ||
        offset < 0 || length < 0 || offset + length > this.byteLength
      ) {
        throw new RangeError(`Alan Map: неверный диапазон ${this.archivePath} ${offset}:${length}.`);
      }

      const output = new Uint8Array(length);
      let sourceOffset = offset;
      let outputOffset = 0;
      while (outputOffset < length) {
        if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
        const shardIndex = Math.floor(sourceOffset / this.shardSize);
        const shardOffset = sourceOffset % this.shardSize;
        const shard = new Uint8Array(await this.loadShard(shardIndex));
        const copyLength = Math.min(length - outputOffset, shard.length - shardOffset);
        if (copyLength <= 0) {
          const file = this.shards[shardIndex]?.file || `part-${String(shardIndex).padStart(3, '0')}.bin`;
          throw new Error(`Alan Map: диапазон ${offset}:${length} выходит за фактический размер ${this.archivePath} / ${file}.`);
        }
        output.set(shard.subarray(shardOffset, shardOffset + copyLength), outputOffset);
        sourceOffset += copyLength;
        outputOffset += copyLength;
      }
      return {data: output.buffer};
    }

    diagnostics() {
      return {
        archivePath: this.archivePath,
        byteLength: this.byteLength,
        shardCount: this.shards.length,
        loadedShardCount: this.loaded.size,
        requests: this.requests
      };
    }
  }

  function viewportHeight() {
    const visualHeight = Number(window.visualViewport?.height || 0);
    const innerHeight = Number(window.innerHeight || 0);
    const documentHeight = Number(document.documentElement.clientHeight || 0);
    return Math.max(1, Math.round(visualHeight || innerHeight || documentHeight || 1));
  }

  function applyViewportHeight() {
    const height = viewportHeight();
    document.documentElement.style.setProperty('--alan-map-viewport-height', `${height}px`);
    root.style.height = `${height}px`;
    if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = null;
      mapInstance?.resize();
    });
  }

  function queueOrientationResize() {
    clearTimeout(orientationTimer);
    applyViewportHeight();
    orientationTimer = setTimeout(applyViewportHeight, 180);
  }

  async function loadShardManifest() {
    const response = await fetch(new URL(MANIFEST_PATH, document.baseURI).href, {cache: 'no-cache'});
    if (!response.ok) throw new Error(`Alan Map: не загружен ${MANIFEST_PATH} (HTTP ${response.status}).`);
    const manifest = await response.json();
    if (manifest?.schema_version !== 1 || !manifest.archives || typeof manifest.archives !== 'object') {
      throw new Error(`Alan Map: повреждён ${MANIFEST_PATH}.`);
    }
    return manifest;
  }

  async function start() {
    if (!window.pmtiles?.Protocol || !window.pmtiles?.PMTiles) {
      throw new Error('Alan Map: локальный PMTiles-модуль не подключён.');
    }
    const data = window.ALAN_MAP_DATA;
    if (!data?.regionalDem?.archivePath || !data?.regionalVector?.archivePath) {
      throw new Error('Alan Map: в данных отсутствуют пути локальных PMTiles.');
    }

    const manifest = await loadShardManifest();
    const archivePaths = [data.regionalDem.archivePath, data.regionalVector.archivePath, data.regionalLandcover?.archivePath].filter(Boolean);
    const cache = new ShardLruCache(MAX_CACHED_SHARDS);
    const sources = [];
    const protocol = new window.pmtiles.Protocol();

    for (const archivePath of archivePaths) {
      const archiveManifest = manifest.archives[archivePath];
      if (!archiveManifest) throw new Error(`Alan Map: архив ${archivePath} отсутствует в ${MANIFEST_PATH}.`);
      const source = new ShardedPmtilesSource(archivePath, archiveManifest, cache);
      sources.push(source);
      protocol.add(new window.pmtiles.PMTiles(source));
    }

    window.maplibregl.addProtocol('pmtiles', protocol.tile);
    window.ALAN_MAP_PMTILES_PROTOCOL = protocol;
    window.ALAN_MAP_PMTILES_SHARD_DIAGNOSTICS = () => ({
      manifestVersion: manifest.generated_at || null,
      cache: cache.diagnostics(),
      archives: sources.map((source) => source.diagnostics())
    });

    applyViewportHeight();
    mapInstance = window.AlanMap.mount(root, {
      data,
      maplibregl: window.maplibregl,
      regionalLabels3D: window.RegionalLabels3D,
      storageKey: `alan-map-stage${VERSION}-view`
    });
    window.ALAN_MAP_INSTANCE = mapInstance;

    window.addEventListener('resize', applyViewportHeight, {passive: true});
    window.addEventListener('orientationchange', queueOrientationResize, {passive: true});
    window.visualViewport?.addEventListener('resize', applyViewportHeight, {passive: true});
    document.addEventListener('fullscreenchange', applyViewportHeight);
    document.addEventListener('webkitfullscreenchange', applyViewportHeight);
  }

  start().catch((error) => {
    console.error(error);
    root.innerHTML = `<div class="alan-map-fatal-error">Карта не загрузилась: ${String(error?.message || error)}</div>`;
    root.dispatchEvent(new CustomEvent('alan-map:error', {detail: {message: String(error?.message || error)}}));
  });
})();
