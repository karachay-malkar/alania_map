export async function runCheckpoints(page){
  const tests=[['nalchik',[43.62,43.48],10.8,'waterway','system_id','nalchik'],['teberda',[41.74,43.44],10.5,'waterway','system_id','teberda'],['blue-lakes',[43.538,43.234],12,'water','class','lake']];
  const results={};
  for(const [id,center,zoom,sourceLayer,property,expected] of tests){
    results[id]=await page.evaluate(async p=>{const map=window.ALAN_MAP_INSTANCE.map;map.jumpTo({center:p.center,zoom:p.zoom,pitch:0,bearing:0});const until=performance.now()+30000;let values=[];do{await new Promise(r=>setTimeout(r,250));values=[...new Set(map.querySourceFeatures('openmaptiles',{sourceLayer:p.sourceLayer}).map(f=>f.properties?.[p.property]).filter(Boolean))];if(values.includes(p.expected))break;}while(performance.now()<until);return{matched:values.includes(p.expected),values};},{center,zoom,sourceLayer,property,expected});
  }
  return results;
}

export function collectReport(page){
  return page.evaluate(()=>{const i=window.ALAN_MAP_INSTANCE,m=i.map,s=window.ALAN_SLIPPY_HYBRID_DIAGNOSTICS();const ids=['terrain-hillshade','osm-water-fill','osm-river-line','osm-peak-points','osm-peak-labels'];return{version:i.version,slippy:s,camera:{bearing:m.getBearing(),pitch:m.getPitch(),maxPitch:m.getMaxPitch(),terrain:m.getTerrain()},required:Object.fromEntries(ids.map(id=>[id,Boolean(m.getLayer(id))])),frame:i.getFrameClipDiagnostics(),network:i.getNetworkDiagnostics(),shard:window.ALAN_MAP_PMTILES_SHARD_DIAGNOSTICS?.()||null};});
}
