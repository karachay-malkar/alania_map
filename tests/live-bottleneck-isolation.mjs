import { chromium } from 'playwright';

const url=process.env.LIVE_URL||'https://karachay-malkar.github.io/alania_map/';
const browser=await chromium.launch({headless:true,args:['--disable-dev-shm-usage']});
const variants=[
  {name:'baseline',mode:'baseline'},
  {name:'low-quality',mode:'low'},
  {name:'no-terrain',mode:'no-terrain'},
  {name:'no-terrain-no-hillshade',mode:'no-terrain-no-hillshade'}
];
const out=[];

for(const variant of variants){
  const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1,serviceWorkers:'block'});
  const page=await context.newPage();
  const cdp=await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:40,downloadThroughput:10*1024*1024/8,uploadThroughput:2*1024*1024/8,connectionType:'wifi'});
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:2});
  await page.addInitScript((mode)=>{
    window.__iso={longTasks:[],paints:{}};
    try{new PerformanceObserver(l=>{for(const e of l.getEntries())window.__iso.longTasks.push({start:e.startTime,duration:e.duration});}).observe({type:'longtask',buffered:true});}catch{}
    try{new PerformanceObserver(l=>{for(const e of l.getEntries())window.__iso.paints[e.name]=e.startTime;}).observe({type:'paint',buffered:true});}catch{}
    if(mode==='low'){
      try{Object.defineProperty(navigator,'hardwareConcurrency',{configurable:true,get:()=>2});}catch{}
      try{Object.defineProperty(navigator,'deviceMemory',{configurable:true,get:()=>2});}catch{}
    }
    if(mode.startsWith('no-terrain')){
      let current;
      try{
        Object.defineProperty(window,'maplibregl',{configurable:true,get(){return current;},set(v){
          current=v;
          if(!v?.Map)return;
          const Native=v.Map;
          class QaMap extends Native{
            constructor(options={}){
              let style=options.style;
              if(style&&typeof style==='object'){
                style={...style,layers:Array.isArray(style.layers)?style.layers.map(x=>({...x})):style.layers};
                delete style.terrain;
                if(mode==='no-terrain-no-hillshade'&&Array.isArray(style.layers))style.layers=style.layers.filter(l=>l.type!=='hillshade');
              }
              super({...options,style});
            }
            setTerrain(){return this;}
          }
          try{v.Map=QaMap;}catch{}
        }});
      }catch{}
    }
  },variant.mode);
  const t0=Date.now(); let error=null;
  try{await page.goto(url,{waitUntil:'load',timeout:45000});}catch(e){error=String(e);}
  let canvasMs=null;
  if(!error){const c0=Date.now();try{await page.waitForFunction(()=>{const c=document.querySelector('canvas.maplibregl-canvas');return !!c&&c.width>0&&c.height>0;},{timeout:30000});canvasMs=Date.now()-t0;}catch{} await page.waitForTimeout(16000);}
  const metrics=await page.evaluate(()=>{
    const q=window.__iso||{}; const tasks=q.longTasks||[];
    return {version:window.ALAN_MAP_DATA?.version||null,paints:q.paints||{},longTaskCount:tasks.length,longTaskTotalMs:tasks.reduce((s,e)=>s+e.duration,0),maxLongTaskMs:tasks.reduce((m,e)=>Math.max(m,e.duration),0),worst:[...tasks].sort((a,b)=>b.duration-a.duration).slice(0,5),demDiag:window.ALAN_MAP_DEM_LOD_DIAGNOSTICS?.()||null,appPerf:window.ALAN_MAP_PERFORMANCE_DIAGNOSTICS?.()||null};
  }).catch(()=>({}));
  out.push({variant:variant.name,error,canvasMs,wallMs:Date.now()-t0,...metrics});
  await context.close();
}
await browser.close();
console.log('QA_ISOLATION_JSON_START');
console.log(JSON.stringify(out,null,2));
console.log('QA_ISOLATION_JSON_END');
