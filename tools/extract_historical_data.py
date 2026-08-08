#!/usr/bin/env python3
from __future__ import annotations
import argparse, base64, gzip, json, math
from collections import Counter
from pathlib import Path

CATEGORIES = {
    'rounded_hill','rounded_mountain','steep_mountain','isolated_peak','massif',
    'ridge','rocky_peak','rocky_ridge','plateau'
}

def read_json(path: Path):
    return json.loads(path.read_text(encoding='utf-8'))

def decode_render(path: Path):
    encoded = ''.join(path.read_text(encoding='utf-8').split())
    return json.loads(gzip.decompress(base64.b64decode(encoded)).decode('utf-8'))

def category_of(props):
    for key in ('morphology','category','terrain_type','type'):
        value = props.get(key)
        if value in CATEGORIES:
            return value
    return None

def key_name(value):
    return str(value or '').strip().casefold().replace('ё','е')

def distance_km(a, b):
    lon1, lat1 = a; lon2, lat2 = b
    dy=(lat2-lat1)*110.574
    dx=(lon2-lon1)*111.320*math.cos(math.radians((lat1+lat2)/2))
    return math.hypot(dx,dy)

def normalize_feature(feature):
    p = feature.get('properties') or {}
    coords = (feature.get('geometry') or {}).get('coordinates') or []
    if len(coords) < 2: raise ValueError('Mountain without coordinates')
    lon, lat = float(coords[0]), float(coords[1])
    ident = str(p.get('point_id') or p.get('id') or '').strip()
    category = category_of(p)
    if not ident or category not in CATEGORIES: raise ValueError(f'Invalid feature {ident}: category={category}')
    elev = p.get('elevation_m')
    return {
      'type':'Feature',
      'properties':{
        'id':ident,'category':category,'name':str(p.get('name') or '').strip(),
        'elevation_m': int(round(float(elev))) if elev not in (None,'') else None,
        'main':False,'five_thousander':False
      },
      'geometry':{'type':'Point','coordinates':[round(lon,6),round(lat,6)]}
    }

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--render', type=Path, required=True)
    ap.add_argument('--special', type=Path, required=True)
    ap.add_argument('--boundary', type=Path, required=True)
    ap.add_argument('--output', type=Path, required=True)
    ap.add_argument('--report', type=Path, required=True)
    args=ap.parse_args()
    raw=decode_render(args.render)
    special=read_json(args.special)
    read_json(args.boundary)
    features=[normalize_feature(f) for f in raw.get('features',[])]
    special_ids={str((f.get('properties') or {}).get('id') or '') for f in special.get('features',[])}
    mingi_coord=(42.436098,43.353811)
    cleaned=[]; removed_elbrus=[]
    for f in features:
        p=f['properties']; coord=tuple(f['geometry']['coordinates'])
        if p['id'] in special_ids: continue
        name=key_name(p.get('name'))
        if 'эльбрус' in name or 'elbrus' in name or 'минги' in name or 'mingi' in name:
            removed_elbrus.append(p['id']); continue
        if (p.get('elevation_m') or 0) >= 5000 and distance_km(coord, mingi_coord) < 2.0:
            removed_elbrus.append(p['id']); continue
        cleaned.append(f)
    for sf in special.get('features',[]):
        p=sf.get('properties') or {}; ident=str(p.get('id') or '').strip(); coords=sf['geometry']['coordinates']
        morphology=p.get('morphology') if p.get('morphology') in CATEGORIES else 'isolated_peak'
        elev=int(round(float(p['elevation_m']))) if p.get('elevation_m') is not None else None
        role=str(p.get('role') or '')
        name='Минги-тау' if ident=='mingi_tau' else str(p.get('name') or '').strip()
        props={'id':ident,'category':morphology,'name':name,'elevation_m':elev,'main':True,'five_thousander':bool(ident=='mingi_tau' or role=='five_thousander' or (elev is not None and elev>=5000))}
        if ident=='mingi_tau': props['alias_ru']='Эльбрус'
        cleaned.append({'type':'Feature','properties':props,'geometry':{'type':'Point','coordinates':[float(coords[0]),float(coords[1])]}})
    ids=[f['properties']['id'] for f in cleaned]
    if len(ids)!=len(set(ids)): raise SystemExit('Duplicate IDs after merge')
    if ids.count('mingi_tau')!=1: raise SystemExit('mingi_tau must occur exactly once')
    if any('эльбрус' in key_name(f['properties'].get('name')) for f in cleaned if f['properties']['id']!='mingi_tau'): raise SystemExit('Separate Elbrus duplicate remains')
    cats=Counter(f['properties']['category'] for f in cleaned)
    output={'type':'FeatureCollection','features':cleaned}
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    report={'source_render':'12.1.8 payload / morphology 12.1.6 lineage','source_special':'special-mountains-12.1.8.geojson','source_boundary':'approved 7.0.23 working contour, standalone copy','render_input_features':len(raw.get('features',[])),'output_features':len(cleaned),'categories':dict(sorted(cats.items())),'main':sum(bool(f['properties'].get('main')) for f in cleaned),'five_thousander':sum(bool(f['properties'].get('five_thousander')) for f in cleaned),'removed_elbrus_duplicates':removed_elbrus,'mingi_tau_count':ids.count('mingi_tau')}
    args.report.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False,indent=2))
if __name__=='__main__': main()
