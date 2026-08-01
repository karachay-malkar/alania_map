import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

export function checkSlippy(baseUrl) {
  const parts=Array.from({length:5},(_,i)=>fs.readFileSync(new URL(`../assets/slippy-hybrid.part-${String(i).padStart(3,'0')}.js`,baseUrl),'utf8'));
  const source=parts.join('');
  const sandbox={console,URL,Object,Array,Number,String,Math,Promise,Map,Set,Proxy,Reflect,AlanMap:{mount(){return {};}}};
  sandbox.self=sandbox;
  vm.createContext(sandbox);
  new vm.Script(source,{filename:'slippy-hybrid.js'}).runInContext(sandbox);
  const Slippy=sandbox.AlanSlippyHybrid;
  assert.equal(Slippy.version,'7.0.23-slippy-hybrid-icons.2');
  const ids=Array.from(Slippy.layerIds);
  assert.deepEqual(ids,['alan-mountain-icons-standard','alan-mountain-icons-high','alan-mountain-icons-five-thousanders']);
  const layers=Slippy.createMountainLayers();
  assert.equal(layers.length,3);
  for(const layer of layers){
    assert.equal(layer.type,'symbol');
    assert.equal(layer.source,'openmaptiles');
    assert.equal(layer['source-layer'],'peak');
    assert.equal(layer.layout['icon-anchor'],'top');
    assert.equal(layer.layout['icon-rotation-alignment'],'viewport');
    assert.equal(layer.layout['icon-pitch-alignment'],'viewport');
    assert.equal(layer.layout['icon-keep-upright'],true);
  }
  assert.equal(layers[2].layout['icon-image'],'mount-11');
  assert.ok(JSON.stringify(layers[2].filter).includes('5000'));
  assert.ok(JSON.stringify(layers[1].filter).includes('4200'));
  assert.ok(JSON.stringify(layers[1].filter).includes('5000'));
  assert.equal(JSON.stringify(layers[0].layout['icon-image']).includes('mount-11'),false);
  assert.equal(JSON.stringify(layers[1].layout['icon-image']).includes('mount-11'),false);
  assert.equal(JSON.stringify(layers[0].layout['icon-image']).includes('mount-1"'),false);
  const mapLayers=new Map([['osm-river-line',{id:'osm-river-line'}],['mountain-object-points',{id:'mountain-object-points'}],['osm-peak-points',{id:'osm-peak-points'}]]);
  const map={getSource:id=>id==='openmaptiles'?{}:null,getLayer:id=>mapLayers.get(id)||null,addLayer:(layer,beforeId)=>mapLayers.set(layer.id,{...layer,beforeId})};
  assert.equal(Slippy.ensureMountainLayers(map),true);
  for(const id of ids) assert.equal(mapLayers.get(id).beforeId,'mountain-object-points');
  return {version:Slippy.version,ids,source};
}
