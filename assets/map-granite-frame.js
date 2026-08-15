(function(root){
  'use strict';

  const RELEASE='7.2.4-r1';
  const LAYER_ID='alan-granite-frame-3d';
  const TOP_M=4000;
  const BOTTOM_M=-4000;
  const OUTER_SKIRT_M=3200;
  const OUTER_TOP_M=2400;
  const INNER_TOP_M=900;
  const INNER_LIP_M=250;
  const LEGACY_FRAME_LAYERS=['alan-native-frame-ornament','alan-native-frame-inner','alan-native-frame-outer','alan-native-frame'];
  const STRIDE_FLOATS=9;
  const STRIDE_BYTES=STRIDE_FLOATS*4;

  function finitePoint(p){return Array.isArray(p)&&p.length>=2&&Number.isFinite(+p[0])&&Number.isFinite(+p[1]);}
  function frameRing(){
    const g=root.ALAN_MAP_DATA?.mapFrame?.features?.[0]?.geometry;
    const ring=g?.type==='Polygon'?g.coordinates?.[0]:null;
    if(!Array.isArray(ring))return [];
    const p=ring.filter(finitePoint).map(v=>[+v[0],+v[1]]);
    if(p.length>1&&p[0][0]===p.at(-1)[0]&&p[0][1]===p.at(-1)[1])p.pop();
    return p.length>=3?p:[];
  }
  function projection(points){
    const c=points.reduce((s,p)=>[s[0]+p[0],s[1]+p[1]],[0,0]).map(v=>v/points.length);
    const mx=Math.max(1,111320*Math.cos(c[1]*Math.PI/180)), my=110574;
    return {toM:([x,y])=>[(x-c[0])*mx,(y-c[1])*my],toLL:([x,y])=>[c[0]+x/mx,c[1]+y/my]};
  }
  function area(points){let a=0;for(let i=0;i<points.length;i++){const p=points[i],q=points[(i+1)%points.length];a+=p[0]*q[1]-q[0]*p[1];}return a/2;}
  function intersect(p,d,q,e){const x=d[0]*e[1]-d[1]*e[0];if(Math.abs(x)<1e-9)return null;const v=[q[0]-p[0],q[1]-p[1]],t=(v[0]*e[1]-v[1]*e[0])/x;return[p[0]+d[0]*t,p[1]+d[1]*t];}
  function offsetRing(ring,insetM){
    const pr=projection(ring), pts=ring.map(pr.toM), sign=area(pts)>=0?1:-1;
    const lines=pts.map((p,i)=>{const q=pts[(i+1)%pts.length],d=[q[0]-p[0],q[1]-p[1]],len=Math.hypot(...d)||1,u=[d[0]/len,d[1]/len],n=sign>0?[-u[1],u[0]]:[u[1],-u[0]];return{p:[p[0]+n[0]*insetM,p[1]+n[1]*insetM],d};});
    return pts.map((_,i)=>{const a=lines[(i-1+lines.length)%lines.length],b=lines[i];return pr.toLL(intersect(a.p,a.d,b.p,b.d)||b.p);});
  }
  function matrixFrom(input){
    if(!input)return null;
    if(input.defaultProjectionData?.mainMatrix)return input.defaultProjectionData.mainMatrix;
    if(input.modelViewProjectionMatrix)return input.modelViewProjectionMatrix;
    if(ArrayBuffer.isView(input)||Array.isArray(input))return input;
    return null;
  }
  function compile(gl,type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){const m=gl.getShaderInfoLog(s);gl.deleteShader(s);throw new Error('Granite shader: '+m);}return s;}
  function program(gl){
    const vs=compile(gl,gl.VERTEX_SHADER,`precision highp float;
attribute vec3 a_position;
attribute vec3 a_local;
attribute vec3 a_normal;
uniform mat4 u_matrix;
varying vec3 v_local;
varying vec3 v_normal;
void main(){v_local=a_local;v_normal=a_normal;gl_Position=u_matrix*vec4(a_position,1.0);}`);
    const fs=compile(gl,gl.FRAGMENT_SHADER,`precision mediump float;
varying vec3 v_local;
varying vec3 v_normal;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),f.x),mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0,1.0)),f.x),f.y);}
float fbm(vec2 p){float v=0.0,a=.5;for(int i=0;i<3;i++){v+=a*noise(p);p=p*2.03+vec2(17.1,9.2);a*=.5;}return v;}
void main(){
  vec2 p=v_local.xy;
  float coarse=fbm(p*.00018);
  float fine=noise(p*.00165);
  float speck=step(.79,noise(p*.0037));
  float veinField=abs(sin(p.x*.00056+p.y*.00031+fbm(p*.00012)*7.0));
  float vein=smoothstep(.90,.985,veinField);
  vec3 warm=vec3(.57,.54,.52), light=vec3(.70,.68,.66), dark=vec3(.32,.30,.29), veinC=vec3(.40,.38,.37);
  vec3 stone=mix(warm,light,coarse*.58+fine*.17);
  stone=mix(stone,dark,speck*.22);
  stone=mix(stone,veinC,vein*.28);
  vec3 n=normalize(v_normal);
  vec3 sun=normalize(vec3(-.38,-.46,.80));
  float diffuse=.56+.44*max(dot(n,sun),0.0);
  float side=clamp(abs(n.z),0.0,1.0);
  float heightTone=clamp((v_local.z+4000.0)/8000.0,0.0,1.0);
  stone*=diffuse*(.83+.17*side)*(.90+.10*heightTone);
  gl_FragColor=vec4(stone,.985);
}`);
    const p=gl.createProgram();gl.attachShader(p,vs);gl.attachShader(p,fs);gl.linkProgram(p);gl.deleteShader(vs);gl.deleteShader(fs);if(!gl.getProgramParameter(p,gl.LINK_STATUS)){const m=gl.getProgramInfoLog(p);gl.deleteProgram(p);throw new Error('Granite program: '+m);}return p;
  }
  function normal(a,b,c){const u=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],v=[c[0]-a[0],c[1]-a[1],c[2]-a[2]],n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],l=Math.hypot(...n)||1;return[n[0]/l,n[1]/l,n[2]/l];}
  function buildMesh(maplibre){
    const base=frameRing();if(base.length<3)throw new Error('Granite frame: mapFrame is unavailable.');
    const pr=projection(base);
    const rings={outerSkirt:offsetRing(base,-OUTER_SKIRT_M),outerTop:offsetRing(base,-OUTER_TOP_M),innerTop:offsetRing(base,INNER_TOP_M),innerLip:offsetRing(base,INNER_LIP_M)};
    const local={};for(const[k,r]of Object.entries(rings))local[k]=r.map(pr.toM);
    const vertices=[];
    function point(kind,i,z){const ll=rings[kind][i],m=local[kind][i],c=maplibre.MercatorCoordinate.fromLngLat({lng:ll[0],lat:ll[1]},z);return{world:[c.x,c.y,c.z],local:[m[0],m[1],z]};}
    function pushVertex(p,n){vertices.push(p.world[0],p.world[1],p.world[2],p.local[0],p.local[1],p.local[2],n[0],n[1],n[2]);}
    function quad(a,b,c,d){const n=normal(a.local,b.local,c.local);pushVertex(a,n);pushVertex(b,n);pushVertex(c,n);pushVertex(a,n);pushVertex(c,n);pushVertex(d,n);}
    const count=base.length;
    for(let i=0;i<count;i++){
      const j=(i+1)%count;
      quad(point('outerSkirt',i,BOTTOM_M),point('outerSkirt',j,BOTTOM_M),point('outerSkirt',j,2500),point('outerSkirt',i,2500));
      quad(point('outerSkirt',i,2500),point('outerSkirt',j,2500),point('outerTop',j,TOP_M),point('outerTop',i,TOP_M));
      quad(point('outerTop',i,TOP_M),point('outerTop',j,TOP_M),point('innerTop',j,TOP_M),point('innerTop',i,TOP_M));
      quad(point('innerTop',i,TOP_M),point('innerTop',j,TOP_M),point('innerLip',j,3000),point('innerLip',i,3000));
      quad(point('innerLip',j,BOTTOM_M),point('innerLip',i,BOTTOM_M),point('innerLip',i,3000),point('innerLip',j,3000));
      quad(point('outerSkirt',j,BOTTOM_M),point('outerSkirt',i,BOTTOM_M),point('innerLip',i,BOTTOM_M),point('innerLip',j,BOTTOM_M));
    }
    return new Float32Array(vertices);
  }
  function capture(gl){return{program:gl.getParameter(gl.CURRENT_PROGRAM),buffer:gl.getParameter(gl.ARRAY_BUFFER_BINDING),blend:gl.isEnabled(gl.BLEND),depth:gl.isEnabled(gl.DEPTH_TEST),cull:gl.isEnabled(gl.CULL_FACE),depthMask:gl.getParameter(gl.DEPTH_WRITEMASK)};}
  function restore(gl,s){gl.useProgram(s.program);gl.bindBuffer(gl.ARRAY_BUFFER,s.buffer);s.blend?gl.enable(gl.BLEND):gl.disable(gl.BLEND);s.depth?gl.enable(gl.DEPTH_TEST):gl.disable(gl.DEPTH_TEST);s.cull?gl.enable(gl.CULL_FACE):gl.disable(gl.CULL_FACE);gl.depthMask(s.depthMask);}
  function install(api){
    const map=api?.map, maplibre=root.maplibregl;if(!map||!maplibre?.MercatorCoordinate||map.__alanGraniteFrameR4)return false;
    for(const id of LEGACY_FRAME_LAYERS){try{if(map.getLayer(id))map.setLayoutProperty(id,'visibility','none');}catch(_){}}
    const mesh=buildMesh(maplibre);let glRef=null,p=null,buffer=null,loc=null,matrixLoc=null,drawCalls=0;
    const custom={id:LAYER_ID,type:'custom',renderingMode:'3d',onAdd(_map,gl){glRef=gl;p=program(gl);buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,mesh,gl.STATIC_DRAW);loc={pos:gl.getAttribLocation(p,'a_position'),local:gl.getAttribLocation(p,'a_local'),normal:gl.getAttribLocation(p,'a_normal')};matrixLoc=gl.getUniformLocation(p,'u_matrix');},render(gl,input){if(!p||!buffer)return;const matrix=matrixFrom(input);if(!matrix)return;const s=capture(gl);try{gl.useProgram(p);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);for(const l of Object.values(loc))if(l>=0)gl.enableVertexAttribArray(l);gl.vertexAttribPointer(loc.pos,3,gl.FLOAT,false,STRIDE_BYTES,0);gl.vertexAttribPointer(loc.local,3,gl.FLOAT,false,STRIDE_BYTES,12);gl.vertexAttribPointer(loc.normal,3,gl.FLOAT,false,STRIDE_BYTES,24);gl.uniformMatrix4fv(matrixLoc,false,matrix instanceof Float32Array?matrix:new Float32Array(matrix));gl.enable(gl.DEPTH_TEST);gl.depthMask(true);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.disable(gl.CULL_FACE);gl.drawArrays(gl.TRIANGLES,0,mesh.length/STRIDE_FLOATS);drawCalls++;}finally{for(const l of Object.values(loc))if(l>=0)gl.disableVertexAttribArray(l);restore(gl,s);}},onRemove(){if(glRef){if(buffer)glRef.deleteBuffer(buffer);if(p)glRef.deleteProgram(p);}buffer=null;p=null;glRef=null;}};
    const before=map.getLayer('alan-native-parchment')?'alan-native-parchment':undefined;
    map.addLayer(custom,before);
    map.__alanGraniteFrameR4=true;
    root.ALAN_MAP_GRANITE_FRAME={version:RELEASE,layerId:LAYER_ID,renderer:'custom-webgl-static-world-mesh',topM:TOP_M,bottomM:BOTTOM_M,heightM:TOP_M-BOTTOM_M,outerSkirtM:OUTER_SKIRT_M,outerTopM:OUTER_TOP_M,innerTopM:INNER_TOP_M,innerLipM:INNER_LIP_M,usesMapProject:false,usesSvg:false,staticMesh:true,vertexCount:mesh.length/STRIDE_FLOATS,drawCalls:()=>drawCalls,ready:()=>Boolean(map.getLayer(LAYER_ID))};
    return true;
  }
  function boot(){
    const host=root.document?.getElementById('alan-map-root');if(!host)return;
    const run=(api)=>{try{install(api||root.ALAN_MAP_INSTANCE);}catch(e){console.error(e);}};
    host.addEventListener('alan-map:ready',e=>queueMicrotask(()=>run(e.detail?.api)),{once:true});
    if(root.ALAN_MAP_INSTANCE?.map)queueMicrotask(()=>run(root.ALAN_MAP_INSTANCE));
  }
  boot();
})(typeof window!=='undefined'?window:this);
