); return; }
      const image = new Image();
      image.onload = () => {
        try {
          if (!map.hasImage(id)) map.addImage(id, image, {pixelRatio: 4});
          resolve();
        } catch (error) {
          reject(error);
        }
      };
      image.onerror = () => reject(new Error(`Не загружена иконка ${id}.`));
      image.src = uri;
    });
  }

  function iconSizeExpression(low, medium, high) {
    return ['interpolate', ['linear'], ['zoom'], 7, low, 10, medium, 14.3, high];
  }

  function mountainLayers() {
    const baseLayout = {
      'icon-image': ['get', 'mountain_icon'],
      'icon-anchor': 'top',
      'icon-rotation-alignment': 'viewport',
      'icon-pitch-alignment': 'viewport',
      'icon-keep-upright': true,
      'icon-ignore-placement': true,
      'icon-padding': 2,
      'symbol-z-order': 'source',
      'symbol-sort-key': ['get', 'mountain_priority']
    };
    return [
      {
        id: 'alan-mountain-icons-standard',
        type: 'symbol',
        source: SOURCE_ID,
        minzoom: 8.6,
        maxzoom: 14.31,
        filter: ['==', ['get', 'mountain_category'], 'standard'],
        layout: Object.assign({}, baseLayout, {
          'icon-size': iconSizeExpression(0.75, 1.0, 1.25),
          'icon-allow-overlap': false
        }),
        paint: {'icon-opacity': ['interpolate', ['linear'], ['zoom'], 8.6, 0, 9.0, 0.9, 14.3, 0.96]}
      },
      {
        id: 'alan-mountain-icons-high',
        type: 'symbol',
        source: SOURCE_ID,
        minzoom: 7.6,
        maxzoom: 14.31,
        filter: ['==', ['get', 'mountain_category'], 'high'],
        layout: Object.assign({}, baseLayout, {
          'icon-size': iconSizeExpression(0.90, 1.20, 1.50),
          'icon-allow-overlap': false
        }),
        paint: {'icon-opacity': ['interpolate', ['linear'], ['zoom'], 7.6, 0.72, 9.0, 0.94, 14.3, 0.98]}
      },
      {
        id: 'alan-mountain-icons-five-thousanders',
        type: 'symbol',
        source: SOURCE_ID,
        minzoom: 7,
        maxzoom: 14.31,
        filter: ['==', ['get', 'mountain_category'], 'five_thousander'],
        layout: Object.assign({}, baseLayout, {
          'icon-size': iconSizeExpression(1.20, 1.55, 2.00),
          'icon-allow-overlap': true,
          'icon-padding': 1
        }),
        paint: {'icon-opacity': 0.98}
      }
    ];
  }

  async function installMountainLayer(map, data) {
    if (!map || !data || map.__alanMountainIconsInstalled) return;
    map.__alanMountainIconsInstalled = true;
    const spriteIds = AVAILABLE_ICONS.slice();
    await Promise.all(spriteIds.map((id) => loadImage(
      map,
      id,
      new URL(`assets/mountains/${id}.png`, document.baseURI).href
    )));

    const collection = buildMountainCollection(data);
    if (!map.getSource(SOURCE_ID)) map.addSource(SOURCE_ID, {type: 'geojson', data: collection, maxzoom: 14, tolerance: 0.1, buffer: 256});
    const beforeId = [
      'settlement-current-points',
      '