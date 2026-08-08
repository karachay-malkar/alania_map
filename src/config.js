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
    ordinary: '#4d5360',
    main: '#9b772d',
    five: '#7b5617',
    mingi: '#b0862f'
  }),
  categories: Object.freeze({
    rounded_hill:      {label: 'Округлый холм', minZoom: 8.2},
    rounded_mountain:  {label: 'Округлая гора', minZoom: 7.6},
    steep_mountain:    {label: 'Крутая гора', minZoom: 7.1},
    isolated_peak:     {label: 'Одиночный пик', minZoom: 6.8},
    massif:            {label: 'Массив', minZoom: 6.8},
    ridge:             {label: 'Хребет', minZoom: 7.0},
    rocky_peak:        {label: 'Скальный пик', minZoom: 6.8},
    rocky_ridge:       {label: 'Скальный хребет', minZoom: 7.0},
    plateau:           {label: 'Плато', minZoom: 8.0}
  })
});
