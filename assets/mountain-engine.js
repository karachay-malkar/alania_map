(() => {
  "use strict";
  const config = window.ALAN_MOUNTAIN_CONFIG;
  const data = window.ALAN_MAP_DATA;

  async function fetchJson(path) {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response.json();
  }

  function loadAtlas(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = "async";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Не удалось загрузить атлас ${url}`));
      image.src = url;
    });
  }

  async function registerAtlasIcons(map, manifest) {
    const atlas = await loadAtlas(manifest.atlas);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    for (const icon of manifest.icons) {
      canvas.width = icon.width;
      canvas.height = icon.height;
      context.clearRect(0, 0, icon.width, icon.height);
      context.drawImage(atlas, icon.x, icon.y, icon.width, icon.height, 0, 0, icon.width, icon.height);
      if (!map.hasImage(icon.id)) map.addImage(icon.id, context.getImageData(0, 0, icon.width, icon.height), { pixelRatio: 1 });
    }
  }

  function style() {
    return {
      version: 8,
      glyphs: "",
      sources: {
        frame: { type: "geojson", data: data.mapFrame }
      },
      layers: [
        { id: "background", type: "background", paint: { "background-color": config.background } },
        { id: "land", type: "fill", source: "frame", paint: { "fill-color": config.land, "fill-opacity": 1 } },
        { id: "frame-line", type: "line", source: "frame", paint: { "line-color": config.boundary, "line-width": ["interpolate", ["linear"], ["zoom"], 5.4, 0.8, 10, 1.4], "line-opacity": 0.58 } }
      ]
    };
  }

  function iconSizeExpression(multiplier) {
    return ["*", ["coalesce", ["get", "scale"], 1], ["interpolate", ["linear"], ["zoom"], 5.4, 0.19 * multiplier, 6.5, 0.26 * multiplier, 8, 0.39 * multiplier, 10, 0.58 * multiplier, 12, 0.82 * multiplier, 14, 1.04 * multiplier]];
  }

  function addMountainLayer(map, id, kind, multiplier) {
    map.addLayer({
      id,
      type: "symbol",
      source: "mountains",
      filter: ["==", ["get", "kind"], kind],
      minzoom: config.minZoom,
      layout: {
        "icon-image": ["get", "icon_id"],
        "icon-size": iconSizeExpression(multiplier),
        "icon-anchor": "top",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "icon-rotation-alignment": "viewport",
        "icon-pitch-alignment": "viewport",
        "symbol-sort-key": ["get", "render_order"],
        "symbol-z-order": "source"
      },
      paint: { "icon-opacity": ["interpolate", ["linear"], ["zoom"], 5.4, 0.86, 6.2, 1] }
    });
  }

  async function createMap() {
    const status = document.getElementById("map-status");
    const setStatus = (text, failed = false) => {
      if (!status) return;
      status.textContent = text;
      status.dataset.failed = failed ? "true" : "false";
    };
    const map = new maplibregl.Map({
      container: "map",
      style: style(),
      center: data.center,
      zoom: config.initialZoom,
      minZoom: config.minZoom,
      maxZoom: config.maxZoom,
      maxBounds: data.bounds,
      bearing: 0,
      pitch: 0,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      renderWorldCopies: false,
      attributionControl: false,
      fadeDuration: 0
    });
    map.dragRotate.disable();
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }), "top-right");

    map.on("load", async () => {
      try {
        setStatus("Загрузка точек вершин и фигурок…");
        const [renderData, manifest] = await Promise.all([fetchJson(config.renderUrl), fetchJson(config.manifestUrl)]);
        await registerAtlasIcons(map, manifest);
        map.addSource("mountains", { type: "geojson", data: renderData, promoteId: "id" });
        addMountainLayer(map, "mountain-fill", "fill", 0.92);
        addMountainLayer(map, "mountain-anchor", "anchor", 1);
        const anchorCount = renderData.features.filter(feature => feature.properties.kind === "anchor").length;
        const fillCount = renderData.features.length - anchorCount;
        setStatus(`Горная основа: ${anchorCount} вершин, ${fillCount} связующих фигурок`);
        window.setTimeout(() => status?.classList.add("is-hidden"), 2600);
      } catch (error) {
        console.error(error);
        setStatus(`Ошибка горного слоя: ${error.message}`, true);
      }
    });
    return map;
  }

  window.AlanMountainMap = { createMap };
})();
