(function (root) {
  'use strict';

  async function start() {
    const config = root.ALAN_12_1_CONFIG;
    const dataModule = root.ALAN_12_1_DATA;
    const mapModule = root.ALAN_12_1_MAP;
    if (!config || !dataModule || !mapModule) throw new Error('Модули карты 12.1 подключены не полностью.');
    const status = document.getElementById('map-status');
    if (status) status.textContent = 'Подготавливаются морфология гор, хребтовые цепи и речные коридоры…';
    const data = await dataModule.loadStageData();
    const map = mapModule.createMap(root.maplibregl, data);
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(document.getElementById('map-shell'));
    root.ALAN_12_1_INSTANCE = Object.freeze({
      version: config.version,
      map,
      data,
      diagnostics: () => mapModule.diagnostics(map, data),
      destroy() {
        resizeObserver.disconnect();
        map.remove();
      }
    });
  }

  start().catch((error) => {
    console.error(error);
    document.getElementById('loading')?.removeAttribute('hidden');
    const status = document.getElementById('map-status');
    if (status) {
      status.textContent = `Карта не загрузилась: ${error.message || error}`;
      status.dataset.failed = 'true';
    }
    const loadingText = document.querySelector('#loading .loading-text');
    if (loadingText) loadingText.textContent = String(error.message || error);
  });
})(typeof self !== 'undefined' ? self : this);
