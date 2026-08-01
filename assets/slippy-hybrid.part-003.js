id)]));
    return {
      version: VERSION,
      flat: Boolean(map && map.getPitch() === 0 && map.getBearing() === 0 && !map.getTerrain()),
      sourceId: VECTOR_SOURCE_ID,
      sourceLayer: VECTOR_SOURCE_LAYER,
      layerIds: LAYER_IDS.slice(),
      layerPresence: Object.fromEntries(LAYER_IDS.map((id) => [id, Boolean(map?.getLayer?.(id))])),
      layerIndexes,
      firstPointIndex,
      mountainLayersBelowPoints: firstPointIndex >= 0 && Object.values(layerIndexes).every((index) => index >= 0 && index < firstPointIndex),
      spriteCount: AVAILABLE_ICONS.length,
      mount1Loaded: Boolean(map?.hasImage?.('mount-1')),
      mount11Loaded: Boolean(map?.hasImage?.('mount-11'))
    };
  }

  async function installMountainLayers(map) {
    if (!map) return;
    if (!map.__alanMountainIconsPromise) {
      map.__alanMountainIconsPromise = Promise.all(AVAILABLE_ICONS.map((id) => loadImage(
        map,
        id,
        new URL(`assets/mountains/${id}.png`, document.baseURI).href
      ))).then(() => {
        const ensure = () => {
          try { ensureMountainLayers(map); } catch (error) { console.error('Alan Slippy mountain layers:', error); }
        };
        ensure();
        map.on('styledata', ensure);
        map.on('idle', ensure);
        return true;
      });
    }
    await map.__alanMountainIconsPromise;
    root.ALAN_SLIPPY_HYBRID_DIAGNOSTICS = () => diagnosticsFor(map);
  }

  function updateUi(host) {
    if (!host) return;
    host.dataset.slippyMode = 'hybrid';
    const title = host.querySelector('.alan-map-title');
    const subtitle = host.querySelector('.alan-map-subtitle');
    const reliefLabel = host.querySelector('[data-control="relief"]')?.closest('.alan-map-control-row')?.querySelector('label');
    const north = host.querySelector('[data-action="north"]');
    if (title) title.textContent = 'Alan Map · 7.0.23 Slippy';
    if (subtitle) subtitle.textContent = 'Гибридная Slippy Map · плоская raster-dem основа + векторные слои и PNG-горы';
    if (reliefLabel) reliefLabel.textContent = 'Тени';
    if (north) { north.textContent = 'N'; north.title = 'Север сверху'; }
  }

  function wrapAlanMapMount() {
    const AlanMap = root.AlanMap;
    if (!AlanMap || typeof AlanMap.mount !== 'function' || AlanMap.__alanSlippyWrapped) return;
    const originalMount = AlanMap.mount.bind(AlanMap);
    AlanMap.mount = function (target, options) {
      const host = typeof target === 'string' ? document.querySelector(target) : target;
      const originalOnReady = options && options.onReady;
      const nextOptions = Object.assign({}, options || {}, {
        regionalLabels3D: {},
        onReady(api) {
          const map = api && api.map;
          installMountainLayers(map).catch((error) => {
            console.error('Alan Slippy Hybrid:', error);
            const status = host && host.querySelector('[data-role="status"]');
            if (status) {
              st