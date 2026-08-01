export function assertReport(report){
  if(report.version!=='7.0.23') throw new Error(`version ${report.version}`);
  if(!report.slippy.flat||!report.slippy.mountainLayersBelowPoints) throw new Error(`slippy ${JSON.stringify(report.slippy)}`);
  if(report.slippy.mount1Loaded||!report.slippy.mount11Loaded) throw new Error(`sprites ${JSON.stringify(report.slippy)}`);
  const c=report.camera;
  if(c.bearing!==0||c.pitch!==0||c.maxPitch!==0||c.terrain) throw new Error(`camera ${JSON.stringify(c)}`);
  for(const [id,present] of Object.entries(report.required)) if(!present) throw new Error(`missing layer ${id}`);
  for(const [id,result] of Object.entries(report.checkpoints)) if(!result.matched) throw new Error(`missing checkpoint ${id}: ${JSON.stringify(result)}`);
  if(!report.frame.strictDataClip||report.frame.cssClipPath||report.frame.runtimeMask) throw new Error(`clip ${JSON.stringify(report.frame)}`);
  if(report.network.errors&&Object.keys(report.network.errors).length) throw new Error(`network ${JSON.stringify(report.network.errors)}`);
  if(!report.shard||report.shard.cache.entries>16) throw new Error(`shards ${JSON.stringify(report.shard)}`);
  if(report.externalRequests.length) throw new Error(`external ${report.externalRequests.join('\n')}`);
  if(report.consoleErrors.length) throw new Error(`console ${report.consoleErrors.join('\n')}`);
}
