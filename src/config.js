(function (root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.ALAN_12_1_CONFIG = value;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const version = '12.1.5';
  return Object.freeze({
    version,
    title: `Alan Map · ${version}`,
    boundaryUrl: `data/map-frame-${version}.geojson`,
    mountainRenderUrl: `data/mountains/mountain-render-${version}.geojson`,
    iconManifestUrl: `data/mountains/mountain-icon-manifest-${version}.json`,
    riversUrl: `data/hydrography/rivers-${version}.geojson`,
    minZoom: 6.7,
    maxZoom: 15,
    fitPadding: Object.freeze({top: 72, right: 36, bottom: 48, left: 36}),
    imageLayerId: 'mountain-images',
    riverBufferLayerId: 'river-buffer',
    riverLineLayerId: 'river-line',
    colors: Object.freeze({
      outside: '#d8c8a8',
      territory: '#efe2c8',
      boundary: '#5e5143',
      river: '#4a8fa8'
    }),
    categories: Object.freeze({
      mountain: Object.freeze({prefix: 'mount', label: 'Гора'}),
      rock: Object.freeze({prefix: 'rock', label: 'Скала'}),
      ridge: Object.freeze({prefix: 'ridge', label: 'Хребтовый якорь'}),
      hill: Object.freeze({prefix: 'hill', label: 'Холм'}),
      main_mountain: Object.freeze({prefix: 'mount-main', label: 'Основная гора'}),
      five_thousander: Object.freeze({prefix: 'mount-5000', label: 'Пятитысячник'})
    })
  });
});
