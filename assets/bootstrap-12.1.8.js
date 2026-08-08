(() => {
  'use strict';
  const baseUrl = new URL('.', document.currentScript.src);
  const fetchText = async (name) => {
    const response = await fetch(new URL(name, baseUrl), {cache: 'no-cache'});
    if (!response.ok) throw new Error('Alan Map: не загружен ' + name + ' (' + response.status + ').');
    return response.text();
  };
  const executeParts = async (names, sourceName) => {
    const code = (await Promise.all(names.map(fetchText))).join('');
    (0, eval)(code + '\n//# sourceURL=' + sourceName);
  };
  const loadScript = (name) => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL(name, baseUrl).href;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Alan Map: не загружен ' + name + '.'));
    document.head.appendChild(script);
  });
  (async () => {
    await executeParts(['maplibre.part-000.js', 'maplibre.part-001.js'], 'maplibre-12.1.8.js');
    await loadScript('app-12.1.8.js?v=12.1.8.1');
  })().catch((error) => {
    console.error(error);
    const loading = document.querySelector('#loading .loading-text');
    if (loading) loading.textContent = String(error.message || error);
    const status = document.getElementById('map-status');
    if (status) { status.textContent = 'Карта не загрузилась: ' + String(error.message || error); status.dataset.failed = 'true'; }
  });
})();
