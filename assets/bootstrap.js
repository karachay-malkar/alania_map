(() => {
  'use strict';

  const baseUrl = new URL('.', document.currentScript.src);

  async function fetchText(name) {
    const response = await fetch(new URL(name, baseUrl), {cache: 'no-cache'});
    if (!response.ok) throw new Error(`Не загружен ${name} (HTTP ${response.status}).`);
    return response.text();
  }

  async function executeParts(names, sourceName) {
    const code = (await Promise.all(names.map(fetchText))).join('');
    (0, eval)(`${code}\n//# sourceURL=${sourceName}`);
  }

  function loadScript(name) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL(name, baseUrl).href;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Не загружен ${name}.`));
      document.head.appendChild(script);
    });
  }

  (async () => {
    await executeParts(['maplibre.part-000.js', 'maplibre.part-001.js'], 'maplibre.js');
    await loadScript('../src/config.js');
    await loadScript('../src/data.js');
    await loadScript('../src/map.js');
    await loadScript('../src/app.js');
  })().catch((error) => {
    console.error(error);
    const status = document.getElementById('map-status');
    if (status) {
      status.textContent = `Карта не загрузилась: ${error.message || error}`;
      status.dataset.failed = 'true';
    }
    const loadingText = document.querySelector('#loading .loading-text');
    if (loadingText) loadingText.textContent = String(error.message || error);
  });
})();
