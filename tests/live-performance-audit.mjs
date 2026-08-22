import { chromium } from 'playwright';

const targets = [
  {name:'live',url:process.env.LIVE_URL || 'https://karachay-malkar.github.io/alania_map/'},
  {name:'local-7.3.3',url:process.env.LOCAL_URL || 'http://127.0.0.1:4173/'}
];
const browser = await chromium.launch({headless:true,args:['--disable-dev-shm-usage']});
const results=[];

async function audit(target){
  const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1,serviceWorkers:'block'});
  const page=await context.newPage();
  const cdp=await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:40,downloadThroughput:10*1024*1024/8,uploadThroughput:2*1024*1024/8,connectionType:'wifi'});
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:2});
  await page.addInitScript(()=>{
    window.__qaPerf={longTasks:[],paints:{},lcp:0,cls:0};
    try{new PerformanceObserver(l=>{for(const e of l.getEntries())window.__qaPerf.longTasks.push({start:e.startTime,duration:e.duration});}).observe({type:'longtask',buffered:true});}catch{}
    try{new PerformanceObserver(l=>{for(const e of l.getEntries())window.__qaPerf.paints[e.name]=e.startTime;}).observe({type:'paint',buffered:true});}catch{}
    try{new PerformanceObserver(l=>{const a=l.getEntries();if(a.length)window.__qaPerf.lcp=a[a.length-1].startTime;}).observe({type:'largest-contentful-paint',buffered:true});}catch{}
    try{new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput)window.__qaPerf.cls+=e.value;}).observe({type:'layout-shift',buffered:true});}catch{}
  });
  const consoleErrors=[]; const failedRequests=[];
  page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
  page.on('requestfailed',r=>failedRequests.push({url:r.url(),error:r.failure()?.errorText||'failed'}));

  const t0=Date.now(); let gotoError=null;
  try{await page.goto(target.url,{waitUntil:'domcontentloaded',timeout:45000});}catch(e){gotoError=String(e);}
  const domWallMs=Date.now()-t0;
  let mapReadyMs=null, idleMs=null;
  if(!gotoError){
    const r0=Date.now();
    try{await page.waitForFunction(()=>{const c=document.querySelector('canvas.maplibregl-canvas');return !!c&&c.width>0&&c.height>0;},{timeout:30000});mapReadyMs=domWallMs+(Date.now()-r0);}catch{}
    const i0=Date.now();
    try{await page.waitForFunction(()=>{const d=window.ALAN_MAP_PERFORMANCE_DIAGNOSTICS?.();return !!d&&(!d.networkGate||d.networkGate.active===0);},{timeout:20000});idleMs=(mapReadyMs??domWallMs)+(Date.now()-i0);}catch{}
    await page.waitForTimeout(1500);
  }
  const data=await page.evaluate(()=>{
    const n=performance.getEntriesByType('navigation')[0]; const q=window.__qaPerf||{};
    const resources=performance.getEntriesByType('resource').map(r=>({name:r.name,initiatorType:r.initiatorType,duration:r.duration,transferSize:r.transferSize||0,encodedBodySize:r.encodedBodySize||0,responseStart:r.responseStart,responseEnd:r.responseEnd}));
    return {version:window.ALAN_MAP_DATA?.version||window.ALAN_MAP_DEM_LOD_CONTRACT?.version||null,title:document.title,
      nav:n?{dns:n.domainLookupEnd-n.domainLookupStart,connect:n.connectEnd-n.connectStart,tls:n.secureConnectionStart>0?n.connectEnd-n.secureConnectionStart:0,ttfb:n.responseStart-n.requestStart,domContentLoaded:n.domContentLoadedEventEnd,load:n.loadEventEnd,responseEnd:n.responseEnd,transferSize:n.transferSize||0}:null,
      paints:q.paints||{},lcp:q.lcp||0,cls:q.cls||0,longTasks:q.longTasks||[],resources,
      demDiag:window.ALAN_MAP_DEM_LOD_DIAGNOSTICS?.()||window.ALAN_MAP_DEM_LOD_CONTRACT||null,
      appPerf:window.ALAN_MAP_PERFORMANCE_DIAGNOSTICS?.()||null};
  }).catch(()=>({version:null,title:null,nav:null,paints:{},lcp:0,cls:0,longTasks:[],resources:[],demDiag:null,appPerf:null}));
  const classify=u=>{const p=new URL(u,target.url).pathname;return p.includes('alan-dem')?'DEM':p.includes('alan-vector')?'vector':p.includes('snow')?'snow':p.endsWith('.js')?'JS':p.endsWith('.css')?'CSS':/\.(png|webp|jpg|jpeg|svg)$/i.test(p)?'images':'other';};
  const groups={}; for(const r of data.resources){const k=classify(r.name);const g=groups[k]||={requests:0,transferSize:0,encodedBodySize:0,totalDurationMs:0,maxDurationMs:0};g.requests++;g.transferSize+=r.transferSize;g.encodedBodySize+=r.encodedBodySize;g.totalDurationMs+=r.duration;g.maxDurationMs=Math.max(g.maxDurationMs,r.duration);groups[k]=g;}
  const cold={target:target.name,url:target.url,title:data.title,version:data.version,gotoError,domWallMs,mapReadyMs,idleMs,navigation:data.nav,paints:data.paints,lcp:data.lcp,cls:data.cls,longTaskCount:data.longTasks.length,longTaskTotalMs:data.longTasks.reduce((s,e)=>s+e.duration,0),worstLongTasks:[...data.longTasks].sort((a,b)=>b.duration-a.duration).slice(0,10),resourceGroups:groups,slowestResources:[...data.resources].sort((a,b)=>b.duration-a.duration).slice(0,20),totalResources:data.resources.length,totalTransferSize:data.resources.reduce((s,r)=>s+r.transferSize,0),totalEncodedBodySize:data.resources.reduce((s,r)=>s+r.encodedBodySize,0),consoleErrors,failedRequests,demDiag:data.demDiag,appPerf:data.appPerf};
  let warm=null;
  if(!gotoError){const w0=Date.now();await page.reload({waitUntil:'domcontentloaded',timeout:45000}).catch(()=>null);const warmDomWallMs=Date.now()-w0;let warmMapReadyMs=null;const wr=Date.now();try{await page.waitForFunction(()=>{const c=document.querySelector('canvas.maplibregl-canvas');return !!c&&c.width>0&&c.height>0;},{timeout:30000});warmMapReadyMs=warmDomWallMs+(Date.now()-wr);}catch{}await page.waitForTimeout(1000);const wn=await page.evaluate(()=>{const n=performance.getEntriesByType('navigation')[0];return n?{ttfb:n.responseStart-n.requestStart,domContentLoaded:n.domContentLoadedEventEnd,load:n.loadEventEnd,transferSize:n.transferSize||0}:null;}).catch(()=>null);warm={domWallMs:warmDomWallMs,mapReadyMs:warmMapReadyMs,navigation:wn};}
  results.push({cold,warm}); await context.close();
}
for(const t of targets)await audit(t); await browser.close();
console.log('QA_PERF_JSON_START'); console.log(JSON.stringify({profile:{viewport:'1440x900',cpuThrottle:2,latencyMs:40,downloadMbps:10,uploadMbps:2,cache:'cold + warm reload'},results},null,2)); console.log('QA_PERF_JSON_END');
