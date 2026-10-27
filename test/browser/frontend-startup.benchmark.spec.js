import {test,expect} from '@playwright/test';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {buildBrowser} from '../../scripts/browser-build.js';
import {createApplicationAssets} from '../../src/application-assets.js';
import {createNotebook} from '../../src/model.js';
import {clearVault} from '../../src/encryption.js';
import {startServer} from '../../src/server.js';
import {encryptedFixture} from './encrypted-fixture.js';

const enabled=process.env.OBSERVANDA_FRONTEND_BENCHMARK==='1';
const cpu=()=>os.cpus().reduce((total,item)=>({idle:total.idle+item.times.idle,total:total.total+Object.values(item.times).reduce((a,b)=>a+b,0)}),{idle:0,total:0});
const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1];

// Opt in with declared hardware/storage budgets. A cache-cold browser against
// a running local service is not a cold desktop process or network-storage test.
test('compiled authenticated frontend meets declared repeated cold and warm cache budgets',async({page,browserName},info)=>{
 test.skip(!enabled,'Explicit frontend measurement profile required');
 expect(browserName).toBe('chromium');
 const samples=Number(process.env.OBSERVANDA_FRONTEND_SAMPLES??20),coldBudget=Number(process.env.OBSERVANDA_FRONTEND_COLD_P95_MS),warmBudget=Number(process.env.OBSERVANDA_FRONTEND_WARM_P95_MS);
 expect(Number.isSafeInteger(samples)&&samples>=20&&samples<=200).toBe(true);
 for(const value of [coldBudget,warmBudget])expect(Number.isFinite(value)&&value>0&&value<=60000).toBe(true);
 test.setTimeout(Math.max(120000,samples*(coldBudget+warmBudget)*3));
 const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-frontend-benchmark-')),errors=[],rows=[];
 let fixture,app,cdp,compiled;
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  globalThis.frontendLongTasks=[];
  new PerformanceObserver(list=>{for(const item of list.getEntries())if(globalThis.frontendLongTasks.length<1000)globalThis.frontendLongTasks.push(item.duration);}).observe({type:'longtask',buffered:true});
 });
 try{
  const out=path.join(directory,'browser');compiled=await buildBrowser({out});
  const book=createNotebook('Frontend measurement');fixture=await encryptedFixture(directory,book);
  app=await startServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,preferencesFile:path.join(directory,'preferences.json'),port:0,browserAssets:await createApplicationAssets({builtDirectory:pathToFileURL(out+path.sep)})});
  const workspaceName=path.basename(fixture.workspace.root);
  await page.goto(app.url);await expect(page.locator('.workspace-name')).toHaveText(workspaceName);
  cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');
  const metrics=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(item=>[item.name,item.value]));
  const measure=async(kind,iteration)=>{
   await page.goto('about:blank');
   if(kind==='cold')await cdp.send('Network.clearBrowserCache');
   const load=cpu(),started=performance.now();
   await page.goto(app.url);await expect(page.locator('.workspace-name')).toHaveText(workspaceName);await expect(page.getByRole('button',{name:'Menu',exact:true})).toBeVisible();
   const elapsedMs=performance.now()-started,after=await metrics(),end=cpu(),total=end.total-load.total;
   const resources=await page.evaluate(()=>{
    const files=performance.getEntriesByType('resource').filter(item=>new URL(item.name).pathname.startsWith('/assets/'));
    return {assetRequests:files.length,transferBytes:files.reduce((sum,item)=>sum+item.transferSize,0),decodedBytes:files.reduce((sum,item)=>sum+item.decodedBodySize,0),longTasks:globalThis.frontendLongTasks};
   });
   // Preserve raw CDP totals; navigation may replace the renderer process, so
   // subtraction across navigations would invent per-navigation CPU timings.
   rows.push({kind,iteration,elapsedMs,...resources,cdpScriptDurationSeconds:after.ScriptDuration,cdpTaskDurationSeconds:after.TaskDuration,rendererHeapBytes:after.JSHeapUsedSize,serverRssBytes:process.memoryUsage().rss,availableMemoryBytes:os.freemem(),hostBusyFraction:total>0?1-(end.idle-load.idle)/total:null});
  };
  for(let i=0;i<samples;i++){await measure('cold',i);await measure('warm',i);}
  expect(errors).toEqual([]);
  for(const kind of ['cold','warm']){
   const values=rows.filter(row=>row.kind===kind),times=values.map(row=>row.elapsedMs);
   expect(values.every(row=>row.assetRequests>0)).toBe(true);
   if(kind==='warm')expect(values.every(row=>row.transferBytes===0)).toBe(true);
   expect(percentile(times,.95),kind+' cache p95').toBeLessThanOrEqual(kind==='cold'?coldBudget:warmBudget);
  }
 }finally{
  const summary=Object.fromEntries(['cold','warm'].map(kind=>{const values=rows.filter(row=>row.kind===kind).map(row=>row.elapsedMs);return [kind,{samples:values.length,p95Ms:values.length?percentile(values,.95):null,p99Ms:values.length?percentile(values,.99):null,budgetP95Ms:kind==='cold'?coldBudget:warmBudget}];}));
  const report={format:1,scope:'Authenticated frontend; cold and warm browser caches; running local service and warm owner; shared host',platform:process.platform,arch:process.arch,node:process.versions.node,browser:page.context().browser()?.version(),cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,totalMemoryBytes:os.totalmem(),initialJavaScriptBytes:compiled?.initialJavaScriptBytes,initialJavaScriptFiles:compiled?.initialJavaScriptFiles,summary,rows,errors};
  await info.attach('frontend-startup.json',{body:JSON.stringify(report,null,2),contentType:'application/json'});
  console.info('Frontend startup '+JSON.stringify(summary));
  await cdp?.detach();await app?.close();if(fixture)clearVault(fixture.vault);
  if(path.dirname(directory)!==parent||!path.basename(directory).startsWith('observanda-frontend-benchmark-'))throw Error('Unexpected disposable directory');
  await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
});
