(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./config.js'));
  else root.ALAN_12_1_MAP = factory(root.ALAN_12_1_CONFIG);
})(typeof self !== 'undefined' ? self : this, function (config) {
  'use strict';

  const CATEGORY_ORDER = Object.freeze(Object.keys(config.morphologies));
  const SIZE_MULTIPLIER = 2;
  const BASE_WIDTH_M = Object.freeze({mountain: 16000, rock: 15200, ridge: 17200, hill: 15200});

  function tierMatch(major, medium, minor) { return ['match', ['get', 'tier'], 1, major, 2, medium, minor]; }
  function riverWidth(kind) {
    const buffer = kind === 'buffer';
    return ['interpolate', ['linear'], ['zoom'], config.minZoom, buffer ? tierMatch(5.2, 3.8, 2.8) : tierMatch(1.15, 0.85, 0.62), 10, buffer ? tierMatch(15, 10.5, 7.3) : tierMatch(2.8, 2.0, 1.35), 13, buffer ? tierMatch(37, 26, 17) : tierMatch(5.8, 4.2, 2.8), 15, buffer ? tierMatch(55, 39, 26) : tierMatch(8.2, 6.0, 4.0)];
  }
  function specialRadius(hitArea = false) {
    const roleRadius = (main, five, unique) => ['match', ['get', 'role'], 'unique_mountain', unique, 'five_thousander', five, main];
    return ['interpolate', ['linear'], ['zoom'], config.minZoom, hitArea ? roleRadius(14, 16, 18) : roleRadius(4.2, 5.0, 5.8), 11, hitArea ? roleRadius(17, 19, 21) : roleRadius(5.0, 5.8, 6.8), 15, hitArea ? roleRadius(20, 22, 24) : roleRadius(6.0, 7.0, 8.2)];
  }

  function createStyle(data) {
    return {version: 8, sources: {
      boundary: {type: 'geojson', data: data.boundary, tolerance: 0.1, buffer: 16},
      rivers: {type: 'geojson', data: data.rivers, maxzoom: 15, tolerance: 0.05, buffer: 128},
      [config.specialSourceId]: {type: 'geojson', data: data.specialMountains, promoteId: 'id'}
    }, layers: [
      {id: 'background', type: 'background', paint: {'background-color': config.colors.outside}},
      {id: 'territory-fill', type: 'fill', source: 'boundary', paint: {'fill-color': config.colors.territory, 'fill-opacity': 1}},
      {id: 'territory-outline', type: 'line', source: 'boundary', layout: {'line-cap': 'round', 'line-join': 'round'}, paint: {'line-color': config.colors.boundary, 'line-width': ['interpolate', ['linear'], ['zoom'], config.minZoom, 1.1, 12, 2.2], 'line-opacity': 0.92}},
      {id: config.riverBufferLayerId, type: 'line', source: 'rivers', layout: {'line-cap': 'round', 'line-join': 'round'}, paint: {'line-color': config.colors.territory, 'line-width': riverWidth('buffer'), 'line-opacity': 1}},
      {id: config.riverLineLayerId, type: 'line', source: 'rivers', layout: {'line-cap': 'round', 'line-join': 'round'}, paint: {'line-color': config.colors.river, 'line-width': riverWidth('line'), 'line-opacity': 0.98}},
      {id: config.specialPointLayerId, type: 'circle', source: config.specialSourceId, paint: {'circle-radius': specialRadius(false), 'circle-color': config.colors.gold, 'circle-stroke-color': config.colors.goldOutline, 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], config.minZoom, 1.15, 15, 1.8], 'circle-opacity': 1, 'circle-stroke-opacity': 0.98}},
      {id: config.specialHitLayerId, type: 'circle', source: config.specialSourceId, paint: {'circle-radius': specialRadius(true), 'circle-color': '#000000', 'circle-opacity': 0.001, 'circle-stroke-width': 0}}
    ]};
  }

  function expandedBounds(bounds, longitudePadding = 0.12, latitudePadding = 0.08) { return [[bounds[0] - longitudePadding, bounds[1] - latitudePadding], [bounds[2] + longitudePadding, bounds[3] + latitudePadding]]; }
  function updateSummary(summary) {
    document.querySelector('[data-total-icons]')?.replaceChildren(String(summary.pngTotal));
    document.querySelector('[data-total-special]')?.replaceChildren(String(summary.specialTotal));
    for (const type of CATEGORY_ORDER) document.querySelector(`[data-count="${type}"]`)?.replaceChildren(String(summary.counts[type] || 0));
    for (const role of Object.keys(config.roles)) document.querySelector(`[data-role-count="${role}"]`)?.replaceChildren(String(summary.specialCounts[role] || 0));
  }
  function bindControls(map, data) {
    document.querySelector('[data-action="zoom-in"]')?.addEventListener('click', () => map.zoomIn({duration: 180}));
    document.querySelector('[data-action="zoom-out"]')?.addEventListener('click', () => map.zoomOut({duration: 180}));
    document.querySelector('[data-action="reset"]')?.addEventListener('click', () => map.fitBounds([[data.bounds[0], data.bounds[1]], [data.bounds[2], data.bounds[3]]], {padding: config.fitPadding, duration: 420, bearing: 0, pitch: 0}));
  }

  function compileShader(gl, type, source) {
    const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { const message = gl.getShaderInfoLog(shader) || 'Не скомпилирован WebGL-шейдер.'; gl.deleteShader(shader); throw new Error(message); }
    return shader;
  }
  function createProgram(gl) {
    const vertex = compileShader(gl, gl.VERTEX_SHADER, `attribute vec2 a_position; attribute vec2 a_uv; uniform mat4 u_matrix; varying vec2 v_uv; void main(){gl_Position=u_matrix*vec4(a_position,0.0,1.0);v_uv=a_uv;}`);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, `precision mediump float; uniform sampler2D u_texture; varying vec2 v_uv; void main(){vec4 color=texture2D(u_texture,v_uv);if(color.a<0.01)discard;gl_FragColor=color;}`);
    const program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { const message = gl.getProgramInfoLog(program) || 'Не связан WebGL-шейдер.'; gl.deleteProgram(program); throw new Error(message); }
    return program;
  }
  function buildSpriteMetrics(manifest) { const metrics = new Map(); for (const icon of manifest.icons) metrics.set(icon.id, {...icon, center_x: icon.width / 2, center_y: icon.height / 2}); return metrics; }

  function createMountainImageLayer(maplibregl, data, atlasImage) {
    const manifestById = buildSpriteMetrics(data.iconManifest);
    const features = [...data.icons.features].sort((left, right) => (right.properties.latitude - left.properties.latitude) || (left.properties.priority - right.properties.priority) || left.properties.point_id.localeCompare(right.properties.point_id));
    return {id: config.imageLayerId, type: 'custom', renderingMode: '2d', imageCount: features.length, drawCalls: 0, vertexCount: 0, drawOrder: features.map((feature) => feature.properties.point_id), anchorMode: 'center', sizeMultiplier: SIZE_MULTIPLIER,
      onAdd(map, gl) {
        this.map=map; this.gl=gl; this.program=createProgram(gl); this.aPosition=gl.getAttribLocation(this.program,'a_position'); this.aUv=gl.getAttribLocation(this.program,'a_uv'); this.uMatrix=gl.getUniformLocation(this.program,'u_matrix'); this.uTexture=gl.getUniformLocation(this.program,'u_texture'); this.texture=gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D,this.texture); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR); gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,atlasImage);
        const values=[]; this.widths=new Map();
        for(const feature of features){const p=feature.properties; const icon=manifestById.get(p.icon_id); if(!icon)throw new Error(`Фигурка отсутствует в манифесте: ${p.icon_id}`); const coordinate=maplibregl.MercatorCoordinate.fromLngLat({lng:p.longitude,lat:p.latitude},0); const unitsPerMeter=coordinate.meterInMercatorCoordinateUnits(); const baseWidth=BASE_WIDTH_M[p.source_type]; if(!baseWidth)throw new Error(`Неизвестный исходный размер для ${p.point_id}: ${p.source_type}`); const widthM=baseWidth*Number(p.icon_scale)*SIZE_MULTIPLIER; const width=widthM*unitsPerMeter; const height=width*(icon.height/icon.width); const left=coordinate.x-width*(icon.center_x/icon.width); const top=coordinate.y-height*(icon.center_y/icon.height); const y0=top, y1=top+height; const shear=width*Number(p.base_shift||0); const topShift=-shear, bottomShift=shear; const x0Top=left+topShift, x1Top=left+width+topShift, x0Bottom=left+bottomShift, x1Bottom=left+width+bottomShift; const u0=icon.x/data.iconManifest.atlas_width, u1=(icon.x+icon.width)/data.iconManifest.atlas_width, v0=icon.y/data.iconManifest.atlas_height, v1=(icon.y+icon.height)/data.iconManifest.atlas_height; values.push(x0Top,y0,u0,v0,x1Top,y0,u1,v0,x1Bottom,y1,u1,v1,x0Top,y0,u0,v0,x1Bottom,y1,u1,v1,x0Bottom,y1,u0,v1); this.widths.set(p.point_id,{widthM,latitude:p.latitude});}
        this.vertexCount=values.length/4; this.buffer=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer); gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(values),gl.STATIC_DRAW);
      },
      render(gl,matrix){gl.useProgram(this.program);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.enableVertexAttribArray(this.aPosition);gl.vertexAttribPointer(this.aPosition,2,gl.FLOAT,false,16,0);gl.enableVertexAttribArray(this.aUv);gl.vertexAttribPointer(this.aUv,2,gl.FLOAT,false,16,8);gl.uniformMatrix4fv(this.uMatrix,false,matrix);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.uniform1i(this.uTexture,0);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.disable(gl.DEPTH_TEST);gl.drawArrays(gl.TRIANGLES,0,this.vertexCount);this.drawCalls+=1;},
      onRemove(map,gl){if(this.buffer)gl.deleteBuffer(this.buffer);if(this.texture)gl.deleteTexture(this.texture);if(this.program)gl.deleteProgram(this.program);}
    };
  }

  async function loadChunkedText(url) { const chunks=[]; for(let index=0;index<100;index+=1){const suffix=String(index).padStart(2,'0');const response=await fetch(`${url}.part-${suffix}`,{cache:'no-cache'});if(response.status===404)break;if(!response.ok)throw new Error(`Не загружена часть ${url}.part-${suffix} (HTTP ${response.status}).`);chunks.push(await response.text());} if(!chunks.length)throw new Error(`Не найдены части ${url}.part-*.`); return chunks.join(''); }
  async function loadAtlasImage(manifest) { const image=new Image(); image.decoding='async'; if(manifest.atlas_format==='base64-png'){const encoded=(await loadChunkedText(manifest.atlas)).trim();image.src=`data:image/png;base64,${encoded}`;}else image.src=manifest.atlas; await image.decode(); return image; }

  function showFeatureCard(properties) { const card=document.getElementById('feature-card'); if(!card)return; const role=String(properties.role||''); card.querySelector('[data-feature-role]')?.replaceChildren(config.roles[role]?.label||role); card.querySelector('[data-feature-name]')?.replaceChildren(String(properties.name||'')); card.querySelector('[data-feature-elevation]')?.replaceChildren(`${Math.round(Number(properties.elevation_m))} м`); const note=card.querySelector('[data-feature-note]'); if(note){const text=String(properties.semantic_note||'').trim();note.replaceChildren(text);note.toggleAttribute('hidden',!text);} card.dataset.featureId=String(properties.id||''); card.removeAttribute('hidden'); }
  function bindSpecialMountainInteractions(map) { const canvas=map.getCanvas(); map.on('mouseenter',config.specialHitLayerId,()=>{canvas.style.cursor='pointer';}); map.on('mouseleave',config.specialHitLayerId,()=>{canvas.style.cursor='';}); map.on('click',config.specialHitLayerId,(event)=>{const feature=event.features?.[0];if(feature?.properties)showFeatureCard(feature.properties);}); document.querySelector('[data-action="close-feature"]')?.addEventListener('click',()=>document.getElementById('feature-card')?.setAttribute('hidden','')); }

  function createMap(maplibregl,data) {
    if(!maplibregl||typeof maplibregl.Map!=='function')throw new Error('Локальный MapLibre не подключён.'); const center=[(data.bounds[0]+data.bounds[2])/2,(data.bounds[1]+data.bounds[3])/2];
    const map=new maplibregl.Map({container:'map',style:createStyle(data),center,zoom:config.minZoom,minZoom:config.minZoom,maxZoom:config.maxZoom,maxBounds:expandedBounds(data.bounds),pitch:0,maxPitch:0,bearing:0,dragRotate:false,pitchWithRotate:false,touchPitch:false,renderWorldCopies:false,attributionControl:false,antialias:false,fadeDuration:0,preserveDrawingBuffer:false,pixelRatio:Math.min(window.devicePixelRatio||1,1.5)}); map.dragRotate?.disable();map.touchZoomRotate?.disableRotation();map.touchPitch?.disable();
    map.once('load',async()=>{try{const atlasImage=await loadAtlasImage(data.iconManifest);const imageLayer=createMountainImageLayer(maplibregl,data,atlasImage);map.addLayer(imageLayer,config.riverBufferLayerId);map.__mountainImageLayer=imageLayer;bindSpecialMountainInteractions(map);map.fitBounds([[data.bounds[0],data.bounds[1]],[data.bounds[2],data.bounds[3]]],{padding:config.fitPadding,duration:0,bearing:0,pitch:0});document.getElementById('loading')?.setAttribute('hidden','');const status=document.getElementById('map-status');if(status)status.textContent=`${data.summary.pngTotal} фигурок · ${data.summary.specialTotal} особых точек · ${data.summary.rivers.representedSystems} речные системы`;}catch(error){console.error(error);const status=document.getElementById('map-status');if(status){status.textContent=`Карта не загрузилась: ${error.message||error}`;status.dataset.failed='true';}document.querySelector('#loading .loading-text')?.replaceChildren(String(error.message||error));}});
    bindControls(map,data);updateSummary(data.summary);return map;
  }

  function diagnostics(map,data){const style=map.getStyle();const renderer=map.__mountainImageLayer;const layerIds=(style.layers||[]).map((layer)=>layer.id);const runtimeLayerOrder=Array.isArray(map.style?._order)?[...map.style._order]:layerIds;return{version:config.version,flat:map.getPitch()===0&&map.getBearing()===0&&map.getMaxPitch()===0,pointCount:data.summary.total,pngPointCount:data.summary.pngTotal,specialPointCount:data.summary.specialTotal,counts:data.summary.counts,specialCounts:data.summary.specialCounts,imageLayerCount:renderer?.imageCount||0,imageDrawCalls:renderer?.drawCalls||0,imageAnchorMode:renderer?.anchorMode||null,imageSizeMultiplier:renderer?.sizeMultiplier||0,specialSourceRegistered:Boolean(style.sources?.[config.specialSourceId]),pointInteractionEnabled:layerIds.includes(config.specialHitLayerId),imageLayerBeforeRiverBuffer:runtimeLayerOrder.indexOf(config.imageLayerId)>=0&&runtimeLayerOrder.indexOf(config.imageLayerId)<runtimeLayerOrder.indexOf(config.riverBufferLayerId),riverBufferBeforeRiverLine:runtimeLayerOrder.indexOf(config.riverBufferLayerId)<runtimeLayerOrder.indexOf(config.riverLineLayerId),riverLineBeforeSpecialPoints:runtimeLayerOrder.indexOf(config.riverLineLayerId)<runtimeLayerOrder.indexOf(config.specialPointLayerId),specialPointBeforeHitArea:runtimeLayerOrder.indexOf(config.specialPointLayerId)<runtimeLayerOrder.indexOf(config.specialHitLayerId)};}
  return Object.freeze({CATEGORY_ORDER,SIZE_MULTIPLIER,BASE_WIDTH_M,riverWidth,specialRadius,createStyle,buildSpriteMetrics,createMountainImageLayer,loadAtlasImage,createMap,diagnostics});
});
