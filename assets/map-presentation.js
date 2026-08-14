(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else {
    const api = factory();
    root.AlanMapPresentation = api;
    api.install(root);
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = '7.2-r1';
  const RELEASE = '7.2.2-r1';
  const PUBLIC_VERSION = '7.2.2';
  const FRAME_WIDTH_M = 2000;
  const ORNAMENT_REPEAT_M = 4800;
  const COMPASS_RADIUS_M = 22000;
  const COMPASS_LOCAL_RADIUS = 53;
  const PARCHMENT_COLOR = '#ead7ad';
  const ORNAMENT_COLOR = '#68482f';
  const BEAM_LAYER_IDS = Object.freeze(['settlement-beam-halo', 'settlement-beam-core']);
  const SVG_NS = 'http://www.w3.org/2000/svg';

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
      center,
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

  function projectPoint(map, lngLat) {
    try {
      const point = map.project({lng:lngLat[0], lat:lngLat[1]});
      return Number.isFinite(point?.x) && Number.isFinite(point?.y) ? [point.x, point.y] : null;
    } catch (_) {
      return null;
    }
  }

  function projectedPath(map, points, close = false) {
    const projected = points.map((point) => projectPoint(map, point));
    if (!projected.length || projected.some((point) => !point)) return '';
    const path = projected.map((point, index) => `${index ? 'L' : 'M'}${point[0].toFixed(2)} ${point[1].toFixed(2)}`).join(' ');
    return close ? `${path} Z` : path;
  }

  function polygonPath(map, points) {
    return projectedPath(map, points, true);
  }

  function ringPath(map, outer, inner) {
    const outerPath = polygonPath(map, outer);
    const innerPath = polygonPath(map, [...inner].reverse());
    return outerPath && innerPath ? `${outerPath} ${innerPath}` : '';
  }

  function worldOrnamentPath(map, geometry) {
    return geometry.map((segment) => projectedPath(map, segment.points, segment.close)).filter(Boolean).join(' ');
  }

  function createSvgElement(name, attributes = {}) {
    const element = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    return element;
  }

  function createFrameOverlay(container) {
    const svg = createSvgElement('svg', {
      'data-role':'map-perimeter-frame',
      'data-space':'map-world-projected',
      'aria-hidden':'true',
      'focusable':'false'
    });
    Object.assign(svg.style, {
      position:'absolute',
      inset:'0',
      width:'100%',
      height:'100%',
      zIndex:'1',
      pointerEvents:'none',
      overflow:'hidden'
    });
    const base = createSvgElement('path', {
      'data-role':'map-perimeter-frame-base',
      fill:PARCHMENT_COLOR,
      'fill-opacity':'0.985',
      'fill-rule':'evenodd'
    });
    const outerLine = createSvgElement('path', {
      'data-role':'map-perimeter-frame-outer',
      fill:'none',
      stroke:ORNAMENT_COLOR,
      'stroke-opacity':'0.82',
      'stroke-width':'1.35',
      'stroke-linejoin':'round',
      'vector-effect':'non-scaling-stroke'
    });
    const innerLine = createSvgElement('path', {
      'data-role':'map-perimeter-frame-inner',
      fill:'none',
      stroke:ORNAMENT_COLOR,
      'stroke-opacity':'0.62',
      'stroke-width':'1.05',
      'stroke-linejoin':'round',
      'vector-effect':'non-scaling-stroke'
    });
    const ornament = createSvgElement('path', {
      'data-role':'map-perimeter-frame-ornament',
      'data-sizing':'fixed-world-geometry',
      fill:'none',
      stroke:ORNAMENT_COLOR,
      'stroke-opacity':'0.86',
      'stroke-width':'1.2',
      'stroke-linecap':'round',
      'stroke-linejoin':'round',
      'vector-effect':'non-scaling-stroke'
    });
    svg.append(base, outerLine, innerLine, ornament);
    container.appendChild(svg);
    return {svg, base, outerLine, innerLine, ornament};
  }

  function removeSettlementBeams(map) {
    for (const layerId of BEAM_LAYER_IDS) {
      try {
        if (map.getLayer?.(layerId)) map.removeLayer(layerId);
      } catch (_) {}
    }
  }

  function removeCornerOrnament(container) {
    const ornament = container.querySelector('[data-role="parchment-ornament"]');
    if (ornament) ornament.remove();
  }

  function markParchmentWorldSpace(container) {
    const parchment = container.querySelector('[data-role="parchment-overlay"]');
    if (!parchment) return false;
    parchment.setAttribute('data-space', 'map-world-projected');
    parchment.setAttribute('data-fixed-world-geometry', 'true');
    return true;
  }

  function offsetLngLat([lon, lat], eastM, northM) {
    const latRadians = lat * Math.PI / 180;
    const lonScale = Math.max(1, 111320 * Math.cos(latRadians));
    return [lon + eastM / lonScale, lat + northM / 110574];
  }

  function compassMatrix(map, centerLngLat, radiusM = COMPASS_RADIUS_M) {
    const center = projectPoint(map, centerLngLat);
    const east = projectPoint(map, offsetLngLat(centerLngLat, radiusM, 0));
    const south = projectPoint(map, offsetLngLat(centerLngLat, 0, -radiusM));
    if (!center || !east || !south) return null;
    return {
      a:(east[0] - center[0]) / COMPASS_LOCAL_RADIUS,
      b:(east[1] - center[1]) / COMPASS_LOCAL_RADIUS,
      c:(south[0] - center[0]) / COMPASS_LOCAL_RADIUS,
      d:(south[1] - center[1]) / COMPASS_LOCAL_RADIUS,
      e:center[0],
      f:center[1]
    };
  }

  function applyCompassTransform(map, container, compassLngLat) {
    const compass = container.querySelector('[data-role="parchment-compass"]');
    if (!compass || !finitePoint(compassLngLat)) return false;
    const matrix = compassMatrix(map, compassLngLat);
    if (!matrix) return false;
    compass.setAttribute(
      'transform',
      `matrix(${matrix.a.toFixed(7)} ${matrix.b.toFixed(7)} ${matrix.c.toFixed(7)} ${matrix.d.toFixed(7)} ${matrix.e.toFixed(2)} ${matrix.f.toFixed(2)})`
    );
    compass.setAttribute('data-map-plane-aligned', 'true');
    compass.setAttribute('data-fixed-world-scale', 'true');
    compass.setAttribute('data-fixed-screen-scale', 'false');
    compass.setAttribute('data-world-radius-m', String(COMPASS_RADIUS_M));
    return true;
  }


  function syncReleaseLabels(root) {
    const document = root?.document;
    if (!document) return;
    const title = document.querySelector('.alan-map-title');
    if (title) title.textContent = `Alan Map · ${PUBLIC_VERSION}`;
    const status = document.querySelector('[data-role="status"]');
    if (status?.textContent?.includes('Alan Map 7.2')) {
      status.textContent = status.textContent.replace(/Alan Map 7\.2(?=\s|$)/, `Alan Map ${PUBLIC_VERSION}`);
    }
  }

  function installOnMap(root, api) {
    const map = api?.map;
    if (!map?.getContainer || map.__alanPresentation722Installed) return;
    map.__alanPresentation722Installed = true;

    const container = map.getContainer();
    const data = root.ALAN_MAP_DATA || {};
    const outerLngLat = frameRingFromData(data);
    const innerLngLat = insetPolygonMeters(outerLngLat, FRAME_WIDTH_M);
    const ornamentGeometry = buildWorldOrnamentGeometry(outerLngLat, innerLngLat, ORNAMENT_REPEAT_M);
    const frame = createFrameOverlay(container);
    const compassLngLat = api?.getPresentationDiagnostics?.().parchmentCompass || null;
    let updatePending = false;
    let lastState = null;

    const update = () => {
      updatePending = false;
      const width = container.clientWidth || 1;
      const height = container.clientHeight || 1;
      frame.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

      const framePath = ringPath(map, outerLngLat, innerLngLat);
      const outerPath = polygonPath(map, outerLngLat);
      const innerPath = polygonPath(map, innerLngLat);
      if (framePath && outerPath && innerPath) {
        frame.base.setAttribute('d', framePath);
        frame.outerLine.setAttribute('d', outerPath);
        frame.innerLine.setAttribute('d', innerPath);
        frame.ornament.setAttribute('d', worldOrnamentPath(map, ornamentGeometry));
      }

      removeSettlementBeams(map);
      removeCornerOrnament(container);
      const parchmentReady = markParchmentWorldSpace(container);
      syncReleaseLabels(root);
      const compassReady = applyCompassTransform(map, container, compassLngLat);
      lastState = {width, height, parchmentReady, compassReady};
    };

    const queueUpdate = () => {
      if (updatePending) return;
      updatePending = true;
      const raf = root.requestAnimationFrame || ((callback) => setTimeout(callback, 16));
      raf(update);
    };

    removeSettlementBeams(map);
    removeCornerOrnament(container);
    markParchmentWorldSpace(container);
    syncReleaseLabels(root);
    update();
    map.on?.('render', queueUpdate);
    map.on?.('styledata', () => { removeSettlementBeams(map); queueUpdate(); });
    map.on?.('resize', queueUpdate);

    const diagnostics = {
      version:RELEASE,
      presentationSpace:'map-world-projected',
      worldProjectedPresentation:true,
      fixedScreenPresentation:false,
      frameWidthM:FRAME_WIDTH_M,
      ornamentRepeatM:ORNAMENT_REPEAT_M,
      compassRadiusM:COMPASS_RADIUS_M,
      frameGeometryFixed:true,
      ornamentGeometryFixed:true,
      beamLayersRemoved:() => BEAM_LAYER_IDS.every((layerId) => !map.getLayer?.(layerId)),
      frameReady:() => Boolean(frame.svg.isConnected && frame.base.getAttribute('d')),
      frameMapPlaneAligned:() => frame.svg.getAttribute('data-space') === 'map-world-projected',
      parchmentMapPlaneAligned:() => container.querySelector('[data-role="parchment-overlay"]')?.getAttribute('data-space') === 'map-world-projected',
      compassMapPlaneAligned:() => container.querySelector('[data-role="parchment-compass"]')?.getAttribute('data-map-plane-aligned') === 'true',
      compassFixedWorldScale:() => container.querySelector('[data-role="parchment-compass"]')?.getAttribute('data-fixed-world-scale') === 'true',
      state:() => lastState ? {...lastState} : null
    };
    root.ALAN_MAP_PRESENTATION_722 = diagnostics;
    root.ALAN_MAP_PRESENTATION_7025 = {...diagnostics, version:VERSION};
  }

  function install(root) {
    if (!root?.document) return;
    const host = root.document.getElementById('alan-map-root');
    if (!host || host.__alanPresentation722Listening) return;
    host.__alanPresentation722Listening = true;
    host.addEventListener('alan-map:ready', (event) => installOnMap(root, event.detail?.api || root.ALAN_MAP_INSTANCE), {once:true});
    if (root.ALAN_MAP_INSTANCE?.map) installOnMap(root, root.ALAN_MAP_INSTANCE);
  }

  return {
    install,
    config:Object.freeze({
      version:RELEASE,
      presentationSpace:'map-world-projected',
      frameWidthM:FRAME_WIDTH_M,
      ornamentRepeatM:ORNAMENT_REPEAT_M,
      compassRadiusM:COMPASS_RADIUS_M,
      parchmentColor:PARCHMENT_COLOR,
      ornamentColor:ORNAMENT_COLOR,
      beamLayerIds:BEAM_LAYER_IDS
    }),
    __test:{
      finitePoint,
      frameRingFromData,
      metersProjection,
      signedArea,
      lineIntersection,
      insetPolygonMeters,
      interpolatePoint,
      addScaled,
      buildWorldOrnamentGeometry,
      projectedPath,
      ringPath,
      worldOrnamentPath,
      offsetLngLat,
      compassMatrix
    }
  };
});
