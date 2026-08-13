(function (root) {
  'use strict';

  const VERSION = '7.0.25-r4';
  const BASE_SCALE = 1.6;
  const MIN_ZOOM = 7;
  const ZOOM_RATE = 0.34;
  const MAX_SCALE = 4.6;
  const ORIENTATION_SPAN_M = 10000;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function finitePoint(point) {
    return Array.isArray(point) && point.length >= 2 && point.slice(0, 2).every(Number.isFinite);
  }

  function offsetLngLat([lon, lat], eastM, northM) {
    const latRadians = lat * Math.PI / 180;
    const lonScale = Math.max(1, 111320 * Math.cos(latRadians));
    return [lon + eastM / lonScale, lat + northM / 110574];
  }

  function project(map, lngLat) {
    try {
      const point = map.project({lng:lngLat[0], lat:lngLat[1]});
      return Number.isFinite(point?.x) && Number.isFinite(point?.y) ? [point.x, point.y] : null;
    } catch (_) {
      return null;
    }
  }

  function install(api) {
    const map = api?.map;
    if (!map?.getContainer || map.__alanCompassR4Installed) return;
    map.__alanCompassR4Installed = true;

    const container = map.getContainer();
    const compassLngLat = api?.getPresentationDiagnostics?.().parchmentCompass;
    if (!finitePoint(compassLngLat)) return;

    let pending = false;
    let lastMatrix = null;

    const update = () => {
      pending = false;
      const compass = container.querySelector('[data-role="parchment-compass"]');
      if (!compass) return;

      const center = project(map, compassLngLat);
      const east = project(map, offsetLngLat(compassLngLat, ORIENTATION_SPAN_M, 0));
      const south = project(map, offsetLngLat(compassLngLat, 0, -ORIENTATION_SPAN_M));
      if (!center || !east || !south) {
        if (lastMatrix) compass.setAttribute('transform', lastMatrix);
        return;
      }

      const eastDx = east[0] - center[0];
      const eastDy = east[1] - center[1];
      const southDx = south[0] - center[0];
      const southDy = south[1] - center[1];
      const eastLength = Math.hypot(eastDx, eastDy);
      const southLength = Math.hypot(southDx, southDy);
      if (eastLength < 0.0001 || southLength < 0.0001) return;

      const zoom = Number(map.getZoom?.() ?? MIN_ZOOM);
      const scale = clamp(BASE_SCALE * Math.pow(2, (zoom - MIN_ZOOM) * ZOOM_RATE), BASE_SCALE, MAX_SCALE);
      const perspectiveY = clamp(southLength / eastLength, 0.34, 1.25);

      const a = eastDx / eastLength * scale;
      const b = eastDy / eastLength * scale;
      const c = southDx / southLength * scale * perspectiveY;
      const d = southDy / southLength * scale * perspectiveY;
      lastMatrix = `matrix(${a.toFixed(6)} ${b.toFixed(6)} ${c.toFixed(6)} ${d.toFixed(6)} ${center[0].toFixed(2)} ${center[1].toFixed(2)})`;

      compass.setAttribute('transform', lastMatrix);
      compass.setAttribute('data-map-plane-aligned', 'true');
      compass.setAttribute('data-zoom-scaled', 'true');
      compass.setAttribute('data-r4-scale', scale.toFixed(4));

      root.ALAN_MAP_COMPASS_7025 = {
        version:VERSION,
        baseScale:BASE_SCALE,
        zoomRate:ZOOM_RATE,
        maxScale:MAX_SCALE,
        currentScale:scale,
        mapPlaneAligned:true
      };
    };

    const queueUpdate = () => {
      if (pending) return;
      pending = true;
      (root.requestAnimationFrame || ((callback) => setTimeout(callback, 16)))(update);
    };

    map.on?.('render', queueUpdate);
    map.on?.('resize', queueUpdate);
    map.on?.('zoom', queueUpdate);
    queueUpdate();
  }

  const host = root.document?.getElementById('alan-map-root');
  if (host) {
    host.addEventListener('alan-map:ready', (event) => install(event.detail?.api || root.ALAN_MAP_INSTANCE), {once:true});
  }
  if (root.ALAN_MAP_INSTANCE?.map) install(root.ALAN_MAP_INSTANCE);
})(typeof window !== 'undefined' ? window : this);
