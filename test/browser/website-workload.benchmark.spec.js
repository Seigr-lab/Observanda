import {test,expect} from '@playwright/test';
import {EventEmitter} from 'node:events';
import {mkdir,mkdtemp,readFile,realpath,rm} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {createNotebook} from '../../src/model.js';
import {clearVault} from '../../src/encryption.js';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {componentOperation} from '../../src/website-component-storage.js';
import {websiteFilesHttp} from '../../src/website-files-http.js';
import {WebsiteFilesCandidate} from '../../src/website-files-candidate.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';

// Opt in with an explicit workload profile and adopted budgets. The fixture
// is generated through the website store; each interaction is measured on a
// shared host and reported with its raw samples. No budget is assumed.
const enabled=process.env.OBSERVANDA_WEBSITE_BENCHMARK==='1';
const profiles={
 hobby:{pages:6,pictures:12,sections:30,largeSections:120,components:0,tables:0,tableRows:0},
 team:{pages:40,pictures:60,sections:40,largeSections:400,components:100,tables:4,tableRows:80},
 lab:{pages:200,pictures:300,sections:40,largeSections:1500,components:100,tables:20,tableRows:200},
};
const budgetNames=['EDIT','SELECT','SAVE','EXPORT','OVERVIEW','COMPONENT'];
const percentile=(values,p)=>{const sorted=[...values].sort((a,b)=>a-b);return sorted.length?sorted[Math.ceil(sorted.length*p)-1]:null;};
const summary=values=>({samples:values.length,p50Ms:percentile(values,.5),p95Ms:percentile(values,.95),maxMs:values.length?Math.max(...values):null});

function sectionHTML(page,i){return '<section id="s'+i+'"><h2>Station '+page+'.'+i+'</h2><p>Dissolved oxygen 7.'+(i%10)+' mg L<sup>−1</sup> at '+(i%50)+' m.</p></section>';}
function tableHTML(rows){
 return '<table><caption>Nutrient results</caption><thead><tr><th scope="col">Station</th>'+Array.from({length:11},(_,i)=>'<th scope="col">Assay '+(i+1)+'</th>').join('')+'</tr></thead><tbody>'+
  Array.from({length:rows},(_,r)=>'<tr><th scope="row">S'+r+'</th>'+Array.from({length:11},(_,c)=>'<td>'+((r*11+c)%97)/10+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
}
function pageHTML(title,sections,{picture,table,page}={}){
 return '<!doctype html><html lang="en"><head><title>'+title+'</title><link rel="stylesheet" href="style.css"></head><body><main><h1>'+title+'</h1><section id="probe-section"><p id="probe">Calibration.</p></section>'+
  (picture?'<figure><img src="'+picture+'" alt="Plate"><figcaption>Plate</figcaption></figure>':'')+(table?tableHTML(table):'')+
  Array.from({length:sections},(_,i)=>sectionHTML(page,i)).join('')+'</main></body></html>';
}

test('website editing, saving, delivery and component updates meet the declared workload budgets',async({page},info)=>{
 test.skip(!enabled,'Explicit website workload profile required');
 const profileName=process.env.OBSERVANDA_WEBSITE_PROFILE??'hobby',profile=profiles[profileName],samples=Number(process.env.OBSERVANDA_WEBSITE_SAMPLES??20);
 expect(profile,'profile').toBeTruthy();expect(Number.isSafeInteger(samples)&&samples>=20&&samples<=200).toBe(true);
 const budgets=Object.fromEntries(budgetNames.map(name=>[name.toLowerCase(),Number(process.env['OBSERVANDA_WEBSITE_'+name+'_P95_MS'])]));
 for(const [name,value] of Object.entries(budgets))expect(Number.isFinite(value)&&value>0&&value<=600000,name+' budget').toBe(true);
 test.setTimeout(3600000);page.setDefaultTimeout(30000);
 const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-website-workload-')),previous=process.env.OBSERVANDA_DATABASE_URL;
 const rows={edit:[],select:[],save:[],export:[],overview:[],component:[],cancel:[]},errors=[];let fixture,app,setupMs,openMs,heap=0,memory={rss:0},io;
 page.on('pageerror',error=>errors.push(error.message));
 try{
  const out=path.join(directory,'publication');await mkdir(out);
  fixture=await encryptedFixture(directory,createNotebook('Workload'));
  const store=new WebsiteFileStore(fixture.workspace),siteId=randomUUID(),png=await readFile(new URL('../../src/preview-assets/image.png',import.meta.url));
  const started=performance.now(),files=new Map([['style.css','body{font:16px/1.5 system-ui}main{max-width:60rem;margin:auto}table{border-collapse:collapse}td,th{padding:2px 6px}']]);
  const pictures=Array.from({length:profile.pictures},(_,i)=>'pictures/'+randomUUID()+'.png');
  files.set('index.html',pageHTML('Station register',profile.largeSections,{page:0}));
  for(let i=1;i<profile.pages;i++)files.set('stations/page-'+i+'.html',pageHTML('Stations '+i,profile.sections,{page:i,table:i<=profile.tables?profile.tableRows:0}));
  let state=await store.importFiles(siteId,{name:'Workload '+profileName,files});
  // Pictures enter through the ordinary save path, one page at a time.
  for(let i=0;i<pictures.length;i++){
   const pagePath=i%profile.pages===0?'index.html':'stations/page-'+(i%profile.pages)+'.html',opened=await store.open(siteId,{path:pagePath});
   state=await store.save(siteId,{expectedRevision:opened.site.revision,path:pagePath,html:opened.html.replace('</main>','<figure><img src="'+'../'.repeat(pagePath.split('/').length-1)+pictures[i]+'" alt="Plate '+i+'"></figure></main>'),css:opened.css,receivePictures:async function*(){yield {name:pictures[i],bytes:png};}});
  }
  let component=null;
  if(profile.components){
   const opened=await store.open(siteId,{path:'stations/page-1.html'});
   state=await componentOperation(store,'create',siteId,{path:'stations/page-1.html',expectedRevision:opened.site.revision,blockPath:'0/1',name:'Calibration legend'});
   component=(await componentOperation(store,'list',siteId,{expectedRevision:state.site.revision})).items[0];
   for(let i=1;i<profile.components;i++){
    const target=profile.pages>1?'stations/page-'+(1+i%(profile.pages-1))+'.html':'index.html';
    state=await componentOperation(store,'insert',siteId,{expectedRevision:state.site.revision,path:target,component:component.id,position:'end'});
   }
  }
  setupMs=performance.now()-started;
  const http=async(operation,data)=>{let answer;await websiteFilesHttp({method:'POST',headers:{}},new EventEmitter(),{workspace:fixture.workspace,url:new URL('/api/website-files/'+operation,'http://localhost'),body:async()=>({siteId,...data}),check:async()=>{},json:value=>{answer=value;}});return answer;};
  const timed=async(kind,task)=>{const t=performance.now();const result=await task();rows[kind].push(performance.now()-t);memory.rss=Math.max(memory.rss,process.memoryUsage().rss);return result;};

  process.env.OBSERVANDA_DATABASE_URL='postgresql://unavailable:unavailable@127.0.0.1:1/unavailable';
  app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,preferencesFile:path.join(directory,'preferences.json'),port:0});
  const opening=performance.now();await page.goto(app.origin+'/?view=website#'+app.launchToken);
  const canvas=page.frameLocator('#website-files-canvas'),probe=canvas.locator('#probe'),status=page.locator('[data-website-files-status]');
  await expect(probe).toBeVisible();openMs=performance.now()-opening;
  const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');
  const sampleHeap=async()=>{const metric=(await cdp.send('Performance.getMetrics')).metrics.find(row=>row.name==='JSHeapUsedSize');heap=Math.max(heap,metric?.value??0);};

  // Key press until the editor has rendered two frames after the edit.
  // The interval includes Playwright round trips.
  await probe.click();await page.keyboard.press('End');let expected=await probe.textContent();
  for(let i=0;i<samples;i++){
   const key=String.fromCharCode(97+i%26);expected+=key;
   const begin=performance.now();await page.keyboard.press(key);
   // The canvas frame may not receive animation frames while unfocused by the
   // compositor; the editor document's next two frames bound the paint.
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const shown=await probe.textContent();
   expect(shown,'edited text').toBe(expected);
   rows.edit.push(performance.now()-begin);
  }
  await sampleHeap();console.info('Website workload: edit samples complete');

  // Selecting a section until the editor names it in the selection trail.
  for(let i=0;i<samples;i++){
   const index=Math.floor((i+1)*profile.largeSections/(samples+1)),section=canvas.locator('#s'+index);
   await section.scrollIntoViewIfNeeded();
   await timed('select',async()=>{await section.locator('h2').click();await expect(page.locator('[data-layer-trail] [aria-current]')).toContainText('Station 0.'+index,{timeout:15000});});
  }
  await sampleHeap();console.info('Website workload: selection samples complete');

  // Saving one paragraph edit of the large page.
  for(let i=0;i<samples;i++){
   await probe.click();await page.keyboard.press('End');await page.keyboard.type('.');
   await timed('save',async()=>{await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(status).toHaveText('Website saved.');});
  }
  await sampleHeap();

  const revision=()=>store.open(siteId).then(value=>value.site.revision);
  const ioBefore=process.resourceUsage();
  for(let i=0;i<samples;i++){
   const current=await revision();
   await timed('export',()=>WebsiteFilesCandidate.open(store,siteId,current).then(candidate=>candidate.verify()));
   await timed('overview',()=>http('release/overview',{expectedRevision:current}));
  }
  const ioAfter=process.resourceUsage();io={fsReadOperations:ioAfter.fsRead-ioBefore.fsRead,fsWriteOperations:ioAfter.fsWrite-ioBefore.fsWrite};

  // Cancelling a full verification promptly releases the request.
  for(let i=0;i<Math.min(samples,20);i++){
   const controller=new AbortController(),current=await revision(),candidate=await WebsiteFilesCandidate.open(store,siteId,current);
   const pending=candidate.verify({signal:controller.signal});setTimeout(()=>controller.abort(),5);
   const t=performance.now();await pending.catch(()=>{});rows.cancel.push(performance.now()-t);
  }

  if(component){
   for(let i=0;i<Math.min(samples,20);i++){
    const current=await revision();
    await timed('component',()=>componentOperation(store,'update',siteId,{expectedRevision:current,path:'stations/page-1.html',component:component.id,name:component.name,html:'<p>Calibration legend revision '+i+'.</p>'}));
   }
  }
  const plan=await http('folder/plan',{expectedRevision:await revision(),directory:out});
  const deliveryStart=performance.now();await http('folder/apply',{expectedRevision:await revision(),directory:out,id:plan.id,reviewed:true});
  rows.delivery=[performance.now()-deliveryStart];
  expect(errors).toEqual([]);
  for(const name of ['edit','select','save','export','overview',...(component?['component']:[])])
   expect(percentile(rows[name],.95),name+' p95').toBeLessThanOrEqual(budgets[name]);
 }finally{
  const report={format:1,profile:profileName,shape:profile,samples,budgets,setupMs,openMs,
   results:Object.fromEntries(Object.entries(rows).map(([name,values])=>[name,{...summary(values),raw:values.map(value=>Math.round(value*10)/10)}])),
   peakRendererHeapBytes:heap,peakServerRssBytes:memory.rss,io,
   machine:{platform:process.platform,arch:process.arch,node:process.versions.node,cpus:os.cpus().length,cpuModel:os.cpus()[0]?.model,memoryBytes:os.totalmem()},
   scope:'In-process service and Chromium on one host. Edit latency is a key press until the editor document renders two frames after it, including Playwright round trips. Selection and save include Playwright round trips. Export is the complete edition verification; overview compares it with the delivered inventory.'};
  await info.attach('website-workload-'+profileName+'.json',{body:JSON.stringify(report,null,2),contentType:'application/json'});
  if(process.env.OBSERVANDA_WEBSITE_REPORT)await import('node:fs/promises').then(fs=>fs.writeFile(process.env.OBSERVANDA_WEBSITE_REPORT,JSON.stringify(report,null,2)));
  console.info('Website workload '+profileName+' '+JSON.stringify(Object.fromEntries(Object.entries(report.results).map(([name,value])=>[name,{p50:value.p50Ms&&Math.round(value.p50Ms),p95:value.p95Ms&&Math.round(value.p95Ms),max:value.maxMs&&Math.round(value.maxMs)}]))));
  if(previous===undefined)delete process.env.OBSERVANDA_DATABASE_URL;else process.env.OBSERVANDA_DATABASE_URL=previous;
  try{await app?.close();if(fixture)await clearVault(fixture.vault);}
  finally{
   if(path.dirname(directory)!==parent||!path.basename(directory).startsWith('observanda-website-workload-'))throw Error('Unexpected disposable directory');
   await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
 }
});
