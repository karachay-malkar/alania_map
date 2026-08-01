 function collectionFeatures(collection) {
    return Array.isArray(collection && collection.features) ? collection.features : [];
  }

  function buildMountainCollection(data) {
    const candidates = [];
    for (const feature of collectionFeatures(data && data.highPeaks)) {
      candidates.push({feature, source: 'highPeaks'});
    }
    for (const feature of collectionFeatures(data && data.peaks)) {
      candidates.push({feature, source: 'peaks'});
    }
    for (const feature of collectionFeatures(data && data.objects)) {
      const properties = feature.properties || {};
      if (properties.object_type === 'mountain') candidates.push({feature, source: 'objects'});
    }

    const deduplicated = new Map();
    for (const candidate of candidates) {
      const coordinates = pointCoordinates(candidate.feature);
      if (!coordinates) continue;
      const key = `${coordinates[0].toFixed(5)}:${coordinates[1].toFixed(5)}`;
      const existing = deduplicated.get(key);
      const candidateElevation = elevationOf(candidate.feature) || -Infinity;
      const existingElevation = existing ? (elevationOf(existing.feature) || -Infinity) : -Infinity;
      if (!existing || candidate.source === 'highPeaks' || candidateElevation > existingElevation) {
        deduplicated.set(key, candidate);
      }
    }

    const features = [];
    for (const candidate of deduplicated.values()) {
      const feature = candidate.feature;
      const coordinates = pointCoordinates(feature);
      const properties = feature.properties || {};
      const elevation = elevationOf(feature);
      const isFiveThousander = elevation !== null && elevation >= 5000;
      const isHigh = !isFiveThousander && (
        candidate.source === 'highPeaks' ||
        (elevation !== null && elevation >= 4200) ||
        Number(properties.peak_level) === 1
      );
      const category = isFiveThousander ? 'five_thousander' : isHigh ? 'high' : 'standard';
      const key = featureKey(feature, coordinates);
      features.push({
        type: 'Feature',
        geometry: {type: 'Point', coordinates},
        properties: {
          mountain_icon: chooseIcon(category, key),
          mountain_category: category,
          mountain_priority: category === 'five_thousander' ? 1 : category === 'high' ? 10 : 20,
          elevation_m: elevation,
          source_collection: candidate.source,
          source_name: properties.name_alan_latin || properties.name_ru || properties.name_map || properties.name || ''
        }
      });
    }

    return {type: 'FeatureCollection', features};
  }

  function forceFlatOptions(options) {
    const next = Object.assign({}, options || {}, {
      bearing: 0,
      pitch: 0,
      maxPitch: 0,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false
    });
    if (next.style && typeof next.style === 'object') {
      delete next.style.terrain;
    }
    return next;
  }

  function installFlatGuards(map) {
    if (!map || map.__al