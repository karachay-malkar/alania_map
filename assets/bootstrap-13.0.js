(() => {
  'use strict';

  const RELEASE = '13.0';
  const CORE_RELEASE = '12.1.8';
  const NORTH_DOWN_BEARING = 180;
  const VALID_MORPHOLOGIES = Object.freeze([
    'rounded_hill',
    'rounded_mountain',
    'steep_mountain',
    'isolated_peak',
    'massif',
    'ridge',
    'rocky_peak',
    'rocky_ridge',
    'plateau'
  ]);
  const VALID_MORPHOLOGY_SET = new Set(VALID_MORPHOLOGIES);
  const SPECIAL_ROLES = new Set(['main_mountain', 'five_thousander', 'unique_mountain']);
  const SPECIAL_IDS = new Set(['mingi_tau']);
  const baseUrl = new URL('.', document.currentScript.src);
  const nativeFetch = window.fetch.bind(window);

  const statusText = (text, failed = false) => {
    const status = document.getElementById('map-status');
    if (status) {
      status.textContent = text;
      if (failed) status.dataset.failed = 'true';
      else delete status.dataset.failed;
    }
  };

  const loadingText = (text) => {
    const node = document.querySelector('#loading .loading-text');
    if (node) node.textContent = text;
  };

  const fetchText = async (name) => {
    const response = await nativeFetch(new URL(name, baseUrl), {cache: 'no-store'});
    if (!response.ok) throw new Error(`Alan Map ${RELEASE}: не загружен ${name} (${response.status}).`);
    return response.text();
  };

  const executeParts = async (names, sourceName) => {
    const code = (await Promise.all(names.map(fetchText))).join('');
    (0, eval)(`${code}\n//# sourceURL=${sourceName}`);
  };

  const decodeGzipBase64Text = async (encoded) => {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('Браузер не поддерживает распаковку gzip.');
    }
    const compact = String(encoded || '').replace(/\s+/g, '');
    const bytes = Uint8Array.from(atob(compact), (character) => character.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
  };

  const encodeGzipBase64Text = async (text) => {
    if (typeof CompressionStream !== 'function') {
      throw new Error('Браузер не поддерживает упаковку gzip, необходимую для назначения фигурок 13.0.');
    }
    const bytes = new TextEncoder().encode(text);
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
    const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
    let binary = '';
    const step = 0x8000;
    for (let offset = 0; offset < compressed.length; offset += step) {
      binary += String.fromCharCode(...compressed.subarray(offset, offset + step));
    }
    return btoa(binary);
  };

  const fnv1a = (value) => {
    let hash = 0x811c9dc5;
    const text = String(value);
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
  };

  const getFeatureId = (feature, index) => String(
    feature?.properties?.id ??
    feature?.properties?.point_id ??
    feature?.id ??
    `feature-${index}`
  );

  const getPoint = (feature) => {
    const properties = feature?.properties || {};
    const coordinates = feature?.geometry?.type === 'Point' ? feature.geometry.coordinates : null;
    const longitude = Number(properties.longitude ?? coordinates?.[0]);
    const latitude = Number(properties.latitude ?? coordinates?.[1]);
    return {longitude, latitude};
  };

  const transformMountainRender = (collection) => {
    if (!collection || collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
      throw new Error('Alan Map 13.0: mountain-render имеет неверный GeoJSON формат.');
    }

    const invalid = [];
    const specialsInOrdinaryRender = [];
    const groups = new Map(VALID_MORPHOLOGIES.map((morphology) => [morphology, []]));

    collection.features.forEach((feature, index) => {
      const properties = feature?.properties || (feature.properties = {});
      const id = getFeatureId(feature, index);
      const role = String(properties.role || properties.type || '');
      if (SPECIAL_IDS.has(id) || SPECIAL_ROLES.has(role)) {
        specialsInOrdinaryRender.push(id);
        return;
      }
      const morphology = String(properties.morphology || '').trim();
      const point = getPoint(feature);
      if (!VALID_MORPHOLOGY_SET.has(morphology) || !Number.isFinite(point.longitude) || !Number.isFinite(point.latitude)) {
        invalid.push({id, morphology, longitude: point.longitude, latitude: point.latitude});
        return;
      }
      groups.get(morphology).push({feature, id, ...point});
    });

    if (invalid.length) {
      window.__ALAN_13_INVALID_MORPHOLOGY = invalid;
      throw new Error(`Alan Map 13.0: ${invalid.length} обычных горных объектов не имеют допустимой morphology.`);
    }

    const variantStats = {};
    const proximityLongitude = 0.055;
    const proximityLatitude = 0.045;

    for (const morphology of VALID_MORPHOLOGIES) {
      const entries = groups.get(morphology);
      entries.sort((left, right) => (
        left.latitude - right.latitude ||
        left.longitude - right.longitude ||
        left.id.localeCompare(right.id)
      ));

      const useCounts = [0, 0, 0, 0];
      const assigned = [];
      const stats = [0, 0, 0, 0];

      for (const entry of entries) {
        const preferred = fnv1a(entry.id) % 4;
        const candidates = [0, 1, 2, 3].map((variant) => {
          let conflicts = 0;
          for (let index = assigned.length - 1, inspected = 0; index >= 0 && inspected < 48; index -= 1, inspected += 1) {
            const previous = assigned[index];
            if (Math.abs(previous.latitude - entry.latitude) > proximityLatitude) continue;
            if (Math.abs(previous.longitude - entry.longitude) > proximityLongitude) continue;
            if (previous.variant === variant) conflicts += 1;
          }
          const cyclicDistance = (variant - preferred + 4) % 4;
          return {variant, conflicts, uses: useCounts[variant], cyclicDistance};
        });

        candidates.sort((a, b) => (
          a.conflicts - b.conflicts ||
          a.uses - b.uses ||
          a.cyclicDistance - b.cyclicDistance ||
          a.variant - b.variant
        ));

        const variant = candidates[0].variant;
        const properties = entry.feature.properties;
        properties.icon_id = `${morphology}_${String(variant + 1).padStart(2, '0')}`;
        properties.icon_variant = variant + 1;
        properties.render_order_13 = assigned.length;
        useCounts[variant] += 1;
        stats[variant] += 1;
        assigned.push({...entry, variant});
      }

      variantStats[morphology] = Object.fromEntries(
        stats.map((count, index) => [`${morphology}_${String(index + 1).padStart(2, '0')}`, count])
      );
    }

    collection.features.sort((left, right) => {
      const a = getPoint(left);
      const b = getPoint(right);
      if (!Number.isFinite(a.latitude) || !Number.isFinite(b.latitude)) return 0;
      return a.latitude - b.latitude || a.longitude - b.longitude || getFeatureId(left, 0).localeCompare(getFeatureId(right, 0));
    });

    const totalAssigned = Object.values(variantStats)
      .flatMap((category) => Object.values(category))
      .reduce((sum, count) => sum + count, 0);

    window.__ALAN_13_ASSIGNMENT_STATS = Object.freeze({
      release: RELEASE,
      totalAssigned,
      categories: variantStats,
      specialObjectsFoundInOrdinaryRender: specialsInOrdinaryRender.slice()
    });

    return collection;
  };

  const makeJsonResponse = (value, sourceResponse) => new Response(JSON.stringify(value), {
    status: 200,
    statusText: 'OK',
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-alan-map-release': RELEASE,
      'x-alan-map-source-status': String(sourceResponse?.status || 200)
    }
  });

  const makeTextResponse = (value, contentType = 'text/plain; charset=utf-8') => new Response(value, {
    status: 200,
    statusText: 'OK',
    headers: {
      'content-type': contentType,
      'cache-control': 'no-store',
      'x-alan-map-release': RELEASE
    }
  });

  const installFetchAdapter = () => {
    window.fetch = async (input, init) => {
      const rawUrl = input instanceof Request ? input.url : String(input);
      const url = new URL(rawUrl, document.baseURI);
      const pathname = url.pathname;

      if (pathname.endsWith('/data/mountains/mountain-icon-manifest-12.1.8.json')) {
        const manifestUrl = new URL('data/mountains/mountain-icon-manifest-13.0.json?v=13.0.2', document.baseURI);
        const response = await nativeFetch(manifestUrl, {cache: 'no-store'});
        if (!response.ok) throw new Error(`Alan Map 13.0: не загружен новый manifest (${response.status}).`);
        const manifest = await response.json();
        if (manifest.version !== RELEASE || !Array.isArray(manifest.icons) || manifest.icons.length !== 36) {
          throw new Error('Alan Map 13.0: manifest не содержит подтверждённые 36 фигурок версии 13.0.');
        }
        return makeJsonResponse({...manifest, version: CORE_RELEASE}, response);
      }

      if (pathname.endsWith('/data/mountains/mountain-render-12.1.8.geojson.gz.b64')) {
        const response = await nativeFetch(input, {...(init || {}), cache: 'no-store'});
        if (!response.ok) return response;
        const encoded = await response.text();
        const jsonText = await decodeGzipBase64Text(encoded);
        const collection = transformMountainRender(JSON.parse(jsonText));
        const repacked = await encodeGzipBase64Text(JSON.stringify(collection));
        return makeTextResponse(repacked);
      }

      if (pathname.endsWith('/assets/mountains/mountain-atlas-13.0.b64')) {
        const parts = await Promise.all(Array.from({length: 6}, async (_, partIndex) => {
          const sourceName = `assets/mountains/mountain-atlas-13.0.part-${String(partIndex).padStart(3, '0')}.b64?v=13.0.2`;
          const response = await nativeFetch(new URL(sourceName, document.baseURI), {cache: 'no-store'});
          if (!response.ok) throw new Error(`Alan Map 13.0: не загружена atlas-часть ${partIndex} (${response.status}).`);
          return (await response.text()).trim();
        }));
        return makeTextResponse(parts.join(''));
      }

      return nativeFetch(input, init);
    };
  };

  const forceViewportAlignedSymbols = (map) => {
    const apply = () => {
      const style = map.getStyle?.();
      for (const layer of style?.layers || []) {
        if (layer.type !== 'symbol') continue;
        try {
          if (layer.layout?.['icon-image'] !== undefined) {
            map.setLayoutProperty(layer.id, 'icon-rotation-alignment', 'viewport');
            map.setLayoutProperty(layer.id, 'icon-pitch-alignment', 'viewport');
          }
          if (layer.layout?.['text-field'] !== undefined) {
            map.setLayoutProperty(layer.id, 'text-rotation-alignment', 'viewport');
            map.setLayoutProperty(layer.id, 'text-pitch-alignment', 'viewport');
          }
        } catch (error) {
          console.warn(`Alan Map ${RELEASE}: не удалось зафиксировать viewport alignment слоя ${layer.id}.`, error);
        }
      }
    };
    map.on?.('style.load', apply);
    map.on?.('styledata', apply);
  };

  const rotateAndReverseMountainVertices = (source) => {
    if (!(source instanceof Float32Array) || source.length === 0 || source.length % 24 !== 0) return source;
    const groupSize = 24;
    const groups = [];
    for (let offset = 0; offset < source.length; offset += groupSize) {
      const group = source.slice(offset, offset + groupSize);
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (let vertex = 0; vertex < 6; vertex += 1) {
        const base = vertex * 4;
        minX = Math.min(minX, group[base]);
        maxX = Math.max(maxX, group[base]);
        minY = Math.min(minY, group[base + 1]);
        maxY = Math.max(maxY, group[base + 1]);
      }
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      for (let vertex = 0; vertex < 6; vertex += 1) {
        const base = vertex * 4;
        group[base] = 2 * centerX - group[base];
        group[base + 1] = 2 * centerY - group[base + 1];
      }
      groups.push(group);
    }
    groups.reverse();
    const output = new Float32Array(source.length);
    groups.forEach((group, index) => output.set(group, index * groupSize));
    return output;
  };

  const installMountainLayerAdapter = (map) => {
    const originalAddLayer = map.addLayer?.bind(map);
    if (!originalAddLayer) return;
    map.addLayer = (layer, beforeId) => {
      if (layer?.type === 'custom' && layer?.id === 'mountain-images' && typeof layer.onAdd === 'function') {
        const originalOnAdd = layer.onAdd;
        layer.onAdd = function onAddNorthDown(mapInstance, gl) {
          const glProxy = new Proxy(gl, {
            get(target, property) {
              if (property === 'bufferData') {
                return (targetEnum, data, usage) => {
                  const payload = data instanceof Float32Array ? rotateAndReverseMountainVertices(data) : data;
                  return target.bufferData(targetEnum, payload, usage);
                };
              }
              const value = Reflect.get(target, property, target);
              return typeof value === 'function' ? value.bind(target) : value;
            }
          });
          const result = originalOnAdd.call(this, mapInstance, glProxy);
          if (Array.isArray(this.drawOrder)) this.drawOrder.reverse();
          this.northDownCompensated = true;
          return result;
        };
      }
      return originalAddLayer(layer, beforeId);
    };
  };

  const lockNorthDown = (map) => {
    map.dragRotate?.disable?.();
    map.touchZoomRotate?.disableRotation?.();
    map.touchPitch?.disable?.();
    installMountainLayerAdapter(map);

    const original = {
      fitBounds: map.fitBounds?.bind(map),
      jumpTo: map.jumpTo?.bind(map),
      easeTo: map.easeTo?.bind(map),
      flyTo: map.flyTo?.bind(map),
      rotateTo: map.rotateTo?.bind(map),
      setBearing: map.setBearing?.bind(map),
      setPitch: map.setPitch?.bind(map)
    };

    const fixedCamera = (options) => ({...(options || {}), bearing: NORTH_DOWN_BEARING, pitch: 0});

    if (original.fitBounds) map.fitBounds = (bounds, options, eventData) => original.fitBounds(bounds, fixedCamera(options), eventData);
    if (original.jumpTo) map.jumpTo = (options, eventData) => original.jumpTo(fixedCamera(options), eventData);
    if (original.easeTo) map.easeTo = (options, eventData) => original.easeTo(fixedCamera(options), eventData);
    if (original.flyTo) map.flyTo = (options, eventData) => original.flyTo(fixedCamera(options), eventData);
    if (original.rotateTo) map.rotateTo = (_bearing, options, eventData) => original.rotateTo(NORTH_DOWN_BEARING, {...(options || {}), duration: options?.duration ?? 0}, eventData);
    if (original.setBearing) map.setBearing = () => original.setBearing(NORTH_DOWN_BEARING);
    if (original.setPitch) map.setPitch = () => original.setPitch(0);

    let correcting = false;
    const enforce = () => {
      if (correcting) return;
      const bearing = Number(map.getBearing?.());
      const pitch = Number(map.getPitch?.());
      if ((Number.isFinite(bearing) && Math.abs(Math.abs(bearing) - 180) > 0.01) || (Number.isFinite(pitch) && Math.abs(pitch) > 0.01)) {
        correcting = true;
        try {
          original.jumpTo?.({bearing: NORTH_DOWN_BEARING, pitch: 0});
        } finally {
          correcting = false;
        }
      }
    };

    map.on?.('rotate', enforce);
    map.on?.('pitch', enforce);
    map.on?.('load', enforce);
    forceViewportAlignedSymbols(map);
    window.__ALAN_MAP_13 = map;
  };

  const installMapConstructorAdapter = () => {
    const OriginalMap = window.maplibregl?.Map;
    if (typeof OriginalMap !== 'function') throw new Error('Alan Map 13.0: MapLibre Map constructor не найден.');

    const WrappedMap = new Proxy(OriginalMap, {
      construct(Target, args) {
        const options = {...(args?.[0] || {}), bearing: NORTH_DOWN_BEARING, pitch: 0, dragRotate: false, touchPitch: false};
        const map = Reflect.construct(Target, [options], Target);
        lockNorthDown(map);
        return map;
      }
    });
    window.maplibregl.Map = WrappedMap;
  };

  const executeCore = async () => {
    const encoded = (await fetchText('app-12.1.8.js.gz.b64?v=13.0-core.2')).trim();
    const code = await decodeGzipBase64Text(encoded);
    (0, eval)(`${code}\n//# sourceURL=app-13.0-core.js`);
  };

  (async () => {
    loadingText('Этап 1/2: разворот карты — север вниз.');
    await executeParts(['maplibre.part-000.js', 'maplibre.part-001.js'], 'maplibre-13.0.js');
    installMapConstructorAdapter();
    installFetchAdapter();
    loadingText('Этап 2/2: назначение 36 фигурок по morphology.');
    await executeCore();
    statusText('13.0 · север внизу · 36 morphology-фигурок');
  })().catch((error) => {
    console.error(error);
    loadingText(String(error.message || error));
    statusText(`Карта не загрузилась: ${String(error.message || error)}`, true);
  });
})();
