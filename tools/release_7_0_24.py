#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PARTS = [ROOT / 'assets/map-data.part-000.js', ROOT / 'assets/map-data.part-001.js']
MARKER = 'window.ALAN_MAP_DATA = '
VERSION = '7.0.24'
SHARD_SIZE = 786432
VECTOR_ARCHIVE = f'data/alan-vector-{VERSION}.pmtiles'
DEM_ARCHIVE = f'data/alan-dem-{VERSION}.pmtiles'
LANDCOVER_ARCHIVE = f'data/alan-landcover-{VERSION}.pmtiles'


def read_data() -> dict:
    source = ''.join(path.read_text(encoding='utf-8') for path in PARTS)
    index = source.find(MARKER)
    if index < 0:
        raise RuntimeError('ALAN_MAP_DATA marker not found')
    payload = source[index + len(MARKER):].strip()
    if payload.endswith(';'):
        payload = payload[:-1]
    return json.loads(payload)


def write_data(data: dict) -> None:
    payload = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
    midpoint = len(payload) // 2
    left = payload.rfind('},"', 0, midpoint)
    right = payload.find('},"', midpoint)
    candidates = [position + 1 for position in (left, right) if position >= 0]
    cut = min(candidates, key=lambda position: abs(position - midpoint)) if candidates else midpoint
    PARTS[0].write_text('\n' + MARKER + payload[:cut], encoding='utf-8')
    PARTS[1].write_text(payload[cut:] + ';\n', encoding='utf-8')


def coordinate_pairs(value):
    if isinstance(value, list):
        if len(value) >= 2 and all(isinstance(item, (int, float)) for item in value[:2]):
            yield float(value[0]), float(value[1])
        else:
            for item in value:
                yield from coordinate_pairs(item)


def bbox_of_feature_collection(collection: dict) -> list[float]:
    points = []
    for feature in collection.get('features') or []:
        points.extend(coordinate_pairs((feature.get('geometry') or {}).get('coordinates')))
    if not points:
        raise RuntimeError('mapFrame has no coordinates')
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return [min(xs), min(ys), max(xs), max(ys)]


def rectangle_collection(bounds: list[float], kind: str) -> dict:
    west, south, east, north = bounds
    ring = [[west, south], [east, south], [east, north], [west, north], [west, south]]
    return {
        'type': 'FeatureCollection',
        'features': [{
            'type': 'Feature',
            'properties': {'kind': kind, 'visible': 1 if kind == 'focus' else 0},
            'geometry': {'type': 'Polygon', 'coordinates': [ring]}
        }]
    }


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count == 0:
        if new and new in text:
            return text
        raise RuntimeError(f'{label}: expected text not found')
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, found {count}')
    return text.replace(old, new, 1)


def patch_bootstrap() -> None:
    path = ROOT / 'assets/bootstrap.js'
    text = path.read_text(encoding='utf-8')
    text = text.replace("    await loadScript('fantasy-relief.js');\n", '')
    text = text.replace("    await loadScript('fantasy-style.js');\n", '')
    path.write_text(text, encoding='utf-8')


def patch_map_page() -> None:
    path = ROOT / 'assets/map-page.js'
    text = path.read_text(encoding='utf-8')
    old = "    const archivePaths = [data.regionalDem.archivePath, data.regionalVector.archivePath];"
    new = "    const archivePaths = [data.regionalDem.archivePath, data.regionalVector.archivePath, data.regionalLandcover?.archivePath].filter(Boolean);"
    text = replace_once(text, old, new, 'map-page archive paths')
    path.write_text(text, encoding='utf-8')


def patch_map_ui() -> None:
    path = ROOT / 'assets/map-ui.js'
    text = path.read_text(encoding='utf-8')
    text = replace_once(text, "  const VERSION = '7.0.23';", f"  const VERSION = '{VERSION}';", 'map-ui version')
    old_templates = "      const demTemplate = localArchiveUrl(data.regionalDem.archivePath);\n      const vectorTemplate = localArchiveUrl(data.regionalVector.archivePath);"
    new_templates = "      const demTemplate = localArchiveUrl(data.regionalDem.archivePath);\n      const vectorTemplate = localArchiveUrl(data.regionalVector.archivePath);\n      const landcoverTemplate = data.regionalLandcover?.archivePath ? localArchiveUrl(data.regionalLandcover.archivePath) : null;"
    text = replace_once(text, old_templates, new_templates, 'map-ui landcover template')
    old_dem_source = "        'terrain-dem': {type:'raster-dem',url:demTemplate,tileSize:demTileSize,minzoom:Number(data.regionalDem.minzoom),maxzoom:Number(data.regionalDem.maxzoom),encoding:'terrarium',bounds:data.regionalDem.bounds,attribution:data.regionalDem.attribution},"
    new_dem_source = "        'terrain-dem': {type:'raster-dem',url:demTemplate,tileSize:demTileSize,minzoom:Number(data.regionalDem.minzoom),maxzoom:Number(data.regionalDem.maxzoom),encoding:String(data.regionalDem.encoding || 'terrarium'),bounds:data.regionalDem.bounds,attribution:data.regionalDem.attribution},"
    text = replace_once(text, old_dem_source, new_dem_source, 'map-ui DEM encoding')
    old_openmap = "      if (natureEnabled) sources.openmaptiles = {type:'vector',url:vectorTemplate,minzoom:Number(data.regionalVector.minzoom),maxzoom:Number(data.regionalVector.maxzoom),bounds:data.regionalVector.bounds,attribution:data.regionalVector.attribution};"
    new_openmap = "      if (natureEnabled) sources.openmaptiles = {type:'vector',url:vectorTemplate,minzoom:Number(data.regionalVector.minzoom),maxzoom:Number(data.regionalVector.maxzoom),bounds:data.regionalVector.bounds,attribution:data.regionalVector.attribution};\n      if (landcoverTemplate) sources['copernicus-landcover'] = {type:'raster',url:landcoverTemplate,tileSize:Number(data.regionalLandcover.tileSize || 256),minzoom:Number(data.regionalLandcover.minzoom),maxzoom:Number(data.regionalLandcover.maxzoom),bounds:data.regionalLandcover.bounds,attribution:data.regionalLandcover.attribution};"
    text = replace_once(text, old_openmap, new_openmap, 'map-ui landcover source')
    old_base_end = "        {id:'terrain-hillshade',type:'hillshade',source:'terrain-dem',paint:{'hillshade-illumination-anchor':'viewport','hillshade-illumination-direction':315,'hillshade-exaggeration':0.62,'hillshade-shadow-color':'#294252','hillshade-highlight-color':'#f8efd9','hillshade-accent-color':'#806b50'}},\n        {id:'ridge-lines',type:'line',source:'lines',filter:['all',sourceFilter('ridges'),['==',['get','visible'],1]],paint:{'line-color':'#675f55','line-width':['interpolate',['linear'],['zoom'],6,0.48,10,1.12],'line-opacity':['interpolate',['linear'],['zoom'],6,0.24,10,0.40],'line-dasharray':[1.2,2.1]}}\n      ];"
    new_base_end = "        {id:'terrain-hillshade',type:'hillshade',source:'terrain-dem',paint:{'hillshade-illumination-anchor':'viewport','hillshade-illumination-direction':315,'hillshade-exaggeration':0.62,'hillshade-shadow-color':'#294252','hillshade-highlight-color':'#f8efd9','hillshade-accent-color':'#806b50'}},\n        {id:'ridge-lines',type:'line',source:'lines',filter:['all',sourceFilter('ridges'),['==',['get','visible'],1]],paint:{'line-color':'#675f55','line-width':['interpolate',['linear'],['zoom'],6,0.48,10,1.12],'line-opacity':['interpolate',['linear'],['zoom'],6,0.24,10,0.40],'line-dasharray':[1.2,2.1]}}\n      ];\n      if (landcoverTemplate) baseLayers.splice(2,0,{id:'copernicus-landcover',type:'raster',source:'copernicus-landcover',minzoom:Number(data.regionalLandcover.minzoom),maxzoom:Number(data.regionalLandcover.maxzoom),paint:{'raster-opacity':['interpolate',['linear'],['zoom'],7,0.54,10,0.62,13,0.68],'raster-fade-duration':100}});"
    text = replace_once(text, old_base_end, new_base_end, 'map-ui landcover base layer')

    forest_fill = "          {id:'forest-fill',type:'fill',source:'openmaptiles','source-layer':'landcover',minzoom:VISIBILITY_ZOOM.DISTANT,filter:['==',['get','class'],'wood'],paint:{'fill-color':'#647b5b','fill-opacity':['interpolate',['linear'],['zoom'],7.0,0.20,8,0.26,11,0.32]}},\n          {id:'forest-pattern',type:'fill',source:'openmaptiles','source-layer':'landcover',minzoom:10.5,filter:['==',['get','class'],'wood'],layout:{'visibility':qualityProfile.forestPattern?'visible':'none'},paint:{'fill-pattern':'forest-canopy','fill-opacity':['interpolate',['linear'],['zoom'],10.5,0.28,12,0.52]}},\n"
    if forest_fill in text:
        text = text.replace(forest_fill, '', 1)
        marker = "        natureLayers.push(\n          {id:'osm-glacier-fill'"
        replacement = "        if (!landcoverTemplate) natureLayers.push(\n          {id:'forest-fill',type:'fill',source:'openmaptiles','source-layer':'landcover',minzoom:VISIBILITY_ZOOM.DISTANT,filter:['==',['get','class'],'wood'],paint:{'fill-color':'#647b5b','fill-opacity':['interpolate',['linear'],['zoom'],7.0,0.20,8,0.26,11,0.32]}},\n          {id:'forest-pattern',type:'fill',source:'openmaptiles','source-layer':'landcover',minzoom:10.5,filter:['==',['get','class'],'wood'],layout:{'visibility':qualityProfile.forestPattern?'visible':'none'},paint:{'fill-pattern':'forest-canopy','fill-opacity':['interpolate',['linear'],['zoom'],10.5,0.28,12,0.52]}}\n        );\n        natureLayers.push(\n          {id:'osm-glacier-fill'"
        text = replace_once(text, marker, replacement, 'map-ui OSM forest fallback')

    old_shard = "        const sourceId = archivePath.includes('dem') ? 'terrain-dem' : archivePath.includes('vector') ? 'openmaptiles' : '';"
    new_shard = "        const sourceId = archivePath.includes('dem') ? 'terrain-dem' : archivePath.includes('landcover') ? 'copernicus-landcover' : archivePath.includes('vector') ? 'openmaptiles' : '';"
    text = replace_once(text, old_shard, new_shard, 'map-ui shard source')
    path.write_text(text, encoding='utf-8')


def patch_index() -> None:
    path = ROOT / 'index.html'
    text = path.read_text(encoding='utf-8')
    text = text.replace('Alan Map 7.0.23 · Fantasy Hybrid', f'Alan Map {VERSION} · 3D Terrain')
    text = text.replace('Alan Map 7.0.23', f'Alan Map {VERSION}')
    path.write_text(text, encoding='utf-8')


def write_tests() -> None:
    runtime = r'''import fs from 'node:fs';
import assert from 'node:assert/strict';

const bootstrap = fs.readFileSync('assets/bootstrap.js','utf8');
const ui = fs.readFileSync('assets/map-ui.js','utf8');
const page = fs.readFileSync('assets/map-page.js','utf8');
const dataSource = fs.readFileSync('assets/map-data.part-000.js','utf8') + fs.readFileSync('assets/map-data.part-001.js','utf8');

assert.match(ui, /const VERSION = '7\.0\.24'/);
assert.ok(!bootstrap.includes('fantasy-relief.js'));
assert.ok(!bootstrap.includes('fantasy-style.js'));
assert.ok(!fs.existsSync('assets/fantasy-relief.js'));
assert.ok(!fs.existsSync('assets/fantasy-style.js'));
assert.match(ui, /data\.regionalDem\.encoding \|\| 'terrarium'/);
assert.match(ui, /copernicus-landcover/);
assert.match(page, /regionalLandcover\?\.archivePath/);

const marker = 'window.ALAN_MAP_DATA = ';
let payload = dataSource.slice(dataSource.indexOf(marker) + marker.length).trim();
if (payload.endsWith(';')) payload = payload.slice(0,-1);
const data = JSON.parse(payload);
assert.equal(data.version, '7.0.24');
assert.equal(data.applicationVersion, '7.0.24');
assert.equal(data.regionalDem.source, 'Copernicus DEM GLO-30');
assert.equal(data.regionalDem.encoding, 'mapbox');
const ring = data.mapFrame.features[0].geometry.coordinates[0];
assert.equal(ring.length, 5);
const uniqueX = new Set(ring.map(p => p[0]));
const uniqueY = new Set(ring.map(p => p[1]));
assert.equal(uniqueX.size, 2);
assert.equal(uniqueY.size, 2);
assert.deepEqual(data.bounds, [Math.min(...uniqueX), Math.min(...uniqueY), Math.max(...uniqueX), Math.max(...uniqueY)]);
if (data.regionalLandcover?.available) {
  assert.equal(data.regionalLandcover.source, 'Copernicus CLMS LCM-10');
  assert.ok(data.regionalLandcover.archivePath.includes('landcover-7.0.24.pmtiles'));
}
console.log('runtime-contract: ok');
'''
    smoke = r'''import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const server = spawn('python3',['-m','http.server','4173','--bind','127.0.0.1'],{stdio:'ignore'});
await new Promise(r => setTimeout(r,1200));
const browser = await chromium.launch({headless:true});
try {
  const page = await browser.newPage({viewport:{width:1280,height:900}});
  const errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  await page.goto('http://127.0.0.1:4173/',{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(()=>Boolean(window.AlanMap && document.querySelector('.maplibregl-canvas')),{timeout:30000});
  assert.equal(await page.locator('[data-fantasy-toggle], .fantasy-toggle').count(),0);
  const sourceIds = await page.evaluate(()=>Object.keys(window.AlanMap?.map?.getStyle?.().sources || {}));
  assert.ok(sourceIds.includes('terrain-dem'));
  assert.ok(errors.length === 0, errors.join('\n'));
  console.log('map-smoke: ok');
} finally {
  await browser.close();
  server.kill('SIGTERM');
}
'''
    (ROOT/'tests/runtime-contract.mjs').write_text(runtime,encoding='utf-8')
    (ROOT/'tests/map-smoke.mjs').write_text(smoke,encoding='utf-8')


def patch_docs() -> None:
    (ROOT/'README.md').write_text(f'''# Alan Map {VERSION}\n\nЛёгкая автономная 3D-карта Alan Til на MapLibre GL JS. Рабочая область — минимальный прямоугольный bbox прежнего культурного контура; север/юг и пользовательские культурные объекты сохраняются данными проекта. Фэнтезийный рендер удалён.\n\nИсточники: Copernicus DEM GLO-30 для 3D-рельефа; Copernicus CLMS LCM-10 для растительности при наличии собранного локального landcover PMTiles; OpenStreetMap/Geofabrik для дорог, рек, водоёмов, жилых территорий, ледников/снега и вершин. Все runtime-слои отдаются локально через PMTiles.\n''',encoding='utf-8')
    (ROOT/'DATA-SOURCES-AND-LICENSES.md').write_text('''# Источники данных и компоненты\n\n- Copernicus DEM GLO-30: глобальная 30-метровая цифровая модель поверхности; локальная копия перекодируется в Mapbox Terrain-RGB и PMTiles.\n- Copernicus Land Monitoring Service LCM-10, 2020: 10-метровая глобальная классификация земного покрова; используется для растительности после авторизованной сборки CDSE в локальный PMTiles.\n- OpenStreetMap: фиксированный Geofabrik snapshot Северо-Кавказского федерального округа; дороги, реки, водоёмы, residential, ледники/снег и вершины. © OpenStreetMap contributors, ODbL.\n- Сборка: GDAL/OGR, GeoPandas/Shapely, Tippecanoe, PMTiles CLI, Rasterio/rio-rgbify.\n- Runtime: MapLibre GL JS 5.24.0, PMTiles JS 4.4.1, локальный Noto Sans.\n\nМанифесты: `data/vector-build-manifest.json`, `data/shards-manifest.json`, `data/copernicus-build-manifest.json`.\n''',encoding='utf-8')


def remove_fantasy_and_obsolete_workflows() -> None:
    for rel in (
        'assets/fantasy-relief.js',
        'assets/fantasy-style.js',
        '.github/workflows/validate-fantasy-map.yml',
        '.github/workflows/rebuild-natural-pmtiles.yml',
        '.github/workflows/probe-copernicus.yml',
    ):
        path = ROOT / rel
        if path.exists():
            path.unlink()


def prepare() -> None:
    data = read_data()
    bounds = bbox_of_feature_collection(data['mapFrame'])
    data['mapFrame'] = rectangle_collection(bounds, 'map_frame')
    data['focus'] = rectangle_collection(bounds, 'focus')
    data['bounds'] = bounds
    for key in ('regionalDem','regionalVector','regionalLandcover'):
        if isinstance(data.get(key), dict):
            data[key]['bounds'] = bounds
    data['applicationVersion'] = VERSION
    data['version'] = VERSION
    data['stage'] = VERSION
    write_data(data)
    patch_bootstrap()
    patch_map_page()
    patch_map_ui()
    patch_index()
    write_tests()
    patch_docs()
    remove_fantasy_and_obsolete_workflows()
    (ROOT/'build').mkdir(exist_ok=True)
    (ROOT/'build/rectangular-bounds.json').write_text(json.dumps({'bounds':bounds},indent=2),encoding='utf-8')
    print(json.dumps({'version':VERSION,'bounds':bounds},ensure_ascii=False))


def sha256(path: Path) -> str:
    h=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''):
            h.update(chunk)
    return h.hexdigest()


def shard_archive(archive: Path, logical_path: str) -> dict:
    directory = ROOT / f"data/shards/{Path(logical_path).stem.replace('alan-','')}"
    if directory.exists():
        shutil.rmtree(directory)
    directory.mkdir(parents=True)
    records=[]
    with archive.open('rb') as src:
        i=0
        while True:
            chunk=src.read(SHARD_SIZE)
            if not chunk: break
            target=directory/f'part-{i:03d}.bin'
            target.write_bytes(chunk)
            records.append({'file':target.name,'size':len(chunk),'sha256':hashlib.sha256(chunk).hexdigest()})
            i+=1
    return {'archive_path':logical_path,'parts_path':directory.relative_to(ROOT).as_posix()+'/', 'byte_length':archive.stat().st_size,'shard_size':SHARD_SIZE,'shard_count':len(records),'shards':records}


def finalize(dem: Path, vector: Path, landcover: Path | None) -> None:
    if not dem.exists() or not vector.exists():
        raise RuntimeError('DEM or vector PMTiles missing')
    data=read_data()
    bounds=data['bounds']
    data['applicationVersion']=VERSION
    data['version']=VERSION
    data['stage']=VERSION
    data['dataVersion']=VERSION+'-copernicus-rectangular.1'
    data['regionalDem']={
        **(data.get('regionalDem') or {}),
        'available':True,'archivePath':DEM_ARCHIVE,'minzoom':7,'maxzoom':13,'tileSize':256,
        'encoding':'mapbox','bounds':bounds,'source':'Copernicus DEM GLO-30',
        'attribution':'Copernicus DEM GLO-30'
    }
    data['regionalVector']={
        **(data.get('regionalVector') or {}),
        'available':True,'archivePath':VECTOR_ARCHIVE,'minzoom':7,'maxzoom':13,'bounds':bounds,
        'physicallyClipped':True
    }
    if landcover and landcover.exists():
        data['regionalLandcover']={
            'available':True,'archivePath':LANDCOVER_ARCHIVE,'minzoom':7,'maxzoom':13,'tileSize':256,
            'bounds':bounds,'source':'Copernicus CLMS LCM-10','year':2020,
            'collectionId':'828f6b20-8ffd-48f8-a1da-fefd271456db',
            'attribution':'Copernicus Land Monitoring Service LCM-10'
        }
    else:
        data['regionalLandcover']={
            'available':False,'bounds':bounds,'source':'Copernicus CLMS LCM-10','year':2020,
            'collectionId':'828f6b20-8ffd-48f8-a1da-fefd271456db',
            'blockedReason':'CDSE OAuth credentials are required to materialize LCM-10 locally'
        }
    write_data(data)

    targets=[(vector,VECTOR_ARCHIVE),(dem,DEM_ARCHIVE)]
    if landcover and landcover.exists(): targets.append((landcover,LANDCOVER_ARCHIVE))
    archives={}
    for src,logical in targets:
        destination=ROOT/logical
        destination.parent.mkdir(parents=True,exist_ok=True)
        if src.resolve()!=destination.resolve(): shutil.copy2(src,destination)
        archives[logical]=shard_archive(destination,logical)
    (ROOT/'data/shards-manifest.json').write_text(json.dumps({'schema_version':1,'archives':archives},ensure_ascii=False,indent=2),encoding='utf-8')
    manifest={
        'version':VERSION,'bounds':bounds,
        'dem':{'source':'Copernicus DEM GLO-30','archive':DEM_ARCHIVE,'bytes':(ROOT/DEM_ARCHIVE).stat().st_size,'sha256':sha256(ROOT/DEM_ARCHIVE)},
        'landcover':{'source':'Copernicus CLMS LCM-10','year':2020,'archive':LANDCOVER_ARCHIVE if landcover and landcover.exists() else None,'available':bool(landcover and landcover.exists())},
        'vector':{'source':'OpenStreetMap / Geofabrik','archive':VECTOR_ARCHIVE,'bytes':(ROOT/VECTOR_ARCHIVE).stat().st_size,'sha256':sha256(ROOT/VECTOR_ARCHIVE)}
    }
    (ROOT/'data/copernicus-build-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')


def validate() -> None:
    data=read_data()
    if data.get('version')!=VERSION: raise RuntimeError('version mismatch')
    ring=data['mapFrame']['features'][0]['geometry']['coordinates'][0]
    if len(ring)!=5: raise RuntimeError('mapFrame is not a rectangle ring')
    xs={p[0] for p in ring}; ys={p[1] for p in ring}
    if len(xs)!=2 or len(ys)!=2: raise RuntimeError('mapFrame is not axis-aligned rectangle')
    if data['bounds'] != [min(xs),min(ys),max(xs),max(ys)]: raise RuntimeError('bounds mismatch')
    bootstrap=(ROOT/'assets/bootstrap.js').read_text(encoding='utf-8')
    ui=(ROOT/'assets/map-ui.js').read_text(encoding='utf-8')
    if 'fantasy-' in bootstrap or (ROOT/'assets/fantasy-style.js').exists() or (ROOT/'assets/fantasy-relief.js').exists():
        raise RuntimeError('fantasy runtime remains')
    if "encoding:String(data.regionalDem.encoding || 'terrarium')" not in ui: raise RuntimeError('dynamic DEM encoding missing')
    if data['regionalDem'].get('source')!='Copernicus DEM GLO-30': raise RuntimeError('Copernicus DEM not active')
    shards=json.loads((ROOT/'data/shards-manifest.json').read_text(encoding='utf-8'))
    for logical,record in shards['archives'].items():
        total=0
        for item in record['shards']:
            path=ROOT/record['parts_path']/item['file']
            if not path.exists() or path.stat().st_size!=item['size'] or sha256(path)!=item['sha256']:
                raise RuntimeError(f'invalid shard {path}')
            total+=path.stat().st_size
        if total!=record['byte_length']: raise RuntimeError(f'shard total mismatch {logical}')
    print('release-7.0.24 validation: ok')


def main() -> None:
    parser=argparse.ArgumentParser()
    sub=parser.add_subparsers(dest='command',required=True)
    sub.add_parser('prepare')
    final=sub.add_parser('finalize')
    final.add_argument('--dem',required=True)
    final.add_argument('--vector',required=True)
    final.add_argument('--landcover')
    sub.add_parser('validate')
    args=parser.parse_args()
    if args.command=='prepare': prepare()
    elif args.command=='finalize': finalize(Path(args.dem),Path(args.vector),Path(args.landcover) if args.landcover else None)
    else: validate()

if __name__=='__main__':
    main()
