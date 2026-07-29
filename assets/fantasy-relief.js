(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AlanFantasyRelief = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = '2.0.0';
  const EARTH_RADIUS_KM = 6371.0088;
  const REFERENCE_ZOOM = 7;
  const IMAGE_PIXEL_RATIO = 4;
  const ASSET_BASE_PATH = 'assets/mountains/';
  const CATALOG = Object.freeze([{"id":"mount-1","file":"mount-1.png","width_px":201,"height_px":139,"profiles":["rocky","massif"],"nominal_width_km":7.5},{"id":"mount-2","file":"mount-2.png","width_px":323,"height_px":99,"profiles":["ridge","massif"],"nominal_width_km":11},{"id":"mount-3","file":"mount-3.png","width_px":296,"height_px":99,"profiles":["massif","rocky"],"nominal_width_km":11},{"id":"mount-4","file":"mount-4.png","width_px":284,"height_px":96,"profiles":["rocky","massif"],"nominal_width_km":10},{"id":"mount-5","file":"mount-5.png","width_px":243,"height_px":112,"profiles":["rocky","ridge"],"nominal_width_km":8.5},{"id":"mount-6","file":"mount-6.png","width_px":257,"height_px":109,"profiles":["ridge","gentle"],"nominal_width_km":9},{"id":"mount-7","file":"mount-7.png","width_px":352,"height_px":100,"profiles":["gentle","ridge"],"nominal_width_km":12},{"id":"mount-8","file":"mount-8.png","width_px":301,"height_px":91,"profiles":["ridge","gentle"],"nominal_width_km":11},{"id":"mount-9","file":"mount-9.png","width_px":344,"height_px":99,"profiles":["gentle","ridge"],"nominal_width_km":12},{"id":"mount-10","file":"mount-10.png","width_px":280,"height_px":97,"profiles":["ridge","massif"],"nominal_width_km":10},{"id":"mount-11","file":"mount-11.png","width_px":158,"height_px":143,"profiles":["rocky","massif"],"nominal_width_km":6.5},{"id":"mount-12","file":"mount-12.png","width_px":322,"height_px":114,"profiles":["massif","ridge"],"nominal_width_km":11.5},{"id":"mount-13","file":"mount-13.png","width_px":329,"height_px":104,"profiles":["gentle","ridge"],"nominal_width_km":11},{"id":"mount-14","file":"mount-14.png","width_px":274,"height_px":84,"profiles":["gentle","ridge"],"nominal_width_km":10},{"id":"mount-15","file":"mount-15.png","width_px":239,"height_px":137,"profiles":["rocky","massif"],"nominal_width_km":8},{"id":"mount-16","file":"mount-16.png","width_px":312,"height_px":109,"profiles":["ridge","massif"],"nominal_width_km":10.5},{"id":"mount-17","file":"mount-17.png","width_px":316,"height_px":102,"profiles":["ridge","gentle"],"nominal_width_km":10.5},{"id":"mount-18","file":"mount-18.png","width_px":279,"height_px":100,"profiles":["ridge","rocky"],"nominal_width_km":9.5},{"id":"mount-19","file":"mount-19.png","width_px":229,"height_px":108,"profiles":["rocky","massif"],"nominal_width_km":8},{"id":"mount-20","file":"mount-20.png","width_px":313,"height_px":96,"profiles":["gentle","ridge"],"nominal_width_km":11},{"id":"mount-21","file":"mount-21.png","width_px":213,"height_px":118,"profiles":["massif","rocky"],"nominal_width_km":8},{"id":"mount-22","file":"mount-22.png","width_px":306,"height_px":103,"profiles":["ridge","massif"],"nominal_width_km":10.5},{"id":"mount-23","file":"mount-23.png","width_px":270,"height_px":98,"profiles":["massif","rocky"],"nominal_width_km":10},{"id":"mount-24","file":"mount-24.png","width_px":352,"height_px":99,"profiles":["gentle","ridge"],"nominal_width_km":12.5},{"id":"mount-25","file":"mount-25.png","width_px":248,"height_px":120,"profiles":["rocky","massif"],"nominal_width_km":7.5},{"id":"mount-26","file":"mount-26.png","width_px":315,"height_px":106,"profiles":["massif","ridge"],"nominal_width_km":11.5},{"id":"mount-27","file":"mount-27.png","width_px":256,"height_px":103,"profiles":["ridge","rocky"],"nominal_width_km":8.5},{"id":"mount-28","file":"mount-28.png","width_px":339,"height_px":89,"profiles":["gentle","ridge"],"nominal_width_km":12},{"id":"mount-29","file":"mount-29.png","width_px":302,"height_px":97,"profiles":["rocky","ridge"],"nominal_width_km":10},{"id":"mount-30","file":"mount-30.png","width_px":290,"height_px":91,"profiles":["ridge","gentle"],"nominal_width_km":10.5}]);
  const ELBRUS = Object.freeze({"id":"elbrus","file":"elbrus.png","width_px":1020,"height_px":503,"nominal_width_km":44});
  const RIDGE_PROFILE_BY_ID = Object.freeze({"ridge_main_caucasus":"massif","ridge_sugan":"massif","ridge_adyrsu":"massif","ridge_sofia":"massif","ridge_chuchkhur":"massif","ridge_dzhentu":"massif","axis_bezengi_balkar":"massif","axis_kyukyurtly_kubansky":"massif","axis_adylsu":"massif","axis_teberda_dombay_side":"massif","axis_bezengi_khulam":"massif","ridge_black_rocks":"rocky","ridge_chaget_chat":"rocky","ridge_kyshkhadzher":"rocky","ridge_arkasara":"rocky","ridge_zagedan":"rocky","ridge_mystybashi":"rocky","ridge_abishira_akhuba":"rocky","ridge_chilik":"rocky","ridge_khatipara":"rocky","axis_gonachkhir_murudzhu":"rocky","axis_arkhyz_psysh_side":"rocky","axis_arkhyz_kyzgych_side":"rocky","axis_upper_balkar_east":"rocky","axis_upper_balkar_west":"rocky","axis_chegem_baksan_upper":"rocky","axis_bulungu_right":"rocky","axis_tyrnyauz_adyrsu_side":"rocky","axis_teberda_gonachkhir_side":"rocky","axis_tegenekli_irik_side":"rocky","ridge_daut":"ridge","ridge_magisho":"ridge","axis_tashorunbash":"ridge","axis_kyrtyk":"ridge","axis_kargashil":"ridge","axis_khulam_chegem":"ridge","axis_uzhum":"ridge","axis_gabulu_dukkinsky":"ridge","axis_uchkulan_ullukam_side":"ridge","axis_khurzuk_uchkulan_side":"ridge","axis_kartdjurt_north_side":"ridge","axis_baksan_malka_side":"gentle","axis_aktoprak_divide":"gentle","axis_balkbashi_spur":"spur"});
  const PROFILE_CONFIG = Object.freeze({
    massif:Object.freeze({scale:1.22,overlap:0.50,bridgeLimitKm:22,tier:1}),
    rocky:Object.freeze({scale:1.10,overlap:0.52,bridgeLimitKm:10,tier:2}),
    ridge:Object.freeze({scale:1.00,overlap:0.56,bridgeLimitKm:8,tier:2}),
    gentle:Object.freeze({scale:0.96,overlap:0.60,bridgeLimitKm:10,tier:3}),
    spur:Object.freeze({scale:0.82,overlap:0.54,bridgeLimitKm:7,tier:3})
  });

  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

  function hashString(value) {
    let hash = 2166136261;
    for (const character of String(value || '')) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function mulberry32(seed) {
    let state = seed >>> 0;
    return function random() {
      state += 0x6D2B79F5;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function haversineKm(start, end) {
    const toRadians = Math.PI / 180;
    const lat1 = Number(start?.[1]) * toRadians;
    const lat2 = Number(end?.[1]) * toRadians;
    const deltaLat = lat2 - lat1;
    const deltaLon = (Number(end?.[0]) - Number(start?.[0])) * toRadians;
    const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
    return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  function lineLengthKm(coordinates) {
    if (!Array.isArray(coordinates) || coordinates.length < 2) return 0;
    let total = 0;
    for (let index = 1; index < coordinates.length; index += 1) total += haversineKm(coordinates[index - 1], coordinates[index]);
    return total;
  }

  function metersPerPixel(latitude, zoom = REFERENCE_ZOOM) {
    const radians = Number(latitude || 0) * Math.PI / 180;
    return Math.cos(radians) * 156543.03392804097 / (2 ** Number(zoom));
  }

  function flattenRidgeFeatures(collection) {
    const flattened = [];
    for (const [featureIndex, feature] of (collection?.features || []).entries()) {
      const geometry = feature?.geometry || {};
      const properties = {...(feature?.properties || {})};
      const append = (coordinates, partIndex) => {
        if (!Array.isArray(coordinates) || coordinates.length < 2) return;
        const lengthKm = lineLengthKm(coordinates);
        if (!Number.isFinite(lengthKm) || lengthKm < 0.6) return;
        flattened.push({
          type:'Feature',
          properties:{...properties,fantasy_source_index:featureIndex,fantasy_part_index:partIndex,fantasy_length_km:Number(lengthKm.toFixed(3))},
          geometry:{type:'LineString',coordinates}
        });
      };
      if (geometry.type === 'LineString') append(geometry.coordinates, 0);
      if (geometry.type === 'MultiLineString') geometry.coordinates?.forEach(append);
    }
    return flattened;
  }

  function profileForRidge(properties, lengthKm = 0) {
    const axisId = String(properties?.axis_id || properties?.ridge_id || '');
    if (RIDGE_PROFILE_BY_ID[axisId]) return RIDGE_PROFILE_BY_ID[axisId];
    const name = String(properties?.name_ru || properties?.name || '').toLowerCase();
    if (/отрог/.test(name)) return 'spur';
    if (/скал|софий|суган|безенг|адыр|чучхур|дженту/.test(name)) return 'rocky';
    if (/водораздел|борт/.test(name)) return lengthKm > 28 ? 'rocky' : 'ridge';
    if (lengthKm > 38) return 'massif';
    if (lengthKm < 10) return 'spur';
    return 'ridge';
  }

  function groupRidges(collection) {
    const groups = new Map();
    for (const feature of flattenRidgeFeatures(collection)) {
      const key = String(feature.properties.axis_id || feature.properties.ridge_id || `ridge-${feature.properties.fantasy_source_index}`);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(feature);
    }
    return groups;
  }

  function bridgeCoordinates(start, end, stepKm = 1.2) {
    const distance = haversineKm(start, end);
    if (distance <= stepKm) return [];
    const count = Math.floor(distance / stepKm);
    const points = [];
    for (let index = 1; index <= count; index += 1) {
      const t = index / (count + 1);
      points.push([Number(start[0]) + (Number(end[0]) - Number(start[0])) * t, Number(start[1]) + (Number(end[1]) - Number(start[1])) * t]);
    }
    return points;
  }

  function mergePair(first, second, mode) {
    let a = first;
    let b = second;
    if (mode === 'end-end') b = [...second].reverse();
    if (mode === 'start-start') a = [...first].reverse();
    if (mode === 'start-end') return mergePair(second, first, 'end-start');
    const bridge = bridgeCoordinates(a[a.length - 1], b[0]);
    return [...a, ...bridge, ...b];
  }

  function closestEndpointPair(first, second) {
    const candidates = [
      ['end-start',haversineKm(first[first.length - 1],second[0])],
      ['end-end',haversineKm(first[first.length - 1],second[second.length - 1])],
      ['start-start',haversineKm(first[0],second[0])],
      ['start-end',haversineKm(first[0],second[second.length - 1])]
    ];
    candidates.sort((a,b) => a[1] - b[1]);
    return {mode:candidates[0][0],distanceKm:candidates[0][1]};
  }

  function stitchRidgeParts(features, bridgeLimitKm) {
    const paths = features.map((feature) => feature.geometry.coordinates.map((coordinate) => [Number(coordinate[0]),Number(coordinate[1])])).filter((coordinates) => coordinates.length > 1);
    let changed = true;
    while (changed && paths.length > 1) {
      changed = false;
      let best = null;
      for (let firstIndex = 0; firstIndex < paths.length; firstIndex += 1) {
        for (let secondIndex = firstIndex + 1; secondIndex < paths.length; secondIndex += 1) {
          const candidate = closestEndpointPair(paths[firstIndex], paths[secondIndex]);
          if (!best || candidate.distanceKm < best.distanceKm) best = {...candidate,firstIndex,secondIndex};
        }
      }
      if (best && best.distanceKm <= bridgeLimitKm) {
        const merged = mergePair(paths[best.firstIndex], paths[best.secondIndex], best.mode);
        paths.splice(best.secondIndex, 1);
        paths.splice(best.firstIndex, 1, merged);
        changed = true;
      }
    }
    return paths.sort((a,b) => lineLengthKm(b) - lineLengthKm(a));
  }

  function pointAtDistance(coordinates, distanceKm) {
    if (!coordinates.length) return null;
    if (distanceKm <= 0) return {coordinate:coordinates[0],segmentIndex:0};
    let travelled = 0;
    for (let index = 1; index < coordinates.length; index += 1) {
      const segmentLength = haversineKm(coordinates[index - 1], coordinates[index]);
      if (travelled + segmentLength >= distanceKm) {
        const t = segmentLength > 0 ? (distanceKm - travelled) / segmentLength : 0;
        return {
          coordinate:[coordinates[index - 1][0] + (coordinates[index][0] - coordinates[index - 1][0]) * t,coordinates[index - 1][1] + (coordinates[index][1] - coordinates[index - 1][1]) * t],
          segmentIndex:index - 1
        };
      }
      travelled += segmentLength;
    }
    return {coordinate:coordinates[coordinates.length - 1],segmentIndex:Math.max(0,coordinates.length - 2)};
  }

  function catalogForProfile(profile) {
    const direct = CATALOG.filter((icon) => icon.profiles.includes(profile));
    return direct.length ? direct : CATALOG;
  }

  function iconSizeAtReferenceZoom(icon, nominalWidthKm, latitude) {
    const cssWidth = Number(icon.width_px) / IMAGE_PIXEL_RATIO;
    return Number((nominalWidthKm * 1000 / Math.max(1, metersPerPixel(latitude, REFERENCE_ZOOM) * cssWidth)).toFixed(6));
  }

  function buildChainFeatures(axisId, nameRu, profile, tier, coordinates, pathIndex, seed) {
    const config = PROFILE_CONFIG[profile] || PROFILE_CONFIG.ridge;
    const pool = catalogForProfile(profile);
    const random = mulberry32(seed);
    const totalLength = lineLengthKm(coordinates);
    const features = [];
    let distance = 0;
    let sequence = 0;
    let previousIconId = '';
    let previousWidth = null;
    let maximumGapRatio = 0;

    const chooseIcon = (offset = 0) => {
      let icon = pool[(seed + sequence * 7 + offset * 3) % pool.length];
      if (icon.id === previousIconId && pool.length > 1) icon = pool[(pool.indexOf(icon) + 1) % pool.length];
      return icon;
    };

    while (distance <= totalLength + 0.001 && sequence < 10000) {
      const icon = chooseIcon();
      const widthVariation = 0.91 + random() * 0.18;
      const nominalWidthKm = Number(icon.nominal_width_km) * config.scale * widthVariation;
      const position = pointAtDistance(coordinates, Math.min(distance,totalLength));
      if (!position) break;
      const sizeZ7 = iconSizeAtReferenceZoom(icon,nominalWidthKm,position.coordinate[1]);
      features.push({
        type:'Feature',
        properties:{
          fantasy_axis_id:axisId,fantasy_name_ru:nameRu,fantasy_profile:profile,fantasy_tier:tier,
          fantasy_icon:icon.id,fantasy_size_z7:sizeZ7,fantasy_width_km:Number(nominalWidthKm.toFixed(3)),
          fantasy_sequence:sequence,fantasy_path_index:pathIndex
        },
        geometry:{type:'Point',coordinates:position.coordinate}
      });
      previousIconId = icon.id;
      const nextIcon = chooseIcon(1);
      const nextWidth = Number(nextIcon.nominal_width_km) * config.scale * (0.96 + random() * 0.08);
      const stepKm = clamp(((nominalWidthKm + nextWidth) / 2) * config.overlap,1.6,10.5);
      if (previousWidth !== null) maximumGapRatio = Math.max(maximumGapRatio,stepKm / ((previousWidth + nominalWidthKm) / 2));
      previousWidth = nominalWidthKm;
      distance += stepKm;
      sequence += 1;
    }

    const lastDistance = features.length ? lineLengthKm(coordinates.slice(0,Math.max(2,coordinates.length))) : 0;
    return {features,totalLengthKm:totalLength,maximumGapRatio};
  }

  function buildMountainPointCollection(collection) {
    const groups = groupRidges(collection);
    const features = [];
    const profileCounts = {massif:0,rocky:0,ridge:0,gentle:0,spur:0};
    const tierCounts = {1:0,2:0,3:0};
    let chainCount = 0;
    let maximumGapRatio = 0;
    let stitchedBridgeCount = 0;

    for (const [axisId, group] of groups.entries()) {
      const groupLength = group.reduce((sum,feature) => sum + Number(feature.properties.fantasy_length_km || 0),0);
      const profile = profileForRidge(group[0]?.properties || {},groupLength);
      const config = PROFILE_CONFIG[profile] || PROFILE_CONFIG.ridge;
      const tier = axisId === 'ridge_main_caucasus' ? 1 : (profile === 'massif' && groupLength >= 25 ? 1 : config.tier);
      const paths = stitchRidgeParts(group,axisId === 'ridge_main_caucasus' ? 24 : config.bridgeLimitKm);
      stitchedBridgeCount += Math.max(0,group.length - paths.length);
      profileCounts[profile] += paths.length;
      tierCounts[tier] += paths.length;
      for (const [pathIndex,path] of paths.entries()) {
        const seed = hashString(`${axisId}:${pathIndex}`);
        const chain = buildChainFeatures(axisId,String(group[0]?.properties?.name_ru || ''),profile,tier,path,pathIndex,seed);
        features.push(...chain.features);
        chainCount += 1;
        maximumGapRatio = Math.max(maximumGapRatio,chain.maximumGapRatio);
      }
    }

    return {
      type:'FeatureCollection',
      features,
      diagnostics:{
        sourceFeatureCount:collection?.features?.length || 0,
        groupedRidgeCount:groups.size,
        chainCount,
        mountainPointCount:features.length,
        stitchedBridgeCount,
        maximumGapRatio:Number(maximumGapRatio.toFixed(3)),
        profileCounts,
        tierCounts
      }
    };
  }

  function createLandmarkCollection(data) {
    const coordinates = Array.isArray(data?.elbrusFocus) ? data.elbrusFocus.map(Number) : [];
    const valid = coordinates.length === 2 && coordinates.every(Number.isFinite);
    if (!valid) return {type:'FeatureCollection',features:[]};
    return {
      type:'FeatureCollection',
      features:[{
        type:'Feature',
        properties:{
          fantasy_landmark:'elbrus',fantasy_icon:'fantasy-elbrus',fantasy_size_z7:iconSizeAtReferenceZoom(ELBRUS,Number(ELBRUS.nominal_width_km),coordinates[1])
        },
        geometry:{type:'Point',coordinates}
      }]
    };
  }

  function requireCanvas(width, height) {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  function paperPatternImage() {
    const size = 128;
    const canvas = requireCanvas(size,size);
    if (!canvas) return null;
    const context = canvas.getContext('2d');
    const random = mulberry32(8000);
    context.clearRect(0,0,size,size);
    context.fillStyle = 'rgba(205,183,138,.12)';
    context.fillRect(0,0,size,size);
    for (let index = 0; index < 900; index += 1) {
      const alpha = 0.014 + random() * 0.042;
      context.fillStyle = random() > 0.42 ? `rgba(91,65,38,${alpha})` : `rgba(248,236,204,${alpha})`;
      context.beginPath();
      context.arc(random()*size,random()*size,0.2+random()*0.9,0,Math.PI*2);
      context.fill();
    }
    return context.getImageData(0,0,size,size);
  }

  function imageDefinitions() {
    return [
      ...CATALOG.map((icon) => ({id:icon.id,url:`${ASSET_BASE_PATH}${icon.file}`,pixelRatio:IMAGE_PIXEL_RATIO})),
      {id:'fantasy-elbrus',url:`${ASSET_BASE_PATH}${ELBRUS.file}`,pixelRatio:IMAGE_PIXEL_RATIO}
    ];
  }

  function loadMapImage(map, url) {
    try {
      const result = map.loadImage(url);
      if (result && typeof result.then === 'function') return result.then((value) => value?.data || value);
    } catch (_) {}
    return new Promise((resolve,reject) => {
      map.loadImage(url,(error,image) => error ? reject(error) : resolve(image));
    });
  }

  async function loadImages(map) {
    const definitions = imageDefinitions();
    await Promise.all(definitions.map(async (definition) => {
      if (map.hasImage(definition.id)) return definition.id;
      const url = new URL(definition.url,document.baseURI).href;
      const image = await loadMapImage(map,url);
      if (!map.hasImage(definition.id)) map.addImage(definition.id,image,{pixelRatio:definition.pixelRatio});
      return definition.id;
    }));
    return definitions.map((definition) => definition.id);
  }

  function createImages() {
    return {'fantasy-paper-grain':paperPatternImage()};
  }

  return {
    version:VERSION,
    referenceZoom:REFERENCE_ZOOM,
    imagePixelRatio:IMAGE_PIXEL_RATIO,
    catalog:CATALOG,
    elbrus:ELBRUS,
    lineLengthKm,
    metersPerPixel,
    flattenRidgeFeatures,
    profileForRidge,
    stitchRidgeParts,
    buildMountainPointCollection,
    createLandmarkCollection,
    imageDefinitions,
    loadImages,
    createImages,
    __test:{hashString,mulberry32,pointAtDistance,iconSizeAtReferenceZoom,profileConfig:PROFILE_CONFIG,ridgeProfiles:RIDGE_PROFILE_BY_ID}
  };
});
