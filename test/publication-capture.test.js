import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {interruptWorkspace} from './fixtures/interrupt-workspace.js';
import {setTimeout as delay} from 'node:timers/promises';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {MediaStore} from '../src/media.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {withPublicationCapture} from '../src/publication-capture.js';
import {withWorkspaceMetadataBatch} from '../src/metadata-batch.js';
import {openPublicationInput} from '../src/publication-input-reader.js';
import {openPublicationOutput} from '../src/publication-output.js';
import {readPublicationRecord} from '../src/publication-input.js';
import {workspaceJobs} from '../src/workspace-jobs.js';
import {websiteWorkspace,websiteJobQueue} from '../src/website-workspace.js';
import {WebsiteSites} from '../src/website-sites.js';
import {Workspace} from '../src/storage.js';
import {EventEmitter} from 'node:events';
import {requestWriterWait} from '../src/writer-wait.js';
import {AppError} from '../src/errors.js';

function request(operation){
 const req={waitForWriter:true,checkWriter:async()=>{},socket:{timeout:60000,destroyed:false,setTimeout(){}}},res=new EventEmitter();res.setTimeout=()=>{};res.writableEnded=false;
 return requestWriterWait(req,res,operation);
}
const edit=site=>({workspaceId:site.book.id,baseEtag:site.etag,websitePin:site.websitePin,metadata:{},projects:[],changes:[],removed:[],selection:site.site.selection});
async function publicationCommand(storage){const {etag,websitePin}=await storage.outline();return {etag,websitePin};}
async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-publication-capture-')),book=sampleNotebook();
 book.entries=Array.from({length:72},(_,index)=>({...structuredClone(book.entries[0]),id:randomUUID(),title:'Observation '+index,body:'Retained observation '+index,share:true,attachments:[],figures:[],sections:[],relations:[]}));
 const f=await encryptedFixture(directory,book),jobs=workspaceJobs(f.workspace),sites=new WebsiteSites(f.workspace);
 t.after(async()=>{await jobs.worker.stop();clearVault(f.vault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-publication-capture-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const ids=[];
 for(const name of ['Research journal','Public report'])ids.push((await sites.change({workspaceId:book.id,etag:(await f.workspace.outline()).etag,operation:'create',name})).id);
 const site=await sites.read(ids[0]),command=edit(site);command.selection.includeProjects=book.projects.filter(project=>project.share).map(project=>project.id);await sites.save(ids[0],command);
 const storage=websiteWorkspace(f.workspace,ids[0]),queue=websiteJobQueue(jobs.queue,ids[0]);
 return {...f,book,sites,ids,storage,queue,worker:jobs.worker,releases:new PublicationJobs(storage)};
}
function intercept(t,workspace,operation){
 const original=ResearchCatalogue.prototype.record;let count=0;
 ResearchCatalogue.prototype.record=async function(...args){const record=await original.apply(this,args);if(this.workspace.root===workspace.root)await operation(++count,record);return record;};
 t.after(()=>{ResearchCatalogue.prototype.record=original;});return ()=>{ResearchCatalogue.prototype.record=original;};
}

test('capture combines small objects into bounded durable batches and retains exact Unicode bodies',{timeout:120000},async t=>{
 const f=await fixture(t),batches=[],expected=new Map(),writeMetadata=f.workspace.writeMetadata;let active;
 f.workspace.writeMetadata=async function(file,text){if(active&&file.includes('/release-inputs/'))active.push(Buffer.byteLength(text));return writeMetadata.call(this,file,text);};
 const write=operation=>f.workspace.withLock(()=>withWorkspaceMetadataBatch(f.workspace,async()=>{
  active=[];try{const result=await operation();if(active.length)batches.push(active);return result;}finally{active=null;}
 }));
 let captureId;
 try{await withPublicationCapture(f.storage,async(storage,id,commit)=>{
  captureId=id;
  for(let index=0;index<134;index++){
   const file='.observanda/release-inputs/'+id+'/'+randomUUID()+'.json',text=JSON.stringify({text:index<130?'Small retained body '+index:'Observation \u00e6 \u03bb \ud83d\udd2c '.repeat(4000)});
   expected.set(file,text);await storage.writeMetadata(file,text);assert.equal(await storage.readMetadata(file,256*1024),text);
  }
  await commit(async()=>{});
 },{write});}finally{f.workspace.writeMetadata=writeMetadata;}
 t.diagnostic(JSON.stringify({batches:batches.map(batch=>({objects:batch.length,bytes:batch.reduce((sum,size)=>sum+size,0)}))}));
 assert.ok(batches.length<=4,'Small retained objects should share durable commits');
 assert.equal(batches.reduce((sum,batch)=>sum+batch.length,0),expected.size);
 for(const batch of batches){assert.ok(batch.length<=128);assert.ok(batch.reduce((sum,size)=>sum+size,0)<=256*1024);}
 const reopened=websiteWorkspace(new Workspace(f.workspace.root,f.vault),f.ids[0]);
 assert.equal((await reopened.listMetadata('.observanda/release-inputs/'+captureId)).length,expected.size);
 for(const [file,text] of expected)assert.equal(await reopened.readMetadata(file,256*1024),text);
 assert.deepEqual(await reopened.listMetadata('.observanda/release-captures'),[]);
});

test('publication capture permits authoring and another preparation while retaining a fixed source',{timeout:120000},async t=>{
 const f=await fixture(t);let arrive,resume,waiting=true;
 const ready=new Promise(resolve=>arrive=resolve),held=new Promise(resolve=>resume=resolve);
 const restore=intercept(t,f.workspace,async count=>{if(waiting&&count===40){waiting=false;arrive();await held;}});
 const initial=await f.storage.outline(),pending=f.releases.start({etag:initial.etag,websitePin:initial.websitePin},f.queue);pending.catch(()=>{});
 try{
  await Promise.race([ready,pending.then(()=>assert.fail('Preparation did not reach the capture barrier'))]);
  const journals=await f.storage.listMetadata('.observanda/release-captures');assert.equal(journals.length,1);
  const firstId=journals[0].slice(0,-5);assert.ok((await f.storage.listMetadata('.observanda/release-inputs/'+firstId)).length>=32);
  // A handoff must not move or remove this folder during input retention.
  await assert.rejects(request(()=>f.workspace.withStorageHandoff(()=>assert.fail('Handoff entered during capture'))),{code:'LOCKED'});
  const other=await f.sites.read(f.ids[1]),command=edit(other);command.metadata.website={...other.book.website,footer:'Saved while capture is paused'};
  await f.sites.save(f.ids[1],command);
  const original=f.book.entries[0],changed={...original,title:'Amended during publication'};
  await new ResearchRecords(f.workspace,new MediaStore(f.workspace)).save({workspaceId:f.book.id,changes:[{id:original.id,expectedRevision:recordRevision(original),record:changed}]});
  assert.equal((await f.sites.read(f.ids[1])).book.website.footer,'Saved while capture is paused');
  // Recovery must skip the first preparation's live lease, not erase its input.
  const second=await new PublicationJobs(f.storage).start(await publicationCommand(f.storage),f.queue);
  assert.equal((await f.storage.listMetadata('.observanda/release-captures')).length,1);
  assert.ok((await f.storage.listMetadata('.observanda/release-inputs/'+firstId)).length>=32);
  resume();const first=await pending;assert.equal(first.id,firstId);restore();
  const before=await f.releases.source(first.id),after=await f.releases.source(second.id),beforeInput=await openPublicationInput(f.storage,before),afterInput=await openPublicationInput(f.storage,after);
  assert.equal(await beforeInput.recordCount(),72);assert.equal(await afterInput.recordCount(),72);
  assert.equal((await readPublicationRecord(f.storage,before,await beforeInput.get('records',original.id))).title,original.title);
  assert.equal((await readPublicationRecord(f.storage,after,await afterInput.get('records',original.id))).title,changed.title);
  assert.deepEqual(await f.storage.listMetadata('.observanda/release-captures'),[]);
  assert.equal((await f.queue.read(first.id)).state,'queued');assert.equal((await f.queue.read(second.id)).state,'queued');
  await f.workspace.withStorageHandoff(async()=>{});
 }finally{resume();await pending.catch(()=>{});restore();}
});

test('interrupted input cleanup is recovered before another preparation without publishing partial input',{timeout:120000},async t=>{
 const f=await fixture(t),remove=f.workspace.removeMetadata;
 const restore=intercept(t,f.workspace,async count=>{if(count===40)throw new AppError('IO');});
 f.workspace.removeMetadata=async function(file){if(file.includes('/release-inputs/'))throw new AppError('STORAGE_FULL');return remove.call(this,file);};
 try{await assert.rejects(f.releases.start(await publicationCommand(f.storage),f.queue),{code:'IO'});}
 finally{f.workspace.removeMetadata=remove;restore();}
 const journals=await f.storage.listMetadata('.observanda/release-captures');assert.equal(journals.length,1);
 const abandoned=journals[0].slice(0,-5);assert.ok((await f.storage.listMetadata('.observanda/release-inputs/'+abandoned)).length>=32);
 assert.equal(await f.queue.read(abandoned),null);await assert.rejects(f.releases.source(abandoned),{code:'NOT_FOUND'});
 const reopened=new Workspace(f.workspace.root,f.vault),storage=websiteWorkspace(reopened,f.ids[0]),jobs=workspaceJobs(reopened),queue=websiteJobQueue(jobs.queue,f.ids[0]),releases=new PublicationJobs(storage);
 const job=await releases.start(await publicationCommand(storage),queue);
 assert.deepEqual(await storage.listMetadata('.observanda/release-inputs/'+abandoned),[]);
 assert.deepEqual(await storage.listMetadata('.observanda/release-captures'),[]);
 assert.equal(await (await openPublicationInput(storage,await releases.source(job.id))).recordCount(),72);assert.equal((await queue.read(job.id)).state,'queued');
});

test('aborting capture removes its committed input batches and releases its lifecycle lease',{timeout:120000},async t=>{
 const f=await fixture(t),controller=new AbortController();
 const restore=intercept(t,f.workspace,async count=>{if(count===40)controller.abort(new AppError('WRITE_CANCELLED'));});
 try{await assert.rejects(f.releases.inline(await publicationCommand(f.storage),{signal:controller.signal}),{code:'WRITE_CANCELLED'});}
 finally{restore();}
 assert.deepEqual(await f.storage.listMetadata('.observanda/release-captures'),[]);
 assert.deepEqual(await f.storage.listMetadata('.observanda/release-inputs'),[]);
 assert.equal(await f.queue.hasActive(),false);
 await f.workspace.withStorageHandoff(async()=>{});
});

test('aborting synchronous rendering removes retained inputs and partial outputs while preserving another website',{timeout:120000},async t=>{
 const f=await fixture(t),controller=new AbortController(),prepare=f.releases.prepare.bind(f.releases),other=await f.sites.read(f.ids[1]);let jobId,pages=0;
 f.releases.prepare=(job,options)=>{jobId=job.id;return prepare(job,{...options,progress:async()=>{pages++;controller.abort(new AppError('WRITE_CANCELLED'));}});};
 await assert.rejects(f.releases.inline(await publicationCommand(f.storage),{signal:controller.signal}),{code:'WRITE_CANCELLED'});
 assert.equal(pages,1);assert.ok(jobId);
 assert.equal(await f.storage.readMetadata('.observanda/release-inputs/'+jobId+'.json',1024),null);
 assert.deepEqual(await f.storage.listMetadata('.observanda/release-inputs/'+jobId),[]);
 assert.deepEqual(await f.storage.listMetadata('.observanda/release-outputs/'+jobId),[]);
 assert.deepEqual(await f.storage.listMetadata('.observanda/release-captures'),[]);
 assert.deepEqual((await f.sites.read(f.ids[1])).book,other.book);
 await f.workspace.withStorageHandoff(async()=>{});
});

test('a lost admission reply preserves the committed job and its retained input',{timeout:120000},async t=>{
 const f=await fixture(t),transaction=f.queue.transaction;let admitted;
 f.queue.transaction=async function(operation){
  const result=await transaction.call(this,operation);
  if(result?.type==='publication.prepare'){admitted=result;throw new AppError('DATABASE_UNAVAILABLE');}
  return result;
 };
 try{await assert.rejects(f.releases.start(await publicationCommand(f.storage),f.queue),{code:'DATABASE_UNAVAILABLE'});}
 finally{f.queue.transaction=transaction;}
 assert.ok(admitted);assert.deepEqual(await f.storage.listMetadata('.observanda/release-captures'),[]);
 assert.equal((await f.queue.read(admitted.id)).state,'queued');
 const source=await f.releases.source(admitted.id),input=await openPublicationInput(f.storage,source);assert.equal(await input.recordCount(),72);
 const retained=(await input.window('records',{limit:1})).items[0];assert.equal((await readPublicationRecord(f.storage,source,retained)).id,retained.id);
});

test('a burst of preparations leaves database capacity for input commits',{timeout:120000},async t=>{
 const f=await fixture(t),site=await f.sites.read(f.ids[0]),command=edit(site);command.selection={defaultShare:false,includeProjects:[],records:[{id:f.book.entries[0].id,share:true,attachments:[]}]};await f.sites.save(f.ids[0],command);
 const {etag,websitePin}=await publicationCommand(f.storage);
 const results=await Promise.allSettled(Array.from({length:14},()=>request(()=>new PublicationJobs(f.storage).start({etag,websitePin},f.queue))));
 for(const result of results)if(result.status==='rejected')t.diagnostic(result.reason.code??result.reason.message);
 assert.equal(results.filter(result=>result.status==='fulfilled').length,14);
 assert.deepEqual(await f.storage.listMetadata('.observanda/release-captures'),[]);
});

test('a killed capture releases its lease and its partial input is removed on the next preparation',{timeout:120000},async t=>{
 const f=await fixture(t);await interruptWorkspace(f.workspace.root,f.vault,'publication-capture',{websiteId:f.ids[0]});
 const journals=await f.storage.listMetadata('.observanda/release-captures');assert.equal(journals.length,1);const abandoned=journals[0].slice(0,-5);
 assert.ok((await f.storage.listMetadata('.observanda/release-inputs/'+abandoned)).length>=32);assert.equal(await f.queue.read(abandoned),null);
 const job=await f.releases.start(await publicationCommand(f.storage),f.queue);
 assert.deepEqual(await f.storage.listMetadata('.observanda/release-inputs/'+abandoned),[]);assert.deepEqual(await f.storage.listMetadata('.observanda/release-captures'),[]);
 assert.equal(await (await openPublicationInput(f.storage,await f.releases.source(job.id))).recordCount(),72);await f.workspace.withStorageHandoff(async()=>{});
});

test('a complete 720-record selection keeps ordinary website saves within their latency budget',{timeout:240000},async t=>{
 const f=await fixture(t),seed=f.book.entries[0],extra=Array.from({length:648},(_,index)=>({...structuredClone(seed),id:randomUUID(),title:'Extended observation '+index,body:('Selected observation '+index+' ').repeat(512)}));
 await new ResearchRecords(f.workspace,new MediaStore(f.workspace)).save({workspaceId:f.book.id,changes:extra.map(record=>({id:record.id,expectedRevision:null,record}))},{receipt:true});
 const {etag,websitePin}=await publicationCommand(f.storage),started=performance.now(),latencies=[];let finished=false;
 const preparing=request(async()=>{
  const job=await f.releases.start({etag,websitePin},f.queue);f.worker.start();
  try{for(;;){const current=await f.queue.read(job.id);if(['completed','failed','cancelled'].includes(current.state)){assert.equal(current.state,'completed',current.error);return current;}await delay(100);}}finally{await f.worker.stop();}
 });preparing.finally(()=>{finished=true;}).catch(()=>{});
 const saving=(async()=>{while(!finished){
  await delay(250);if(finished)break;const start=performance.now();
  await request(async()=>{const site=await f.sites.read(f.ids[1]),command=edit(site);command.metadata.website={...site.book.website,footer:'Concurrent settings '+latencies.length};await f.sites.save(f.ids[1],command);});
  latencies.push(Math.round(performance.now()-start));
 }})();
 const results=await Promise.allSettled([preparing,saving]);for(const result of results)if(result.status==='rejected')throw result.reason;
 const job=results[0].value,source=await f.releases.source(job.id),candidate=await f.releases.stored(job.result.id),elapsedMs=Math.round(performance.now()-started),maximumSaveMs=Math.max(...latencies);
 const input=await openPublicationInput(f.storage,source),output=await openPublicationOutput(f.storage,candidate),recordCount=await input.recordCount(),fileCount=output.count('files');
 t.diagnostic(JSON.stringify({records:recordCount,files:fileCount,inputBytes:extra.reduce((sum,record)=>sum+Buffer.byteLength(record.body),0),elapsedMs,saves:latencies.length,maximumSaveMs}));
 assert.equal(recordCount,720);assert.equal(output.count('entries'),720);assert.ok(fileCount>720);assert.ok(latencies.length>=2);assert.ok(maximumSaveMs<5000,'A website settings save exceeded five seconds');assert.ok(elapsedMs<180000,'Full selected publication exceeded three minutes');
 const last=await input.get('records',extra.at(-1).id);assert.equal((await readPublicationRecord(f.storage,source,last)).body,extra.at(-1).body);
});
