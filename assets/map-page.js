(() => {
  'use strict';

  const VERSION = '7.2';
  const RANGE_CACHE_BYTES = (() => {
    const memory = Number(navigator.deviceMemory || 0);
    if (memory > 0 && memory <= 2) return 12 * 1024 * 1024;
    if (memory > 0 && memory <= 4) return 24 * 1024 * 1024;
    return 40 * 1024 * 1024;
  })();
  const RANGE_CACHE_ENTRIES = 256;
  const PREFETCH_NEIGHBORS = Object.freeze([[1,0],[-1,0],[0,1],[0,-1]]);

  const root = document.getElementById('alan-map-root');
  if (!root) throw new Error('Alan Map root container was not found.');

  document.documentElement.classList.add('alan-map-document');
  document.body.classList.add('alan-map-document');
  root.classList.add('alan-map-viewport-root');

  let resizeFrame = null;
  let orientationTimer = null;
  let mapInstance = null;
  const startedAt = performance.now();
  const performanceState = {
    readyMs:null,
    firstIdleMs:null,
    renderFrames:0,
    renderFps:null,
    renderIntervals:[],
    lastRenderAt:null,
    prefetchRuns:0,
    prefetchedTiles:0,
    prefetchErrors:0
  };

  class RangeLruCache {
    constructor(maxEntries, maxBytes) {
      this.maxEntries = maxEntries;
      this.maxBytes = maxBytes;
      this.entries = new Map();
      this.pending = new Map();
      this.bytes = 0;
      this.hits = 0;
      this.misses = 0;
      this.evictions = 0;
    }

    get(key) {
      const record = this.entries.get(key);
      if (!record) return null;
      this.entries.delete(key);
      this.entries.set(key, record);
      this.hits += 1;
      return record.value;
    }

    remember(key, value) {
      const size = Number(value?.data?.byteLength || 0);
      if (!Number.isFinite(size) || size <= 0 || size > this.maxBytes) return value;
      if (this.entries.has(key)) {
        this.bytes -= this.entries.get(key).size;
        this.entries.delete(key);
      }
      this.entries.set(key, {value, size});
      this.bytes += size;
      while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
        const oldestKey = this.entries.keys().next().value;
        if (oldestKey === undefined) break;
        const oldest = this.entries.get(oldestKey);
        this.entries.delete(oldestKey);
        this.bytes -= oldest?.size || 0;
        this.evictions += 1;
      }
      return value;
    }

    async getOrCreate(key, factory) {
      const cached = this.get(key);
      if (cached) return cached;
      if (this.pending.has(key)) {
        this.hits += 1;
        return this.pending.get(key);
      }
      this.misses += 1;
      const pending = Promise.resolve().then(factory).then((value) => this.remember(key, value));
      this.pending.set(key, pending);
      try {
        return await pending;
      } finally {
        this.pending.delete(key);
      }
    }

    diagnostics() {
      return {
        maxEntries:this.maxEntries,
        maxBytes:this.maxBytes,
        entries:this.entries.size,
        bytes:this.bytes,
        pending:this.pending.size,
        hits:this.hits,
        misses:this.misses,
        evictions:this.evictions
      };
    }
  }

  class InstrumentedRangeSource {
    constructor(archivePath, cache) {
      this.archivePath = archivePath;
      this.url = new URL(archivePath, document.baseURI).href;
      this.inner = new window.pmtiles.FetchSource(this.url);
      this.cache = cache;
      this.requests = 0;
      this.networkBytes = 0;
      this.rangeBytesRequested = 0;
      this.lastRequestMs = 0;
      this.status206Confirmed = false;
    }

    getKey() {
      return this.inner.getKey();
    }

    setHeaders(headers) {
      this.inner.setHeaders?.(headers);
    }

    async getBytes(offset, length, signal, etag) {
      const key = `${this.url}|${offset}|${length}|${etag || ''}`;
      this.rangeBytesRequested += Number(length || 0);
      return this.cache.getOrCreate(key, async () => {
        const before = performance.now();
        const result = await this.inner.getBytes(offset, length, signal, etag);
        const byteLength = Number(result?.data?.byteLength || 0);
        this.requests += 1;
        this.networkBytes += byteLength;
        this.lastRequestMs = performance.now() - before;
        // FetchSource rejects a full-file 200 response when it exceeds the requested range,
        // so a successful partial request proves byte serving for normal archive reads.
        if (byteLength <= length) this.status206Confirmed = true;
        document.dispatchEvent(new CustomEvent('alan-map:pmtiles-range-loaded', {
          detail:{archivePath:this.archivePath,offset,length,bytes:byteLength,durationMs:this.lastRequestMs}
        }));
        return result;
      });
    }

    diagnostics() {
      return {
        archivePath:this.archivePath,
        url:this.url,
        mode:'http-range',
        requests:this.requests,
        networkBytes:this.networkBytes,
        rangeBytesRequested:this.rangeBytesRequested,
        lastRequestMs:this.lastRequestMs,
        byteServingConfirmed:this.status206Confirmed
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

  function lonToTileX(lon, zoom) {
    const count = 2 ** zoom;
    return Math.max(0, Math.min(count - 1, Math.floor((Number(lon) + 180) / 360 * count)));
  }

  function latToTileY(lat, zoom) {
    const count = 2 ** zoom;
    const clipped = Math.max(-85.05112878, Math.min(85.05112878, Number(lat)));
    const radians = clipped * Math.PI / 180;
    const value = (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * count;
    return Math.max(0, Math.min(count - 1, Math.floor(value)));
  }

  function canPrefetch() {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (connection?.saveData) return false;
    return !['slow-2g','2g'].includes(String(connection?.effectiveType || '').toLowerCase());
  }

  function scheduleIdle(callback) {
    if (typeof requestIdleCallback === 'function') return requestIdleCallback(callback,{timeout:900});
    return setTimeout(() => callback({didTimeout:true,timeRemaining:() => 0}),180);
  }

  function installPrefetch(map, archiveRecords, data) {
    if (!map || !canPrefetch()) return;
    const seen = new Set();
    let scheduled = false;

    const run = async () => {
      scheduled = false;
      if (!map || map.isMoving?.()) return;
      const center = map.getCenter();
      const mapZoom = Math.max(0, Math.floor(map.getZoom()));
      const jobs = [];
      for (const record of archiveRecords) {
        if (!record.prefetch) continue;
        const minzoom = Number(record.config?.minzoom ?? 0);
        const maxzoom = Number(record.config?.maxzoom ?? mapZoom);
        const zoom = Math.max(minzoom, Math.min(maxzoom, mapZoom));
        const centerX = lonToTileX(center.lng, zoom);
        const centerY = latToTileY(center.lat, zoom);
        const count = 2 ** zoom;
        for (const [dx,dy] of PREFETCH_NEIGHBORS) {
          const x = centerX + dx;
          const y = centerY + dy;
          if (x < 0 || y < 0 || x >= count || y >= count) continue;
          const key = `${record.path}:${zoom}/${x}/${y}`;
          if (seen.has(key)) continue;
          seen.add(key);
          jobs.push(
            record.archive.getZxy(zoom,x,y).then(() => {
              performanceState.prefetchedTiles += 1;
            }).catch(() => {
              performanceState.prefetchErrors += 1;
            })
          );
        }
      }
      if (seen.size > 160) {
        const keep = [...seen].slice(-96);
        seen.clear();
        keep.forEach((key) => seen.add(key));
      }
      if (jobs.length) {
        performanceState.prefetchRuns += 1;
        await Promise.allSettled(jobs);
      }
    };

    const queue = () => {
      if (scheduled || map.isMoving?.()) return;
      scheduled = true;
      scheduleIdle(run);
    };
    map.on('moveend',queue);
    map.on('idle',queue);
    queue();
  }

  function installRenderMetrics(map) {
    map.on('render',() => {
      const now = performance.now();
      performanceState.renderFrames += 1;
      if (performanceState.lastRenderAt !== null) {
        const interval = now - performanceState.lastRenderAt;
        if (interval > 0 && interval < 250) {
          performanceState.renderIntervals.push(interval);
          if (performanceState.renderIntervals.length > 90) performanceState.renderIntervals.shift();
          const average = performanceState.renderIntervals.reduce((sum,value) => sum + value,0) / performanceState.renderIntervals.length;
          performanceState.renderFps = average > 0 ? Math.min(240,1000 / average) : null;
        }
      }
      performanceState.lastRenderAt = now;
    });
    map.once('idle',() => {
      performanceState.firstIdleMs = performance.now() - startedAt;
    });
  }

  async function start() {
    if (!window.pmtiles?.Protocol || !window.pmtiles?.PMTiles || !window.pmtiles?.FetchSource) {
      throw new Error('Alan Map: локальный PMTiles-модуль не подключён.');
    }
    const data = window.ALAN_MAP_DATA;
    if (!data?.regionalDem?.archivePath || !data?.regionalVector?.archivePath) {
      throw new Error('Alan Map: в данных отсутствуют пути локальных PMTiles.');
    }

    const rangeCache = new RangeLruCache(RANGE_CACHE_ENTRIES,RANGE_CACHE_BYTES);
    const protocol = new window.pmtiles.Protocol();
    const archiveRecords = [];
    const configurations = [
      {path:data.regionalDem.archivePath,config:data.regionalDem,prefetch:true},
      {path:data.regionalVector.archivePath,config:data.regionalVector,prefetch:true},
      ...(data.regionalLandcover?.archivePath ? [{path:data.regionalLandcover.archivePath,config:data.regionalLandcover,prefetch:false}] : [])
    ];

    for (const entry of configurations) {
      const source = new InstrumentedRangeSource(entry.path,rangeCache);
      const archive = new window.pmtiles.PMTiles(source);
      protocol.add(archive);
      archiveRecords.push({...entry,source,archive});
    }

    window.maplibregl.addProtocol('pmtiles',protocol.tile);
    window.ALAN_MAP_PMTILES_PROTOCOL = protocol;
    window.ALAN_MAP_PMTILES_RANGE_DIAGNOSTICS = () => ({
      mode:'http-range',
      cache:rangeCache.diagnostics(),
      archives:archiveRecords.map((record) => record.source.diagnostics())
    });

    root.addEventListener('alan-map:ready',() => {
      performanceState.readyMs = performance.now() - startedAt;
    },{once:true});

    applyViewportHeight();
    mapInstance = window.AlanMap.mount(root, {
      data,
      maplibregl:window.maplibregl,
      regionalLabels3D:window.RegionalLabels3D,
      storageKey:`alan-map-stage${VERSION}-view`
    });
    window.ALAN_MAP_INSTANCE = mapInstance;

    const map = mapInstance?.map;
    if (map) {
      installRenderMetrics(map);
      installPrefetch(map,archiveRecords,data);
    }

    window.ALAN_MAP_PERFORMANCE_DIAGNOSTICS = () => {
      const transport = window.ALAN_MAP_PMTILES_RANGE_DIAGNOSTICS?.() || {};
      const totalNetworkBytes = (transport.archives || []).reduce((sum,item) => sum + Number(item.networkBytes || 0),0);
      const totalNetworkRequests = (transport.archives || []).reduce((sum,item) => sum + Number(item.requests || 0),0);
      return {
        version:VERSION,
        readyMs:performanceState.readyMs,
        firstIdleMs:performanceState.firstIdleMs,
        renderFrames:performanceState.renderFrames,
        renderFps:performanceState.renderFps,
        totalNetworkBytes,
        totalNetworkRequests,
        prefetchRuns:performanceState.prefetchRuns,
        prefetchedTiles:performanceState.prefetchedTiles,
        prefetchErrors:performanceState.prefetchErrors,
        transport
      };
    };

    window.addEventListener('resize',applyViewportHeight,{passive:true});
    window.addEventListener('orientationchange',queueOrientationResize,{passive:true});
    window.visualViewport?.addEventListener('resize',applyViewportHeight,{passive:true});
    document.addEventListener('fullscreenchange',applyViewportHeight);
    document.addEventListener('webkitfullscreenchange',applyViewportHeight);
  }

  start().catch((error) => {
    console.error(error);
    root.innerHTML = `<div class="alan-map-fatal-error">Карта не загрузилась: ${String(error?.message || error)}</div>`;
    root.dispatchEvent(new CustomEvent('alan-map:error',{detail:{message:String(error?.message || error)}}));
  });
})();
