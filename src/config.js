export const CONFIG = Object.freeze({
  version: '1.0.1',
  boundaryUrl: 'data/map-boundary.geojson?v=1.0.1',
  mountainsUrl: 'data/mountains.geojson?v=1.0.1',
  iconMountainsUrl: 'data/mountain-icons-1500.geojson?v=1.0.1',
  atlasManifestUrl: 'assets/mountains/atlas-manifest.json?v=1.0.1',
  iconAtlasUrl: 'assets/mountains/mountain-atlas.webp?v=1.0.1',
  bearing: 180,
  pitch: 25,
  minZoom: 6.2,
  maxZoom: 15.5,
  fitPadding: 46,
  iconReferenceZoom: 9.5,
  labelMinZoom: 9.5,
  colors: Object.freeze({
    outside: '#d7c5a1',
    territory: '#eadbbc',
    boundary: '#5b4b39',
    main: '#9b772d',
    five: '#7b5617',
    mingi: '#b0862f',
    label: '#4b3b28',
    labelHalo: '#efe2c5'
  }),
  revealTiers: Object.freeze([
    {tier: 1, zoom: 7.2},
    {tier: 2, zoom: 8.0},
    {tier: 3, zoom: 8.8}
  ]),
  categories: Object.freeze({
    rounded_hill:     {label: 'Округлый холм'},
    rounded_mountain: {label: 'Округлая гора'},
    steep_mountain:   {label: 'Крутая гора'},
    isolated_peak:    {label: 'Одиночный пик'},
    massif:            {label: 'Массив'},
    ridge:             {label: 'Хребет'},
    rocky_peak:        {label: 'Скальный пик'},
    rocky_ridge:       {label: 'Скальный хребет'},
    plateau:           {label: 'Плато'}
  })
});
