import assert from 'node:assert/strict';
import fs from 'node:fs';

export function checkAssets(baseUrl,source){
  const bootstrap=fs.readFileSync(new URL('../assets/bootstrap.js',baseUrl),'utf8');
  for(let i=0;i<5;i++) assert.ok(bootstrap.includes(`slippy-hybrid.part-${String(i).padStart(3,'0')}.js`));
  assert.equal(bootstrap.includes('slippy-hybrid.part-005.js'),false);
  assert.ok(bootstrap.indexOf("loadScript('map-ui.js')")<bootstrap.indexOf('slippy-hybrid.part-000.js'));
  assert.ok(bootstrap.indexOf('slippy-hybrid.part-004.js')<bootstrap.indexOf("loadScript('map-page.js')"));
  const page=fs.readFileSync(new URL('../assets/map-page.js',baseUrl),'utf8');
  assert.ok(page.includes('MAX_CACHED_SHARDS = 16'));
  assert.ok(page.includes("cache: index === 0 ? 'no-cache' : 'default'"));
  assert.equal(page.includes("'force-cache'"),false);
  assert.equal(/https?:\/\//.test(source),false);
  for(const token of ['bearing: 0','pitch: 0','maxPitch: 0','dragRotate: false','delete next.style.terrain','map.addLayer(layer, beforeId)']) assert.ok(source.includes(token));
  const files=fs.readdirSync(new URL('../assets/mountains/',baseUrl)).filter(name=>/^mount-\d+\.png$/.test(name));
  assert.equal(files.length,29);
  assert.equal(files.includes('mount-1.png'),false);
  for(let i=2;i<=30;i++) assert.ok(files.includes(`mount-${i}.png`));
  return files.length;
}
