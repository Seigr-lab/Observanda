import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {createNotebook} from '../src/model.js';
import {clearVault} from '../src/encryption.js';
import {websiteDocument} from '../src/web/website-sites-model.js';
import {websiteWorkspace,websiteJobQueue} from '../src/website-workspace.js';
import {workspaceJobs} from '../src/workspace-jobs.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {PublicationOutputWriter} from '../src/publication-output.js';
import {contentBuffer} from '../src/file-content.js';
import {WebsiteEditor} from '../src/website-editor.js';

test('a named 120-page preparation serializes output batches and heartbeat writes in both directions',{timeout:180000},async t=>{
 const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-publication-contention-')),book=createNotebook('Publication contention'),websiteId=randomUUID();
 const pages=Array.from({length:120},(_,index)=>({id:randomUUID(),title:'Page '+(index+1),body:'Retained page '+(index+1),share:true,sections:[]}));
 book.websites=[{id:websiteId,name:'Independent website',projectId:null,document:websiteDocument(book),projects:[],selection:{defaultShare:false,includeProjects:[],records:[]}}];
 const f=await encryptedFixture(directory,book),jobs=workspaceJobs(f.workspace),workspace=websiteWorkspace(f.workspace,websiteId),releases=new PublicationJobs(workspace);
 t.after(async()=>{await jobs.worker.stop();clearVault(f.vault);assert.equal(path.dirname(directory),parent);assert.ok(path.basename(directory).startsWith('observanda-publication-contention-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const editor=new WebsiteEditor(f.workspace),base={workspaceId:book.id,websiteId};let state=await editor.execute('open',base);
 for(let offset=0;offset<pages.length;offset+=24)state=await editor.execute('change',{...base,websitePin:state.websitePin,draftId:state.draft?.id??null,expectedRevision:state.draft?.revision??null,commandId:randomUUID(),operations:[{type:'append',collection:'pages',values:pages.slice(offset,offset+24)}]});
 const job=await releases.start({etag:state.websitePin.researchSnapshotId,websitePin:state.websitePin,websiteDraft:{id:state.draft.id,revision:state.draft.revision}},websiteJobQueue(jobs.queue,websiteId));
 const startQueue=Promise.withResolvers(),queueHeld=Promise.withResolvers(),outputHeld=Promise.withResolvers();
 let queueReleased=false,outputReleased=false,holdOutput=false,rendered=0,prepareError;
 // These contenders start outside the output writer's async transaction scope.
 const queueContender=startQueue.promise.then(()=>jobs.queue.transaction(async()=>{queueHeld.resolve();await delay(450);queueReleased=true;}));
 const heartbeat=outputHeld.promise.then(()=>jobs.queue.pulse(job.id,jobs.worker.active.lease.token)).then(()=>assert.equal(outputReleased,true,'Heartbeat bypassed the active output transaction'));
 queueContender.catch(()=>{});heartbeat.catch(()=>{});
 const retain=PublicationOutputWriter.prototype.retain,write=f.workspace.writeMetadata,prepare=jobs.queue.definitions['publication.prepare'].prepare;
 t.mock.method(jobs.queue.definitions['publication.prepare'],'prepare',async(...args)=>{try{return await prepare(...args);}catch(error){prepareError=error;throw error;}});
 t.mock.method(PublicationOutputWriter.prototype,'retain',async function(name,...args){
  const result=await retain.call(this,name,...args);
  if(/^pages\/[^/]+\.html$/.test(name)){
   rendered++;
   if(rendered===35){startQueue.resolve();await queueHeld.promise;await this.flush();assert.equal(queueReleased,true,'Output bypassed the active job transaction');}
   if(rendered===85){holdOutput=true;await this.flush();assert.equal(outputReleased,true);}
  }
  return result;
 });
 t.mock.method(f.workspace,'writeMetadata',async function(file,...args){
  if(holdOutput&&file.includes('/release-outputs/')){holdOutput=false;outputHeld.resolve();await delay(450);outputReleased=true;}
  return write.call(this,file,...args);
 });
 // Await the real worker rather than polling a load-dependent wall-clock budget.
 jobs.worker.enabled=true;
 try{await jobs.worker.runOnce();}finally{jobs.worker.enabled=false;}
 const done=await jobs.queue.read(job.id);
 assert.equal(done.state,'completed',prepareError?.stack??done.error);
 await Promise.all([queueContender,heartbeat]);assert.equal(rendered,120);
 const reopened=new PublicationJobs(websiteWorkspace(f.workspace,websiteId)),candidate=await reopened.read(done.result.id);
 for(const index of [0,34,84,119])assert.match((await contentBuffer(await candidate.files.get('pages/'+pages[index].id+'.html'))).toString(),new RegExp('Retained page '+(index+1)));
 assert.equal((await jobs.queue.read(job.id)).attempt,1,'Contention must not restart rendering');
});
