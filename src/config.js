(function (root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  else root.ALAN_12_1_CONFIG = value;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  return Object.freeze({
    version: '12.1.0',
    title: 'Alan Map · 12.1',
    boundaryUrl: 'data/map-frame.geojson',
    mountainSourceUrl: 'data/mountains/mountain_points.geojson',
    minZoom: 6.7,
    maxZoom: 15,
    fitPadding: Object.freeze({top: 72, right: 36, bottom: 48, left: 36}),
    categories: Object.freeze({
      mountain: Object.freeze({prefix: 'mount', label: 'Гора', color: '#66584b', radius: 3.1}),
      rock: Object.freeze({prefix: 'rock', label: 'Скала', color: '#4e5053', radius: 2.8}),
      ridge: Object.freeze({prefix: 'ridge', label: 'Хребет', color: '#7b6754', radius: 3}),
      hill: Object.freeze({prefix: 'hill', label: 'Холм', color: '#81785f', radius: 2.7}),
      main_mountain: Object.freeze({prefix: 'mount-main', label: 'Основная гора', color: '#59483b', radius: 4.4}),
      five_thousander: Object.freeze({prefix: 'mount-5000', label: 'Пятитысячник', color: '#342f2c', radius: 5.2})
    })
  });
});
