import {chromium} from 'playwright';
import fs from 'node:fs';
import {assertReport} from './map-smoke-assertions.mjs';
import {collectReport} from './map-smoke-browser.mjs';

const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
page.setDefaultTimeout(120000);
const errors=[]; const requests=[];
page.on('console',m=>{if(m.type()==='error') errors.push(m.text());});
page.on('pageerror',e=>errors.push(String(e)));
page.on('request',r=>requests.push(r.url()));
fs.mkdirSync('build',{recursive:true});
try{
  await page.goto('http://127.0.0.1:8000/index.html',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.ALAN_MAP_INSTANCE?.map&&window.ALAN_SLIPPY_HYBRID_DIAGNOSTICS);
  await page.waitForFunction(()=>{const d=window.ALAN_SLIPPY_HYBRID_DIAGNOSTICS?.();return d&&Object.values(d.layerPresence||{}).every(Boolean)&&d.mountainLayersBelowPoints;});
  await page.evaluate(()=>window.ALAN_MAP_INSTANCE.map.jumpTo({center:[43.1,43.25],zoom:10.5,pitch:0,bearing:0}));
  await page.waitForTimeout(6000);
  const report=await collectReport(page);
  report.externalRequests=requests.filter(url=>!url.startsWith('http://127.0.0.1:8000/')&&!url.startsWith('blob:http://127.0.0.1:8000/'));
  report.consoleErrors=errors.filter(x=>!/favicon|WebGL performance caveat/i.test(x));
  assertReport(report);
  fs.writeFileSync('build/browser-diagnostics.json',JSON.stringify(report,null,2));
  await page.screenshot({path:'build/map-smoke.png',animations:'disabled'});
  console.log(JSON.stringify(report,null,2));
}catch(error){
  const diagnostics=await page.evaluate(()=>({root:document.getElementById('alan-map-root')?.textContent?.slice(0,1200)||'',slippy:window.ALAN_SLIPPY_HYBRID_DIAGNOSTICS?.()||null})).catch(()=>null);
  fs.writeFileSync('build/browser-diagnostics.json',JSON.stringify({error:String(error),diagnostics,errors,requests},null,2));
  await page.screenshot({path:'build/map-smoke.png',animations:'disabled'}).catch(()=>{});
  throw error;
}finally{await browser.close();}
