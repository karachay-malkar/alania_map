(() => {
  'use strict';
  const maplibregl = window.maplibregl;
  const MapClass = maplibregl?.Map;
  if (!MapClass || MapClass.prototype.__alanCustomLayerCompat) return;
  const originalAddLayer = MapClass.prototype.addLayer;
  MapClass.prototype.addLayer = function (layer, beforeId) {
    if (layer?.type === 'custom' && layer.id === 'mountain-images' && !layer.__alanRenderCompat) {
      const originalRender = layer.render;
      layer.render = function (gl, renderOptions) {
        const matrix = renderOptions?.defaultProjectionData?.mainMatrix || renderOptions;
        return originalRender.call(this, gl, matrix);
      };
      layer.__alanRenderCompat = true;
    }
    return originalAddLayer.call(this, layer, beforeId);
  };
  MapClass.prototype.__alanCustomLayerCompat = true;
})();
