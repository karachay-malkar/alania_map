(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else {
    const api = factory();
    root.AlanMapPresentationR2 = api;
    api.install(root);
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RELEASE = '7.2.2-r5';
  const SOURCE = 'alan-native-presentation';
  const FRAME_WIDTH_M = 2000;
  const ORNAMENT_REPEAT_M = 4800;
  const COMPASS_RADIUS_M = 22000;
  const PARCHMENT = '#ead7ad';
  const BROWN = '#68482f';
  const BEAM_LAYER_IDS = Object.freeze(['settlement-beam-halo', 'settlement-beam-core']);

  const layers = Object.freeze({
    frame:'alan-native-frame',
    outer:'alan-native-frame-outer',
    inner:'alan-native-frame-inner',
    ornament:'alan-native-frame-ornament',
    parchment:'alan-native-parchment',
    wash:'alan-native-parchment-wash',
    feather:'alan-native-parchment-feather',
    aged:'alan-native-parchment-aged',
    pencil:'alan-native-parchment-pencil',
    compassFill:'alan-native-compass-fill',
    compassOutline:'alan-native-compass-outline',
    compassLine:'alan-native-compass-line',
    compassLetters:'alan-native-compass-letters'
  });

  function finitePoint(point) {
    return Array.isArray(point) && point.length >= 2 && point.slice(0, 2).every(Number.isFinite);
  }

  function frameRingFromData(data) {
    const geometry = data?.mapFrame?.features?.[0]?.geometry;
    const ring = geometry?.type === 'Polygon' ? geometry.coordinates?.[0] : null;
    if (!Array.isArray(ring)) return [];
    const points = ring.filter(finitePoint).map((point) => [Number(point[0]), Number(point[1])]);
    if (points.length > 1 && points[0][0] === points.at(-1)[0] && points[0][1] === points.at(-1)[1]) points.pop();
    return points.length >= 3 ? points : [];
  }

  function metersProjection(points) {
    if (!points.length) return null;
    const center = points.reduce((sum, point) => [sum[0] + point[0], sum[1] + point[1]], [0, 0]).map((value) => value / points.length);
    const latRadians = center[1] * Math.PI / 180;
    const metersPerLonDegree = Math.max(1, 111320 * Math.cos(latRadians));
    const metersPerLatDegree = 110574;
    return {
      toMeters:([lon, lat]) => [(lon - center[0]) * metersPerLonDegree, (lat - center[1]) * metersPerLatDegree],
      toLngLat:([x, y]) => [center[0] + x / metersPerLonDegree, center[1] + y / metersPerLatDegree]
    };
  }

  function signedArea(points) {
    let area = 0;
    for (let index = 0; index < points.length; index += 1) {
      const current = points[index];
      const next = points[(index + 1) % points.length];
      area += current[0] * next[1] - next[0] * current[1];
    }
    return area / 2;
  }

  function lineIntersection(firstPoint, firstDirection, secondPoint, secondDirection) {
    const cross = firstDirection[0] * secondDirection[1] - firstDirection[1] * secondDirection[0];
    if (Math.abs(cross) < 1e-9) return null;
    const delta = [secondPoint[0] - firstPoint[0], secondPoint[1] - firstPoint[1]];
    const amount = (delta[0] * secondDirection[1] - delta[1] * secondDirection[0]) / cross;
    return [firstPoint[0] + firstDirection[0] * amount, firstPoint[1] + firstDirection[1] * amount];
  }

  function insetPolygonMeters(lngLatRing, insetM = FRAME_WIDTH_M) {
    const projection = metersProjection(lngLatRing);
    if (!projection) return [];
    const points = lngLatRing.map(projection.toMeters);
    const orientation = signedArea(points) >= 0 ? 1 : -1;
    const lines = points.map((current, index) => {
      const next = points[(index + 1) % points.length];
      const direction = [next[0] - current[0], next[1] - current[1]];
      const length = Math.hypot(direction[0], direction[1]) || 1;
      const unit = [direction[0] / length, direction[1] / length];
      const inward = orientation > 0 ? [-unit[1], unit[0]] : [unit[1], -unit[0]];
      return {
        point:[current[0] + inward[0] * insetM, current[1] + inward[1] * insetM],
        direction
      };
    });
    return points.map((_, index) => {
      const previous = lines[(index - 1 + lines.length) % lines.length];
      const current = lines[index];
      return projection.toLngLat(lineIntersection(previous.point, previous.direction, current.point, current.direction) || current.point);
    });
  }

  function interpolatePoint(start, end, amount) {
    return [start[0] + (end[0] - start[0]) * amount, start[1] + (end[1] - start[1]) * amount];
  }

  function addScaled(point, tangent, normal, along, across) {
    return [point[0] + tangent[0] * along + normal[0] * across, point[1] + tangent[1] * along + normal[1] * across];
  }

  function buildWorldOrnamentGeometry(outerLngLat, innerLngLat, repeatM = ORNAMENT_REPEAT_M) {
    if (outerLngLat.length !== innerLngLat.length || outerLngLat.length < 3) return [];
    const projection = metersProjection(outerLngLat);
    if (!projection) return [];
    const outer = outerLngLat.map(projection.toMeters);
    const inner = innerLngLat.map(projection.toMeters);
    const geometry = [];

    for (let index = 0; index < outer.length; index += 1) {
      const next = (index + 1) % outer.length;
      const centerStart = interpolatePoint(outer[index], inner[index], 0.52);
      const centerEnd = interpolatePoint(outer[next], inner[next], 0.52);
      const dx = centerEnd[0] - centerStart[0];
      const dy = centerEnd[1] - centerStart[1];
      const length = Math.hypot(dx, dy);
      if (!(length > 1)) continue;

      const tangent = [dx / length, dy / length];
      let normal = [-tangent[1], tangent[0]];
      const inward = [inner[index][0] - outer[index][0], inner[index][1] - outer[index][1]];
      if (normal[0] * inward[0] + normal[1] * inward[1] < 0) normal = [-normal[0], -normal[1]];
      const bandWidth = Math.max(1, Math.min(
        Math.hypot(inward[0], inward[1]),
        Math.hypot(inner[next][0] - outer[next][0], inner[next][1] - outer[next][1])
      ));
      const count = Math.max(1, Math.floor(length / Math.max(1, repeatM)));
      const cell = length / count;
      const amplitude = Math.min(bandWidth * 0.22, cell * 0.16);
      const diamondAlong = Math.min(cell * 0.12, bandWidth * 0.33);
      const diamondAcross = Math.min(bandWidth * 0.23, cell * 0.12);

      for (let cellIndex = 0; cellIndex < count; cellIndex += 1) {
        const base = cellIndex * cell;
        const wave = [];
        const samples = 12;
        for (let sample = 0; sample <= samples; sample += 1) {
          const t = sample / samples;
          const along = base + cell * (0.06 + 0.88 * t);
          const across = Math.sin(t * Math.PI * 2) * amplitude;
          wave.push(projection.toLngLat(addScaled(centerStart, tangent, normal, along, across)));
        }
        geometry.push({points:wave, close:false});

        const center = addScaled(centerStart, tangent, normal, base + cell * 0.5, 0);
        geometry.push({
          points:[
            projection.toLngLat(addScaled(center, tangent, normal, 0, -diamondAcross)),
            projection.toLngLat(addScaled(center, tangent, normal, diamondAlong, 0)),
            projection.toLngLat(addScaled(center, tangent, normal, 0, diamondAcross)),
            projection.toLngLat(addScaled(center, tangent, normal, -diamondAlong, 0))
          ],
          close:true
        });
      }
    }
    return geometry;
  }

  function closeRing(points) {
    const ring = points.map((point) => [Number(point[0]), Number(point[1])]);
    if (ring.length && ring[0].some((value, index) => value !== ring[ring.length - 1][index])) ring.push([...ring[0]]);
    return ring;
  }

  function feature(kind, geometry, extra = {}) {
    return {type:'Feature', properties:{kind, ...extra}, geometry};
  }

  function offsetLngLat([lon, lat], eastM, northM) {
    return [lon + eastM / Math.max(1, 111320 * Math.cos(lat * Math.PI / 180)), lat + northM / 110574];
  }

  function compassPoint(center, x, y) {
    return offsetLngLat(center, x / 53 * COMPASS_RADIUS_M, -y / 53 * COMPASS_RADIUS_M);
  }

  function circle(center, radius, segments = 64) {
    return Array.from({length:segments + 1}, (_, index) => {
      const angle = index / segments * Math.PI * 2;
      return compassPoint(center, Math.cos(angle) * radius, Math.sin(angle) * radius);
    });
  }

  function parchmentGeometry(anchors) {
    const a = [...anchors.edgeA];
    const b = [...anchors.corner];
    const c = [...anchors.edgeC];
    const dx = a[0] - c[0];
    const dy = a[1] - c[1];
    const length = Math.hypot(dx, dy) || 1;
    let normal = [-dy / length, dx / length];
    const midpoint = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
    const towardCorner = [b[0] - midpoint[0], b[1] - midpoint[1]];
    if (normal[0] * towardCorner[0] + normal[1] * towardCorner[1] < 0) normal = [-normal[0], -normal[1]];
    const jitter = [0,.006,-.010,.004,.012,-.005,.008,-.012,.004,.010,-.004,.006,-.009,.004,0];
    const edge = jitter.map((noise, index) => {
      const t = index / (jitter.length - 1);
      const base = [c[0] + (a[0] - c[0]) * t, c[1] + (a[1] - c[1]) * t];
      const distance = Math.sin(Math.PI * t) * (.038 + noise);
      return [base[0] + normal[0] * distance, base[1] + normal[1] * distance];
    });
    edge[0] = c;
    edge[edge.length - 1] = a;
    return {polygon:closeRing([a, b, c, ...edge.slice(1)]), edge};
  }

  function compassLetterLines(center) {
    const glyph = {
      N:[[[-.5,.6],[-.5,-.6]],[[-.5,.6],[.5,-.6]],[[.5,.6],[.5,-.6]]],
      S:[[[.5,-.5],[.2,-.65],[-.35,-.55],[-.5,-.2],[-.25,0],[.3,.08],[.5,.35],[.3,.6],[-.35,.65],[-.5,.5]]],
      E:[[[.5,-.6],[-.5,-.6],[-.5,.6],[.5,.6]],[[-.5,0],[.35,0]]],
      W:[[[-.55,-.6],[-.28,.6],[0,.05],[.28,.6],[.55,-.6]]]
    };
    const specs = [['N',0,-62],['S',0,66],['E',64,0],['W',-64,0]];
    const output = [];
    for (const [name, cx, cy] of specs) {
      for (const stroke of glyph[name]) output.push(stroke.map(([x, y]) => compassPoint(center, cx + x * 7.5, cy + y * 10.5)));
    }
    return output;
  }

  function buildGeoJSON(data, diagnostics) {
    const outer = frameRingFromData(data);
    const inner = insetPolygonMeters(outer, FRAME_WIDTH_M);
    const features = [];

    if (outer.length === inner.length && outer.length >= 3) {
      features.push(feature('frame', {type:'Polygon', coordinates:[closeRing(outer), closeRing([...inner].reverse())]}));
      features.push(feature('frame_outer', {type:'LineString', coordinates:closeRing(outer)}));
      features.push(feature('frame_inner', {type:'LineString', coordinates:closeRing(inner)}));
      for (const segment of buildWorldOrnamentGeometry(outer, inner, ORNAMENT_REPEAT_M)) {
        features.push(feature('frame_ornament', {type:'LineString', coordinates:segment.close ? closeRing(segment.points) : segment.points}));
      }
    }

    const parchment = parchmentGeometry(diagnostics.parchmentAnchors);
    features.push(feature('parchment', {type:'Polygon', coordinates:[parchment.polygon]}));
    features.push(feature('parchment_wash', {type:'Polygon', coordinates:[parchment.polygon]}));
    features.push(feature('parchment_edge', {type:'LineString', coordinates:parchment.edge}));

    const center = diagnostics.parchmentCompass;
    features.push(feature('compass_ring_outer', {type:'LineString', coordinates:circle(center, 42)}));
    features.push(feature('compass_ring_inner', {type:'LineString', coordinates:circle(center, 28)}));

    const needles = [
      ['north',[[0,-53],[7,-10],[0,0],[-7,-10],[0,-53]]],
      ['south',[[0,53],[7,10],[0,0],[-7,10],[0,53]]],
      ['west',[[-53,0],[-10,-7],[0,0],[-10,7],[-53,0]]],
      ['east',[[53,0],[10,-7],[0,0],[10,7],[53,0]]]
    ];
    for (const [direction, points] of needles) {
      const ring = points.map(([x, y]) => compassPoint(center, x, y));
      features.push(feature('compass_needle', {type:'Polygon', coordinates:[ring]}, {direction}));
      features.push(feature('compass_outline', {type:'LineString', coordinates:ring}, {direction}));
    }

    for (const points of [[[-36,-36],[-8,-8]],[[36,-36],[8,-8]],[[-36,36],[-8,8]],[[36,36],[8,8]]]) {
      features.push(feature('compass_line', {type:'LineString', coordinates:points.map(([x, y]) => compassPoint(center, x, y))}));
    }
    features.push(feature('compass_center', {type:'Polygon', coordinates:[circle(center, 4, 24)]}));
    for (const line of compassLetterLines(center)) features.push(feature('compass_letter', {type:'LineString', coordinates:line}));

    return {
      type:'FeatureCollection',
      features,
      metadata:{
        release:RELEASE,
        coordinateSpace:'geographic-world',
        frameWidthM:FRAME_WIDTH_M,
        ornamentRepeatM:ORNAMENT_REPEAT_M,
        compassRadiusM:COMPASS_RADIUS_M
      }
    };
  }

  const filter = (kind) => ['==', ['get','kind'], kind];
  const inFilter = (kinds) => ['in', ['get','kind'], ['literal', kinds]];

  function definitions() {
    return [
      {id:layers.frame,type:'fill',source:SOURCE,filter:filter('frame'),paint:{'fill-color':PARCHMENT,'fill-opacity':.985}},
      {id:layers.outer,type:'line',source:SOURCE,filter:filter('frame_outer'),paint:{'line-color':BROWN,'line-opacity':.82,'line-width':1.35}},
      {id:layers.inner,type:'line',source:SOURCE,filter:filter('frame_inner'),paint:{'line-color':BROWN,'line-opacity':.62,'line-width':1.05}},
      {id:layers.ornament,type:'line',source:SOURCE,filter:filter('frame_ornament'),layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':BROWN,'line-opacity':.86,'line-width':1.2}},
      {id:layers.parchment,type:'fill',source:SOURCE,filter:filter('parchment'),paint:{'fill-color':PARCHMENT,'fill-opacity':.985}},
      {id:layers.wash,type:'fill',source:SOURCE,filter:filter('parchment_wash'),paint:{'fill-color':'#c49253','fill-opacity':.055}},
      {id:layers.feather,type:'line',source:SOURCE,filter:filter('parchment_edge'),layout:{'line-cap':'round'},paint:{'line-color':PARCHMENT,'line-opacity':.48,'line-width':28,'line-blur':9}},
      {id:layers.aged,type:'line',source:SOURCE,filter:filter('parchment_edge'),layout:{'line-cap':'round'},paint:{'line-color':'#a67846','line-opacity':.22,'line-width':9,'line-blur':3}},
      {id:layers.pencil,type:'line',source:SOURCE,filter:filter('parchment_edge'),layout:{'line-cap':'round'},paint:{'line-color':'#755137','line-opacity':.46,'line-width':1.25}},
      {id:layers.compassFill,type:'fill',source:SOURCE,filter:inFilter(['compass_needle','compass_center']),paint:{'fill-color':['match',['get','direction'],'north','#62442e','south','#b48756','east','#8b6241','west','#8b6241','#62442e'],'fill-opacity':.95}},
      {id:layers.compassOutline,type:'line',source:SOURCE,filter:filter('compass_outline'),paint:{'line-color':'#62442e','line-opacity':.82,'line-width':1.5}},
      {id:layers.compassLine,type:'line',source:SOURCE,filter:inFilter(['compass_ring_outer','compass_ring_inner','compass_line']),paint:{'line-color':'#62442e','line-opacity':['match',['get','kind'],'compass_ring_outer',.74,'compass_ring_inner',.52,.72],'line-width':['match',['get','kind'],'compass_ring_outer',2.2,'compass_ring_inner',1.2,1.5]}},
      {id:layers.compassLetters,type:'line',source:SOURCE,filter:filter('compass_letter'),paint:{'line-color':'#573c29','line-opacity':.9,'line-width':1.7}}
    ];
  }

  function removeLegacyDom(container) {
    container?.querySelectorAll?.('[data-role="parchment-overlay"],[data-role="map-perimeter-frame"]').forEach((element) => element.remove());
  }

  function removeBeamLayers(map) {
    for (const layerId of BEAM_LAYER_IDS) {
      try {
        if (map.getLayer?.(layerId)) map.removeLayer(layerId);
      } catch (_) {}
    }
  }

  function installOnMap(root, api) {
    const map = api?.map;
    if (!map || map.__alanNativePresentationR3) return false;
    const diagnostics = api.getPresentationDiagnostics?.();
    if (!diagnostics?.parchmentAnchors || !finitePoint(diagnostics.parchmentCompass)) return false;

    const geojson = buildGeoJSON(root.ALAN_MAP_DATA || {}, diagnostics);
    removeLegacyDom(map.getContainer?.());
    removeBeamLayers(map);

    if (!map.getSource(SOURCE)) map.addSource(SOURCE, {type:'geojson',data:geojson,maxzoom:16,tolerance:.12,buffer:128});
    for (const layer of definitions()) if (!map.getLayer(layer.id)) map.addLayer(layer);
    map.__alanNativePresentationR3 = true;

    root.ALAN_MAP_PRESENTATION_722 = {
      version:RELEASE,
      presentationSpace:'native-map-scene',
      nativeMapScene:true,
      usesMapProject:false,
      usesSvgOverlay:false,
      renderLoopInstalled:false,
      mutationObserverInstalled:false,
      sourceId:SOURCE,
      layerIds:{...layers},
      frameWidthM:FRAME_WIDTH_M,
      ornamentRepeatM:ORNAMENT_REPEAT_M,
      compassRadiusM:COMPASS_RADIUS_M,
      beamLayersRemoved:() => BEAM_LAYER_IDS.every((layerId) => !map.getLayer?.(layerId)),
      nativeSourceReady:() => Boolean(map.getSource?.(SOURCE)),
      nativeLayersReady:() => Object.values(layers).every((layerId) => Boolean(map.getLayer?.(layerId))),
      legacySvgCount:() => map.getContainer?.().querySelectorAll?.('[data-role="parchment-overlay"],[data-role="map-perimeter-frame"]').length || 0,
      geometry:() => geojson
    };
    root.ALAN_MAP_PRESENTATION_7025 = root.ALAN_MAP_PRESENTATION_722;
    return true;
  }

  function install(root) {
    if (!root?.document) return;
    const host = root.document.getElementById('alan-map-root');
    if (!host || host.__alanNativePresentationR3Listening) return;
    host.__alanNativePresentationR3Listening = true;
    host.addEventListener('alan-map:ready', (event) => installOnMap(root, event.detail?.api || root.ALAN_MAP_INSTANCE), {once:true});
    if (root.ALAN_MAP_INSTANCE?.map) installOnMap(root, root.ALAN_MAP_INSTANCE);
  }

  return {
    version:RELEASE,
    install,
    installOnMap,
    buildGeoJSON,
    definitions,
    layers,
    sourceId:SOURCE,
    config:Object.freeze({
      release:RELEASE,
      presentationSpace:'native-map-scene',
      frameWidthM:FRAME_WIDTH_M,
      ornamentRepeatM:ORNAMENT_REPEAT_M,
      compassRadiusM:COMPASS_RADIUS_M,
      parchmentColor:PARCHMENT,
      ornamentColor:BROWN
    }),
    __test:{
      finitePoint,
      frameRingFromData,
      metersProjection,
      signedArea,
      lineIntersection,
      insetPolygonMeters,
      buildWorldOrnamentGeometry,
      parchmentGeometry,
      compassPoint,
      compassLetterLines,
      closeRing
    }
  };
});
