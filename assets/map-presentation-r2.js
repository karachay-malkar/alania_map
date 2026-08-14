(function(root){
  'use strict';
  const RELEASE='7.2.2-r2';
  const SOURCE='alan-native-presentation';
  const FRAME_WIDTH_M=2000;
  const ORNAMENT_REPEAT_M=4800;
  const COMPASS_RADIUS_M=22000;
  const PARCHMENT='#ead7ad';
  const BROWN='#68482f';
  const layers={
    frame:'alan-native-frame',outer:'alan-native-frame-outer',inner:'alan-native-frame-inner',ornament:'alan-native-frame-ornament',
    parchment:'alan-native-parchment',wash:'alan-native-parchment-wash',feather:'alan-native-parchment-feather',aged:'alan-native-parchment-aged',pencil:'alan-native-parchment-pencil',
    compassFill:'alan-native-compass-fill',compassOutline:'alan-native-compass-outline',compassLine:'alan-native-compass-line',compassLetters:'alan-native-compass-letters'
  };
  const close=(points)=>{const r=points.map(p=>[+p[0],+p[1]]);if(r.length&&r[0].some((v,i)=>v!==r[r.length-1][i]))r.push([...r[0]]);return r;};
  const feature=(kind,geometry,extra={})=>({type:'Feature',properties:{kind,...extra},geometry});
  const offset=([lon,lat],east,north)=>[lon+east/Math.max(1,111320*Math.cos(lat*Math.PI/180)),lat+north/110574];
  const compassPoint=(center,x,y)=>offset(center,x/53*COMPASS_RADIUS_M,-y/53*COMPASS_RADIUS_M);
  const circle=(center,r,n=64)=>Array.from({length:n+1},(_,i)=>{const a=i/n*Math.PI*2;return compassPoint(center,Math.cos(a)*r,Math.sin(a)*r);});
  function parchmentGeometry(anchors){
    const a=[...anchors.edgeA],b=[...anchors.corner],c=[...anchors.edgeC];
    const dx=a[0]-c[0],dy=a[1]-c[1],len=Math.hypot(dx,dy)||1;
    let normal=[-dy/len,dx/len];
    const mid=[(a[0]+c[0])/2,(a[1]+c[1])/2],toward=[b[0]-mid[0],b[1]-mid[1]];
    if(normal[0]*toward[0]+normal[1]*toward[1]<0)normal=[-normal[0],-normal[1]];
    const jitter=[0,.006,-.010,.004,.012,-.005,.008,-.012,.004,.010,-.004,.006,-.009,.004,0];
    const edge=jitter.map((noise,i)=>{const t=i/(jitter.length-1);const base=[c[0]+(a[0]-c[0])*t,c[1]+(a[1]-c[1])*t];const d=Math.sin(Math.PI*t)*(.038+noise);return[base[0]+normal[0]*d,base[1]+normal[1]*d];});
    edge[0]=c;edge[edge.length-1]=a;
    return {polygon:close([a,b,c,...edge.slice(1)]),edge};
  }
  function letters(center){
    const glyph={
      N:[[[-.5,.6],[-.5,-.6]],[[-.5,.6],[.5,-.6]],[[.5,.6],[.5,-.6]]],
      S:[[[.5,-.5],[.2,-.65],[-.35,-.55],[-.5,-.2],[-.25,0],[.3,.08],[.5,.35],[.3,.6],[-.35,.65],[-.5,.5]]],
      E:[[[.5,-.6],[-.5,-.6],[-.5,.6],[.5,.6]],[[-.5,0],[.35,0]]],
      W:[[[-.55,-.6],[-.28,.6],[0,.05],[.28,.6],[.55,-.6]]]
    };
    const specs=[['N',0,-62],['S',0,66],['E',64,0],['W',-64,0]],out=[];
    for(const [name,cx,cy] of specs)for(const stroke of glyph[name])out.push(stroke.map(([x,y])=>compassPoint(center,cx+x*7.5,cy+y*10.5)));
    return out;
  }
  function buildGeoJSON(data,diag,base){
    const outer=base.frameRingFromData(data),inner=base.insetPolygonMeters(outer,FRAME_WIDTH_M),features=[];
    if(outer.length===inner.length&&outer.length>=3){
      features.push(feature('frame',{type:'Polygon',coordinates:[close(outer),close([...inner].reverse())]}));
      features.push(feature('frame_outer',{type:'LineString',coordinates:close(outer)}),feature('frame_inner',{type:'LineString',coordinates:close(inner)}));
      for(const seg of base.buildWorldOrnamentGeometry(outer,inner,ORNAMENT_REPEAT_M))features.push(feature('frame_ornament',{type:'LineString',coordinates:seg.close?close(seg.points):seg.points}));
    }
    const pg=parchmentGeometry(diag.parchmentAnchors);
    features.push(feature('parchment',{type:'Polygon',coordinates:[pg.polygon]}),feature('parchment_wash',{type:'Polygon',coordinates:[pg.polygon]}),feature('parchment_edge',{type:'LineString',coordinates:pg.edge}));
    const center=diag.parchmentCompass;
    features.push(feature('compass_ring_outer',{type:'LineString',coordinates:circle(center,42)}),feature('compass_ring_inner',{type:'LineString',coordinates:circle(center,28)}));
    const needles=[['north',[[0,-53],[7,-10],[0,0],[-7,-10],[0,-53]]],['south',[[0,53],[7,10],[0,0],[-7,10],[0,53]]],['west',[[-53,0],[-10,-7],[0,0],[-10,7],[-53,0]]],['east',[[53,0],[10,-7],[0,0],[10,7],[53,0]]]];
    for(const [direction,pts] of needles){const ring=pts.map(([x,y])=>compassPoint(center,x,y));features.push(feature('compass_needle',{type:'Polygon',coordinates:[ring]},{direction}),feature('compass_outline',{type:'LineString',coordinates:ring},{direction}));}
    for(const pts of [[[-36,-36],[-8,-8]],[[36,-36],[8,-8]],[[-36,36],[-8,8]],[[36,36],[8,8]]])features.push(feature('compass_line',{type:'LineString',coordinates:pts.map(([x,y])=>compassPoint(center,x,y))}));
    features.push(feature('compass_center',{type:'Polygon',coordinates:[circle(center,4,24)]}));
    for(const line of letters(center))features.push(feature('compass_letter',{type:'LineString',coordinates:line}));
    return {type:'FeatureCollection',features,metadata:{release:RELEASE,coordinateSpace:'geographic-world',frameWidthM:FRAME_WIDTH_M,ornamentRepeatM:ORNAMENT_REPEAT_M,compassRadiusM:COMPASS_RADIUS_M}};
  }
  const filter=(kind)=>['==',['get','kind'],kind];
  const inFilter=(kinds)=>['in',['get','kind'],['literal',kinds]];
  function definitions(){return [
    {id:layers.frame,type:'fill',source:SOURCE,filter:filter('frame'),paint:{'fill-color':PARCHMENT,'fill-opacity':.985}},
    {id:layers.outer,type:'line',source:SOURCE,filter:filter('frame_outer'),paint:{'line-color':BROWN,'line-opacity':.82,'line-width':1.35}},
    {id:layers.inner,type:'line',source:SOURCE,filter:filter('frame_inner'),paint:{'line-color':BROWN,'line-opacity':.62,'line-width':1.05}},
    {id:layers.ornament,type:'line',source:SOURCE,filter:filter('frame_ornament'),layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':BROWN,'line-opacity':.86,'line-width':1.2}},
    {id:layers.parchment,type:'fill',source:SOURCE,filter:filter('parchment'),paint:{'fill-color':PARCHMENT,'fill-opacity':.985}},
    {id:layers.wash,type:'fill',source:SOURCE,filter:filter('parchment_wash'),paint:{'fill-color':'#c49253','fill-opacity':.055}},
    {id:layers.feather,type:'line',source:SOURCE,filter:filter('parchment_edge'),layout:{'line-cap':'round'},paint:{'line-color':PARCHMENT,'line-opacity':.48,'line-width':28,'line-blur':9}},
    {id:layers.aged,type:'line',source:SOURCE,filter:filter('parchment_edge'),layout:{'line-cap':'round'},paint:{'line-color':'#a67846','line-opacity':.22,'line-width':9,'line-blur':3}},
    {id:layers.pencil,type:'line',source:SOURCE,filter:filter('parchment_edge'),layout:{'line-cap':'round'},paint:{'line-color':'#755137','line-opacity':.46,'line-width':1.25}},
    {id:layers.compassFill,type:'fill',source:SOURCE,filter:inFilter(['compass_needle','compass_center']),paint:{'fill-color':['match',['get','direction'],'north','#62442e','south','#b48756','east','#8b6241','west','#8b6241','#62442e'],'fill-opacity':.95}},
    {id:layers.compassOutline,type:'line',source:SOURCE,filter:filter('compass_outline'),paint:{'line-color':'#62442e','line-opacity':.82,'line-width':1.5}},
    {id:layers.compassLine,type:'line',source:SOURCE,filter:inFilter(['compass_ring_outer','compass_ring_inner','compass_line']),paint:{'line-color':'#62442e','line-opacity':['match',['get','kind'],'compass_ring_outer',.74,'compass_ring_inner',.52,.72],'line-width':['match',['get','kind'],'compass_ring_outer',2.2,'compass_ring_inner',1.2,1.5]}},
    {id:layers.compassLetters,type:'line',source:SOURCE,filter:filter('compass_letter'),paint:{'line-color':'#573c29','line-opacity':.9,'line-width':1.7}}
  ];}
  function removeLegacy(host){host.querySelectorAll('[data-role="parchment-overlay"],[data-role="map-perimeter-frame"]').forEach(el=>el.remove());}
  function install(api){
    const map=api?.map,base=root.AlanMapPresentation?.__test;if(!map||!base||map.__alanNativePresentationR2)return;map.__alanNativePresentationR2=true;
    const geojson=buildGeoJSON(root.ALAN_MAP_DATA||{},api.getPresentationDiagnostics(),base);
    const ensure=()=>{removeLegacy(map.getContainer());if(!map.isStyleLoaded?.())return false;if(!map.getSource(SOURCE))map.addSource(SOURCE,{type:'geojson',data:geojson,maxzoom:24,tolerance:.05,buffer:256});for(const layer of definitions())if(!map.getLayer(layer.id))map.addLayer(layer);return Object.values(layers).every(id=>!!map.getLayer(id));};
    ensure();map.on('styledata',ensure);map.on('load',ensure);
    root.ALAN_MAP_PRESENTATION_722={version:RELEASE,presentationSpace:'native-map-scene',nativeMapScene:true,usesMapProject:false,usesSvgOverlay:false,sourceId:SOURCE,layerIds:{...layers},frameWidthM:FRAME_WIDTH_M,ornamentRepeatM:ORNAMENT_REPEAT_M,compassRadiusM:COMPASS_RADIUS_M,beamLayersRemoved:()=>['settlement-beam-halo','settlement-beam-core'].every(id=>!map.getLayer(id)),nativeSourceReady:()=>!!map.getSource(SOURCE),nativeLayersReady:()=>Object.values(layers).every(id=>!!map.getLayer(id)),legacySvgCount:()=>map.getContainer().querySelectorAll('[data-role="parchment-overlay"],[data-role="map-perimeter-frame"]').length,geometry:()=>geojson};
    root.ALAN_MAP_PRESENTATION_7025=root.ALAN_MAP_PRESENTATION_722;
  }
  const host=root.document?.getElementById('alan-map-root');
  if(!host)return;
  const observer=new MutationObserver(()=>removeLegacy(host));observer.observe(host,{childList:true,subtree:true});removeLegacy(host);
  host.addEventListener('alan-map:ready',event=>install(event.detail?.api||root.ALAN_MAP_INSTANCE),{once:true});
  if(root.ALAN_MAP_INSTANCE?.map)install(root.ALAN_MAP_INSTANCE);
  root.AlanMapPresentationR2={version:RELEASE,buildGeoJSON,definitions,layers,sourceId:SOURCE};
})(typeof self!=='undefined'?self:this);
