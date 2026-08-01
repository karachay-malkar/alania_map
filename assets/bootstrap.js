(() => {
  'use strict';
  const baseUrl = new URL('.', document.currentScript.src);
  const fetchText = async (name) => {
    const response = await fetch(new URL(name, baseUrl));
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
    await executeParts(["maplibre.part-000.js","maplibre.part-001.js"], 'maplibre.js');
    await loadScript('pmtiles.js');
    await executeParts(["map-data.part-000.js","map-data.part-001.js"], 'map-data.js');
    await loadScript('map-core.js');
    await loadScript('map-ui.js');
    await executeParts([
      "slippy-hybrid.part-000.js",
      "slippy-hybrid.part-001.js",
      "slippy-hybrid.part-002.js",
      "slippy-hybrid.part-003.js",
      "slippy-hybrid.part-004.js",
      "slippy-hybrid.part-005.js"
    ], 'slippy-hybrid.js');
    await loadScript('map-page.js');
  })().catch((error) => {
    console.error(error);
    const root = document.getElementById('alan-map-root');
    if (root) root.innerHTML = '<div style="padding:20px;color:#fff;background:#25282a">Карта не загрузилась: ' + String(error.message || error) + '</div>';
  });
})();
