(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./config.js'));
  } else {
    root.ALAN_12_1_MAP = factory(root.ALAN_12_1_CONFIG);
  }
})(typeof self !== 'undefined' ? self : this, function (config) {
  'use strict';

  const CATEGORY_ORDER = Object.freeze([
    'mountain', 'rock', 'ridge', 'hill', 'main_mountain', 'five_thousander'
  ]);
  const BASE_WIDTH_M = Object.freeze({mountain: 9000, rock: 8500, ridge: 10000, hill: 10000, main_mountain: 9500, five_thousander: 11000});

  function categoryLayerId(type) {
    return `mountain-points-${type.replaceAll('_', '-')}`;
  }

  function pointLayer(type) {
    const category = config.categories[type];
    return {
      id: categoryLayerId(type),
      type: 'circle',
      source: 'mountain-points',
      minzoom: config.minZoom,
      filter: ['==', ['get', 'type'], type],
      paint: {
        'circle-radius': [
          'interpolate', ['linear'], ['zoom'],
          config.minZoom, Math.max(1.8, category.radius - 1.1),
          10, category.radius,
          15, category.radius + 1.5
        ],
        'circle-color': category.color,
        'circle-stroke-color': '#f6eddc',
        'circle-stroke-width': type === 'five_thousander' ? 1.5 : 1,
        'circle-opacity': 0.9,
        'circle-stroke-opacity': 0.95,
        'circle-pitch-alignment': 'viewport',
        'circle-pitch-scale': 'viewport'
      }
    };
  }

  function createStyle(data) {
    return {
      version: 8,
      sources: {
        boundary: {type: 'geojson', data: data.boundary, tolerance: 0.1, buffer: 16},
        'mountain-points': {type: 'geojson', data: data.mountains, maxzoom: 15, tolerance: 0, buffer: 64}
      },
      layers: [
        {id: 'background', type: 'background', paint: {'background-color': '#d8c8a8'}},
        {id: 'territory-fill', type: 'fill', source: 'boundary', paint: {'fill-color': '#efe2c8', 'fill-opacity': 1}},
        {
          id: 'territory-outline', type: 'line', source: 'boundary',
          layout: {'line-cap': 'round', 'line-join': 'round'},
          paint: {
            'line-color': '#5e5143',
            'line-width': ['interpolate', ['linear'], ['zoom'], config.minZoom, 1.1, 12, 2.2],
            'line-opacity': 0.92
          }
        },
        ...CATEGORY_ORDER.map(pointLayer)
      ]
    };
  }

  function expandedBounds(bounds, longitudePadding = 0.12, latitudePadding = 0.08) {
    return [[bounds[0] - longitudePadding, bounds[1] - latitudePadding], [bounds[2] + longitudePadding, bounds[3] + latitudePadding]];
  }

  function updateSummary(summary) {
    document.querySelector('[data-total-points]')?.replaceChildren(String(summary.total));
    document.querySelector('[data-total-icons]')?.replaceChildren(String(summary.icons.total));
    for (const type of CATEGORY_ORDER) {
      document.querySelector(`[data-count="${type}"]`)?.replaceChildren(String(summary.counts[type] || 0));
    }
  }

  function valueRow(label, value) {
    const row = document.createElement('div');
    row.className = 'feature-row';
    const term = document.createElement('span');
    term.className = 'feature-term';
    term.textContent = label;
    const description = document.createElement('span');
    description.className = 'feature-value';
    description.textContent = value;
    row.append(term, description);
    return row;
  }

  function showFeatureCard(feature) {
    const card = document.getElementById('feature-card');
    const body = document.getElementById('feature-card-body');
    if (!card || !body) return;
    const properties = feature.properties || {};
    const category = config.categories[properties.type] || config.categories.mountain;
    body.replaceChildren();
    body.append(valueRow('ID', String(properties.id || '—')));
    body.append(valueRow('Тип', category.label));
    if (properties.elevation_m !== null && properties.elevation_m !== undefined && properties.elevation_m !== '') {
      body.append(valueRow('Высота', `${properties.elevation_m} м`));
    }
    body.append(valueRow('Долгота', Number(properties.longitude).toFixed(6)));
    body.append(valueRow('Широта', Number(properties.latitude).toFixed(6)));
    if (properties.name) body.append(valueRow('Название', String(properties.name)));
    card.hidden = false;
  }

  function bindControls(map, data) {
    document.querySelector('[data-action="zoom-in"]')?.addEventListener('click', () => map.zoomIn({duration: 180}));
    document.querySelector('[data-action="zoom-out"]')?.addEventListener('click', () => map.zoomOut({duration: 180}));
    document.querySelector('[data-action="reset"]')?.addEventListener('click', () => map.fitBounds(
      [[data.bounds[0], data.bounds[1]], [data.bounds[2], data.bounds[3]]],
      {padding: config.fitPadding, duration: 420, bearing: 0, pitch: 0}
    ));
    document.querySelector('[data-action="close-card"]')?.addEventListener('click', () => {
      const card = document.getElementById('feature-card');
      if (card) card.hidden = true;
    });
  }

  function bindPointInteraction(map) {
    for (const layerId of CATEGORY_ORDER.map(categoryLayerId)) {
      map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
      map.on('click', layerId, (event) => {
        const feature = event.features && event.features[0];
        if (feature) showFeatureCard(feature);
      });
    }
  }

  function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) || 'Не скомпилирован WebGL-шейдер.';
      gl.deleteShader(shader);
      throw new Error(message);
    }
    return shader;
  }

  function createProgram(gl) {
    const vertex = compileShader(gl, gl.VERTEX_SHADER, `
      attribute vec2 a_position;
      attribute vec2 a_uv;
      uniform mat4 u_matrix;
      varying vec2 v_uv;
      void main() {
        gl_Position = u_matrix * vec4(a_position, 0.0, 1.0);
        v_uv = a_uv;
      }
    `);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, `
      precision mediump float;
      uniform sampler2D u_texture;
      varying vec2 v_uv;
      void main() {
        vec4 color = texture2D(u_texture, v_uv);
        if (color.a < 0.01) discard;
        gl_FragColor = color;
      }
    `);
    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program) || 'Не связан WebGL-шейдер.';
      gl.deleteProgram(program);
      throw new Error(message);
    }
    return program;
  }

  function buildSpriteMetrics(manifest, atlasImage) {
    const metrics = new Map();
    for (const icon of manifest.icons) {
      const canvas = document.createElement('canvas');
      canvas.width = icon.width;
      canvas.height = icon.height;
      const context = canvas.getContext('2d', {alpha: true, willReadFrequently: true});
      context.clearRect(0, 0, icon.width, icon.height);
      context.drawImage(atlasImage, icon.x, icon.y, icon.width, icon.height, 0, 0, icon.width, icon.height);
      const alpha = context.getImageData(0, 0, icon.width, icon.height).data;
      let summitY = 0;
      let found = false;
      for (let y = 0; y < icon.height && !found; y += 1) {
        for (let x = 0; x < icon.width; x += 1) {
          if (alpha[(y * icon.width + x) * 4 + 3] > 20) { summitY = y; found = true; break; }
        }
      }
      let weightedX = 0;
      let weight = 0;
      for (let y = summitY; y < Math.min(icon.height, summitY + 5); y += 1) {
        for (let x = 0; x < icon.width; x += 1) {
          const value = alpha[(y * icon.width + x) * 4 + 3];
          if (value > 20) { weightedX += x * value; weight += value; }
        }
      }
      metrics.set(icon.id, {...icon, summit_x: weight ? weightedX / weight : icon.width / 2, summit_y: summitY});
    }
    return metrics;
  }

  function createMountainImageLayer(maplibregl, data, atlasImage) {
    const manifestById = buildSpriteMetrics(data.iconManifest, atlasImage);
    const typeRank = {mountain: 0, rock: 0, ridge: 0, hill: 0, main_mountain: 1, five_thousander: 2};
    const features = [...data.icons.features].sort((left, right) => {
      const a = left.properties;
      const b = right.properties;
      return (typeRank[a.type] - typeRank[b.type]) || (b.latitude - a.latitude) || (a.priority - b.priority) || a.point_id.localeCompare(b.point_id);
    });
    const layer = {
      id: config.imageLayerId,
      type: 'custom',
      renderingMode: '2d',
      imageCount: features.length,
      drawCalls: 0,
      vertexCount: 0,
      onAdd(map, gl) {
        this.map = map;
        this.gl = gl;
        this.program = createProgram(gl);
        this.aPosition = gl.getAttribLocation(this.program, 'a_position');
        this.aUv = gl.getAttribLocation(this.program, 'a_uv');
        this.uMatrix = gl.getUniformLocation(this.program, 'u_matrix');
        this.uTexture = gl.getUniformLocation(this.program, 'u_texture');
        this.texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlasImage);

        const values = [];
        this.widths = new Map();
        for (const feature of features) {
          const properties = feature.properties;
          const icon = manifestById.get(properties.icon_id);
          if (!icon) throw new Error(`Фигурка отсутствует в манифесте: ${properties.icon_id}`);
          const coordinate = maplibregl.MercatorCoordinate.fromLngLat({lng: properties.longitude, lat: properties.latitude}, 0);
          const unitsPerMeter = coordinate.meterInMercatorCoordinateUnits();
          const widthM = BASE_WIDTH_M[properties.type] * Number(properties.icon_scale);
          const width = widthM * unitsPerMeter;
          const height = width * (icon.height / icon.width);
          const left = coordinate.x - width * (icon.summit_x / icon.width);
          const top = coordinate.y - height * (icon.summit_y / icon.height);
          const visibleLeft = Math.max(0, -icon.x);
          const visibleTop = Math.max(0, -icon.y);
          const visibleRight = Math.min(icon.width, data.iconManifest.atlas_width - icon.x);
          const visibleBottom = Math.min(icon.height, data.iconManifest.atlas_height - icon.y);
          const x0 = left + width * (visibleLeft / icon.width);
          const x1 = left + width * (visibleRight / icon.width);
          const y0 = top + height * (visibleTop / icon.height);
          const y1 = top + height * (visibleBottom / icon.height);
          const u0 = Math.max(0, icon.x) / data.iconManifest.atlas_width;
          const u1 = Math.min(data.iconManifest.atlas_width, icon.x + icon.width) / data.iconManifest.atlas_width;
          const v0 = Math.max(0, icon.y) / data.iconManifest.atlas_height;
          const v1 = Math.min(data.iconManifest.atlas_height, icon.y + icon.height) / data.iconManifest.atlas_height;
          values.push(
            x0, y0, u0, v0,  x1, y0, u1, v0,  x1, y1, u1, v1,
            x0, y0, u0, v0,  x1, y1, u1, v1,  x0, y1, u0, v1
          );
          this.widths.set(properties.point_id, {widthM, latitude: properties.latitude});
        }
        this.vertexCount = values.length / 4;
        this.buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(values), gl.STATIC_DRAW);
      },
      render(gl, matrix) {
        gl.useProgram(this.program);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
        gl.enableVertexAttribArray(this.aPosition);
        gl.vertexAttribPointer(this.aPosition, 2, gl.FLOAT, false, 16, 0);
        gl.enableVertexAttribArray(this.aUv);
        gl.vertexAttribPointer(this.aUv, 2, gl.FLOAT, false, 16, 8);
        gl.uniformMatrix4fv(this.uMatrix, false, matrix);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.uniform1i(this.uTexture, 0);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.disable(gl.DEPTH_TEST);
        gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
        this.drawCalls += 1;
      },
      onRemove(map, gl) {
        if (this.buffer) gl.deleteBuffer(this.buffer);
        if (this.texture) gl.deleteTexture(this.texture);
        if (this.program) gl.deleteProgram(this.program);
      },
      measureWidth(pointId, zoom) {
        const item = this.widths?.get(pointId);
        if (!item) return 0;
        const coordinate = maplibregl.MercatorCoordinate.fromLngLat({lng: 0, lat: item.latitude}, 0);
        return item.widthM * coordinate.meterInMercatorCoordinateUnits() * 512 * Math.pow(2, zoom);
      }
    };
    return layer;
  }

  async function loadAtlasImage(manifest) {
    const image = new Image();
    image.decoding = 'async';
    image.src = manifest.atlas;
    await image.decode();
    return image;
  }

  function createMap(maplibregl, data) {
    if (!maplibregl || typeof maplibregl.Map !== 'function') throw new Error('Локальный MapLibre не подключён.');
    const center = [(data.bounds[0] + data.bounds[2]) / 2, (data.bounds[1] + data.bounds[3]) / 2];
    const map = new maplibregl.Map({
      container: 'map', style: createStyle(data), center, zoom: config.minZoom,
      minZoom: config.minZoom, maxZoom: config.maxZoom, maxBounds: expandedBounds(data.bounds),
      pitch: 0, maxPitch: 0, bearing: 0, dragRotate: false, pitchWithRotate: false, touchPitch: false,
      renderWorldCopies: false, attributionControl: false, antialias: true, fadeDuration: 0, preserveDrawingBuffer: false
    });
    map.dragRotate?.disable();
    map.touchZoomRotate?.disableRotation();
    map.touchPitch?.disable();

    map.once('load', async () => {
      try {
        const atlasImage = await loadAtlasImage(data.iconManifest);
        const imageLayer = createMountainImageLayer(maplibregl, data, atlasImage);
        map.addLayer(imageLayer, categoryLayerId('mountain'));
        map.__mountainImageLayer = imageLayer;
        map.fitBounds([[data.bounds[0], data.bounds[1]], [data.bounds[2], data.bounds[3]]], {
          padding: config.fitPadding, duration: 0, bearing: 0, pitch: 0
        });
        bindPointInteraction(map);
        document.getElementById('loading')?.setAttribute('hidden', '');
        const status = document.getElementById('map-status');
        if (status) status.textContent = `${data.summary.total} точек · ${data.summary.icons.total} фигурок`;
      } catch (error) {
        console.error(error);
        const status = document.getElementById('map-status');
        if (status) {
          status.textContent = `Фигурки не загрузились: ${error.message || error}`;
          status.dataset.failed = 'true';
        }
        document.querySelector('#loading .loading-text')?.replaceChildren(String(error.message || error));
      }
    });

    bindControls(map, data);
    updateSummary(data.summary);
    return map;
  }

  function diagnostics(map, data) {
    const style = map.getStyle();
    const renderer = map.__mountainImageLayer;
    return {
      version: config.version,
      flat: map.getPitch() === 0 && map.getBearing() === 0 && map.getMaxPitch() === 0,
      pitch: map.getPitch(), bearing: map.getBearing(), maxPitch: map.getMaxPitch(),
      sourceIds: Object.keys(style.sources || {}),
      layerIds: (style.layers || []).map((layer) => layer.id),
      pointCount: data.summary.total,
      counts: data.summary.counts,
      iconBindingCount: data.summary.icons.total,
      iconCounts: data.summary.icons.counts,
      imageLayerCount: renderer?.imageCount || 0,
      imageVertexCount: renderer?.vertexCount || 0,
      imageDrawCalls: renderer?.drawCalls || 0,
      invalidSourcePoints: data.summary.invalid,
      excludedOutsideBoundary: data.summary.outside
    };
  }

  return Object.freeze({
    CATEGORY_ORDER, BASE_WIDTH_M, categoryLayerId, pointLayer, createStyle, buildSpriteMetrics, createMountainImageLayer, createMap, diagnostics
  });
});
