(function (root) {
  'use strict';

  const VERSION = '7.0.22';
  const ARCHIVE_PATH = 'data/alan-vector-7.0.22.pmtiles';
  const EMPTY_COLLECTION = Object.freeze({type:'FeatureCollection', features:[]});
  const EXTRA_RIVER_LAYERS = [
    'osm-river-main-halo','osm-river-main',
    'osm-river-regional-halo','osm-river-regional',
    'osm-river-local-halo','osm-river-local'
  ];
  const EXTRA_RIVER_LABELS = ['osm-river-label-main','osm-river-label-regional'];
  const EXTRA_PEAK_LABELS = ['osm-peak-high-labels','osm-peak-labels'];

  function patchData(input) {
    const data = input || root.ALAN_MAP_DATA;
    if (!data || typeof data !== 'object') return data;
    ['rivers','glaciers','peakSnow','elbrusSnow','peaks','highPeaks'].forEach((key) => {
      data[key] = {type:EMPTY_COLLECTION.type, features:[]};
    });
    data.regionalVector = {
      ...(data.regionalVector || {}),
      available:true,
      archivePath:ARCHIVE_PATH,
      minzoom:7,
      maxzoom:13,
      layers:['landcover','landuse','transportation','water','waterway','peak'],
      physicallyClipped:true,
      attribution:'Geofabrik © OpenStreetMap contributors'
    };
    data.applicationVersion = VERSION;
    data.dataVersion = VERSION + '-osm-natural.1';
    data.version = VERSION;
    data.stage = VERSION;
    return data;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;'
    })[character]);
  }

  function visibility(map, ids, visible) {
    ids.forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    });
  }

  function riverWidth(tier, scale, halo) {
    const extra = halo ? (tier === 1 ? 3.0 : tier === 2 ? 2.2 : 1.6) : 0;
    const stops = tier === 1
      ? [7.0, 1.15, 8.0, 2.0, 11.0, 3.35, 14.3, 4.6]
      : tier === 2
        ? [7.0, 0.15, 8.2, 0.35, 9.0, 1.15, 11.0, 2.15, 14.3, 3.2]
        : [10.4, 0.05, 11.2, 0.72, 13.0, 1.5, 14.3, 2.2];
    const expression = ['interpolate',['linear'],['zoom']];
    for (let index = 0; index < stops.length; index += 2) {
      expression.push(stops[index], stops[index + 1] * scale + extra);
    }
    return expression;
  }

  function addLayer(map, definition, beforeId) {
    if (map.getLayer(definition.id)) map.removeLayer(definition.id);
    map.addLayer(definition, beforeId && map.getLayer(beforeId) ? beforeId : undefined);
  }

  function installNaturalLayers(api, host) {
    const map = api?.map;
    if (!map || !map.getSource('openmaptiles')) return;

    ['lake-outline','lake-fill','permanent-snow-fill'].forEach((id) => {
      if (map.getLayer(id)) map.removeLayer(id);
    });

    addLayer(map, {
      id:'osm-glacier-fill', type:'fill', source:'openmaptiles', 'source-layer':'landcover', minzoom:7,
      filter:['all',['==',['get','class'],'ice'],['==',['get','subclass'],'glacier']],
      paint:{
        'fill-color':'#f2f8f7',
        'fill-opacity':['interpolate',['linear'],['zoom'],7,0.72,9,0.9,12,0.94],
        'fill-outline-color':'#8fb6c1'
      }
    }, 'boundary-line');
    addLayer(map, {
      id:'osm-snow-fill', type:'fill', source:'openmaptiles', 'source-layer':'landcover', minzoom:7,
      filter:['all',['==',['get','class'],'ice'],['==',['get','subclass'],'snow']],
      paint:{
        'fill-color':'#fbfdfc',
        'fill-opacity':['interpolate',['linear'],['zoom'],7,0.58,9,0.78,12,0.86],
        'fill-outline-color':'#b8ced3'
      }
    }, 'boundary-line');
    addLayer(map, {
      id:'osm-lake-fill', type:'fill', source:'openmaptiles', 'source-layer':'water', minzoom:7,
      filter:['in',['get','class'],['literal',['lake','reservoir']]],
      paint:{'fill-color':'#6aa7bb','fill-opacity':['interpolate',['linear'],['zoom'],7,0.62,9.2,0.72,12,0.78]}
    }, 'boundary-line');
    addLayer(map, {
      id:'osm-lake-outline', type:'line', source:'openmaptiles', 'source-layer':'water', minzoom:7,
      filter:['in',['get','class'],['literal',['lake','reservoir']]],
      paint:{
        'line-color':'#79b6c9',
        'line-width':['interpolate',['linear'],['zoom'],7,0.75,11,1.65],
        'line-opacity':['interpolate',['linear'],['zoom'],7,0.72,7.5,0.94]
      }
    }, 'boundary-line');
    addLayer(map, {
      id:'osm-river-water-fill', type:'fill', source:'openmaptiles', 'source-layer':'water', minzoom:7,
      filter:['==',['get','class'],'river'],
      paint:{'fill-color':'#6aa7bb','fill-opacity':['interpolate',['linear'],['zoom'],7,0.5,10,0.68,13,0.76]}
    }, 'boundary-line');

    const riverDefinitions = [
      ['osm-river-main-halo',1,true], ['osm-river-main',1,false],
      ['osm-river-regional-halo',2,true], ['osm-river-regional',2,false],
      ['osm-river-local-halo',3,true], ['osm-river-local',3,false]
    ];
    const currentScale = Number(host.querySelector('[data-control="rivers"]')?.value || 1.25);
    riverDefinitions.forEach(([id,tier,halo]) => addLayer(map, {
      id, type:'line', source:'openmaptiles', 'source-layer':'waterway', minzoom:tier === 1 ? 7 : tier === 2 ? 8.2 : 10.4,
      filter:['==',['get','tier'],tier],
      layout:{'line-cap':'round','line-join':'round'},
      paint:{
        'line-color':halo ? '#f4ead6' : '#3f8dac',
        'line-width':riverWidth(tier,currentScale,halo),
        'line-opacity':tier === 1
          ? (halo ? 0.88 : 0.98)
          : tier === 2
            ? ['interpolate',['linear'],['zoom'],8.2,0,8.9,halo?0.82:0.94]
            : ['interpolate',['linear'],['zoom'],10.4,0,11.2,halo?0.7:0.82],
        ...(halo ? {'line-blur':0.4} : {})
      }
    }, 'settlement-current-points'));

    const labelName = ['coalesce',['get','name_alan_latin'],['get','name_ru'],['get','name']];
    addLayer(map, {
      id:'osm-river-label-main', type:'symbol', source:'openmaptiles', 'source-layer':'waterway', minzoom:7,
      filter:['==',['get','tier'],1],
      layout:{
        'symbol-placement':'line','symbol-spacing':500,'text-field':labelName,'text-font':['Noto Sans Regular'],
        'text-size':['interpolate',['linear'],['zoom'],7,9.5,11,14.5],
        'text-letter-spacing':0.055,'text-rotation-alignment':'map','text-pitch-alignment':'viewport',
        'text-keep-upright':true,'text-max-angle':38,'text-allow-overlap':false
      },
      paint:{'text-color':'#126083','text-halo-color':'#f5ead5','text-halo-width':1.7,'text-halo-blur':0.55}
    }, 'settlement-labels-current');
    addLayer(map, {
      id:'osm-river-label-regional', type:'symbol', source:'openmaptiles', 'source-layer':'waterway', minzoom:9,
      filter:['==',['get','tier'],2],
      layout:{
        'symbol-placement':'line','symbol-spacing':440,'text-field':labelName,'text-font':['Noto Sans Regular'],
        'text-size':['interpolate',['linear'],['zoom'],9,9.1,12,12.7],
        'text-letter-spacing':0.04,'text-rotation-alignment':'map','text-pitch-alignment':'viewport',
        'text-keep-upright':true,'text-max-angle':42,'text-allow-overlap':false
      },
      paint:{'text-color':'#126083','text-halo-color':'#f5ead5','text-halo-width':1.45,'text-halo-blur':0.45}
    }, 'settlement-labels-current');

    const visiblePeakFilter = ['!=',['get','hidden'],1];
    addLayer(map, {
      id:'osm-peak-high', type:'circle', source:'openmaptiles', 'source-layer':'peak', minzoom:7,
      filter:['all',visiblePeakFilter,['==',['get','peak_level'],1]],
      paint:{
        'circle-radius':4,'circle-color':'#514b44','circle-stroke-color':'#f7efe0','circle-stroke-width':1,
        'circle-pitch-alignment':'viewport','circle-pitch-scale':'viewport'
      }
    }, 'settlement-labels-current');
    addLayer(map, {
      id:'osm-peak-points', type:'circle', source:'openmaptiles', 'source-layer':'peak', minzoom:10,
      filter:['all',visiblePeakFilter,['==',['get','peak_level'],2]],
      paint:{
        'circle-radius':2.5,'circle-color':'#675f55','circle-stroke-color':'#f5ead5','circle-stroke-width':1,
        'circle-pitch-alignment':'viewport','circle-pitch-scale':'viewport'
      }
    }, 'settlement-labels-current');
    addLayer(map, {
      id:'osm-peak-high-labels', type:'symbol', source:'openmaptiles', 'source-layer':'peak', minzoom:7,
      filter:['all',visiblePeakFilter,['==',['get','peak_level'],1]],
      layout:{
        'text-field':['format',labelName,{},'\n',{},['concat',['to-string',['get','ele']],' м'],{'font-scale':0.72}],
        'text-font':['Noto Sans Regular'],'text-size':11.5,'text-offset':[0,1.15],'text-anchor':'top','text-allow-overlap':false
      },
      paint:{'text-color':'#514a43','text-halo-color':'#f7efe0','text-halo-width':1.9}
    }, 'settlement-labels-current');
    addLayer(map, {
      id:'osm-peak-labels', type:'symbol', source:'openmaptiles', 'source-layer':'peak', minzoom:10,
      filter:['all',visiblePeakFilter,['==',['get','peak_level'],2]],
      layout:{'text-field':labelName,'text-font':['Noto Sans Regular'],'text-size':9.7,'text-offset':[0,1],'text-anchor':'top','text-allow-overlap':false},
      paint:{'text-color':'#514a43','text-halo-color':'#f4ead6','text-halo-width':1.5}
    }, 'settlement-labels-current');

    function syncVisibility() {
      const riversVisible = host.querySelector('[data-toggle="rivers"]')?.classList.contains('active') !== false;
      const labelsVisible = host.querySelector('[data-toggle="labels"]')?.classList.contains('active') !== false;
      visibility(map, EXTRA_RIVER_LAYERS, riversVisible);
      visibility(map, EXTRA_RIVER_LABELS, riversVisible && labelsVisible);
      visibility(map, EXTRA_PEAK_LABELS, labelsVisible);
    }

    function syncRiverScale(value) {
      const scale = Math.max(0.7,Math.min(2.2,Number(value) || 1.25));
      [[1,'main'],[2,'regional'],[3,'local']].forEach(([tier,name]) => {
        const haloId = `osm-river-${name}-halo`;
        const lineId = `osm-river-${name}`;
        if (map.getLayer(haloId)) map.setPaintProperty(haloId,'line-width',riverWidth(tier,scale,true));
        if (map.getLayer(lineId)) map.setPaintProperty(lineId,'line-width',riverWidth(tier,scale,false));
      });
    }

    host.querySelector('[data-toggle="rivers"]')?.addEventListener('click',syncVisibility);
    host.querySelector('[data-toggle="labels"]')?.addEventListener('click',syncVisibility);
    host.querySelector('[data-control="rivers"]')?.addEventListener('input',(event) => syncRiverScale(event.target.value));
    syncVisibility();
    syncRiverScale(currentScale);

    function popup(event, kindResolver) {
      const feature = event.features?.[0];
      if (!feature) return;
      const props = feature.properties || {};
      const kind = kindResolver(props);
      const title = props.name_alan_latin || props.name_ru || props.name || (kind === 'ледник' ? 'Ледник' : 'Объект');
      const details = [];
      if (props.ele) details.push(`Высота: ${escapeHtml(props.ele)} м`);
      if (props.class && kind.includes('водоток')) details.push(`Класс: ${escapeHtml(props.class)}`);
      new root.maplibregl.Popup({closeButton:true,maxWidth:'310px'})
        .setLngLat(event.lngLat)
        .setHTML(`<div class="alan-map-popup-title">${escapeHtml(title)}</div><div class="alan-map-popup-kind">${escapeHtml(kind)}</div>${details.length?`<div class="alan-map-popup-meta">${details.join('<br>')}</div>`:''}`)
        .addTo(map);
    }

    const interactive = {
      'osm-glacier-fill':() => 'ледник',
      'osm-snow-fill':() => 'постоянный снег',
      'osm-lake-fill':(props) => props.class === 'reservoir' ? 'водохранилище' : 'озеро',
      'osm-river-main':(props) => props.class === 'canal' ? 'канал' : 'река',
      'osm-river-regional':(props) => props.class === 'canal' ? 'канал' : 'региональный водоток',
      'osm-river-local':() => 'горный водоток',
      'osm-peak-high':() => 'вершина',
      'osm-peak-points':() => 'вершина'
    };
    Object.entries(interactive).forEach(([id,resolver]) => {
      if (!map.getLayer(id)) return;
      map.on('mouseenter',id,() => {map.getCanvas().style.cursor='pointer';});
      map.on('mouseleave',id,() => {map.getCanvas().style.cursor='';});
      map.on('click',id,(event) => popup(event,resolver));
    });

    host.dispatchEvent(new CustomEvent('alan-map:natural-layers-ready', {
      detail:{version:VERSION, layers:[...EXTRA_RIVER_LAYERS,...EXTRA_RIVER_LABELS,'osm-glacier-fill','osm-snow-fill','osm-lake-fill','osm-river-water-fill','osm-peak-high','osm-peak-points']}
    }));
  }

  const original = root.AlanMap;
  if (!original?.mount) throw new Error('Alan Map natural layers: AlanMap.mount is unavailable.');
  const originalMount = original.mount;
  root.AlanMap = {
    ...original,
    version:VERSION,
    mount(target, options = {}) {
      const host = typeof target === 'string' ? document.querySelector(target) : target;
      const previousReady = options.onReady;
      return originalMount(target, {
        ...options,
        data:patchData(options.data || root.ALAN_MAP_DATA),
        onReady(api) {
          installNaturalLayers(api,host);
          if (typeof previousReady === 'function') previousReady(api);
        }
      });
    }
  };
  root.ALAN_MAP_NATURAL = {version:VERSION, patchData, installNaturalLayers};
})(typeof window !== 'undefined' ? window : globalThis);
