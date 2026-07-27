

(() => {
  'use strict';

  const root = document.getElementById('alan-map-root');
  if (!root) throw new Error('Alan Map root container was not found.');

  document.documentElement.classList.add('alan-map-document');
  document.body.classList.add('alan-map-document');
  root.classList.add('alan-map-viewport-root');

  let resizeFrame = null;
  let orientationTimer = null;
  let mapInstance = null;
  if (!window.pmtiles?.Protocol) throw new Error('Alan Map: локальный PMTiles-модуль не подключён.');

  const PMTILES_SHARD_SIZE = 786432;
  const PMTILES_SHARDS = [
    {
      archivePath: 'data/alan-dem-7.0.21.pmtiles',
      partsPath: 'data/shards/dem/',
      byteLength: 34261814
    },
    {
      archivePath: 'data/alan-vector-7.0.21.pmtiles',
      partsPath: 'data/shards/vector/',
      byteLength: 13549632
    }
  ];

  class ShardedPmtilesSource {
    constructor(archiveUrl, partsUrl, byteLength, shardSize = PMTILES_SHARD_SIZE) {
      this.archiveUrl = archiveUrl;
      this.partsUrl = partsUrl;
      this.byteLength = byteLength;
      this.shardSize = shardSize;
      this.cache = new Map();
    }

    getKey() {
      return this.archiveUrl;
    }

    async loadShard(index) {
      if (this.cache.has(index)) return this.cache.get(index);
      const fileName = `part-${String(index).padStart(3, '0')}.bin`;
      const request = fetch(new URL(fileName, this.partsUrl).href, {cache: 'force-cache'})
        .then((response) => {
          if (!response.ok) throw new Error(`Alan Map: не загружен фрагмент ${fileName} (${response.status}).`);
          return response.arrayBuffer();
        });
      this.cache.set(index, request);
      try {
        return await request;
      } catch (error) {
        this.cache.delete(index);
        throw error;
      }
    }

    async getBytes(offset, length, signal) {
      if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > this.byteLength) {
        throw new RangeError(`Alan Map: неверный диапазон PMTiles ${offset}:${length}.`);
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
        if (copyLength <= 0) throw new Error(`Alan Map: повреждён фрагмент PMTiles ${shardIndex}.`);
        output.set(shard.subarray(shardOffset, shardOffset + copyLength), outputOffset);
        sourceOffset += copyLength;
        outputOffset += copyLength;
      }
      return {data: output.buffer};
    }
  }

  const pmtilesProtocol = new window.pmtiles.Protocol();
  for (const archive of PMTILES_SHARDS) {
    const archiveUrl = new URL(archive.archivePath, document.baseURI).href;
    const partsUrl = new URL(archive.partsPath, document.baseURI).href;
    pmtilesProtocol.add(new window.pmtiles.PMTiles(
      new ShardedPmtilesSource(archiveUrl, partsUrl, archive.byteLength)
    ));
  }
  window.maplibregl.addProtocol('pmtiles', pmtilesProtocol.tile);
  window.ALAN_MAP_PMTILES_PROTOCOL = pmtilesProtocol;

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

  applyViewportHeight();

  mapInstance = window.AlanMap.mount(root, {
    data: window.ALAN_MAP_DATA,
    maplibregl: window.maplibregl,
    regionalLabels3D: window.RegionalLabels3D,
    storageKey: 'alan-map-stage7.0.21-view'
  });
  window.ALAN_MAP_INSTANCE = mapInstance;

  window.addEventListener('resize', applyViewportHeight, {passive: true});
  window.addEventListener('orientationchange', queueOrientationResize, {passive: true});
  window.visualViewport?.addEventListener('resize', applyViewportHeight, {passive: true});
  document.addEventListener('fullscreenchange', applyViewportHeight);
  document.addEventListener('webkitfullscreenchange', applyViewportHeight);
})();

  
  