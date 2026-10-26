import {test,expect} from '@playwright/test';
import {mkdir,open,writeFile,realpath,lstat,rm} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {desktopFixture} from './fixture.js';
import {desktopAccess} from './access.js';

const MiB=1024*1024,hash=value=>createHash('sha256').update(value).digest('hex');
const samePath=(left,right)=>process.platform==='win32'?path.resolve(left).toLowerCase()===path.resolve(right).toLowerCase():path.resolve(left)===path.resolve(right);
async function sourceFiles(parent){
 const directory=path.join(parent,'Synthetic proposal'),files=[];await mkdir(directory);
 // Small files first leave observable source verification before the large
 // capture. Cancellation is based on actual job progress, never a fixed delay.
 for(let index=0;index<257;index++){
  const file={id:randomUUID(),path:index===256?'capture.bin':'sample-'+String(index).padStart(3,'0')+'.bin',size:index===256?64*MiB:4096,sha256:'',provenance:'Synthetic acceptance source'},digest=createHash('sha256'),handle=await open(path.join(directory,file.path),'wx',0o600);
  try{
   const buffer=Buffer.alloc(Math.min(MiB,file.size),index%251+1);
   for(let position=0;position<file.size;position+=buffer.length){const bytes=buffer.subarray(0,Math.min(buffer.length,file.size-position));await handle.writeFile(bytes);digest.update(bytes);}await handle.sync();
  }finally{await handle.close();}
  file.sha256=digest.digest('hex');files.push(file);
 }
 return {directory,files,bytes:files.reduce((sum,file)=>sum+file.size,0)};
}

// Uses the selected desktop's authenticated local-folder API. Application
// storage modules and private helpers are deliberately absent from this test.
// OBSERVANDA_DESKTOP_EXECUTABLE selects an installed application;
// OBSERVANDA_ACCEPTANCE_STORAGE_ROOT selects its disposable storage parent.
test('desktop local-folder intake resumes verified work and retains every original exactly once',async({},info)=>{
 test.setTimeout(30*60*1000);
 const fixture=await desktopFixture('observanda-desktop-local-intake-'),access=desktopAccess(),errors=[];
 const metrics={files:257,bytes:65*MiB,packaged:!!fixture.packaged,storage:process.env.OBSERVANDA_ACCEPTANCE_STORAGE_ROOT?'configured parent':'temporary local storage',qualification:'Elapsed API phases and sampled progress/staged-original checkpoints. Update counts are lower bounds, not isolated persistence timings. The public API does not expose internal source-verification receipts; native tests prove their reuse. Other host/storage activity is not controlled.',phaseMs:{},statusReads:{count:0,totalMs:0,maxMs:0},observedJobUpdates:0,observations:[]};
 let app,page,storageDirectory,storageCreated=false,externalParent,command,intakeRoute,stageJobId,maxStageAttempt=0,lastObservation='',lastJobUpdate='',lastStage='',nextCheckpointLog=32;const started=performance.now();
 const call=(route,data)=>page.evaluate(async({route,data})=>{
  // First use is after setup; a renderer restart discards this cached context.
  const context=globalThis.observandaLocalIntakeAcceptanceContext??=(await(await fetch('/api/storage')).json()).contextId;
  const response=await fetch(route,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Observanda-Workspace':context,'X-Observanda-Wait':'1'},...(data===undefined?{}:{body:JSON.stringify(data)}),signal:AbortSignal.timeout(300000)});
  if(!response.ok)throw Error(route+' returned '+response.status+': '+await response.text());return response.json();
 },{route,data});
 const watch=async()=>{page=await app.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',error=>errors.push(error.message));await page.waitForFunction(()=>['setup','access','workspace'].includes(document.documentElement.dataset.appMode),null,{timeout:60000});};
 const observed=value=>{
  if(value.job?.id===stageJobId)maxStageAttempt=Math.max(maxStageAttempt,value.job.attempt);
  const update=value.job?value.job.id+':'+value.job.updatedAt:'';if(update&&update!==lastJobUpdate){metrics.observedJobUpdates++;lastJobUpdate=update;}
  const observation={state:value.state,stagedFiles:value.stagedFiles,job:value.job?{id:value.job.id,type:value.job.type,state:value.job.state,attempt:value.job.attempt,progress:value.job.progress}:null},key=JSON.stringify(observation);
  if(key!==lastObservation){lastObservation=key;if(metrics.observations.length<1024)metrics.observations.push({elapsedMs:performance.now()-started,...observation});}
  const stage=value.job?[value.job.type,value.job.state,value.job.progress.stage].join(' / '):value.state;if(stage!==lastStage){lastStage=stage;console.log('Local intake stage: '+stage);}
  if(value.stagedFiles>=nextCheckpointLog){console.log('Local intake durable originals: '+value.stagedFiles+' / '+metrics.files);nextCheckpointLog=(Math.floor(value.stagedFiles/32)+1)*32;}
  return value;
 };
 const status=async()=>{const at=performance.now(),value=await call(intakeRoute+'status',command),milliseconds=performance.now()-at;metrics.statusReads.count++;metrics.statusReads.totalMs+=milliseconds;metrics.statusReads.maxMs=Math.max(metrics.statusReads.maxMs,milliseconds);return observed(value);};
 const waitFor=async(predicate,{timeout=10*60*1000,interval=750,allowCancelled=false}={})=>{
  const until=performance.now()+timeout;let value;
  while(performance.now()<until){value=await status();if(predicate(value))return value;if(value.job?.state==='failed'||value.job?.state==='cancelled'&&!allowCancelled)throw Error('Local intake '+value.job.state+': '+JSON.stringify({code:value.job.error,message:value.job.message}));await delay(interval);}
  throw Error('Local intake did not reach the required state: '+JSON.stringify({state:value?.state,stagedFiles:value?.stagedFiles,job:value?.job}));
 };
 try{
  if(process.env.OBSERVANDA_ACCEPTANCE_STORAGE_ROOT){expect(path.isAbsolute(process.env.OBSERVANDA_ACCEPTANCE_STORAGE_ROOT)).toBe(true);externalParent=await realpath(process.env.OBSERVANDA_ACCEPTANCE_STORAGE_ROOT);storageDirectory=path.join(externalParent,'observanda-local-intake-'+randomUUID());}
  else storageDirectory=path.join(await realpath(fixture.directory),'storage');
  await mkdir(storageDirectory);storageCreated=true;expect(samePath(await realpath(storageDirectory),storageDirectory)).toBe(true);expect((await lstat(storageDirectory)).isSymbolicLink()).toBe(false);
  const generation=performance.now(),sources=await sourceFiles(storageDirectory);metrics.phaseMs.generateSources=performance.now()-generation;
  expect(sources.files).toHaveLength(257);expect(sources.bytes).toBe(metrics.bytes);
  app=await fixture.start();await watch();expect(await app.evaluate(({app})=>app.isPackaged)).toBe(!!fixture.packaged);metrics.appVersion=await app.evaluate(({app})=>app.getVersion());
  console.log(fixture.packaged?'Local intake acceptance: selected packaged executable.':'Local intake acceptance: source Electron; installed executable not qualified.');
  await expect(page.getByRole('heading',{name:'Create a workspace',exact:true})).toBeVisible({timeout:60000});
  await page.getByLabel('Workspace name',{exact:true}).fill('Local intake acceptance');await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByLabel('Create in',{exact:true}).fill(storageDirectory);await access.setup(page);
  // Network storage may outlast a DOM assertion's default setup window.
  // Require the actual service response before looking for the ready UI.
  const setupStarted=performance.now(),creation=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/notebook/create'&&response.request().method()==='POST',{timeout:300000});void creation.catch(()=>{});
  console.log('Local intake acceptance: creating workspace.');
  await page.getByRole('button',{name:'Create workspace',exact:true}).click();const created=await creation;metrics.phaseMs.workspaceCreationResponse=performance.now()-setupStarted;metrics.workspaceCreationStatus=created.status();
  console.log('Local intake workspace response: '+created.status()+' after '+metrics.phaseMs.workspaceCreationResponse.toFixed(1)+' ms.');
  if(created.status()!==201)throw Error('Workspace creation returned '+created.status()+': '+await created.text());
  await expect(page.locator('.workspace-name')).toHaveText('Local intake acceptance',{timeout:60000});metrics.phaseMs.workspaceSetup=performance.now()-setupStarted;
  console.log('Local intake acceptance: workspace ready; creating project.');const projectStarted=performance.now();
  const {project}=await call('/api/projects/create',{id:randomUUID(),...access.credentials,project:{id:randomUUID(),title:'Local acquisition project',parentId:null,description:'',share:false,logoId:null}}),projectRoute='/api/projects/'+project.projectId;
  metrics.phaseMs.projectCreation=performance.now()-projectStarted;console.log('Local intake project created after '+metrics.phaseMs.projectCreation.toFixed(1)+' ms.');
  await call(projectRoute+'/access/unlock',{...access.credentials,recovery:''});
  console.log('Local intake acceptance: creating lab book.');const bookStarted=performance.now();
  const {book}=await call(projectRoute+'/lab-books/create',{id:randomUUID(),...access.credentials,book:{id:randomUUID(),projectId:project.projectId,title:'Local acquisition observations'}}),owner=projectRoute+'/lab-books/'+book.labBookId,materials=owner+'/research/materials/';intakeRoute=owner+'/v1/intake/';
  metrics.phaseMs.labBookCreation=performance.now()-bookStarted;console.log('Local intake lab book created after '+metrics.phaseMs.labBookCreation.toFixed(1)+' ms.');
  const unlockOwners=async()=>{await call(projectRoute+'/access/unlock',{...access.credentials,recovery:''});await call(owner+'/access/unlock',{...access.credentials,recovery:''});};await unlockOwners();
  const now=new Date().toISOString(),record={id:randomUUID(),notebookId:book.labBookId,type:'experiment',title:'Synthetic local acquisition',body:'Disposable source verification.',contributors:[],relations:[],tags:[],occurredOn:'2026-10-01',createdAt:now,updatedAt:now,share:false,figures:[],status:'draft',attachments:[],sections:[]};
  await call(owner+'/research/records/save',{workspaceId:book.namespaceId,changes:[{id:record.id,expectedRevision:null,record}]});
  const selected=await call(owner+'/workspace/read/selection',{workspaceId:book.namespaceId,ids:[record.id]}),manifest={version:1,id:randomUUID(),workspaceId:book.namespaceId,recordId:record.id,expectedRevision:selected.recordRevisions[record.id],purpose:'evidence',title:'Synthetic local-folder proposal',files:sources.files,analyses:[],source:{revision:'synthetic-acquisition',sha256:hash('synthetic-acquisition')},verification:{tool:'synthetic-validator',version:'1',sha256:hash('synthetic-validator'),statement:'Synthetic file identity and exact bytes only.'}};
  await writeFile(path.join(sources.directory,'intake.observanda.json'),JSON.stringify(manifest));command={version:1,workspaceId:book.namespaceId,recordId:record.id,id:manifest.id,source:sources.directory};
  console.log('Local intake acceptance: requesting preview of 257 files (65 MiB).');
  let at=performance.now();const preview=await call(intakeRoute+'preview',command);metrics.phaseMs.previewValidation=performance.now()-at;expect(preview.files.map(({id,size,sha256})=>({id,size,sha256}))).toEqual(sources.files.map(({id,size,sha256})=>({id,size,sha256})));command.expectedPin=preview.pin;
  console.log('Local intake preview received after '+metrics.phaseMs.previewValidation.toFixed(1)+' ms; requesting stage admission.');
  at=performance.now();const admitted=await call(intakeRoute+'stage',command);metrics.phaseMs.stageAdmissionValidation=performance.now()-at;expect(admitted.state).toBe('staging');stageJobId=admitted.job.id;console.log('Local intake stage admitted after '+metrics.phaseMs.stageAdmissionValidation.toFixed(1)+' ms.');observed(admitted);
  const firstGroupBytes=sources.files.slice(0,32).reduce((sum,file)=>sum+file.size,0);
  const verifying=await waitFor(value=>{const progress=value.job?.progress;return value.job?.state==='running'&&progress.stage==='validating'&&(progress.unit==='files'?progress.done>=32:progress.unit==='bytes'&&progress.done>=firstGroupBytes)&&value.stagedFiles===0;},{timeout:120000,interval:250});
  metrics.interrupted={jobId:verifying.job.id,attempt:verifying.job.attempt,progress:verifying.job.progress,stagedFiles:verifying.stagedFiles,firstGroupFiles:32,firstGroupBytes};expect(verifying.job.id).toBe(stageJobId);
  at=performance.now();await call(intakeRoute+'cancel',command);const cancelled=await waitFor(value=>value.job?.state==='cancelled',{timeout:120000,allowCancelled:true});metrics.phaseMs.cancelVerification=performance.now()-at;expect(cancelled.job.id).toBe(stageJobId);expect(cancelled.stagedFiles).toBeLessThan(sources.files.length);expect((await call(materials+'list',{recordId:record.id,limit:50})).items).toEqual([]);
  console.log('Local intake acceptance: verifying progress observed and cancelled; restarting the same proposal.');
  await fixture.close(app);app=null;app=await fixture.start();await watch();if(await page.getByRole('heading',{name:'Unlock workspace',exact:true}).isVisible())await access.unlock(page);await expect(page.locator('.workspace-name')).toHaveText('Local intake acceptance',{timeout:60000});await unlockOwners();
  const reopened=await status();expect(reopened.job.state).toBe('cancelled');expect(reopened.job.id).toBe(stageJobId);expect(reopened.stagedFiles).toBe(cancelled.stagedFiles);
  at=performance.now();const resumed=await call(intakeRoute+'resume',command);expect(resumed.job.id).toBe(stageJobId);const prepared=await waitFor(value=>value.state==='prepared');metrics.phaseMs.resumeVerificationAndStaging=performance.now()-at;
  expect(maxStageAttempt).toBeGreaterThan(verifying.job.attempt);metrics.resumedStageAttempt=maxStageAttempt;expect(prepared.stagedFiles).toBe(257);expect(prepared.receipt).toBeNull();expect((await call(materials+'list',{recordId:record.id,limit:50})).items).toEqual([]);expect((await call(intakeRoute+'stage',command)).stagedFiles).toBe(257);
  at=performance.now();const applying=await call(intakeRoute+'apply',command);metrics.phaseMs.applyAdmission=performance.now()-at;observed(applying);expect(applying.job.type).toBe('intake.apply');const applyStarted=performance.now(),completed=await waitFor(value=>value.state==='completed');metrics.phaseMs.retainedVerificationAndFinalization=performance.now()-applyStarted;
  const receipt=completed.receipt;expect(receipt.files).toHaveLength(257);expect(new Set(receipt.files.map(file=>file.id)).size).toBe(257);expect(receipt.files.map(file=>file.id).sort()).toEqual(sources.files.map(file=>file.id).sort());expect(receipt.pin).toBe(preview.pin);expect((await call(intakeRoute+'apply',command)).receipt).toEqual(receipt);expect((await call(intakeRoute+'list',command)).items).toHaveLength(1);
  const cookies=await app.evaluate(({BrowserWindow},url)=>BrowserWindow.getAllWindows()[0].webContents.session.cookies.get({url}),page.url()),cookie=cookies.map(value=>value.name+'='+value.value).join('; '),context=await page.evaluate(()=>globalThis.observandaLocalIntakeAcceptanceContext),expected=new Map(sources.files.map(file=>[file.id,file]));
  console.log('Local intake acceptance: checking all 257 original downloads.');at=performance.now();let downloadedBytes=0,downloadedFiles=0;
  for(const ref of receipt.files){
   const source=expected.get(ref.id),doc=await call(materials+'read',{ref});expect(source).toBeTruthy();expect(doc.content.name).toBe(source.path);expect(doc.content.sha256).toBe(source.sha256);expect(doc.content.size).toBe(source.size);
   const response=await fetch(new URL(materials+'original/'+ref.id+'/'+ref.revision+'?context='+encodeURIComponent(context),page.url()),{headers:{Cookie:cookie},signal:AbortSignal.timeout(300000)});expect(response.ok).toBe(true);const digest=createHash('sha256');let bytes=0;for await(const chunk of response.body){bytes+=chunk.length;digest.update(chunk);}expect({size:bytes,sha256:digest.digest('hex')}).toEqual({size:source.size,sha256:source.sha256});downloadedBytes+=bytes;downloadedFiles++;expected.delete(ref.id);
   if(downloadedFiles%32===0||downloadedFiles===257)console.log('Local intake verified downloads: '+downloadedFiles+' / 257 ('+downloadedBytes+' bytes).');
  }
  metrics.phaseMs.downloadAndHashAllOriginals=performance.now()-at;metrics.downloadedBytes=downloadedBytes;metrics.uniqueOriginals=receipt.files.length;expect(expected.size).toBe(0);expect(downloadedBytes).toBe(sources.bytes);expect(errors).toEqual([]);
  console.log('Local intake acceptance: all 257 downloaded originals match their declared hashes and identities.');
 }catch(error){
  console.error('Local intake acceptance original failure: '+(error?.stack??String(error)));
  if(page&&!page.isClosed()&&command&&intakeRoute)await call(intakeRoute+'cancel',command).catch(()=>{});
  throw error;
 }finally{
  metrics.elapsedMs=performance.now()-started;metrics.observedStageWindows=[];
  for(const observation of metrics.observations){
   const stage=observation.job?observation.job.type+'/'+observation.job.progress.stage:observation.state,state=observation.job?.state??observation.state,attempt=observation.job?.attempt??null,last=metrics.observedStageWindows.at(-1);
   if(last?.stage===stage&&last.state===state&&last.attempt===attempt)last.lastObservedMs=observation.elapsedMs;
   else{if(last)last.nextStageObservedMs=observation.elapsedMs;metrics.observedStageWindows.push({stage,state,attempt,firstObservedMs:observation.elapsedMs,lastObservedMs:observation.elapsedMs});}
  }
  try{const metricsFile=info.outputPath('local-intake-recovery-metrics.json');await writeFile(metricsFile,JSON.stringify(metrics,null,2));await info.attach('local-intake-recovery-metrics',{path:metricsFile,contentType:'application/json'});console.log('Local intake acceptance phases: '+JSON.stringify({phaseMs:metrics.phaseMs,statusReads:metrics.statusReads,observedJobUpdates:metrics.observedJobUpdates,observedStageWindows:metrics.observedStageWindows,interrupted:metrics.interrupted,resumedStageAttempt:metrics.resumedStageAttempt,uniqueOriginals:metrics.uniqueOriginals}));}
  finally{
   await fixture.dispose(app);
   if(externalParent&&storageCreated){const resolved=await realpath(storageDirectory);expect(samePath(resolved,storageDirectory)).toBe(true);expect(samePath(path.dirname(resolved),externalParent)).toBe(true);expect(/^observanda-local-intake-[a-f0-9-]{36}$/.test(path.basename(resolved))).toBe(true);expect((await lstat(resolved)).isSymbolicLink()).toBe(false);await rm(resolved,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
  }
 }
});
