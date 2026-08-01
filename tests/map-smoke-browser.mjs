export function collectReport(page){
  return page.evaluate(()=>{const i=window.ALAN_MAP_INSTANCE,m=i.map,s=window.ALAN_SLIPPY_HYBRID_DIAGNOSTICS();const ids=['terrain-hillshade','osm-water-fill','osm-river-line','osm-peak-points','osm-peak-labels'];return{version:i.version,slippy:s,camera:{bearing:m.getBearing(),pitch:m.getPitch(),maxPitch:m.getMaxPitch(),terrain:m.getTerrain()},required:Object.fromEntries(ids.map(id=>[id,Boolean(m.getLayer(id))])),frame:i.getFrameClipDiagnostics(),network:i.getNetworkDiagnostics(),shard:window.ALAN_MAP_PMTILES_SHARD_DIAGNOSTICS?.()||null};});
}
