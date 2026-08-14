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
  const FRAME_WIDTH_M = 2000;
  const COMPASS_RADIUS_M = 22000;
  const PARCHMENT_COLOR = '#ead7ad';
  const ORNAMENT_COLOR = '#68482f';
  const BEAM_LAYER_IDS = Object.freeze(['settlement-beam-halo', 'settlement-beam-core']);
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

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
    const inset = points.map((_, index) => {
      const previous = lines[(index - 1 + lines.length) % lines.length];
      const current = lines[index];
      return lineIntersection(previous.point, previous.direction, current.point, current.direction) || current.point;
    });
    return inset.map(projection.toLngLat);
  }

  function projectPoint(map, lngLat) {
    try {
      const point = map.project({lng:lngLat[0], lat:lngLat[1]});
      return Number.isFinite(point?.x) && Number.isFinite(point?.y) ? [point.x, point.y] : null;
    } catch (_) {
      return null;
    }
  }

  function polygonPath(points) {
    if (!points.length) return '';
    return points.map((point, index) => `${index ? 'L' : 'M'}${point[0].toFixed(2)} ${point[1].toFixed(2)}`).join(' ') + ' Z';
  }

  function ringPath(outer, inner) {
    if (!outer.length || !inner.length) return '';
    return `${polygonPath(outer)} ${polygonPath([...inner].reverse())}`;
  }

  function interpolatePoint(start, end, amount) {
    return [start[0] + (end[0] - start[0]) * amount, start[1] + (end[1] - start[1]) * amount];
  }

  function addScaled(point, tangent, normal, along, across) {
    return [point[0] + tangent[0] * along + normal[0] * across, point[1] + tangent[1] * along + normal[1] * across];
  }

  function clipSegmentRange(start, end, bounds) {
    if (!bounds) return [0, 1];
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    let t0 = 0;
    let t1 = 1;
    const tests = [
      [-dx, start[0] - bounds.minX],
      [dx, bounds.maxX - start[0]],
      [-dy, start[1] - bounds.minY],
      [dy, bounds.maxY - start[1]]
    ];
    for (const [p, q] of tests) {
      if (Math.abs(p) < 1e-9) {
        if (q < 0) return null;
        continue;
      }
      const ratio = q / p;
      if (p < 0) {
        if (ratio > t1) return null;
        if (ratio > t0) t0 = ratio;
      } else {
        if (ratio < t0) return null;
        if (ratio < t1) t1 = ratio;
      }
    }
    return [clamp(t0, 0, 1), clamp(t1, 0, 1)];
  }

  function ornamentPathForSide(outerStart, outerEnd, innerStart, innerEnd, viewport = null) {
    const centerStart = interpolatePoint(outerStart, innerStart, 0.52);
    const centerEnd = interpolatePoint(outerEnd, innerEnd, 0.52);
    const dx = centerEnd[0] - centerStart[0];
    const dy = centerEnd[1] - centerStart[1];
    const length = Math.hypot(dx, dy);
    if (length < 8) return '';
    const tangent = [dx / length, dy / length];
    let normal = [-tangent[1], tangent[0]];
    const inwardVector = [innerStart[0] - outerStart[0], innerStart[1] - outerStart[1]];
    if (normal[0] * inwardVector[0] + normal[1] * inwardVector[1] < 0) normal = [-normal[0], -normal[1]];
    const widthStart = Math.hypot(inwardVector[0], inwardVector[1]);
    const widthEnd = Math.hypot(innerEnd[0] - outerEnd[0], innerEnd[1] - outerEnd[1]);
    const bandWidth = Math.max(1, Math.min(widthStart, widthEnd));
    const repeatLength = clamp(bandWidth * 2.55, 20, 58);
    const count = Math.max(1, Math.floor(length / repeatLength));
    const cell = length / count;
    const amplitude = Math.min(bandWidth * 0.22, cell * 0.16);
    const diamondAlong = Math.min(cell * 0.12, bandWidth * 0.33);
    const diamondAcross = Math.min(bandWidth * 0.23, cell * 0.12);
    const commands = [];
    let firstIndex = 0;
    let lastIndex = count - 1;
    if (viewport) {
      const margin = Math.max(80, bandWidth * 1.25);
      const range = clipSegmentRange(centerStart, centerEnd, {
        minX:-margin,
        minY:-margin,
        maxX:viewport.width + margin,
        maxY:viewport.height + margin
      });
      if (!range) return '';
      firstIndex = Math.max(0, Math.floor(range[0] * length / cell) - 2);
      lastIndex = Math.min(count - 1, Math.ceil(range[1] * length / cell) + 2);
    }

    for (let index = firstIndex; index <= lastIndex; index += 1) {
      const base = index * cell;
      const p0 = addScaled(centerStart, tangent, normal, base + cell * 0.06, 0);
      const p1 = addScaled(centerStart, tangent, normal, base + cell * 0.27, amplitude);
      const p2 = addScaled(centerStart, tangent, normal, base + cell * 0.48, 0);
      const p3 = addScaled(centerStart, tangent, normal, base + cell * 0.69, -amplitude);
      const p4 = addScaled(centerStart, tangent, normal, base + cell * 0.94, 0);
      commands.push(
        `M${p0[0].toFixed(2)} ${p0[1].toFixed(2)} ` +
        `C${p1[0].toFixed(2)} ${p1[1].toFixed(2)} ${p1[0].toFixed(2)} ${p1[1].toFixed(2)} ${p2[0].toFixed(2)} ${p2[1].toFixed(2)} ` +
        `C${p3[0].toFixed(2)} ${p3[1].toFixed(2)} ${p3[0].toFixed(2)} ${p3[1].toFixed(2)} ${p4[0].toFixed(2)} ${p4[1].toFixed(2)}`
      );
      const center = addScaled(centerStart, tangent, normal, base + cell * 0.5, 0);
      const top = addScaled(center, tangent, normal, 0, -diamondAcross);
      const right = addScaled(center, tangent, normal, diamondAlong, 0);
      const bottom = addScaled(center, tangent, normal, 0, diamondAcross);
      const left = addScaled(center, tangent, normal, -diamondAlong, 0);
      commands.push(`M${top[0].toFixed(2)} ${top[1].toFixed(2)} L${right[0].toFixed(2)} ${right[1].toFixed(2)} L${bottom[0].toFixed(2)} ${bottom[1].toFixed(2)} L${left[0].toFixed(2)} ${left[1].toFixed(2)} Z`);
    }
    return commands.join(' ');
  }

  function ornamentPath(outer, inner, viewport = null) {
    if (outer.length !== inner.length || outer.length < 3) return '';
    const commands = [];
    for (let index = 0; index < outer.length; index += 1) {
      const next = (index + 1) % outer.length;
      commands.push(ornamentPathForSide(outer[index], outer[next], inner[index], inner[next], viewport));
    }
    return commands.filter(Boolean).join(' ');
  }

  function createSvgElement(name, attributes = {}) {
    const element = document.createElementNS(SVG_NS, name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    return element;
  }

  function createFrameOverlay(container) {
    const svg = createSvgElement('svg', {
      'data-role':'map-perimeter-frame',
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
      'stroke-linejoin':'round'
    });
    const innerLine = createSvgElement('path', {
      'data-role':'map-perimeter-frame-inner',
      fill:'none',
      stroke:ORNAMENT_COLOR,
      'stroke-opacity':'0.62',
      'stroke-width':'1.05',
      'stroke-linejoin':'round'
    });
    const ornament = createSvgElement('path', {
      'data-role':'map-perimeter-frame-ornament',
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
    const localRadius = 53;
    return {
      a:(east[0] - center[0]) / localRadius,
      b:(east[1] - center[1]) / localRadius,
      c:(south[0] - center[0]) / localRadius,
      d:(south[1] - center[1]) / localRadius,
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
      `matrix(${matrix.a.toFixed(6)} ${matrix.b.toFixed(6)} ${matrix.c.toFixed(6)} ${matrix.d.toFixed(6)} ${matrix.e.toFixed(2)} ${matrix.f.toFixed(2)})`
    );
    compass.setAttribute('data-map-plane-aligned', 'true');
    compass.setAttribute('data-world-radius-m', String(COMPASS_RADIUS_M));
    return true;
  }

  function installOnMap(root, api) {
    const map = api?.map;
    if (!map?.getContainer || map.__alanPresentationR4Installed) return;
    map.__alanPresentationR4Installed = true;
    const container = map.getContainer();
    const data = root.ALAN_MAP_DATA || {};
    const outerLngLat = frameRingFromData(data);
    const innerLngLat = insetPolygonMeters(outerLngLat, FRAME_WIDTH_M);
    const frame = createFrameOverlay(container);
    const compassLngLat = api?.getPresentationDiagnostics?.().parchmentCompass || null;
    let framePending = false;

    const update = () => {
      framePending = false;
      const width = container.clientWidth || 1;
      const height = container.clientHeight || 1;
      frame.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      const outer = outerLngLat.map((point) => projectPoint(map, point));
      const inner = innerLngLat.map((point) => projectPoint(map, point));
      if (outer.some((point) => !point) || inner.some((point) => !point)) return;
      frame.base.setAttribute('d', ringPath(outer, inner));
      frame.outerLine.setAttribute('d', polygonPath(outer));
      frame.innerLine.setAttribute('d', polygonPath(inner));
      frame.ornament.setAttribute('d', ornamentPath(outer, inner, {width, height}));
      removeSettlementBeams(map);
      removeCornerOrnament(container);
      applyCompassTransform(map, container, compassLngLat);
    };
    const queueUpdate = () => {
      if (framePending) return;
      framePending = true;
      const raf = root.requestAnimationFrame || ((callback) => setTimeout(callback, 16));
      raf(update);
    };

    removeSettlementBeams(map);
    removeCornerOrnament(container);
    update();
    map.on?.('render', queueUpdate);
    map.on?.('styledata', () => { removeSettlementBeams(map); queueUpdate(); });
    map.on?.('resize', queueUpdate);

    root.ALAN_MAP_PRESENTATION_7025 = {
      version:VERSION,
      frameWidthM:FRAME_WIDTH_M,
      compassRadiusM:COMPASS_RADIUS_M,
      beamLayersRemoved:() => BEAM_LAYER_IDS.every((layerId) => !map.getLayer?.(layerId)),
      frameReady:() => Boolean(frame.svg.isConnected && frame.base.getAttribute('d')),
      compassMapPlaneAligned:() => container.querySelector('[data-role="parchment-compass"]')?.getAttribute('data-map-plane-aligned') === 'true'
    };
  }

  function install(root) {
    if (!root?.document) return;
    const host = root.document.getElementById('alan-map-root');
    if (!host || host.__alanPresentationR4Listening) return;
    host.__alanPresentationR4Listening = true;
    host.addEventListener('alan-map:ready', (event) => installOnMap(root, event.detail?.api || root.ALAN_MAP_INSTANCE), {once:true});
    if (root.ALAN_MAP_INSTANCE?.map) installOnMap(root, root.ALAN_MAP_INSTANCE);
  }

  return {
    install,
    config:Object.freeze({
      version:VERSION,
      frameWidthM:FRAME_WIDTH_M,
      compassRadiusM:COMPASS_RADIUS_M,
      parchmentColor:PARCHMENT_COLOR,
      ornamentColor:ORNAMENT_COLOR,
      beamLayerIds:BEAM_LAYER_IDS
    }),
    __test:{
      frameRingFromData,
      signedArea,
      insetPolygonMeters,
      ringPath,
      clipSegmentRange,
      ornamentPathForSide,
      ornamentPath,
      offsetLngLat
    }
  };
});
