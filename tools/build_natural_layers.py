#!/usr/bin/env python3
from __future__ import annotations
import argparse, hashlib, json, math, re, shutil, unicodedata
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]; BUILD=ROOT/'build'
PARTS=[ROOT/'assets/map-data.part-000.js',ROOT/'assets/map-data.part-001.js']
CFG=ROOT/'config/river_systems.json'; EMPTY={'type':'FeatureCollection','features':[]}
SHARD=786432; VERSION='7.0.22'; ARCHIVE=f'data/alan-vector-{VERSION}.pmtiles'

def map_data():
 s=''.join(p.read_text(encoding='utf-8') for p in PARTS); m='window.ALAN_MAP_DATA = '
 i=s.find(m)
 if i<0: raise RuntimeError('ALAN_MAP_DATA not found')
 payload=s[i+len(m):].strip(); payload=payload[:-1] if payload.endswith(';') else payload
 return json.loads(payload)

def write_data(d):
 s=json.dumps(d,ensure_ascii=False,separators=(',',':')); mid=len(s)//2
 a=s.rfind('},"',0,mid); b=s.find('},"',mid); candidates=[x+1 for x in (a,b) if x>=0]
 cut=min(candidates,key=lambda x:abs(x-mid)) if candidates else mid
 PARTS[0].write_text('\nwindow.ALAN_MAP_DATA = '+s[:cut],encoding='utf-8')
 PARTS[1].write_text(s[cut:]+';\n',encoding='utf-8')

def feats(v): return list(v.get('features') or []) if isinstance(v,dict) and v.get('type')=='FeatureCollection' else []
def norm(v):
 s=unicodedata.normalize('NFKC',str(v or '')).casefold().replace('ё','е')
 s=re.sub(r'\b(река|речка|river|riv\.?|р\.)\b',' ',s)
 return re.sub(r'[^0-9a-zа-я]+','',s)
def tags(v):
 if not isinstance(v,str): return {}
 return {k.replace('\\"','"').replace('\\\\','\\'):x.replace('\\"','"').replace('\\\\','\\') for k,x in re.findall(r'"((?:[^"\\]|\\.)*)"=>"((?:[^"\\]|\\.)*)"',v)}
def val(row,key,t):
 if key in row:
  x=row[key]
  if x is not None and str(x) not in {'','<NA>','nan','NaN','None'}: return str(x)
 return str(t.get(key,'') or '')
def ele(v):
 m=re.search(r'-?\d+(?:[.,]\d+)?',v or '')
 return float(m.group(0).replace(',','.')) if m else None
def valid(g):
 if g is None or g.is_empty:return None
 from shapely import make_valid
 g=make_valid(g)
 return None if g.is_empty else g

def prepare():
 BUILD.mkdir(exist_ok=True); d=map_data(); frame=d.get('mapFrame')
 if not feats(frame): raise RuntimeError('mapFrame is empty')
 (BUILD/'map-frame.geojson').write_text(json.dumps(frame,ensure_ascii=False),encoding='utf-8')
 out={'river_aliases':{},'peak_aliases':{}}
 for group,cols in [('river_aliases',['rivers']),('peak_aliases',['peaks','highPeaks'])]:
  for col in cols:
   for f in feats(d.get(col)):
    p=f.get('properties') or {}; alias={'name_alan_latin':str(p.get('name_alan_latin') or p.get('name_map') or ''),'name_ru':str(p.get('name_ru') or '')}
    for n in (p.get('name_ru'),p.get('name_map'),p.get('name_alan_latin')):
     if norm(n): out[group][norm(n)]=alias
 (BUILD/'custom-names.json').write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf-8')

def rules():
 c=json.loads(CFG.read_text(encoding='utf-8')); by={}
 for r in c['rules']:
  for n in r['names']: by[norm(n)]=r
 return c['rules'],by,{norm(x) for x in c['elbrus_names']}
def rule_for(names,by):
 nn=[norm(n) for n in names if n]
 for n in nn:
  if n in by:return by[n]
 for n in nn:
  if len(n)>=5:
   m=[r for k,r in by.items() if len(k)>=5 and (k in n or n in k)]
   if m:return sorted(m,key=lambda r:(r['tier'],r['id']))[0]
 return None

def classify():
 import geopandas as gpd
 from shapely.geometry import mapping
 from shapely.ops import linemerge,unary_union
 BUILD.mkdir(exist_ok=True)
 frame=valid(gpd.read_file(BUILD/'map-frame.geojson').to_crs(4326).geometry.union_all())
 custom=json.loads((BUILD/'custom-names.json').read_text(encoding='utf-8'))
 rr,by,elbrus=rules(); gpkg=BUILD/'osm-clipped.gpkg'
 src={n:gpd.read_file(gpkg,layer=n).to_crs(4326) for n in ('lines','multipolygons','points')}
 metric={n:g.to_crs(3857) for n,g in src.items()}; out=defaultdict(list); lengths=defaultdict(float); geoms=defaultdict(list)
 def add(layer,g,p):
  g=valid(g)
  if g is None:return
  g=valid(g.intersection(frame))
  if g is None:return
  z=p.pop('_minzoom',None); f={'type':'Feature','properties':{k:v for k,v in p.items() if v not in (None,'')},'geometry':mapping(g)}
  if z is not None:f['tippecanoe']={'minzoom':int(z)}
  out[layer].append(f)
 for pos,(_,r) in enumerate(src['lines'].iterrows()):
  t=tags(r.get('other_tags')); g=r.geometry; mg=metric['lines'].iloc[pos].geometry; ln=float(mg.length) if mg is not None else 0
  oid=val(r,'osm_id',t); name=val(r,'name',t); ru=val(r,'name:ru',t) or name; h=val(r,'highway',t); w=val(r,'waterway',t)
  road={'motorway':'motorway','motorway_link':'motorway','trunk':'trunk','trunk_link':'trunk','primary':'primary','primary_link':'primary','secondary':'secondary','secondary_link':'secondary','tertiary':'tertiary','tertiary_link':'tertiary','unclassified':'minor','residential':'minor','living_street':'minor','service':'minor','road':'minor'}.get(h)
  if road:
   tun=val(r,'tunnel',t); bri=val(r,'bridge',t); br='tunnel' if tun not in {'','no','false','0'} else ('bridge' if bri not in {'','no','false','0'} else '')
   add('transportation',g,{'osm_id':oid,'class':road,'subclass':h,'brunnel':br,'name':name,'_minzoom':9 if road=='minor' else 7})
  if w not in {'river','stream','canal'}:continue
  match=rule_for((ru,name),by); intermittent=val(r,'intermittent',t).casefold() in {'yes','true','1'}
  if w=='stream' and ((intermittent and not match) or (not match and not ((name or ru) and ln>=1200 or ln>=5000)) or (ln<180 and not match)):continue
  if w=='canal' and not match and not ((name or ru) and ln>=2000):continue
  if match:tier,sid=int(match['tier']),str(match['id'])
  elif w=='river' or ((name or ru) and ln>=5000):tier,sid=2,norm(ru or name) or f'osm-{oid}'
  else:tier,sid=3,norm(ru or name) or f'osm-{oid}'
  alias=custom['river_aliases'].get(norm(ru)) or custom['river_aliases'].get(norm(name)) or {}
  tun=val(r,'tunnel',t); bri=val(r,'bridge',t); br='tunnel' if tun not in {'','no','false','0'} else ('bridge' if bri not in {'','no','false','0'} else '')
  add('waterway',g,{'osm_id':oid,'class':w,'tier':tier,'system_id':sid,'name':name,'name_ru':ru,'name_alan_latin':alias.get('name_alan_latin',''),'intermittent':int(intermittent),'brunnel':br,'_minzoom':7 if tier==1 else 8 if tier==2 else 10})
  lengths[sid]+=ln; geoms[sid].append(mg)
 for pos,(_,r) in enumerate(src['multipolygons'].iterrows()):
  t=tags(r.get('other_tags')); g=r.geometry; mg=metric['multipolygons'].iloc[pos].geometry; area=float(mg.area) if mg is not None else 0
  oid=val(r,'osm_id',t); name=val(r,'name',t); ru=val(r,'name:ru',t) or name; natural=val(r,'natural',t); landuse=val(r,'landuse',t); water=val(r,'water',t); leisure=val(r,'leisure',t)
  intermittent=val(r,'intermittent',t).casefold() in {'yes','true','1'}; seasonal=val(r,'seasonal',t).casefold() in {'yes','true','1','spring','summer','winter'}
  if natural in {'wood','scrub'} or landuse=='forest':add('landcover',g,{'osm_id':oid,'class':'wood','subclass':natural or landuse,'name':name,'name_ru':ru})
  if natural=='glacier':add('landcover',g,{'osm_id':oid,'class':'ice','subclass':'glacier','natural':natural,'name':name,'name_ru':ru})
  elif natural in {'snowfield','ice_shelf'} or val(r,'landcover',t) in {'snow','ice'}:add('landcover',g,{'osm_id':oid,'class':'ice','subclass':'snow','natural':natural,'name':name,'name_ru':ru})
  if landuse=='residential':add('landuse',g,{'osm_id':oid,'class':'residential','subclass':'residential','name':name})
  ice=natural in {'glacier','snowfield','ice_shelf'} or water=='glacier' or bool(val(r,'glacier',t)); iswater=natural=='water' or bool(water) or landuse in {'reservoir','basin'} or leisure=='swimming_pool'
  if iswater and not ice and not intermittent and not seasonal:
   wc='river' if water in {'river','stream','canal'} or val(r,'waterway',t) in {'riverbank','river'} else ('reservoir' if water=='reservoir' or landuse=='reservoir' else 'lake')
   if name or ru or area>=(1000 if wc in {'river','reservoir'} else 5000):add('water',g,{'osm_id':oid,'class':wc,'subclass':water or landuse or natural,'natural':natural,'name':name,'name_ru':ru,'intermittent':0})
 for _,r in src['points'].iterrows():
  t=tags(r.get('other_tags'))
  if val(r,'natural',t)!='peak':continue
  name=val(r,'name',t); ru=val(r,'name:ru',t) or name; alias=custom['peak_aliases'].get(norm(ru)) or custom['peak_aliases'].get(norm(name)) or {}; e=ele(val(r,'ele',t)); hidden=norm(ru) in elbrus or norm(name) in elbrus
  add('peak',r.geometry,{'osm_id':val(r,'osm_id',t),'class':'peak','name':name,'name_ru':ru,'name_alan_latin':alias.get('name_alan_latin',''),'ele':e,'peak_level':1 if e is not None and e>=5000 else 2,'hidden':int(hidden),'_minzoom':7 if e is not None and e>=5000 else 10})
 for layer in ('landcover','landuse','transportation','water','waterway','peak'):(BUILD/f'{layer}.geojson').write_text(json.dumps({'type':'FeatureCollection','features':out[layer]},ensure_ascii=False),encoding='utf-8')
 systems=[]
 for r in rr:
  sid=r['id']; gg=[g for g in geoms.get(sid,[]) if g is not None and not g.is_empty]; components=0
  if gg:
   merged=linemerge(unary_union(gg)); components=len(merged.geoms) if hasattr(merged,'geoms') else 1
  systems.append({'id':sid,'tier':r['tier'],'names':r['names'],'matched_length_m':round(lengths.get(sid,0),1),'segment_count':len(gg),'component_count':components,'present':lengths.get(sid,0)>0})
 report={'generated_at':datetime.now(timezone.utc).isoformat(),'systems':systems,'summary':{'required':len(systems),'present':sum(x['present'] for x in systems),'missing':[x['id'] for x in systems if not x['present']]}}
 (BUILD/'river-network-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')

def patch(path,fn): path.write_text(fn(path.read_text(encoding='utf-8')),encoding='utf-8')
def integrate(archive,source_url,source_md5,pipeline,tippecanoe):
 archive=Path(archive); size=archive.stat().st_size; old=13549632
 if size<1000:raise RuntimeError('PMTiles missing')
 sd=ROOT/'data/shards/vector'; shutil.rmtree(sd,ignore_errors=True); sd.mkdir(parents=True); count=0
 with archive.open('rb') as f:
  while chunk:=f.read(SHARD):(sd/f'part-{count:03d}.bin').write_bytes(chunk); count+=1
 d=map_data()
 for k in ('rivers','glaciers','peakSnow','elbrusSnow','peaks','highPeaks'):d[k]=dict(EMPTY)
 d['regionalVector']={**(d.get('regionalVector') or {}),'available':True,'archivePath':ARCHIVE,'minzoom':7,'maxzoom':13,'bounds':d.get('bounds'),'layers':['landcover','landuse','transportation','water','waterway','peak'],'physicallyClipped':True,'sourceSnapshot':source_url,'attribution':'Geofabrik © OpenStreetMap contributors'}
 for k in ('applicationVersion','version','stage'):d[k]=VERSION
 d['dataVersion']=VERSION+'-osm-natural.1'; write_data(d)
 def page(s):
  s=s.replace('alan-vector-7.0.21.pmtiles',f'alan-vector-{VERSION}.pmtiles').replace('alan-map-stage7.0.21-view',f'alan-map-stage{VERSION}-view')
  return re.sub(r"(archivePath: 'data/alan-vector-7\.0\.22\.pmtiles',\s*partsPath: 'data/shards/vector/',\s*byteLength:)\s*\d+",rf'\g<1> {size}',s)
 patch(ROOT/'assets/map-page.js',page)
 def ui(s):
  s=s.replace("const VERSION = '7.0.21';",f"const VERSION = '{VERSION}';").replace("const DEFAULT_STORAGE_KEY = 'alan-map-stage7.0.21-view';",f"const DEFAULT_STORAGE_KEY = 'alan-map-stage{VERSION}-view';").replace('Alan Map · 7.0.21',f'Alan Map · {VERSION}')
  return s if "'alan-map-stage7.0.21-view'," in s else s.replace('const LEGACY_STORAGE_KEYS = [',"const LEGACY_STORAGE_KEYS = [\n    'alan-map-stage7.0.21-view',")
 patch(ROOT/'assets/map-ui.js',ui); patch(ROOT/'index.html',lambda s:s.replace('Alan Map 7.0.21 Offline',f'Alan Map {VERSION} Offline'))
 patch(ROOT/'assets/bootstrap.js',lambda s:s if 'map-natural.js' in s else s.replace("await loadScript('map-ui.js');","await loadScript('map-ui.js');\n    await loadScript('map-natural.js');"))
 shutil.copy2(BUILD/'river-network-report.json',ROOT/'data/river-network-report.json')
 manifest={'version':VERSION,'generated_at':datetime.now(timezone.utc).isoformat(),'source':{'url':source_url,'md5':source_md5},'tools':{'pipeline':pipeline,'tippecanoe_commit':tippecanoe},'archive':{'logical_path':ARCHIVE,'byte_length':size,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'shard_size':SHARD,'shard_count':count,'previous_byte_length':old,'delta_bytes':size-old},'layers':['landcover','landuse','transportation','water','waterway','peak'],'physical_clip':'mapFrame polygon before tile packaging'}
 (ROOT/'data/vector-build-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
 (ROOT/'README.md').write_text(f'# Alan Map {VERSION}\n\nАвтономная карта Alan Til для GitHub Pages. DEM и вектор физически обрезаны по рабочему контуру. Озёра, ледники, постоянный снег, реки и вершины берутся из локального OSM PMTiles. Вектор: {size} байт ({size-old:+d} к 7.0.21).\n',encoding='utf-8')
 (ROOT/'DATA-SOURCES-AND-LICENSES.md').write_text(f'# Источники данных и компоненты\n\n- OpenStreetMap: `{source_url}`, © OpenStreetMap contributors, ODbL.\n- Рельеф: Mapzen/Tilezen Skadi SRTM HGT, без изменений.\n- Сборка: GDAL/OGR, GeoPandas/Shapely, Tippecanoe, PMTiles CLI.\n- MapLibre GL JS 5.24.0; PMTiles JS 4.4.1; локальный Noto Sans.\n\nМанифест: `data/vector-build-manifest.json`. Реки: `data/river-network-report.json`.\n',encoding='utf-8')
def validate():
 m=json.loads((ROOT/'data/vector-build-manifest.json').read_text()); r=json.loads((ROOT/'data/river-network-report.json').read_text()); shards=sorted((ROOT/'data/shards/vector').glob('part-*.bin')); size=sum(p.stat().st_size for p in shards)
 if size!=m['archive']['byte_length']:raise RuntimeError('shard size mismatch')
 if size>int(16.5*1024*1024):raise RuntimeError(f'vector exceeds 16.5 MiB: {size}')
 if not shards or any(p.stat().st_size>SHARD for p in shards):raise RuntimeError('invalid shards')
 critical=set(r['summary']['missing'])&{'nalchik','urvan'}
 if critical:raise RuntimeError(f'critical rivers missing: {sorted(critical)}')
 src=''.join(p.read_text(encoding='utf-8') for p in PARTS)
 if '"rivers":{"type":"FeatureCollection","features":[{' in src or '"glaciers":{"type":"FeatureCollection","features":[{' in src:raise RuntimeError('duplicated runtime geometry remains')
 if 'map-natural.js' not in (ROOT/'assets/bootstrap.js').read_text():raise RuntimeError('map-natural.js missing')

if __name__=='__main__':
 p=argparse.ArgumentParser(); sub=p.add_subparsers(dest='cmd',required=True); sub.add_parser('prepare'); sub.add_parser('classify'); x=sub.add_parser('patch-runtime'); x.add_argument('--archive',required=True); x.add_argument('--source-url',required=True); x.add_argument('--source-md5',required=True); x.add_argument('--pipeline',required=True); x.add_argument('--tippecanoe-commit',required=True); sub.add_parser('validate-repository'); a=p.parse_args()
 if a.cmd=='prepare':prepare()
 elif a.cmd=='classify':classify()
 elif a.cmd=='patch-runtime':integrate(a.archive,a.source_url,a.source_md5,a.pipeline,a.tippecanoe_commit)
 else:validate()
