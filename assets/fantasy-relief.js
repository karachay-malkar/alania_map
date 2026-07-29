(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AlanFantasyRelief = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = '1.1.0';
  const EARTH_RADIUS_KM = 6371.0088;
  const INK = 'rgba(39, 61, 72, .96)';
  const SHADE = 'rgba(48, 70, 78, .72)';
  const PAPER = 'rgba(226, 208, 169, .94)';
  const SNOW = 'rgba(249, 241, 216, .97)';

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
      const variantCount = ridgeClass === 'main' ? 4 : ridgeClass === 'secondary' ? 3 : 2;
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

  function smoothMountainOutline(context, peaks, baseY, width) {
    context.beginPath();
    context.moveTo(3, baseY + 1);
    let previousX = 3;
    let previousY = baseY + 1;
    for (const peak of peaks) {
      const leftX = peak.centerX - peak.halfWidth;
      const rightX = peak.centerX + peak.halfWidth;
      context.bezierCurveTo(
        previousX + (leftX - previousX) * 0.54,
        previousY - 1,
        leftX + peak.halfWidth * 0.40,
        peak.topY + peak.shoulderDrop,
        peak.centerX,
        peak.topY
      );
      context.bezierCurveTo(
        peak.centerX + peak.halfWidth * 0.34,
        peak.topY + peak.shoulderDrop * 0.72,
        rightX - peak.halfWidth * 0.20,
        baseY - 4,
        rightX,
        baseY
      );
      previousX = rightX;
      previousY = baseY;
    }
    context.bezierCurveTo(previousX + 10, baseY + 2, width - 16, baseY + 3, width - 3, baseY + 1);
    context.lineTo(width - 3, baseY + 7);
    context.lineTo(3, baseY + 7);
    context.closePath();
  }

  function drawSlopeStroke(context, startX, startY, endX, endY, width = 1.15) {
    const controlX = startX + (endX - startX) * 0.58;
    const controlY = startY + (endY - startY) * 0.32;
    context.beginPath();
    context.moveTo(startX, startY);
    context.quadraticCurveTo(controlX, controlY, endX, endY);
    context.strokeStyle = SHADE;
    context.lineWidth = width;
    context.stroke();
  }

  function mountainImage(ridgeClass, variant = 0) {
    const width = 124;
    const height = 82;
    const canvas = requireCanvas(width, height);
    if (!canvas) return null;
    const context = canvas.getContext('2d');
    const random = mulberry32(3109 + variant * 977 + (ridgeClass === 'main' ? 1 : ridgeClass === 'secondary' ? 2 : 3));
    const profile = ridgeClass === 'main'
      ? {peaks: variant % 2 === 0 ? 3 : 4, baseY: 69, topY: 8, spread: 29, line: 2.25, snow: true}
      : ridgeClass === 'secondary'
        ? {peaks: variant === 2 ? 4 : 3, baseY: 68, topY: 19, spread: 30, line: 2.0, snow: false}
        : {peaks: 2, baseY: 65, topY: 30, spread: 39, line: 1.75, snow: false};

    context.clearRect(0, 0, width, height);
    context.lineCap = 'round';
    context.lineJoin = 'round';

    const peaks = [];
    for (let index = 0; index < profile.peaks; index += 1) {
      const centerX = width / 2 + (index - (profile.peaks - 1) / 2) * profile.spread + (random() - 0.5) * 7;
      peaks.push({
        centerX,
        topY: profile.topY + random() * (ridgeClass === 'main' ? 14 : 11),
        halfWidth: profile.spread * (0.70 + random() * 0.18),
        shoulderDrop: 12 + random() * 8
      });
    }

    smoothMountainOutline(context, peaks, profile.baseY, width);
    context.fillStyle = PAPER;
    context.fill();
    context.strokeStyle = INK;
    context.lineWidth = profile.line;
    context.stroke();

    for (const peak of peaks) {
      const leftEndX = peak.centerX - peak.halfWidth * (0.42 + random() * 0.16);
      const rightEndX = peak.centerX + peak.halfWidth * (0.38 + random() * 0.18);
      drawSlopeStroke(context, peak.centerX - 0.5, peak.topY + 2, leftEndX, profile.baseY - 4, Math.max(1.05, profile.line * 0.62));
      drawSlopeStroke(context, peak.centerX + 1.5, peak.topY + 4, rightEndX, profile.baseY - 8, Math.max(1.0, profile.line * 0.56));

      const strokeCount = ridgeClass === 'spur' ? 2 : 4;
      for (let strokeIndex = 0; strokeIndex < strokeCount; strokeIndex += 1) {
        const side = strokeIndex % 2 === 0 ? -1 : 1;
        const startY = peak.topY + 15 + strokeIndex * 7 + random() * 2;
        const startX = peak.centerX + side * (5 + strokeIndex * 1.7);
        const endX = peak.centerX + side * (15 + strokeIndex * 4.2 + random() * 3);
        const endY = Math.min(profile.baseY - 4, startY + 11 + random() * 7);
        drawSlopeStroke(context, startX, startY, endX, endY, 1.05);
      }

      if (profile.snow) {
        const snowY = peak.topY + 11 + random() * 4;
        context.beginPath();
        context.moveTo(peak.centerX, peak.topY + 1);
        context.bezierCurveTo(peak.centerX - 3, peak.topY + 5, peak.centerX - 7, snowY + 1, peak.centerX - 10, snowY + 5);
        context.quadraticCurveTo(peak.centerX - 4, snowY + 1, peak.centerX - 1, snowY + 5);
        context.quadraticCurveTo(peak.centerX + 4, snowY + 1, peak.centerX + 10, snowY + 4);
        context.bezierCurveTo(peak.centerX + 7, snowY, peak.centerX + 3, peak.topY + 4, peak.centerX, peak.topY + 1);
        context.closePath();
        context.fillStyle = SNOW;
        context.fill();
        context.strokeStyle = INK;
        context.lineWidth = 0.85;
        context.stroke();
      }
    }

    context.beginPath();
    context.moveTo(4, profile.baseY + 3);
    context.bezierCurveTo(width * 0.25, profile.baseY, width * 0.66, profile.baseY + 6, width - 4, profile.baseY + 2);
    context.strokeStyle = 'rgba(39, 61, 72, .62)';
    context.lineWidth = 1.35;
    context.stroke();

    return imageDataFromCanvas(canvas);
  }

  function elbrusImage() {
    const width = 224;
    const height = 132;
    const canvas = requireCanvas(width, height);
    if (!canvas) return null;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, width, height);
    context.lineCap = 'round';
    context.lineJoin = 'round';

    context.beginPath();
    context.moveTo(5, 112);
    context.bezierCurveTo(27, 108, 43, 91, 58, 69);
    context.bezierCurveTo(72, 47, 87, 26, 105, 20);
    context.bezierCurveTo(115, 17, 122, 30, 129, 39);
    context.bezierCurveTo(139, 28, 149, 16, 164, 18);
    context.bezierCurveTo(184, 21, 191, 48, 198, 68);
    context.bezierCurveTo(204, 87, 214, 104, 219, 111);
    context.bezierCurveTo(172, 120, 57, 119, 5, 112);
    context.closePath();
    context.fillStyle = PAPER;
    context.fill();
    context.strokeStyle = INK;
    context.lineWidth = 3.1;
    context.stroke();

    context.beginPath();
    context.moveTo(105, 21);
    context.bezierCurveTo(99, 34, 93, 45, 82, 58);
    context.bezierCurveTo(75, 67, 68, 82, 60, 105);
    context.moveTo(164, 19);
    context.bezierCurveTo(158, 35, 151, 49, 140, 65);
    context.bezierCurveTo(132, 78, 126, 92, 120, 108);
    context.strokeStyle = SHADE;
    context.lineWidth = 1.9;
    context.stroke();

    context.beginPath();
    context.moveTo(105, 21);
    context.bezierCurveTo(97, 31, 92, 40, 87, 49);
    context.quadraticCurveTo(96, 44, 103, 50);
    context.quadraticCurveTo(111, 43, 121, 47);
    context.bezierCurveTo(116, 37, 111, 27, 105, 21);
    context.closePath();
    context.moveTo(164, 19);
    context.bezierCurveTo(157, 29, 153, 38, 148, 49);
    context.quadraticCurveTo(157, 43, 164, 50);
    context.quadraticCurveTo(173, 43, 181, 49);
    context.bezierCurveTo(176, 36, 171, 26, 164, 19);
    context.closePath();
    context.fillStyle = SNOW;
    context.fill();
    context.strokeStyle = INK;
    context.lineWidth = 1.15;
    context.stroke();

    for (const [startX, startY, endX, endY] of [
      [90,55,67,92],[116,55,101,92],[146,58,130,94],[177,57,192,94],
      [76,76,51,105],[128,75,112,108],[157,75,146,108],[187,78,207,106]
    ]) drawSlopeStroke(context,startX,startY,endX,endY,1.35);

    context.beginPath();
    context.moveTo(8, 114);
    context.bezierCurveTo(58, 107, 164, 124, 217, 113);
    context.strokeStyle = 'rgba(39, 61, 72, .68)';
    context.lineWidth = 1.7;
    context.stroke();
    return imageDataFromCanvas(canvas);
  }

  function hachureImage() {
    const canvas = requireCanvas(32, 32);
    if (!canvas) return null;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, 32, 32);
    context.strokeStyle = 'rgba(39, 61, 72, .62)';
    context.lineWidth = 1.25;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(16, 3);
    context.quadraticCurveTo(15, 14, 16, 27);
    context.moveTo(12, 7);
    context.quadraticCurveTo(11, 15, 12, 23);
    context.moveTo(20, 8);
    context.quadraticCurveTo(21, 14, 20, 21);
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
      'fantasy-hachure': hachureImage(),
      'fantasy-elbrus': elbrusImage()
    };
    for (const ridgeClass of ['main', 'secondary', 'spur']) {
      const variants = ridgeClass === 'main' ? 4 : ridgeClass === 'secondary' ? 3 : 2;
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
