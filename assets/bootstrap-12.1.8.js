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
  const executeGzipBase64 = async (name, sourceName) => {
    const encoded = (await fetchText(name)).trim();
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    if (typeof DecompressionStream !== 'function') throw new Error('Браузер не поддерживает распаковку gzip.');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    const code = await new Response(stream).text();
    (0, eval)(code + '\n//# sourceURL=' + sourceName);
  };
  (async () => {
    await executeParts(['maplibre.part-000.js', 'maplibre.part-001.js'], 'maplibre-12.1.8.js');
    await executeGzipBase64('app-12.1.8.js.gz.b64?v=12.1.8.2', 'app-12.1.8.js');
  })().catch((error) => {
    console.error(error);
    const loading = document.querySelector('#loading .loading-text');
    if (loading) loading.textContent = String(error.message || error);
    const status = document.getElementById('map-status');
    if (status) { status.textContent = 'Карта не загрузилась: ' + String(error.message || error); status.dataset.failed = 'true'; }
  });
})();
