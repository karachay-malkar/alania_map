export const CONFIG = Object.freeze({
  version: '1.0',
  boundaryUrl: 'data/map-boundary.geojson',
  mountainsUrl: 'data/mountains.geojson',
  bearing: 180,
  pitch: 25,
  minZoom: 6.2,
  maxZoom: 15.5,
  fitPadding: 46,
  colors: Object.freeze({
    outside: '#d7c5a1',
    territory: '#eadbbc',
    boundary: '#5b4b39',
    main: '#9b772d',
    five: '#7b5617',
    mingi: '#b0862f'
  }),
  categories: Object.freeze({
    rounded_hill:     {label: 'Округлый холм', minZoom: 8.2, color: '#8b8172', radiusScale: 0.84},
    rounded_mountain: {label: 'Округлая гора', minZoom: 7.6, color: '#6f756d', radiusScale: 0.98},
    steep_mountain:   {label: 'Крутая гора', minZoom: 7.1, color: '#5f6670', radiusScale: 1.08},
    isolated_peak:    {label: 'Одиночный пик', minZoom: 6.8, color: '#55515c', radiusScale: 1.20},
    massif:           {label: 'Массив', minZoom: 6.8, color: '#6b5c55', radiusScale: 1.22},
    ridge:            {label: 'Хребет', minZoom: 7.0, color: '#707467', radiusScale: 1.04},
    rocky_peak:       {label: 'Скальный пик', minZoom: 6.8, color: '#4d5662', radiusScale: 1.16},
    rocky_ridge:      {label: 'Скальный хребет', minZoom: 7.0, color: '#505b58', radiusScale: 1.10},
    plateau:          {label: 'Плато', minZoom: 8.0, color: '#8a7964', radiusScale: 0.90}
  })
});
