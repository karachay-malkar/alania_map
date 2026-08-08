import fs from 'node:fs';
const boundary=JSON.parse(fs.readFileSync('data/map-boundary.geojson','utf8'));
const mountains=JSON.parse(fs.readFileSync('data/mountains.geojson','utf8'));
const allowed=new Set(['rounded_hill','rounded_mountain','steep_mountain','isolated_peak','massif','ridge','rocky_peak','rocky_ridge','plateau']);
if(boundary.type!=='FeatureCollection'||!boundary.features.length) throw new Error('Invalid boundary');
if(mountains.type!=='FeatureCollection'||!mountains.features.length) throw new Error('Invalid mountains');
const ids=new Set(); let mingi=0;
for(const f of mountains.features){
  const p=f.properties||{}; const c=f.geometry?.coordinates||[];
  if(f.geometry?.type!=='Point'||c.length<2||!c.every(Number.isFinite)) throw new Error(`Invalid point ${p.id}`);
  if(!p.id||ids.has(p.id)) throw new Error(`Duplicate id ${p.id}`); ids.add(p.id);
  if(!allowed.has(p.category)) throw new Error(`Invalid category ${p.category}`);
  if(p.id==='mingi_tau') mingi++;
  if(p.id!=='mingi_tau'&&/эльбрус/i.test(String(p.name||''))) throw new Error(`Elbrus duplicate ${p.id}`);
}
if(mingi!==1) throw new Error(`Expected one mingi_tau, got ${mingi}`);
console.log(JSON.stringify({ok:true,mountains:mountains.features.length,mingi_tau:mingi},null,2));
