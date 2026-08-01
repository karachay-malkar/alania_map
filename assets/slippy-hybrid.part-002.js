anSlippyFlatGuards) return map;
    Object.defineProperty(map, '__alanSlippyFlatGuards', {value: true});

    const constrainCamera = (methodName) => {
      const original = typeof map[methodName] === 'function' ? map[methodName].bind(map) : null;
      if (!original) return;
      map[methodName] = function (options, eventData) {
        const next = options && typeof options === 'object'
          ? Object.assign({}, options, {bearing: 0, pitch: 0})
          : {bearing: 0, pitch: 0};
        return original(next, eventData);
      };
    };
    constrainCamera('jumpTo');
    constrainCamera('easeTo');
    constrainCamera('flyTo');

    for (const methodName of ['setBearing', 'setPitch', 'rotateTo', 'resetNorth', 'resetNorthPitch']) {
      if (typeof map[methodName] === 'function') map[methodName] = function () { return map; };
    }

    const originalSetTerrain = typeof map.setTerrain === 'function' ? map.setTerrain.bind(map) : null;
    map.setTerrain = function (terrain) {
      if (terrain == null && originalSetTerrain) return originalSetTerrain(null);
      return map;
    };

    if (map.dragRotate) {
      map.dragRotate.disable();
      map.dragRotate.enable = function () { map.dragRotate.disable(); return map.dragRotate; };
    }
    if (map.touchZoomRotate) {
      const originalEnable = typeof map.touchZoomRotate.enable === 'function'
        ? map.touchZoomRotate.enable.bind(map.touchZoomRotate)
        : null;
      if (originalEnable) {
        map.touchZoomRotate.enable = function () {
          const result = originalEnable();
          if (typeof map.touchZoomRotate.disableRotation === 'function') map.touchZoomRotate.disableRotation();
          return result;
        };
      }
      if (typeof map.touchZoomRotate.disableRotation === 'function') map.touchZoomRotate.disableRotation();
    }
    if (map.touchPitch && typeof map.touchPitch.disable === 'function') map.touchPitch.disable();

    const clearTerrain = () => {
      try {
        if (map.getTerrain && map.getTerrain() && originalSetTerrain) originalSetTerrain(null);
      } catch (_) {}
      try { map.jumpTo({bearing: 0, pitch: 0}); } catch (_) {}
    };
    map.on('load', clearTerrain);
    map.on('styledata', clearTerrain);
    return map;
  }

  function wrapMapConstructor() {
    const maplibregl = root.maplibregl;
    const OriginalMap = maplibregl && maplibregl.Map;
    if (!OriginalMap || OriginalMap.__alanSlippyWrapped) return;
    const WrappedMap = new Proxy(OriginalMap, {
      construct(Target, args) {
        const nextArgs = Array.from(args || []);
        nextArgs[0] = forceFlatOptions(nextArgs[0]);
        const map = Reflect.construct(Target, nextArgs, Target);
        return installFlatGuards(map);
      }
    });
    Object.defineProperty(WrappedMap, '__alanSlippyWrapped', {value: true});
    maplibregl.Map = WrappedMap;
  }

  function loadImage(map, id, uri) {
    return new Promise((resolve, reject) => {
      if (map.hasImage(id)) { resolve(