#!/usr/bin/env python3
from __future__ import annotations

import io
import json
import sqlite3
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage
from affine import Affine
from rasterio.features import rasterize
from rasterio.warp import reproject, Resampling
import rasterio
from shapely.geometry import shape, mapping
from shapely.ops import transform as shp_transform
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[1]
PARTS = [ROOT / 'assets/map-data.part-000.js', ROOT / 'assets/map-data.part-001.js']
MARKER = 'window.ALAN_MAP_DATA = '
HALF = 20037508.342789244
WORLD = HALF * 2
DETAIL_Z = 12
ALPHA_THRESHOLD = 96
DATA_VERSION = '7.3.1-snow-canonical-unified-z12.1'
CANONICAL_ARCHIVE = 'data/alan-snow-7.3.1.pmtiles'
CANONICAL_TIF = ROOT / 'build/alan-snow-7.3.1.tif'
REPORT_PATH = ROOT / 'data/snow-canonical-report-7.3.1.json'
TO_3857 = Transformer.from_crs('EPSG:4326', 'EPSG:3857', always_xy=True).transform
REFERENCE_RULES = [(11,96,12.0),(10,88,18.0),(9,80,24.0),(8,72,28.0),(7,64,32.0)]


def read_data() -> dict:
    source = ''.join(path.read_text(encoding='utf-8') for path in PARTS)
    start = source.index(MARKER) + len(MARKER)
    payload = source[start:].strip()
    if payload.endswith(';'):
        payload = payload[:-1]
    return json.loads(payload)


def write_data(data: dict) -> None:
    payload = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
    midpoint = len(payload) // 2
    left = payload.rfind('},"', 0, midpoint)
    right = payload.find('},"', midpoint)
    candidates = [position + 1 for position in (left, right) if position >= 0]
    cut = min(candidates, key=lambda p: abs(p - midpoint)) if candidates else midpoint
    PARTS[0].write_text('\n' + MARKER + payload[:cut], encoding='utf-8')
    PARTS[1].write_text(payload[cut:] + ';\n', encoding='utf-8')


def xyz_y(z: int, tms_y: int) -> int:
    return (1 << z) - 1 - int(tms_y)


def tile_rows(db: Path, zoom: int):
    con = sqlite3.connect(db)
    rows = list(con.execute('select tile_column,tile_row,tile_data from tiles where zoom_level=? order by tile_column,tile_row',(zoom,)))
    con.close()
    return rows


def load_union_mosaic(paths: list[Path], zoom: int) -> tuple[np.ndarray, Affine]:
    all_rows = []
    for path in paths:
        rows = tile_rows(path, zoom)
        if rows:
            all_rows.append(rows)
    if not all_rows:
        raise RuntimeError(f'No z{zoom} snow tiles')
    xs, ys = [], []
    for rows in all_rows:
        xs.extend(int(row[0]) for row in rows)
        ys.extend(xyz_y(zoom, row[1]) for row in rows)
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    mosaic = np.zeros(((max_y-min_y+1)*256,(max_x-min_x+1)*256),dtype=np.uint8)
    for rows in all_rows:
        for tile_x,tile_row,tile_data in rows:
            tile_y = xyz_y(zoom,tile_row)
            alpha = np.asarray(Image.open(io.BytesIO(tile_data)).convert('RGBA'),dtype=np.uint8)[:,:,3]
            r0=(tile_y-min_y)*256; c0=(int(tile_x)-min_x)*256
            target=mosaic[r0:r0+256,c0:c0+256]
            np.maximum(target,alpha,out=target)
    tile_span=WORLD/(1<<zoom); px=tile_span/256
    west=-HALF+min_x*tile_span; north=HALF-min_y*tile_span
    return mosaic,Affine(px,0,west,0,-px,north)


def align(alpha: np.ndarray, src_transform: Affine, dst_shape, dst_transform: Affine) -> np.ndarray:
    out=np.zeros(dst_shape,dtype=np.uint8)
    reproject(alpha,out,src_transform=src_transform,src_crs='EPSG:3857',dst_transform=dst_transform,dst_crs='EPSG:3857',resampling=Resampling.bilinear,src_nodata=0,dst_nodata=0)
    return out


def frame_mask(data: dict, out_shape, transform: Affine) -> np.ndarray:
    features=(data.get('mapFrame') or {}).get('features') or []
    if not features:
        return np.ones(out_shape,dtype=bool)
    geom=shp_transform(TO_3857,shape(features[0]['geometry'])).buffer(0)
    return rasterize([(mapping(geom),1)],out_shape=out_shape,transform=transform,fill=0,dtype='uint8',all_touched=False).astype(bool)


def build_canonical(data: dict, mbtiles: list[Path]) -> dict:
    detail_alpha,detail_transform=load_union_mosaic(mbtiles,DETAIL_Z)
    clip=frame_mask(data,detail_alpha.shape,detail_transform)
    core=(detail_alpha>=ALPHA_THRESHOLD)&clip
    if not core.any():
        raise RuntimeError('Canonical z12 union has no snow')
    distance=ndimage.distance_transform_edt(~core)
    final=core.copy(); per_zoom=[]; max_reference_alpha=np.zeros(detail_alpha.shape,dtype=np.uint8)
    for zoom,threshold,max_distance_px in REFERENCE_RULES:
        ref_alpha,ref_transform=load_union_mosaic(mbtiles,zoom)
        aligned=align(ref_alpha,ref_transform,detail_alpha.shape,detail_transform)
        np.maximum(max_reference_alpha,aligned,out=max_reference_alpha)
        supported=(aligned>=threshold)&clip
        additions=supported&~final&(distance<=max_distance_px)
        final|=additions
        per_zoom.append({'zoom':zoom,'alpha_threshold':threshold,'max_distance_px':max_distance_px,'supported_pixels':int(supported.sum()),'new_pixels':int(additions.sum())})
    holes=ndimage.binary_fill_holes(core)&~core&clip&(max_reference_alpha>=64)
    final|=holes
    final=ndimage.binary_closing(final,structure=np.ones((3,3),dtype=bool),iterations=1)&clip
    added=final&~core
    added_ratio=float(added.sum()/max(1,core.sum()))
    if added_ratio>1.75:
        raise RuntimeError(f'Canonical restoration expanded too far: {added_ratio:.3f}')
    soft=ndimage.gaussian_filter(final.astype(np.float32),sigma=0.70,mode='constant',cval=0.0)
    alpha=np.clip((soft-0.055)/0.945*255.0,0,255).astype(np.uint8)
    interior=ndimage.binary_erosion(final,structure=np.ones((3,3),dtype=bool),iterations=1)
    alpha[interior]=255; alpha[~clip]=0
    CANONICAL_TIF.parent.mkdir(parents=True,exist_ok=True)
    profile={'driver':'GTiff','height':alpha.shape[0],'width':alpha.shape[1],'count':4,'dtype':'uint8','crs':'EPSG:3857','transform':detail_transform,'compress':'DEFLATE','predictor':2,'tiled':True,'blockxsize':256,'blockysize':256}
    with rasterio.open(CANONICAL_TIF,'w',**profile) as dst:
        visible=alpha>0
        for band,value in enumerate((250,253,253),start=1):
            dst.write(np.where(visible,value,0).astype(np.uint8),band)
        dst.write(alpha,4)
        dst.colorinterp=(rasterio.enums.ColorInterp.red,rasterio.enums.ColorInterp.green,rasterio.enums.ColorInterp.blue,rasterio.enums.ColorInterp.alpha)
    px_area=abs(detail_transform.a*detail_transform.e)
    report={'version':'7.3.1','data_version':DATA_VERSION,'strategy':'canonical-unified-z12-with-multiscale-restoration','detail_zoom':DETAIL_Z,'source_layers':['permanent','seasonal'],'source_archives':['data/alan-snow-permanent-7.2.5.pmtiles','data/alan-snow-seasonal-7.2.5.pmtiles'],'alpha_threshold':ALPHA_THRESHOLD,'reference_rules':per_zoom,'core_pixels':int(core.sum()),'restored_pixels':int(added.sum()),'restored_ratio_to_core':added_ratio,'final_pixels':int(final.sum()),'final_area_km2_mercator':float(final.sum()*px_area/1_000_000),'hole_pixels_added':int(holes.sum()),'antialias_sigma_px':0.70,'output_tif':str(CANONICAL_TIF.relative_to(ROOT)),'output_archive':CANONICAL_ARCHIVE}
    REPORT_PATH.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    return report


def patch_map_ui() -> None:
    path=ROOT/'assets/map-ui.js'; text=path.read_text(encoding='utf-8')
    text=text.replace("        ['snowGapSeasonal', data.snowGapSeasonal],\n",'').replace("        ['snowGapPermanent', data.snowGapPermanent],\n",'')
    old="      const snowPermanentTemplate = data.regionalSnow?.available && data.regionalSnow?.permanent?.archivePath ? localArchiveUrl(data.regionalSnow.permanent.archivePath) : null;\n      const snowSeasonalTemplate = data.regionalSnow?.available && data.regionalSnow?.seasonal?.archivePath ? localArchiveUrl(data.regionalSnow.seasonal.archivePath) : null;"
    new="      const snowTemplate = data.regionalSnow?.available && data.regionalSnow?.archivePath ? localArchiveUrl(data.regionalSnow.archivePath) : null;"
    if old not in text: raise RuntimeError('map-ui snow template anchor missing')
    text=text.replace(old,new,1)
    old="      if (snowPermanentTemplate) sources['snow-permanent'] = {type:'raster',url:snowPermanentTemplate,tileSize:Number(data.regionalSnow.permanent.tileSize || 256),minzoom:Number(data.regionalSnow.permanent.minzoom),maxzoom:Number(data.regionalSnow.permanent.maxzoom),bounds:data.regionalSnow.permanent.bounds,attribution:data.regionalSnow.attribution};\n      if (snowSeasonalTemplate) sources['snow-seasonal'] = {type:'raster',url:snowSeasonalTemplate,tileSize:Number(data.regionalSnow.seasonal.tileSize || 256),minzoom:Number(data.regionalSnow.seasonal.minzoom),maxzoom:Number(data.regionalSnow.seasonal.maxzoom),bounds:data.regionalSnow.seasonal.bounds,attribution:data.regionalSnow.attribution};"
    new="      if (snowTemplate) sources.snow = {type:'raster',url:snowTemplate,tileSize:Number(data.regionalSnow.tileSize || 256),minzoom:Number(data.regionalSnow.minzoom),maxzoom:Number(data.regionalSnow.maxzoom),bounds:data.regionalSnow.bounds,attribution:data.regionalSnow.attribution};"
    if old not in text: raise RuntimeError('map-ui snow source anchor missing')
    text=text.replace(old,new,1)
    old="      if (snowSeasonalTemplate) baseLayers.splice(-1,0,{id:'satellite-snow-seasonal',type:'raster',source:'snow-seasonal',minzoom:Number(data.regionalSnow.seasonal.minzoom),paint:{'raster-opacity':['interpolate',['linear'],['zoom'],7,0.26,9,0.36,12,0.52],'raster-fade-duration':100,'raster-resampling':'linear'}});\n      if (snowPermanentTemplate) baseLayers.splice(-1,0,{id:'satellite-snow-permanent',type:'raster',source:'snow-permanent',minzoom:Number(data.regionalSnow.permanent.minzoom),paint:{'raster-opacity':['interpolate',['linear'],['zoom'],7,0.74,9,0.86,12,0.94],'raster-fade-duration':100,'raster-resampling':'linear'}});\n      if (data.snowGapSeasonal?.features?.length) baseLayers.splice(-1,0,{id:'snow-gap-seasonal',type:'fill',source:'polygons',minzoom:Number(data.regionalSnow?.gapPatchMinzoom || 10.75),filter:sourceFilter('snowGapSeasonal'),paint:{'fill-color':'#f5fafb','fill-opacity':0.44,'fill-antialias':true}});\n      if (data.snowGapPermanent?.features?.length) baseLayers.splice(-1,0,{id:'snow-gap-permanent',type:'fill',source:'polygons',minzoom:Number(data.regionalSnow?.gapPatchMinzoom || 10.75),filter:sourceFilter('snowGapPermanent'),paint:{'fill-color':'#fafdfd','fill-opacity':0.92,'fill-antialias':true}});"
    new="      if (snowTemplate) baseLayers.splice(-1,0,{id:'satellite-snow',type:'raster',source:'snow',minzoom:Number(data.regionalSnow.minzoom),paint:{'raster-opacity':0.92,'raster-fade-duration':0,'raster-resampling':'linear'}});"
    if old not in text: raise RuntimeError('map-ui snow layers anchor missing')
    text=text.replace(old,new,1).replace('if (!snowPermanentTemplate) natureLayers.push(','if (!snowTemplate) natureLayers.push(',1)
    if any(x in text for x in ['snowPermanentTemplate','snowSeasonalTemplate','snowGapPermanent','snowGapSeasonal']): raise RuntimeError('Legacy snow runtime references remain in map-ui')
    path.write_text(text,encoding='utf-8')


def patch_map_page() -> None:
    path=ROOT/'assets/map-page.js'; text=path.read_text(encoding='utf-8')
    old="      ...(data.regionalSnow?.available && data.regionalSnow?.permanent?.archivePath ? [{path:data.regionalSnow.permanent.archivePath,sourceId:'snow-permanent',config:data.regionalSnow.permanent,prefetch:false,maxConcurrent:mobileTransport?3:6,retryDelays:RANGE_RETRY_DELAYS_MS}] : []),\n      ...(data.regionalSnow?.available && data.regionalSnow?.seasonal?.archivePath ? [{path:data.regionalSnow.seasonal.archivePath,sourceId:'snow-seasonal',config:data.regionalSnow.seasonal,prefetch:false,maxConcurrent:mobileTransport?3:6,retryDelays:RANGE_RETRY_DELAYS_MS}] : [])"
    new="      ...(data.regionalSnow?.available && data.regionalSnow?.archivePath ? [{path:data.regionalSnow.archivePath,sourceId:'snow',config:data.regionalSnow,prefetch:false,maxConcurrent:mobileTransport?3:6,retryDelays:RANGE_RETRY_DELAYS_MS}] : [])"
    if old not in text: raise RuntimeError('map-page snow transport anchor missing')
    path.write_text(text.replace(old,new,1),encoding='utf-8')


def patch_metadata(data: dict) -> None:
    data.pop('snowGapPermanent',None); data.pop('snowGapSeasonal',None); data.pop('snowDisplayPermanent',None); data.pop('snowDisplaySeasonal',None)
    data['dataVersion']=DATA_VERSION
    snow=data.get('regionalSnow') or {}
    permanent=(snow.get('permanent') or {}).get('archivePath','data/alan-snow-permanent-7.2.5.pmtiles')
    seasonal=(snow.get('seasonal') or {}).get('archivePath','data/alan-snow-seasonal-7.2.5.pmtiles')
    for key in ['permanent','seasonal','gapPatchDetailZoom','gapPatchReferenceZoom','gapPatchMinzoom','gapPatchMaxDistancePx','gapPatchMaxComponentPx','gapPatchMaxRatio']: snow.pop(key,None)
    snow.update({'version':'7.3.1','archivePath':CANONICAL_ARCHIVE,'tileSize':256,'minzoom':7,'maxzoom':12,'kind':'canonical-unified-snow','displayStrategy':'canonical-unified-z12-with-multiscale-restoration','sourceArchives':{'permanent':permanent,'seasonal':seasonal},'canonicalDetailZoom':12,'canonicalReportPath':'data/snow-canonical-report-7.3.1.json','displayNotes':'Permanent and seasonal source masks are merged into one z12 canonical raster. Coarser z7-z11 masks only restore supported gaps near detailed snow. The same z12 geometry is overzoomed above z12, so snow no longer shrinks on close zooms.'})
    data['regionalSnow']=snow


def patch_tests_and_docs() -> None:
    rt=ROOT/'tests/runtime-contract.mjs'; text=rt.read_text(encoding='utf-8')
    text=text.replace("assert.match(uiSource, /satellite-snow-permanent/);\nassert.match(uiSource, /satellite-snow-seasonal/);\nassert.match(uiSource, /if \\(!snowPermanentTemplate\\) natureLayers\\.push/);","assert.match(uiSource, /satellite-snow/);\nassert.ok(!uiSource.includes('satellite-snow-permanent'));\nassert.ok(!uiSource.includes('satellite-snow-seasonal'));\nassert.match(uiSource, /if \\(!snowTemplate\\) natureLayers\\.push/);")
    text=text.replace("assert.match(indexSource, /map-presentation-r2\\.js\\?v=7\\.3\\.1-snow5/);","assert.match(indexSource, /map-presentation-r2\\.js\\?v=7\\.3\\.1-snow6/);")
    start=text.index("if (data.regionalSnow?.available) {")
    end=text.index("\n\nif (data.regionalLandcover?.available)",start)
    new_block="if (data.regionalSnow?.available) {\n  assert.equal(data.regionalSnow.version, '7.3.1');\n  assert.equal(data.dataVersion, '7.3.1-snow-canonical-unified-z12.1');\n  assert.equal(data.regionalSnow.method, 'worldcover-class-70-plus-multiyear-late-summer-ndsi');\n  assert.deepEqual(data.regionalSnow.bounds, data.bounds);\n  assert.equal(data.regionalSnow.archivePath, 'data/alan-snow-7.3.1.pmtiles');\n  assert.equal(data.regionalSnow.displayStrategy, 'canonical-unified-z12-with-multiscale-restoration');\n  assert.equal(data.regionalSnow.canonicalDetailZoom, 12);\n  assert.equal(data.regionalSnow.sourceArchives.permanent, 'data/alan-snow-permanent-7.2.5.pmtiles');\n  assert.equal(data.regionalSnow.sourceArchives.seasonal, 'data/alan-snow-seasonal-7.2.5.pmtiles');\n  assert.ok(!('snowGapPermanent' in data));\n  assert.ok(!('snowGapSeasonal' in data));\n  assert.ok(fs.existsSync(data.regionalSnow.archivePath));\n  assert.ok(fs.existsSync(data.regionalSnow.canonicalReportPath));\n}"
    rt.write_text(text[:start]+new_block+text[end:],encoding='utf-8')
    smoke=ROOT/'tests/map-smoke.mjs'; text=smoke.read_text(encoding='utf-8')
    text=text.replace("        satelliteSnowPermanent:byId['satellite-snow-permanent'] || null,\n        satelliteSnowSeasonal:byId['satellite-snow-seasonal'] || null","        satelliteSnow:byId['satellite-snow'] || null")
    old="  if (diagnostics.sourceIds.includes('snow-permanent')) {\n    assert.ok(diagnostics.sourceIds.includes('snow-seasonal'));\n    assert.ok(diagnostics.layers.satelliteSnowPermanent);\n    assert.ok(diagnostics.layers.satelliteSnowSeasonal);\n    assert.equal(diagnostics.layers.glacierFill,null);\n    assert.equal(diagnostics.layers.snowFill,null);\n  } else {\n    assert.ok(diagnostics.layers.glacierFill);\n    assert.ok(diagnostics.layers.snowFill);\n  }"
    new="  if (diagnostics.sourceIds.includes('snow')) {\n    assert.ok(diagnostics.layers.satelliteSnow);\n    assert.equal(diagnostics.layers.glacierFill,null);\n    assert.equal(diagnostics.layers.snowFill,null);\n  } else {\n    assert.ok(diagnostics.layers.glacierFill);\n    assert.ok(diagnostics.layers.snowFill);\n  }"
    if old not in text: raise RuntimeError('map-smoke style snow block missing')
    text=text.replace(old,new,1)
    old="  if (diagnostics.sourceIds.includes('snow-permanent')) {\n    assert.ok(diagnostics.transport.archives.some(item => item.archivePath === 'data/alan-snow-permanent-7.2.5.pmtiles'));\n    assert.ok(diagnostics.transport.archives.some(item => item.archivePath === 'data/alan-snow-seasonal-7.2.5.pmtiles'));\n  }"
    new="  if (diagnostics.sourceIds.includes('snow')) {\n    assert.ok(diagnostics.transport.archives.some(item => item.archivePath === 'data/alan-snow-7.3.1.pmtiles'));\n  }"
    if old not in text: raise RuntimeError('map-smoke transport snow block missing')
    smoke.write_text(text.replace(old,new,1),encoding='utf-8')
    index=ROOT/'index.html'; index.write_text(index.read_text(encoding='utf-8').replace('7.3.1-snow5','7.3.1-snow6'),encoding='utf-8')
    (ROOT/'README.md').write_text("# Alan Map 7.3.1\n\nВ runtime используется один канонический snow-layer `data/alan-snow-7.3.1.pmtiles`. Он объединяет исходные permanent и seasonal snow 7.2.5 в детальной сетке z12. Пропуски, которые появлялись при переходе от дальних масштабов к z12, восстанавливаются по подтверждению уровней z7-z11 только рядом с детальным снегом.\n\nПосле z12 MapLibre overzoom-ит одну и ту же каноническую геометрию, поэтому снежное покрытие больше не должно уменьшаться при приближении. Старые permanent/seasonal PMTiles сохранены как исходные научные данные, но не являются отдельными runtime-слоями.\n",encoding='utf-8')


def main() -> None:
    data=read_data(); mbtiles=[ROOT/'build/snow-permanent.mbtiles',ROOT/'build/snow-seasonal.mbtiles']
    for path in mbtiles:
        if not path.exists(): raise RuntimeError(f'Missing converted source: {path}')
    report=build_canonical(data,mbtiles); patch_metadata(data); write_data(data); patch_map_ui(); patch_map_page(); patch_tests_and_docs(); print(json.dumps(report,ensure_ascii=False,indent=2))

if __name__ == '__main__':
    main()
