

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RegionalLabels3D = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = '5.0.0';
  const DEFAULT_ALTITUDE_M = 7000;
  const MIN_ZOOM = 7.0;
  const FULL_OPACITY_ZOOM = 9.5;
  const MAX_ZOOM = 10.0;
  const DISPLAY_HEIGHT_PX = 24;
  const TEXTURE_FONT_SIZE = 56;
  const ATLAS_MAX_WIDTH = 2048;
  const ATLAS_PADDING = 2;
  const FLOATS_PER_VERTEX = 7;
  const STRIDE_BYTES = FLOATS_PER_VERTEX * 4;

  const VERTEX_SHADER = `
    precision highp float;
    attribute vec3 a_center;
    attribute vec2 a_offset;
    attribute vec2 a_texcoord;
    uniform mat4 u_matrix;
    uniform vec2 u_viewport;
    varying vec2 v_texcoord;
    void main() {
      vec4 centerClip = u_matrix * vec4(a_center, 1.0);
      // Regional names are true screen-space billboards: they remain horizontal,
      // readable left-to-right, and the same CSS-pixel size at every zoom/bearing.
      vec2 pixelOffset = vec2(a_offset.x, -a_offset.y);
      vec2 ndcOffset = pixelOffset * 2.0 / max(u_viewport, vec2(1.0));
      gl_Position = centerClip;
      gl_Position.xy += ndcOffset * centerClip.w;
      v_texcoord = a_texcoord;
    }
  `;

  const FRAGMENT_SHADER = `
    precision mediump float;
    uniform sampler2D u_texture;
    uniform float u_opacity;
    varying vec2 v_texcoord;
    void main() {
      vec4 color = texture2D(u_texture, v_texcoord);
      gl_FragColor = color * u_opacity;
    }
  `;

  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
  const lerp = (start, end, amount) => start + (end - start) * amount;

  function interpolate(value, stops) {
    if (value <= stops[0][0]) return stops[0][1];
    for (let index = 1; index < stops.length; index += 1) {
      const [rightX, rightY] = stops[index];
      const [leftX, leftY] = stops[index - 1];
      if (value <= rightX) return lerp(leftY, rightY, (value - leftX) / (rightX - leftX));
    }
    return stops[stops.length - 1][1];
  }

  function labelOpacity(zoom) {
    if (zoom < MIN_ZOOM || zoom >= MAX_ZOOM) return 0;
    if (zoom <= FULL_OPACITY_ZOOM) return 1;
    return interpolate(zoom, [[FULL_OPACITY_ZOOM, 1], [MAX_ZOOM, 0]]);
  }

  function matrixFromRenderInput(renderInput) {
    if (!renderInput) return null;
    if (renderInput.defaultProjectionData?.mainMatrix) return renderInput.defaultProjectionData.mainMatrix;
    if (renderInput.modelViewProjectionMatrix) return renderInput.modelViewProjectionMatrix;
    if (ArrayBuffer.isView(renderInput) || Array.isArray(renderInput)) return renderInput;
    return null;
  }

  function lineMidpoint(coordinates) {
    if (!Array.isArray(coordinates) || coordinates.length === 0) return null;
    if (coordinates.length === 1) return coordinates[0];
    let total = 0;
    const lengths = [];
    for (let index = 1; index < coordinates.length; index += 1) {
      const previous = coordinates[index - 1];
      const current = coordinates[index];
      const length = Math.hypot(current[0] - previous[0], current[1] - previous[1]);
      lengths.push(length);
      total += length;
    }
    if (!total) return coordinates[Math.floor(coordinates.length / 2)];
    const target = total / 2;
    let accumulated = 0;
    for (let index = 0; index < lengths.length; index += 1) {
      const length = lengths[index];
      if (accumulated + length >= target) {
        const start = coordinates[index];
        const end = coordinates[index + 1];
        const ratio = (target - accumulated) / length;
        return [lerp(start[0], end[0], ratio), lerp(start[1], end[1], ratio)];
      }
      accumulated += length;
    }
    return coordinates[coordinates.length - 1];
  }

  function resolveLine(feature) {
    const geometry = feature?.geometry || {};
    if (geometry.type === 'LineString' && geometry.coordinates?.length >= 2) return geometry.coordinates;
    if (geometry.type === 'MultiLineString' && geometry.coordinates?.length) {
      return geometry.coordinates.reduce((longest, line) => line.length > longest.length ? line : longest, geometry.coordinates[0]);
    }
    const properties = feature?.properties || {};
    const start = [Number(properties.axis_start_lon), Number(properties.axis_start_lat)];
    const end = [Number(properties.axis_end_lon), Number(properties.axis_end_lat)];
    return start.every(Number.isFinite) && end.every(Number.isFinite) ? [start, end] : null;
  }

  function pngDimensions(uri) {
    if (typeof uri !== 'string' || !uri.startsWith('data:image/png;base64,')) return null;
    try {
      const binary = typeof atob === 'function' ? atob(uri.slice(uri.indexOf(',') + 1)) : null;
      if (!binary || binary.length < 24) return null;
      const readUint32 = (offset) => ((binary.charCodeAt(offset) << 24) | (binary.charCodeAt(offset + 1) << 16) | (binary.charCodeAt(offset + 2) << 8) | binary.charCodeAt(offset + 3)) >>> 0;
      return {width: readUint32(16), height: readUint32(20)};
    } catch (_) {
      return null;
    }
  }

  function displayDimensions(label, heightPx = DISPLAY_HEIGHT_PX) {
    const safeHeight = Math.max(1, Number(label?.imageHeight || 1));
    const safeWidth = Math.max(1, Number(label?.imageWidth || safeHeight));
    const targetHeight = Math.max(1, Number(heightPx || DISPLAY_HEIGHT_PX));
    return {width: targetHeight * safeWidth / safeHeight, height: targetHeight};
  }

  function buildLabelQuad(label, maplibregl, altitudeM = DEFAULT_ALTITUDE_M, displayHeightPx = DISPLAY_HEIGHT_PX) {
    const line = label?.line;
    if (!Array.isArray(line) || line.length < 2) return null;
    const midpoint = label.midpoint || lineMidpoint(line);
    if (!midpoint) return null;
    const center = maplibregl.MercatorCoordinate.fromLngLat({lng: midpoint[0], lat: midpoint[1]}, altitudeM);
    if (![center.x, center.y, center.z].every(Number.isFinite)) return null;
    const dimensions = displayDimensions(label, displayHeightPx);
    const halfWidth = dimensions.width / 2;
    const halfHeight = dimensions.height / 2;
    const uv = label.uv || {left: 0, right: 1, top: 1, bottom: 0};
    const vertex = (offsetX, offsetY, u, v) => [
      center.x, center.y, center.z,
      offsetX, offsetY,
      u, v
    ];
    return new Float32Array([
      ...vertex(-halfWidth, -halfHeight, uv.left, uv.top),
      ...vertex(halfWidth, -halfHeight, uv.right, uv.top),
      ...vertex(halfWidth, halfHeight, uv.right, uv.bottom),
      ...vertex(-halfWidth, -halfHeight, uv.left, uv.top),
      ...vertex(halfWidth, halfHeight, uv.right, uv.bottom),
      ...vertex(-halfWidth, halfHeight, uv.left, uv.bottom)
    ]);
  }

  function buildCombinedVertices(labels, maplibregl, altitudeM, displayHeightPx = DISPLAY_HEIGHT_PX) {
    const quads = labels.map((label) => buildLabelQuad(label, maplibregl, altitudeM, displayHeightPx)).filter(Boolean);
    const vertices = new Float32Array(quads.length * 6 * FLOATS_PER_VERTEX);
    quads.forEach((quad, index) => vertices.set(quad, index * 6 * FLOATS_PER_VERTEX));
    return {vertices, vertexCount: quads.length * 6};
  }

  function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('RegionalLabels3D: WebGL shader allocation failed.');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) || 'unknown shader error';
      gl.deleteShader(shader);
      throw new Error(`RegionalLabels3D: shader compilation failed: ${message}`);
    }
    return shader;
  }

  function createProgram(gl) {
    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (!program) throw new Error('RegionalLabels3D: WebGL program allocation failed.');
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program) || 'unknown link error';
      gl.deleteProgram(program);
      throw new Error(`RegionalLabels3D: program linking failed: ${message}`);
    }
    return program;
  }

  function createFallbackCanvas(text, preferredWidth, preferredHeight) {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    const measurement = document.createElement('canvas').getContext('2d');
    if (!measurement) return null;
    measurement.font = `700 ${TEXTURE_FONT_SIZE}px Georgia, "Bookman Old Style", serif`;
    const measuredWidth = Math.ceil(measurement.measureText(text).width + 32);
    canvas.width = Math.max(2, preferredWidth || measuredWidth);
    canvas.height = Math.max(2, preferredHeight || 84);
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = `700 ${TEXTURE_FONT_SIZE}px Georgia, "Bookman Old Style", serif`;
    context.lineJoin = 'round';
    context.lineWidth = 9;
    context.strokeStyle = 'rgba(247,235,213,.96)';
    context.strokeText(text, canvas.width / 2, canvas.height / 2);
    context.fillStyle = '#6a4f39';
    context.fillText(text, canvas.width / 2, canvas.height / 2);
    return canvas;
  }

  function loadImageSource(label) {
    return new Promise((resolve) => {
      const fallback = () => resolve(createFallbackCanvas(label.text, label.imageWidth, label.imageHeight));
      if (!label.imageUri || typeof Image !== 'function') { fallback(); return; }
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = fallback;
      image.src = label.imageUri;
    });
  }

  async function createTextureAtlas(labels) {
    if (typeof document === 'undefined') throw new Error('RegionalLabels3D: document is required for texture atlas.');
    const sources = await Promise.all(labels.map(loadImageSource));
    if (sources.some((source) => !source)) throw new Error('RegionalLabels3D: label texture source is unavailable.');
    const placements = [];
    let x = ATLAS_PADDING;
    let y = ATLAS_PADDING;
    let rowHeight = 0;
    let usedWidth = 0;
    for (let index = 0; index < labels.length; index += 1) {
      const width = labels[index].imageWidth;
      const height = labels[index].imageHeight;
      if (x + width + ATLAS_PADDING > ATLAS_MAX_WIDTH && x > ATLAS_PADDING) {
        x = ATLAS_PADDING;
        y += rowHeight + ATLAS_PADDING;
        rowHeight = 0;
      }
      placements.push({x, y, width, height});
      x += width + ATLAS_PADDING;
      rowHeight = Math.max(rowHeight, height);
      usedWidth = Math.max(usedWidth, x);
    }
    const atlasWidth = Math.max(2, Math.min(ATLAS_MAX_WIDTH, usedWidth + ATLAS_PADDING));
    const atlasHeight = Math.max(2, y + rowHeight + ATLAS_PADDING);
    const canvas = document.createElement('canvas');
    canvas.width = atlasWidth;
    canvas.height = atlasHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('RegionalLabels3D: texture atlas 2D context is unavailable.');
    context.clearRect(0, 0, atlasWidth, atlasHeight);
    placements.forEach((placement, index) => {
      context.drawImage(sources[index], placement.x, placement.y, placement.width, placement.height);
      labels[index].uv = {
        left: placement.x / atlasWidth,
        right: (placement.x + placement.width) / atlasWidth,
        top: 1 - placement.y / atlasHeight,
        bottom: 1 - (placement.y + placement.height) / atlasHeight
      };
    });
    return {canvas, width: atlasWidth, height: atlasHeight};
  }

  function readParameter(gl, parameter, fallback = null) {
    try { return typeof gl.getParameter === 'function' ? gl.getParameter(parameter) : fallback; } catch (_) { return fallback; }
  }

  function readEnabled(gl, capability) {
    try { return typeof gl.isEnabled === 'function' ? gl.isEnabled(capability) : false; } catch (_) { return false; }
  }

  function captureAttrib(gl, location) {
    if (location < 0 || typeof gl.getVertexAttrib !== 'function') return null;
    try {
      return {
        enabled: gl.getVertexAttrib(location, gl.VERTEX_ATTRIB_ARRAY_ENABLED),
        buffer: gl.getVertexAttrib(location, gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING),
        size: gl.getVertexAttrib(location, gl.VERTEX_ATTRIB_ARRAY_SIZE),
        type: gl.getVertexAttrib(location, gl.VERTEX_ATTRIB_ARRAY_TYPE),
        normalized: gl.getVertexAttrib(location, gl.VERTEX_ATTRIB_ARRAY_NORMALIZED),
        stride: gl.getVertexAttrib(location, gl.VERTEX_ATTRIB_ARRAY_STRIDE),
        offset: typeof gl.getVertexAttribOffset === 'function' ? gl.getVertexAttribOffset(location, gl.VERTEX_ATTRIB_ARRAY_POINTER) : 0
      };
    } catch (_) {
      return null;
    }
  }

  function captureGlState(gl, locations) {
    return {
      program: readParameter(gl, gl.CURRENT_PROGRAM),
      arrayBuffer: readParameter(gl, gl.ARRAY_BUFFER_BINDING),
      activeTexture: readParameter(gl, gl.ACTIVE_TEXTURE, gl.TEXTURE0),
      texture2d: readParameter(gl, gl.TEXTURE_BINDING_2D),
      blend: readEnabled(gl, gl.BLEND),
      depthTest: readEnabled(gl, gl.DEPTH_TEST),
      cullFace: readEnabled(gl, gl.CULL_FACE),
      depthMask: readParameter(gl, gl.DEPTH_WRITEMASK, true),
      blendSrcRgb: readParameter(gl, gl.BLEND_SRC_RGB, gl.ONE),
      blendDstRgb: readParameter(gl, gl.BLEND_DST_RGB, gl.ONE_MINUS_SRC_ALPHA),
      blendSrcAlpha: readParameter(gl, gl.BLEND_SRC_ALPHA, gl.ONE),
      blendDstAlpha: readParameter(gl, gl.BLEND_DST_ALPHA, gl.ONE_MINUS_SRC_ALPHA),
      attributes: Object.fromEntries(Object.entries(locations).map(([name, location]) => [name, captureAttrib(gl, location)]))
    };
  }

  function restoreCapability(gl, capability, enabled) {
    if (enabled) gl.enable(capability); else gl.disable(capability);
  }

  function restoreAttrib(gl, location, state) {
    if (location < 0 || !state) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, state.buffer);
    if (state.enabled) gl.enableVertexAttribArray(location);
    else if (typeof gl.disableVertexAttribArray === 'function') gl.disableVertexAttribArray(location);
    if (state.buffer && state.size && state.type) gl.vertexAttribPointer(location, state.size, state.type, state.normalized, state.stride, state.offset || 0);
  }

  function restoreGlState(gl, state, locations) {
    Object.entries(locations).forEach(([name, location]) => restoreAttrib(gl, location, state.attributes[name]));
    gl.useProgram(state.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, state.arrayBuffer);
    gl.activeTexture(state.activeTexture || gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, state.texture2d);
    restoreCapability(gl, gl.BLEND, state.blend);
    restoreCapability(gl, gl.DEPTH_TEST, state.depthTest);
    restoreCapability(gl, gl.CULL_FACE, state.cullFace);
    gl.depthMask(state.depthMask !== false);
    if (typeof gl.blendFuncSeparate === 'function') gl.blendFuncSeparate(state.blendSrcRgb, state.blendDstRgb, state.blendSrcAlpha, state.blendDstAlpha);
    else gl.blendFunc(state.blendSrcRgb, state.blendDstRgb);
  }

  function create(options = {}) {
    const map = options.map;
    const maplibregl = options.maplibregl;
    const features = Array.isArray(options.features) ? options.features : [];
    const images = options.images || {};
    const altitudeM = Number.isFinite(Number(options.altitudeM)) ? Number(options.altitudeM) : DEFAULT_ALTITUDE_M;
    const displayHeightPx = clamp(Number(options.displayHeightPx || DISPLAY_HEIGHT_PX), 12, 40);
    const layerId = options.layerId || 'regional-labels-3d-hook';
    const beforeId = options.beforeId || null;
    const onError = typeof options.onError === 'function' ? options.onError : () => {};
    if (!map || !maplibregl?.MercatorCoordinate) throw new Error('RegionalLabels3D: map and maplibregl.MercatorCoordinate are required.');

    const preparedLabels = features
      .filter((feature) => Number(feature?.properties?.visible ?? 1) === 1)
      .map((feature, index) => {
        const line = resolveLine(feature);
        const midpoint = lineMidpoint(line);
        const properties = feature.properties || {};
        const iconId = String(properties.icon_id || properties.label_id || `regional-label-${index}`);
        const imageUri = images[iconId] || null;
        const dimensions = pngDimensions(imageUri);
        const text = String(properties.name_alan_latin || properties.name_map || properties.name_ru || '');
        return line && midpoint && text ? {
          id: String(properties.label_id || properties.name_map || iconId),
          iconId,
          text,
          line,
          midpoint,
          priority: Number(properties.placement_priority || properties.label_rank || 99),
          imageUri,
          imageWidth: dimensions?.width || Math.max(120, text.length * 43),
          imageHeight: dimensions?.height || 84,
          uv: null
        } : null;
      })
      .filter(Boolean)
      .sort((left, right) => left.priority - right.priority);

    let visible = options.visible !== false;
    let destroyed = false;
    let contextLost = false;
    let glContext = null;
    let program = null;
    let vertexBuffer = null;
    let atlasTexture = null;
    let atlas = null;
    let locations = {center: -1, offset: -1, texcoord: -1};
    let matrixLocation = null;
    let viewportLocation = null;
    let textureLocation = null;
    let opacityLocation = null;
    let geometryUploaded = false;
    let vertexCount = 0;
    let lastError = null;
    let bufferUploads = 0;
    let drawCalls = 0;
    let contextRestoreCount = 0;

    function uploadAtlas(gl) {
      if (!atlas || destroyed) return;
      if (atlasTexture) gl.deleteTexture(atlasTexture);
      atlasTexture = gl.createTexture();
      if (!atlasTexture) throw new Error('RegionalLabels3D: atlas texture allocation failed.');
      gl.bindTexture(gl.TEXTURE_2D, atlasTexture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas.canvas);
    }

    function uploadGeometry(gl) {
      if (!atlas || !vertexBuffer) return;
      const geometry = buildCombinedVertices(preparedLabels, maplibregl, altitudeM, displayHeightPx);
      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, geometry.vertices, gl.STATIC_DRAW);
      vertexCount = geometry.vertexCount;
      geometryUploaded = true;
      bufferUploads += 1;
    }

    function initializeGl(gl) {
      glContext = gl;
      program = createProgram(gl);
      vertexBuffer = gl.createBuffer();
      if (!vertexBuffer) throw new Error('RegionalLabels3D: WebGL vertex buffer allocation failed.');
      locations = {
        center: gl.getAttribLocation(program, 'a_center'),
        offset: gl.getAttribLocation(program, 'a_offset'),
        texcoord: gl.getAttribLocation(program, 'a_texcoord')
      };
      matrixLocation = gl.getUniformLocation(program, 'u_matrix');
      viewportLocation = gl.getUniformLocation(program, 'u_viewport');
      textureLocation = gl.getUniformLocation(program, 'u_texture');
      opacityLocation = gl.getUniformLocation(program, 'u_opacity');
      geometryUploaded = false;
      if (atlas) {
        uploadAtlas(gl);
        uploadGeometry(gl);
      }
    }

    function releaseGl(deleteResources = true) {
      if (glContext && deleteResources) {
        if (atlasTexture) glContext.deleteTexture(atlasTexture);
        if (vertexBuffer) glContext.deleteBuffer(vertexBuffer);
        if (program) glContext.deleteProgram(program);
      }
      atlasTexture = null;
      vertexBuffer = null;
      program = null;
      glContext = null;
      geometryUploaded = false;
      vertexCount = 0;
    }

    function configureAttributes(gl) {
      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      Object.values(locations).forEach((location) => { if (location >= 0) gl.enableVertexAttribArray(location); });
      gl.vertexAttribPointer(locations.center, 3, gl.FLOAT, false, STRIDE_BYTES, 0);
      gl.vertexAttribPointer(locations.offset, 2, gl.FLOAT, false, STRIDE_BYTES, 12);
      gl.vertexAttribPointer(locations.texcoord, 2, gl.FLOAT, false, STRIDE_BYTES, 20);
    }

    function render(gl, renderInput) {
      if (destroyed || contextLost || !visible || !atlas) return;
      if (!program || !vertexBuffer || glContext !== gl) {
        releaseGl(false);
        initializeGl(gl);
        contextRestoreCount += 1;
      }
      if (!atlasTexture) uploadAtlas(gl);
      if (!geometryUploaded) uploadGeometry(gl);
      const matrix = matrixFromRenderInput(renderInput);
      if (!matrix) throw new Error('RegionalLabels3D: projection matrix is unavailable.');
      const opacity = labelOpacity(map.getZoom());
      if (opacity <= 0) return;
      const mapCanvas = map.getCanvas?.();
      const viewportWidth = Math.max(1, mapCanvas?.clientWidth || 1);
      const viewportHeight = Math.max(1, mapCanvas?.clientHeight || 1);
      const previousState = captureGlState(gl, locations);
      try {
        gl.useProgram(program);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.disable(gl.DEPTH_TEST);
        gl.depthMask(false);
        gl.disable(gl.CULL_FACE);
        configureAttributes(gl);
        gl.uniformMatrix4fv(matrixLocation, false, matrix instanceof Float32Array ? matrix : new Float32Array(matrix));
        gl.uniform2f(viewportLocation, viewportWidth, viewportHeight);
        gl.uniform1i(textureLocation, 0);
        gl.uniform1f(opacityLocation, opacity);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, atlasTexture);
        if (vertexCount > 0) {
          gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
          drawCalls += 1;
        }
      } finally {
        restoreGlState(gl, previousState, locations);
      }
    }

    const canvas = map.getCanvas?.();
    const onContextLost = (event) => {
      event?.preventDefault?.();
      contextLost = true;
      releaseGl(false);
    };
    const onContextRestored = () => {
      contextLost = false;
      releaseGl(false);
      map.triggerRepaint();
    };
    canvas?.addEventListener?.('webglcontextlost', onContextLost, false);
    canvas?.addEventListener?.('webglcontextrestored', onContextRestored, false);

    createTextureAtlas(preparedLabels).then((createdAtlas) => {
      if (destroyed) return;
      atlas = createdAtlas;
      if (glContext && program) {
        uploadAtlas(glContext);
        uploadGeometry(glContext);
      }
      map.triggerRepaint();
    }).catch((error) => {
      lastError = error.message;
      onError(error);
    });

    const customLayer = {
      id: layerId,
      type: 'custom',
      renderingMode: '3d',
      onAdd(_map, gl) {
        try { initializeGl(gl); } catch (error) { lastError = error.message; onError(error); }
      },
      render(gl, renderInput) {
        try { render(gl, renderInput); } catch (error) {
          if (lastError !== error.message) { lastError = error.message; onError(error); }
        }
      },
      onRemove() { releaseGl(true); }
    };

    map.addLayer(customLayer, beforeId && map.getLayer?.(beforeId) ? beforeId : undefined);

    return {
      version: VERSION,
      altitudeM,
      layerId,
      get isVisible() { return visible; },
      setVisible(nextVisible) { visible = Boolean(nextVisible); map.triggerRepaint(); },
      redraw() { geometryUploaded = false; map.triggerRepaint(); },
      getDiagnostics() {
        return {
          version: VERSION,
          renderer: 'webgl-fixed-screen-label-atlas',
          altitudeM,
          preparedLabels: preparedLabels.length,
          atlasReady: Boolean(atlas),
          atlasWidth: atlas?.width || 0,
          atlasHeight: atlas?.height || 0,
          textureCount: atlasTexture ? 1 : 0,
          bufferUploads,
          drawCalls,
          drawCallsPerRenderedFrame: 1,
          vertexCount,
          contextRestoreCount,
          minZoom: MIN_ZOOM,
          maxZoom: MAX_ZOOM,
          fullOpacityZoom: FULL_OPACITY_ZOOM,
          minimumFontSizePx: displayHeightPx,
          maximumFontSizePx: displayHeightPx,
          displayHeightPx,
          sizingModel: 'constant-css-pixel-height',
          sharedAbsolutePlane: false,
          mapPlaneAligned: false,
          screenRotationDegrees: 0,
          readableLeftToRight: true,
          projectedAxisRotation: false,
          billboard: true,
          screenCanvas: false,
          collisionDisplacement: false,
          fixedGroundScale: false,
          fixedScreenScale: true,
          geometryDependsOnZoom: false,
          glStateRestored: true,
          contextRecovery: true
        };
      },
      destroy() {
        destroyed = true;
        canvas?.removeEventListener?.('webglcontextlost', onContextLost, false);
        canvas?.removeEventListener?.('webglcontextrestored', onContextRestored, false);
        if (map.getLayer(layerId)) map.removeLayer(layerId); else releaseGl(true);
      }
    };
  }

  return {
    version: VERSION,
    create,
    config: {
      altitudeM: DEFAULT_ALTITUDE_M,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      fullOpacityZoom: FULL_OPACITY_ZOOM,
      displayHeightPx: DISPLAY_HEIGHT_PX,
      textureFontSize: TEXTURE_FONT_SIZE,
      renderer: 'webgl-fixed-screen-label-atlas',
      mapPlaneAligned: false,
      screenRotationDegrees: 0,
      readableLeftToRight: true,
      billboard: true,
      fixedGroundScale: false,
      fixedScreenScale: true,
      sizingModel: 'constant-css-pixel-height',
      drawCallsPerRenderedFrame: 1
    },
    __test: {
      labelOpacity,
      lineMidpoint,
      resolveLine,
      pngDimensions,
      displayDimensions,
      buildLabelQuad,
      buildCombinedVertices,
      matrixFromRenderInput,
      clamp,
      interpolate,
      createTextureAtlas
    }
  };
});

  
  