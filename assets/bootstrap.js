(() => {
  "use strict";
  const base = new URL("../", document.currentScript.src);
  const status = document.getElementById("map-status");
  const setStatus = (text, failed = false) => {
    if (!status) return;
    status.textContent = text;
    status.dataset.failed = failed ? "true" : "false";
  };
  const fetchText = async (path) => {
    const response = await fetch(new URL(path, base), { cache: "no-store" });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response.text();
  };
  const execute = (source, label) => {
    const script = document.createElement("script");
    script.textContent = `${source}
//# sourceURL=${label}`;
    document.head.appendChild(script);
    script.remove();
  };
  const executeParts = async (paths, label) => execute((await Promise.all(paths.map(fetchText))).join("
"), label);
  (async () => {
    try {
      setStatus("Загрузка локального картографического движка…");
      await executeParts(["assets/maplibre.part-000.js", "assets/maplibre.part-001.js"], "maplibre.local.js");
      for (const path of ["assets/map-data.js", "assets/mountain-config.js", "assets/mountain-engine.js", "assets/map-page.js"]) {
        execute(await fetchText(path), path);
      }
    } catch (error) {
      console.error(error);
      setStatus(`Ошибка загрузки: ${error.message}`, true);
    }
  })();
})();
