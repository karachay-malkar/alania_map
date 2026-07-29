(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AlanFantasyRelief = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = '1.0.0';
  const EARTH_RADIUS_KM = 6371.0088;

  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

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
    for (let index = 1; index < coordinates.length; index += 1) {
      total += haversineKm(coordinates[index - 1], coordinates[index]);
    }
    return total;
  }

  function quantile(sortedValues, fraction) {
    if (!sortedValues.length) return 0;
    const position = clamp(Number(fraction), 0, 1) * (sortedValues.length - 1);
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) return sortedValues[lower];
    const weight = position - lower;
    return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
  }

  function flattenRidgeFeatures(collection) {
    const flattened = [];
    for (const [featureIndex, feature] of (collection?.features || []).entries()) {
      const geometry = feature?.geometry || {};
      const properties = {...(feature?.properties || {})};
      const append = (coordinates, partIndex) => {
        if (!Array.isArray(coordinates) || coordinates.length < 2) return;
        const lengthKm = lineLengthKm(coordinates);
        if (!Number.isFinite(lengthKm) || lengthKm < 1.2) return;
        flattened.push({
          type: 'Feature',
          properties: {
            ...properties,
            fantasy_source_index: featureIndex,
            fantasy_part_index: partIndex,
            fantasy_length_km: Number(lengthKm.toFixed(3))
          },
          geometry: {type: 'LineString', coordinates}
        });
      };
      if (geometry.type === 'LineString') append(geometry.coordinates, 0);
      if (geometry.type === 'MultiLineString') geometry.coordinates?.forEach(append);
    }
    return flattened;
  }

  function explicitClass(properties) {
    const raw = String(
      properties?.fantasy_class ??
      properties?.ridge_class ??
      properties?.ridge_type ??
      properties?.class ??
      ''
    ).toLowerCase();
    if (/main|primary|major|principal|глав/.test(raw)) return 'main';
    if (/secondary|regional|middle|сред/.test(raw)) return 'secondary';
    if (/spur|local|minor|отрог/.test(raw)) return 'spur';
    const tier = Number(properties?.tier ?? properties?.rank ?? properties?.level);
    if (tier === 1) return 'main';
    if (tier === 2) return 'secondary';
    if (tier >= 3) return 'spur';
    return '';
  }

  function buildRidgeCollection(collection) {
    const features = flattenRidgeFeatures(collection);
    const lengths = features.map((feature) => feature.properties.fantasy_length_km).sort((a, b) => a - b);
    const mainCutoff = Math.max(18, quantile(lengths, 0.78));
    const secondaryCutoff = Math.max(7, quantile(lengths, 0.42));
    const classCounts = {main: 0, secondary: 0, spur: 0};

    for (const [index, feature] of features.entries()) {
      const properties = feature.properties;
      const lengthKm = Number(properties.fantasy_length_km);
      let ridgeClass = explicitClass(properties);
      if (!ridgeClass) ridgeClass = lengthKm >= mainCutoff ? 'main' : lengthKm >= secondaryCutoff ? 'secondary' : 'spur';
      const variantCount = ridgeClass === 'main' ? 3 : 2;
      const sourceSeed = Number(properties.fantasy_source_index || 0) * 17 + Number(properties.fantasy_part_index || 0) * 7 + index;
      properties.fantasy_class = ridgeClass;
      properties.fantasy_variant = sourceSeed % variantCount;
      properties.fantasy_icon = `fantasy-mountain-${ridgeClass}-${properties.fantasy_variant}`;
      properties.fantasy_sort_key = ridgeClass === 'main' ? 30 : ridgeClass === 'secondary' ? 20 : 10;
      classCounts[ridgeClass] += 1;
    }

    return {
      type: 'FeatureCollection',
      features,
      diagnostics: {
        sourceFeatureCount: collection?.features?.length || 0,
        flattenedFeatureCount: features.length,
        mainCutoffKm: Number(mainCutoff.toFixed(3)),
        secondaryCutoffKm: Number(secondaryCutoff.toFixed(3)),
        classCounts
      }
    };
  }

  function requireCanvas(width, height) {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  function imageDataFromCanvas(canvas) {
    const context = canvas?.getContext?.('2d');
    return context ? context.getImageData(0, 0, canvas.width, canvas.height) : null;
  }

  function mountainImage(ridgeClass, variant = 0) {
    const width = 112;
    const height = 76;
    const canvas = requireCanvas(width, height);
    if (!canvas) return null;
    const context = canvas.getContext('2d');
    const random = mulberry32(3109 + variant * 977 + (ridgeClass === 'main' ? 1 : ridgeClass === 'secondary' ? 2 : 3));
    const palette = {
      ink: 'rgba(67, 48, 32, .96)',
      shade: 'rgba(93, 67, 43, .72)',
      paper: 'rgba(227, 207, 164, .88)',
      snow: 'rgba(249, 240, 214, .96)'
    };
    const profile = ridgeClass === 'main'
      ? {peaks: 3, baseY: 65, topY: 8, spread: 31, line: 2.3, snow: true}
      : ridgeClass === 'secondary'
        ? {peaks: 3, baseY: 64, topY: 18, spread: 29, line: 2.0, snow: false}
        : {peaks: 2, baseY: 61, topY: 27, spread: 34, line: 1.8, snow: false};

    context.clearRect(0, 0, width, height);
    context.lineCap = 'round';
    context.lineJoin = 'round';

    const peaks = [];
    for (let index = 0; index < profile.peaks; index += 1) {
      const centerX = width / 2 + (index - (profile.peaks - 1) / 2) * profile.spread + (random() - 0.5) * 8;
      const topY = profile.topY + random() * (ridgeClass === 'main' ? 12 : 10);
      const halfWidth = profile.spread * (0.70 + random() * 0.22);
      peaks.push({centerX, topY, leftX: centerX - halfWidth, rightX: centerX + halfWidth});
    }

    context.beginPath();
    context.moveTo(Math.max(2, peaks[0].leftX), profile.baseY);
    for (const peak of peaks) {
      context.lineTo(peak.centerX, peak.topY);
      context.lineTo(peak.rightX, profile.baseY);
    }
    context.lineTo(width - 2, profile.baseY);
    context.closePath();
    context.fillStyle = palette.paper;
    context.fill();
    context.strokeStyle = palette.ink;
    context.lineWidth = profile.line;
    context.stroke();

    for (const peak of peaks) {
      const leftShoulder = peak.leftX + (peak.centerX - peak.leftX) * (0.47 + random() * 0.08);
      const rightShoulder = peak.centerX + (peak.rightX - peak.centerX) * (0.38 + random() * 0.12);
      context.beginPath();
      context.moveTo(peak.centerX, peak.topY + 1);
      context.lineTo(leftShoulder, profile.baseY - 3);
      context.moveTo(peak.centerX + 1, peak.topY + 2);
      context.lineTo(rightShoulder, profile.baseY - 7);
      context.strokeStyle = palette.shade;
      context.lineWidth = Math.max(1.1, profile.line * 0.65);
      context.stroke();

      const strokeCount = ridgeClass === 'spur' ? 2 : 3;
      for (let strokeIndex = 0; strokeIndex < strokeCount; strokeIndex += 1) {
        const side = strokeIndex % 2 === 0 ? -1 : 1;
        const startY = peak.topY + 13 + strokeIndex * 8 + random() * 3;
        const startX = peak.centerX + side * (5 + strokeIndex * 2);
        const endX = peak.centerX + side * (14 + strokeIndex * 5 + random() * 4);
        const endY = Math.min(profile.baseY - 4, startY + 12 + random() * 7);
        context.beginPath();
        context.moveTo(startX, startY);
        context.lineTo(endX, endY);
        context.strokeStyle = palette.shade;
        context.lineWidth = 1.15;
        context.stroke();
      }

      if (profile.snow) {
        const snowY = peak.topY + 10 + random() * 4;
        context.beginPath();
        context.moveTo(peak.centerX, peak.topY + 1);
        context.lineTo(peak.centerX - 8, snowY + 5);
        context.lineTo(peak.centerX - 2, snowY + 2);
        context.lineTo(peak.centerX + 3, snowY + 6);
        context.lineTo(peak.centerX + 9, snowY + 2);
        context.closePath();
        context.fillStyle = palette.snow;
        context.fill();
        context.strokeStyle = palette.ink;
        context.lineWidth = 0.9;
        context.stroke();
      }
    }

    context.beginPath();
    context.moveTo(4, profile.baseY + 2);
    context.bezierCurveTo(width * 0.28, profile.baseY - 1, width * 0.68, profile.baseY + 5, width - 4, profile.baseY + 1);
    context.strokeStyle = 'rgba(78, 54, 35, .68)';
    context.lineWidth = 1.4;
    context.stroke();

    return imageDataFromCanvas(canvas);
  }

  function hachureImage() {
    const canvas = requireCanvas(32, 32);
    if (!canvas) return null;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, 32, 32);
    context.strokeStyle = 'rgba(74, 54, 36, .62)';
    context.lineWidth = 1.4;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(16, 3);
    context.lineTo(16, 26);
    context.moveTo(12, 7);
    context.lineTo(12, 22);
    context.moveTo(20, 8);
    context.lineTo(20, 20);
    context.stroke();
    return imageDataFromCanvas(canvas);
  }

  function paperPatternImage() {
    const size = 128;
    const canvas = requireCanvas(size, size);
    if (!canvas) return null;
    const context = canvas.getContext('2d');
    const random = mulberry32(702023);
    context.clearRect(0, 0, size, size);
    context.fillStyle = 'rgba(205, 183, 138, .13)';
    context.fillRect(0, 0, size, size);
    for (let index = 0; index < 1050; index += 1) {
      const alpha = 0.018 + random() * 0.055;
      const warm = random() > 0.42;
      context.fillStyle = warm ? `rgba(91, 65, 38, ${alpha})` : `rgba(248, 236, 204, ${alpha})`;
      const radius = 0.25 + random() * 1.1;
      context.beginPath();
      context.arc(random() * size, random() * size, radius, 0, Math.PI * 2);
      context.fill();
    }
    context.strokeStyle = 'rgba(88, 63, 40, .035)';
    context.lineWidth = 0.7;
    for (let index = 0; index < 34; index += 1) {
      const y = random() * size;
      context.beginPath();
      context.moveTo(-8, y);
      context.bezierCurveTo(size * 0.28, y + random() * 5 - 2.5, size * 0.72, y + random() * 5 - 2.5, size + 8, y);
      context.stroke();
    }
    return imageDataFromCanvas(canvas);
  }

  function createImages() {
    const images = {
      'fantasy-paper-grain': paperPatternImage(),
      'fantasy-hachure': hachureImage()
    };
    for (const ridgeClass of ['main', 'secondary', 'spur']) {
      const variants = ridgeClass === 'main' ? 3 : 2;
      for (let variant = 0; variant < variants; variant += 1) {
        images[`fantasy-mountain-${ridgeClass}-${variant}`] = mountainImage(ridgeClass, variant);
      }
    }
    return images;
  }

  return {
    version: VERSION,
    lineLengthKm,
    flattenRidgeFeatures,
    buildRidgeCollection,
    createImages,
    __test: {quantile, explicitClass, mulberry32}
  };
});
