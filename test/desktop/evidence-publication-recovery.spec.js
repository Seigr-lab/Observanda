import {test,expect} from '@playwright/test';
import {mkdir,mkdtemp,open,realpath,rm} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {desktopFixture} from './fixture.js';
import {desktopAccess} from './access.js';

const MiB=1024*1024;
async function originals(parent){
 const directory=path.join(parent,'Synthetic evidence'),files=[];await mkdir(directory);
 for(let index=0;index<62;index++){
  const name='PRIVATE_ORIGINAL_'+String(index).padStart(2,'0')+'.bin',size=index===0?64*MiB:3*MiB/2,hash=createHash('sha256'),file=await open(path.join(directory,name),'wx');
  try{for(let offset=0;offset<size;offset+=MiB){const bytes=Buffer.alloc(Math.min(MiB,size-offset),index+1);bytes.write('WITHHELD_EVIDENCE_'+index+'_'+offset);await file.writeFile(bytes);hash.update(bytes);}}finally{await file.close();}
  files.push({name,size,sha256:hash.digest('hex')});
 }
 return {directory,files,bytes:files.reduce((sum,file)=>sum+file.size,0)};
}

// This runs the selected desktop executable through its authenticated service
// and visible controls. It imports no application storage implementation.
// Set OBSERVANDA_ACCEPTANCE_STORAGE_ROOT to an existing disposable storage
// parent to exercise network files while keeping Electron's profile local.
test('desktop resumes a large evidence folder and retains publication requests and seven review decisions across lost replies',async({},info)=>{
 test.setTimeout(20*60*1000);
 const fixture=await desktopFixture('observanda-desktop-evidence-publication-'),access=desktopAccess(),errors=[],metrics={files:62,customPages:121,decisions:7};
 let app,page,storageDirectory=null,externalParent=null,websiteId=null;
 const call=(route,data,site=null)=>page.evaluate(async({route,data,site})=>{
  // First called after workspace creation; each restart creates a new renderer.
  const context=globalThis.acceptanceWorkspaceContext??=(await(await fetch('/api/storage')).json()).contextId,response=await fetch(route,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Observanda-Workspace':context,'X-Observanda-Wait':'1',...(site?{'X-Observanda-Website':site}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
  if(!response.ok)throw Error(route+' returned '+response.status+': '+await response.text());return response.json();
 },{route,data,site});
 const watch=async()=>{page=await app.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',error=>errors.push(error.message));await page.waitForFunction(()=>['setup','access','workspace'].includes(document.documentElement.dataset.appMode),null,{timeout:60000});};
 const interruptWindow=async()=>{
  // Destroy only this fixture's windows. The real desktop closed handler sends
  // stop to its service and waits for its workers and databases to drain. This
  // bypasses "Close when finished" without killing a database or another app.
  const child=app.process();let onExit,timer;
  const exited=new Promise(resolve=>{onExit=(code,signal)=>resolve({code,signal});child.once('exit',onExit);if(child.exitCode!==null||child.signalCode!==null)onExit(child.exitCode,child.signalCode);});
  try{
   await app.evaluate(({BrowserWindow})=>{for(const window of BrowserWindow.getAllWindows())window.destroy();}).catch(error=>{if(!/Target page, context or browser has been closed|Target closed|session closed/.test(error.message))throw error;});
   const result=await Promise.race([exited,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Interrupted desktop service did not drain within two minutes')),120000);})]);expect(result).toEqual({code:0,signal:null});app=null;
  }finally{clearTimeout(timer);child.removeListener('exit',onExit);}
 };
 const restart=async({interrupt=false}={})=>{if(interrupt)await interruptWindow();else await fixture.close(app);app=null;app=await fixture.start();await watch();if(await page.getByRole('heading',{name:'Unlock workspace',exact:true}).isVisible())await access.unlock(page);await expect(page.locator('.workspace-name')).toHaveText('Evidence and publication acceptance',{timeout:60000});};
 const finished=async(route,id,site=null,{retryRoute=null}={})=>{
  const until=Date.now()+300000;let previous='',retried=false;
  while(Date.now()<until){const {job}=await call(route,{id},site);if(job.state==='completed')return job;
   if(job.state==='failed'&&job.error==='ACCESS_LOCKED'&&retryRoute&&!retried){retried=true;const response=await call(retryRoute,{id},site);expect(response.job.id).toBe(id);metrics.sourceAccessRetries=(metrics.sourceAccessRetries??0)+1;continue;}
   if(['failed','cancelled','relocated'].includes(job.state))throw Error('Acceptance job '+job.type+' '+job.state+': '+JSON.stringify(job.error??job.message));const stage=job.progress?.stage??'';if(stage!==previous){previous=stage;console.log('Desktop recovery stage: '+stage);}await delay(500);}
  throw Error('Acceptance job did not finish within five minutes');
 };
 const loseReply=async(route,data,site)=>{
  let receipt,intercepted=false;const pattern='**'+route;
  const handler=async request=>{intercepted=true;const response=await request.fetch({timeout:120000});expect(response.status()).toBe(202);receipt=await response.json();await request.abort('connectionreset');};
  await page.route(pattern,handler);
  try{await expect(call(route,data,site)).rejects.toThrow();expect(intercepted).toBe(true);expect(receipt?.job?.id).toBe(data.commandId);return receipt.job;}finally{await page.unroute(pattern,handler);}
 };
 const downloadHash=async(route,site=null)=>{
  const cookies=await app.evaluate(({BrowserWindow},url)=>BrowserWindow.getAllWindows()[0].webContents.session.cookies.get({url}),page.url()),response=await fetch(new URL(route,page.url()),{headers:{Cookie:cookies.map(cookie=>cookie.name+'='+cookie.value).join('; '),...(site?{'X-Observanda-Website':site}:{})},signal:AbortSignal.timeout(180000)});
  expect(response.ok).toBe(true);const hash=createHash('sha256');let bytes=0;for await(const chunk of response.body){bytes+=chunk.length;hash.update(chunk);}return {size:bytes,sha256:hash.digest('hex')};
 };
 try{
  if(process.env.OBSERVANDA_ACCEPTANCE_STORAGE_ROOT){expect(path.isAbsolute(process.env.OBSERVANDA_ACCEPTANCE_STORAGE_ROOT)).toBe(true);externalParent=await realpath(process.env.OBSERVANDA_ACCEPTANCE_STORAGE_ROOT);storageDirectory=await mkdtemp(path.join(externalParent,'observanda-evidence-acceptance-'));}
  else storageDirectory=path.join(fixture.directory,'storage');
  await mkdir(storageDirectory,{recursive:true});const originalSet=await originals(storageDirectory);metrics.originalBytes=originalSet.bytes;
  app=await fixture.start();await watch();expect(await app.evaluate(({app})=>app.isPackaged)).toBe(!!fixture.packaged);
  console.log(fixture.packaged?'Evidence/publication acceptance: selected packaged executable.':'Evidence/publication acceptance: source Electron; installed executable not qualified.');
  await expect(page.getByRole('heading',{name:'Create a workspace',exact:true})).toBeVisible({timeout:60000});
  await page.getByLabel('Workspace name',{exact:true}).fill('Evidence and publication acceptance');await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByLabel('Create in',{exact:true}).fill(storageDirectory);await access.setup(page);
  console.log('Desktop recovery: submitting workspace creation.');const setupStarted=Date.now(),setupResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/notebook/create'&&response.request().method()==='POST',{timeout:300000});void setupResponse.catch(()=>{});
  await page.getByRole('button',{name:'Create workspace',exact:true}).click();const setup=await setupResponse;expect(setup.status(),await setup.text()).toBe(201);const createdWorkspace=await setup.json();expect(createdWorkspace.book.id).toBeTruthy();expect(createdWorkspace.storage.contextId).toBeTruthy();metrics.workspaceCreateMs=Date.now()-setupStarted;
  console.log('Desktop recovery: workspace creation receipt confirmed; waiting for its dashboard.');await expect(page.locator('.workspace-name')).toHaveText('Evidence and publication acceptance',{timeout:60000});
  console.log('Desktop recovery: submitting dedicated project creation.');const projectStarted=Date.now();
  const {project}=await call('/api/projects/create',{id:randomUUID(),...access.credentials,project:{id:randomUUID(),title:'Acceptance project',parentId:null,description:'',share:false,logoId:null}}),projectRoute='/api/projects/'+project.projectId;
  metrics.projectCreateMs=Date.now()-projectStarted;console.log('Desktop recovery: dedicated project receipt confirmed; creating its lab book.');
  await call(projectRoute+'/access/unlock',{...access.credentials,recovery:''});
  const {book}=await call(projectRoute+'/lab-books/create',{id:randomUUID(),...access.credentials,book:{id:randomUUID(),projectId:project.projectId,title:'Acceptance observations'}}),owner=projectRoute+'/lab-books/'+book.labBookId,materials=owner+'/research/materials/';
  const unlockOwners=async()=>{await call(projectRoute+'/access/unlock',{...access.credentials,recovery:''});await call(owner+'/access/unlock',{...access.credentials,recovery:''});};await unlockOwners();
  const now=new Date().toISOString(),record={id:randomUUID(),notebookId:book.labBookId,type:'experiment',title:'Public observations with private originals',body:'Selected observation for the acceptance website.',contributors:[],relations:[],tags:[],occurredOn:'2026-10-01',createdAt:now,updatedAt:now,share:true,figures:[],status:'draft',attachments:[],sections:[]};
  const foreground={...record,id:randomUUID(),title:'Concurrent private observation',share:false};
  await call(owner+'/research/records/save',{workspaceId:book.namespaceId,changes:[record,foreground].map(record=>({id:record.id,expectedRevision:null,record}))});
  console.log('Desktop recovery: dedicated project and lab book created; starting 62-file folder upload.');
  const recordRoute='#/owners/'+project.projectId+'/books/'+book.labBookId+'/records/'+record.id;
  const openEvidence=async()=>{await page.evaluate(route=>location.hash=route,recordRoute);await page.getByRole('button',{name:'Open evidence & analysis',exact:true}).click();};
  await openEvidence();await page.locator('[data-action="material-intake-new"]').click();await page.getByLabel('Collection title',{exact:true}).fill('Private synthetic originals');await page.getByLabel('Select source',{exact:true}).selectOption('folder');await page.locator('#intake-files').setInputFiles(originalSet.directory);
  await page.evaluate(()=>{const state=window.acceptanceProgress={changes:0,last:''};window.acceptanceProgressObserver=new MutationObserver(()=>{const text=document.getElementById('intake-status')?.textContent??'';if(text&&text!==state.last){state.changes++;state.last=text;}});window.acceptanceProgressObserver.observe(document.body,{subtree:true,childList:true,characterData:true});});
  const batchResponse=page.waitForResponse(response=>response.url().endsWith('/research/materials/intake-start')&&response.ok(),{timeout:300000}),firstUpload=page.waitForResponse(response=>response.url().endsWith('/research/materials/chunks')&&response.ok(),{timeout:300000});
  // Keep owned waiters observed if a preceding UI action fails; the awaited
  // original promise still reports its failure when that step is reached.
  void batchResponse.catch(()=>{});void firstUpload.catch(()=>{});
  const uploadStarted=Date.now();await page.getByRole('button',{name:'Upload file set',exact:true}).click();const batch=await(await batchResponse).json();await firstUpload;await page.getByRole('button',{name:'Pause upload',exact:true}).click();await expect(page.getByRole('button',{name:'Upload selected files',exact:true})).toBeEnabled({timeout:60000});
  let uploadPage=await call(materials+'intake-page',{id:batch.id});expect(uploadPage.batch.registered).toBe(62);expect(uploadPage.batch.ready).toBeLessThan(62);expect(uploadPage.items[0].received).toBeGreaterThan(0);metrics.folderProgressUpdates=(await page.evaluate(()=>window.acceptanceProgress)).changes;expect(metrics.folderProgressUpdates).toBeGreaterThan(1);
  console.log('Desktop recovery: acknowledged upload paused; reopening and resuming the same file set.');
  await restart();await unlockOwners();await openEvidence();await page.locator('[data-action="material-intake-list"]').click();await page.locator('[data-action="material-intake-open"][data-id="'+batch.id+'"]').click();await page.locator('#intake-files').setInputFiles(originalSet.directory);await page.getByRole('button',{name:'Upload selected files',exact:true}).click();await expect(page.getByRole('button',{name:'Verify and attach file set',exact:true})).toBeEnabled({timeout:300000});metrics.uploadAndRestartMs=Date.now()-uploadStarted;
  const enqueue=page.waitForResponse(response=>response.url().endsWith('/research/materials/intake-finish')&&response.ok());await page.getByRole('button',{name:'Verify and attach file set',exact:true}).click();const admitted=await(await enqueue).json();expect(admitted.job.id).toBe(batch.id);
  metrics.foregroundSaveMs=[];metrics.foregroundWhileActive=0;
  for(let index=0;index<3;index++){
   const state=(await call(materials+'job',{id:batch.id})).job.state;if(['queued','running'].includes(state))metrics.foregroundWhileActive++;
   const selected=await call(owner+'/workspace/read/selection',{workspaceId:book.namespaceId,ids:[foreground.id]}),changed={...selected.book.entries[0],title:'Concurrent private observation '+(index+1)},started=Date.now();
   await call(owner+'/research/records/save',{workspaceId:book.namespaceId,changes:[{id:foreground.id,expectedRevision:selected.recordRevisions[foreground.id],record:changed}]});metrics.foregroundSaveMs.push(Date.now()-started);
   expect((await call(owner+'/workspace/read/selection',{workspaceId:book.namespaceId,ids:[foreground.id]})).book.entries[0].title).toBe(changed.title);
  }
  expect(metrics.foregroundWhileActive).toBeGreaterThan(0);
  const interruptedEvidence=(await call(materials+'job',{id:batch.id})).job;expect(interruptedEvidence.state).toBe('running');metrics.evidenceRestartState=interruptedEvidence.state;metrics.evidenceAttemptBefore=interruptedEvidence.attempt;
  console.log('Desktop recovery: foreground saves retained; interrupting active evidence finalization.');
  await restart({interrupt:true});await unlockOwners();const finalizationStarted=Date.now(),completed=await finished(materials+'job',batch.id);metrics.finalizationAfterRestartMs=Date.now()-finalizationStarted;metrics.evidenceAttemptAfter=completed.attempt;expect(completed.attempt).toBeGreaterThan(interruptedEvidence.attempt);expect((await call(materials+'intake-finish',{id:batch.id})).job.result).toEqual(completed.result);
  const refs=[];let offset=0;do{const result=await call(materials+'references',{ref:completed.result,offset,limit:20});refs.push(...result.items);offset=result.next;}while(offset!==null);expect(refs).toHaveLength(62);expect(new Set(refs.map(ref=>ref.id)).size).toBe(62);
  const expected=new Map(originalSet.files.map(file=>[file.name,file])),context=(await call('/api/storage')).contextId;
  for(const ref of refs){const doc=await call(materials+'read',{ref}),original=expected.get(doc.content.name);expect(original).toBeTruthy();expect(doc.content.size).toBe(original.size);expect(doc.content.sha256).toBe(original.sha256);expect(await downloadHash(materials+'original/'+ref.id+'/'+ref.revision+'?context='+encodeURIComponent(context))).toEqual({size:original.size,sha256:original.sha256});expected.delete(doc.content.name);}expect(expected.size).toBe(0);
  console.log('Desktop recovery: all 62 downloaded originals match; preparing 121 pages and seven historical analyses.');
  const current=await call(owner+'/workspace/read/selection',{workspaceId:book.namespaceId,ids:[record.id]}),pin=await call(materials+'pin',{id:record.id,expectedRevision:current.recordRevisions[record.id]}),analyses=[];
  for(let index=0;index<7;index++)analyses.push(await call(materials+'analysis',{recordId:record.id,title:'Retained interpretation '+(index+1),tool:'Synthetic acceptance interpretation',version:'1',parameters:'Explicit historical observation',inputs:[pin],outputs:[]}));
  const updated={...current.book.entries[0],body:'Selected observation with seven retained historical interpretations.',results:{version:1,statements:analyses.map((source,index)=>({id:randomUUID(),kind:'conclusion',basis:'retained',title:'Interpretation '+(index+1),text:'Synthetic interpretation '+(index+1),limitations:'Historical source only; no physical or causal claim.',source}))}};
  await call(owner+'/research/records/save',{workspaceId:book.namespaceId,changes:[{id:record.id,expectedRevision:current.recordRevisions[record.id],record:updated}]});
  const sites=await call('/api/websites/list',{}),created=await call('/api/websites/change',{workspaceId:sites.workspaceId,etag:sites.etag,operation:'create',name:'Acceptance website',projectId:null});websiteId=created.id;
  const website={workspaceId:sites.workspaceId,websiteId},pages=Array.from({length:121},(_,index)=>({id:randomUUID(),title:'Custom page '+String(index+1).padStart(3,'0'),body:'Selected custom page '+(index+1),share:true,sections:[]}));let site=await call('/api/websites/editor/open',website);
  const change=async operations=>{site=await call('/api/websites/editor/change',{...website,websitePin:site.websitePin,draftId:site.draft?.id??null,expectedRevision:site.draft?.revision??null,commandId:randomUUID(),operations});};
  await change([{type:'source-selection',kind:'record',workspaceId:book.namespaceId,labBookId:book.labBookId,projectId:project.projectId,recordId:record.id,share:true}]);
  for(let index=0;index<pages.length;index+=20)await change([{type:'append',collection:'pages',values:pages.slice(index,index+20)}]);
  await call('/api/websites/editor/save',{...website,websitePin:site.websitePin,draftId:site.draft.id,expectedRevision:site.draft.revision,commandId:randomUUID()});site=await call('/api/websites/editor/open',website);
  console.log('Desktop recovery: website saved; losing preparation acknowledgement and restarting active work.');
  const command={workspaceId:sites.workspaceId,etag:site.websitePin.researchSnapshotId,websitePin:site.websitePin,commandId:randomUUID()},startRoute='/api/publication-jobs/start',publication=await loseReply(startRoute,command,websiteId);expect((await call(startRoute,command,websiteId)).job.id).toBe(publication.id);
  const interruptedPublication=(await call('/api/publication-jobs/status',{id:publication.id},websiteId)).job;expect(['queued','running']).toContain(interruptedPublication.state);metrics.publicationRestartState=interruptedPublication.state;
  await restart({interrupt:true});await unlockOwners();const release=await finished('/api/publication-jobs/status',publication.id,websiteId,{retryRoute:'/api/publication-jobs/retry'}),reviewId=release.result.id;expect(release.attempt).toBeGreaterThan(interruptedPublication.attempt);let review=await call('/api/publication-jobs/open',{id:reviewId},websiteId);
  const decisionsPage=await call('/api/publication-jobs/analysis-review-window',{id:reviewId,offset:0,limit:32},websiteId);expect(decisionsPage.total).toBe(7);expect(decisionsPage.items).toHaveLength(7);expect(decisionsPage.decided).toBe(0);
  const refused=await page.evaluate(async({id,websiteId})=>{const response=await fetch('/api/export/'+id,{headers:{'X-Observanda-Website':websiteId}});return {status:response.status,error:await response.json()};},{id:reviewId,websiteId});expect(refused.status).toBeGreaterThanOrEqual(400);expect(refused.error.code).toBe('ANALYSIS_REVIEW');
  console.log('Desktop recovery: seven decisions required and export blocked; losing review acknowledgement.');
  const decisions=decisionsPage.items.map((row,index)=>({id:row.id,reason:'Retain historical interpretation '+(index+1)+' with its stated limitations.'})),decisionCommand={id:reviewId,commandId:randomUUID(),decisions},reviewJob=await loseReply('/api/publication-jobs/analysis-review',decisionCommand,websiteId);expect((await call('/api/publication-jobs/analysis-review',decisionCommand,websiteId)).job.id).toBe(reviewJob.id);
  const interruptedReview=(await call('/api/publication-jobs/analysis-review-status',{id:reviewJob.id},websiteId)).job;metrics.reviewRestartState=interruptedReview.state;expect(['queued','running','completed']).toContain(interruptedReview.state);
  await restart({interrupt:true});await unlockOwners();const saved=await finished('/api/publication-jobs/analysis-review-status',reviewJob.id,websiteId,{retryRoute:'/api/publication-jobs/analysis-review-retry'});expect(saved.result).toMatchObject({reviewed:true,decided:7,total:7});expect(saved.result.decisions).toEqual(decisions);if(interruptedReview.state!=='completed')expect(saved.attempt).toBeGreaterThan(interruptedReview.attempt);
  review=await call('/api/publication-jobs/open',{id:reviewId},websiteId);expect(review.analysisReview).toMatchObject({reviewed:true,decided:7,total:7});const persisted=await call('/api/publication-jobs/analysis-review-window',{id:reviewId,offset:0,limit:32},websiteId);expect(persisted.items.map(row=>row.decision).sort((a,b)=>a.id.localeCompare(b.id))).toEqual([...decisions].sort((a,b)=>a.id.localeCompare(b.id)));
  console.log('Desktop recovery: all seven decisions retained after restart; opening the review.');
  await page.evaluate(({websiteId,reviewId})=>location.hash='#/websites/'+websiteId+'/review/'+reviewId,{websiteId,reviewId});await expect(page.getByRole('heading',{name:'Review website',exact:true})).toBeVisible({timeout:60000});await expect(page.getByRole('status').filter({hasText:'Analysis review decisions saved'})).toBeVisible();
  const preview=new URL(await page.locator('#full-public-preview').getAttribute('href'),page.url()),previewPath='/preview/'+reviewId+'/publication.json'+preview.search,manifest=await page.evaluate(async route=>{const response=await fetch(route);if(!response.ok)throw Error('Publication manifest unavailable');return response.json();},previewPath);
  expect(manifest.files.filter(file=>/^pages\/[^/]+\.html$/.test(file.path))).toHaveLength(121);expect(manifest.entries).toHaveLength(1);
  console.log('Desktop recovery: checking downloaded publication file hashes and private-content exclusions.');
  for(const file of manifest.files){const url='/preview/'+reviewId+'/'+file.path+preview.search;expect(await downloadHash(url)).toEqual({size:file.bytes,sha256:file.sha256});}
  const publicText=await page.evaluate(async({files,base,search})=>{let output='';for(const file of files)if(/\.(?:html|json|txt|xml|csv)$/.test(file.path))output+=await(await fetch(base+file.path+search)).text();return output;},{files:manifest.files,base:'/preview/'+reviewId+'/',search:preview.search});
  for(const withheld of ['PRIVATE_ORIGINAL_','WITHHELD_EVIDENCE_','Private synthetic originals','Concurrent private observation',...originalSet.files.map(file=>file.sha256)])expect(publicText).not.toContain(withheld);
  const exported=await downloadHash('/api/export/'+reviewId+'?context='+encodeURIComponent((await call('/api/storage')).contextId),websiteId);expect(exported.size).toBeGreaterThan(0);
  expect(errors).toEqual([]);console.log('Desktop evidence/publication acceptance: '+JSON.stringify(metrics));
 }catch(error){
  console.log('Desktop evidence/publication acceptance before failure: '+JSON.stringify(metrics));
  console.error('Desktop acceptance original failure: '+(error.stack??error.message??String(error)));
  // This isolated profile contains only this test's synthetic content. Capture
  // the hidden renderer when available; do not show or activate its window.
  if(page&&!page.isClosed())await page.screenshot({path:info.outputPath('evidence-publication-failure.png'),timeout:10000}).catch(()=>{});
  throw error;
 }finally{
  await fixture.dispose(app);
  if(externalParent&&storageDirectory){expect(path.dirname(path.resolve(storageDirectory))).toBe(path.resolve(externalParent));expect(path.basename(storageDirectory).startsWith('observanda-evidence-acceptance-')).toBe(true);await rm(storageDirectory,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
 }
});
