['zoom'], 7, low, 10, medium, 14.3, high];
  }

  function createMountainLayers() {
    const elevation = elevationExpression();
    const baseLayout = {
      'icon-anchor': 'top',
      'icon-rotation-alignment': 'viewport',
      'icon-pitch-alignment': 'viewport',
      'icon-keep-upright': true,
      'icon-ignore-placement': true,
      'icon-padding': 2,
      'symbol-z-order': 'source',
      'symbol-sort-key': ['-', 6000, elevation]
    };
    return [
      {
        id: LAYER_IDS[0],
        type: 'symbol',
        source: VECTOR_SOURCE_ID,
        'source-layer': VECTOR_SOURCE_LAYER,
        minzoom: 8.6,
        maxzoom: 14.31,
        filter: ['all', visiblePeakFilter(), ['<', elevation, 4200]],
        layout: Object.assign({}, baseLayout, {
          'icon-image': moduloIconExpression(STANDARD_ICONS),
          'icon-size': iconSizeExpression(0.72, 0.98, 1.22),
          'icon-allow-overlap': false
        }),
        paint: {'icon-opacity': ['interpolate', ['linear'], ['zoom'], 8.6, 0, 9, 0.9, 14.3, 0.96]}
      },
      {
        id: LAYER_IDS[1],
        type: 'symbol',
        source: VECTOR_SOURCE_ID,
        'source-layer': VECTOR_SOURCE_LAYER,
        minzoom: 7.6,
        maxzoom: 14.31,
        filter: ['all', visiblePeakFilter(), ['>=', elevation, 4200], ['<', elevation, 5000]],
        layout: Object.assign({}, baseLayout, {
          'icon-image': moduloIconExpression(HIGH_ICONS),
          'icon-size': iconSizeExpression(0.88, 1.18, 1.48),
          'icon-allow-overlap': false
        }),
        paint: {'icon-opacity': ['interpolate', ['linear'], ['zoom'], 7.6, 0.7, 9, 0.94, 14.3, 0.98]}
      },
      {
        id: LAYER_IDS[2],
        type: 'symbol',
        source: VECTOR_SOURCE_ID,
        'source-layer': VECTOR_SOURCE_LAYER,
        minzoom: 7,
        maxzoom: 14.31,
        filter: ['all', visiblePeakFilter(), ['>=', elevation, 5000]],
        layout: Object.assign({}, baseLayout, {
          'icon-image': 'mount-11',
          'icon-size': iconSizeExpression(1.12, 1.48, 1.9),
          'icon-allow-overlap': true,
          'icon-padding': 1
        }),
        paint: {'icon-opacity': 0.98}
      }
    ];
  }

  function firstPointLayer(map) {
    return POINT_LAYER_IDS.find((id) => map.getLayer(id));
  }

  function ensureMountainLayers(map) {
    if (!map || !map.getSource(VECTOR_SOURCE_ID)) return false;
    const beforeId = firstPointLayer(map);
    for (const layer of createMountainLayers()) {
      if (!map.getLayer(layer.id)) map.addLayer(layer, beforeId);
    }
    return LAYER_IDS.every((id) => Boolean(map.getLayer(id)));
  }

  function diagnosticsFor(map) {
    const order = map?.getStyle?.()?.layers?.map((layer) => layer.id) || [];
    const pointIndexes = POINT_LAYER_IDS.map((id) => order.indexOf(id)).filter((index) => index >= 0);
    const firstPointIndex = pointIndexes.length ? Math.min(...pointIndexes) : -1;
    const layerIndexes = Object.fromEntries(LAYER_IDS.map((id) => [id, order.indexOf(