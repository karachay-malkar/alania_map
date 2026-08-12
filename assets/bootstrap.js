(() => {
  'use strict';
  const RELEASE = '7.0.24-r1';
  const baseUrl = new URL('.', document.currentScript.src);
  const assetUrl = (name) => {
    const url = new URL(name, baseUrl);
    url.searchParams.set('v', RELEASE);
    return url;
  };
  const fetchText = async (name) => {
    const response = await fetch(assetUrl(name));
    if (!response.ok) throw new Error('Alan Map: не загружен ' + name + ' (' + response.status + ').');
    return response.text();
  };
  const executeParts = async (names, sourceName) => {
    const code = (await Promise.all(names.map(fetchText))).join('');
    (0, eval)(code + '\n//# sourceURL=' + sourceName);
  };
  const loadScript = (name) => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = assetUrl(name).href;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Alan Map: не загружен ' + name + '.'));
    document.head.appendChild(script);
  });
  (async () => {
    await executeParts(["maplibre.part-000.js","maplibre.part-001.js"], 'maplibre.js');
    await loadScript('pmtiles.js');
    await executeParts(["map-data.part-000.js","map-data.part-001.js"], 'map-data.js');
    await loadScript('map-core.js');
    await loadScript('map-ui.js');
    await loadScript('map-page.js');
  })().catch((error) => {
    console.error(error);
    const root = document.getElementById('alan-map-root');
    if (root) root.innerHTML = '<div style="padding:20px;color:#fff;background:#25282a">Карта не загрузилась: ' + String(error.message || error) + '</div>';
  });
})();
