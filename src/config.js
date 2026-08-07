(function (root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.ALAN_12_1_CONFIG = value;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const version = '12.1.8';
  return Object.freeze({
    version,
    title: `Alan Map · ${version}`,
    boundaryUrl: 'data/map-frame-12.1.5.geojson',
    mountainRenderUrl: `data/mountains/mountain-render-${version}.geojson`,
    specialMountainsUrl: `data/mountains/special-mountains-${version}.geojson`,
    iconManifestUrl: `data/mountains/mountain-icon-manifest-${version}.json`,
    riversUrl: 'data/hydrography/rivers-12.1.5.geojson',
    minZoom: 6.7,
    maxZoom: 15,
    fitPadding: Object.freeze({top: 72, right: 36, bottom: 48, left: 36}),
    imageLayerId: 'mountain-images',
    specialSourceId: 'special-mountains',
    specialHitLayerId: 'special-mountains-hit',
    specialPointLayerId: 'special-mountains-point',
    riverBufferLayerId: 'river-buffer',
    riverLineLayerId: 'river-line',
    colors: Object.freeze({
      outside: '#d8c8a8',
      territory: '#efe2c8',
      boundary: '#5e5143',
      river: '#4a8fa8',
      gold: '#c7a047',
      goldOutline: '#44372b'
    }),
    morphologies: Object.freeze({
      rounded_hill: Object.freeze({label: 'Округлый холм'}),
      rounded_mountain: Object.freeze({label: 'Округлая гора'}),
      steep_mountain: Object.freeze({label: 'Крутая гора'}),
      isolated_peak: Object.freeze({label: 'Одиночный пик'}),
      massif: Object.freeze({label: 'Горный массив'}),
      ridge: Object.freeze({label: 'Хребет'}),
      rocky_peak: Object.freeze({label: 'Скальный пик'}),
      rocky_ridge: Object.freeze({label: 'Скальный хребет'}),
      plateau: Object.freeze({label: 'Плато'})
    }),
    roles: Object.freeze({
      main_mountain: Object.freeze({label: 'Главная гора'}),
      five_thousander: Object.freeze({label: 'Пятитысячник'}),
      unique_mountain: Object.freeze({label: 'Уникальная гора'})
    })
  });
});
