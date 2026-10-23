import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {Workspace} from '../src/storage.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {clearVault} from '../src/encryption.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {DurableJobs} from '../src/jobs.js';
import {researchJobDefinitions} from '../src/research-jobs.js';
import {enqueuePlot} from '../src/dataset-jobs.js';
import {materialRequest,executeMaterialRequest} from '../src/material-requests.js';
import {materialHttp} from '../src/material-http.js';
import {projectRequest} from '../src/project-application.js';
import {LiveResearch} from '../src/collaboration/live-research.js';
import {AppError} from '../src/errors.js';
const route='/api/research/materials/plot-job-settings',request=materialRequest(route);
const column=name=>({name,representation:'integer',radix:10,unit:'',missing:[],time:{kind:'none',reference:'',resolution:'',uncertainty:''}});
const mapping={x:0,xKind:'number',values:[{column:1,error:null}],group:null,operation:'raw',kind:'scatter',order:'source',mode:'replace',decimal:'.',numericPolicy:'safe',projection:{version:1,x:{origin:{spelling:'000',representation:'integer',radix:10},scale:{spelling:'1/1',representation:'rational',radix:10}}}};
const queueFor=workspace=>{let queue;queue=new DurableJobs(workspace,researchJobDefinitions(workspace,()=>queue));return queue;};

test('saved plot settings are a selected-owner read and reject stale workspace or live-room routing',async()=>{
 assert.equal(request.material,'plot-job-settings');assert.equal(request.write,false);assert.equal(request.method,'POST');assert.equal(request.status,200);
 const projectId=randomUUID(),labBookId=randomUUID();
 for(const prefix of ['/api/projects/'+projectId,'/api/projects/'+projectId+'/lab-books/'+labBookId]){const selected=projectRequest(prefix+'/research/materials/plot-job-settings','POST');assert.equal(selected.material,'plot-job-settings');assert.equal(selected.projectId,projectId);assert.equal(selected.write,false);if(prefix.includes('/lab-books/'))assert.equal(selected.labBookId,labBookId);}
 const res=new EventEmitter();let disclosed=false;
 await assert.rejects(materialHttp({method:'POST',headers:{'x-observanda-workspace':'prior'}},res,request,{contextId:'current',body:()=>{throw Error('stale body read');},json:()=>{disclosed=true;},execute:()=>{disclosed=true;}}),{code:'WORKSPACE_CHANGED'});assert.equal(disclosed,false);
 await assert.rejects(LiveResearch.prototype.dispatch.call({},null,null,'plot-job-settings',{}),{code:'COLLABORATION_INVALID'});
});

test('failed or cancelled plot intents reopen exactly without retry and recheck source, state and authority',{timeout:120000},async t=>{
 const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-plot-settings-')),provider=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(provider);let vault;
 t.after(async()=>{await provider.close();detach();if(vault)clearVault(vault);assert.equal(path.dirname(directory),parent);assert.ok(path.basename(directory).startsWith('observanda-plot-settings-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const book=sampleNotebook();book.entries=book.entries.slice(0,2);const fixture=await encryptedFixture(directory,book),workspace=fixture.workspace;vault=fixture.vault;
 const materials=new ResearchMaterials(workspace),recordId=book.entries[0].id,bytes=Buffer.from('x,y\n1,2\n3,4\n'),upload=await materials.startImport({recordId,name:'observations.csv',size:bytes.length});await materials.appendImport(upload.id,0,[bytes]);const artifact=await materials.finishImport(upload.id);
 const dataset=await materials.dataset({recordId,title:'Pinned observations',artifact,sourceMapping:{format:'delimited',delimiter:',',header:true},columns:[column('x'),column('y')]}),command={recordId,title:'Original plot settings',dataset,mapping},id=randomUUID();let queue=queueFor(workspace);
 await enqueuePlot(materials,queue,command,id);
 const call=(data={id,recordId},options={})=>executeMaterialRequest(workspace,request,data,{signal:t.signal,jobs:async()=>({queue,worker:{wake(){throw Error('read woke worker');},cancel(){throw Error('read cancelled worker');}}}),...options});
 await assert.rejects(call(),{code:'JOB_CHANGED'});const running=await queue.claim();assert.equal(running.id,id);await assert.rejects(call(),{code:'JOB_CHANGED'});await queue.release(id,running.lease.token,{error:new AppError('DATASET_CALCULATION_RESOURCE')});
 const saved=await queue.read(id),raw=await workspace.readMetadata(queue.file(id),1048576);
 // Recreate the storage facade and service: the editor's former in-memory command is gone.
 const reopened=new Workspace(workspace.root,vault);queue=queueFor(reopened);const restored=await call();assert.equal(restored.job.state,'failed');assert.deepEqual(restored.command,saved.input.command);assert.deepEqual(restored.command.dataset,dataset);assert.equal(restored.command.id,id);assert.equal(restored.command.expectedRevision,null);assert.equal(restored.command.base.id,id);assert.equal(restored.command.mapping.projection.x.origin.spelling,'000');
 restored.command.title='Changed only in the response';assert.equal((await queue.read(id)).input.command.title,command.title);assert.equal(await workspace.readMetadata(queue.file(id),1048576),raw);
 // A newer source head must never replace the pinned revision saved in the job.
 const revised=await materials.dataset({id:dataset.id,expectedRevision:dataset.revision,baseDataset:dataset,recordId,title:'Later observations title',artifact,columns:[column('x'),column('y')]});assert.notEqual(revised.revision,dataset.revision);assert.deepEqual((await call()).command.dataset,dataset);
 await assert.rejects(call({id,recordId:book.entries[1].id}),{code:'JOB_CHANGED'});await assert.rejects(call({id:randomUUID(),recordId}),{code:'NOT_FOUND'});await assert.rejects(call({id,recordId,extra:true}),{code:'INVALID'});
 const authorize=queue.authorize.bind(queue);let authorizations=0;queue.authorize=async job=>{authorizations++;throw new AppError('ACCESS_LOCKED');};await assert.rejects(call(),{code:'ACCESS_LOCKED'});assert.equal(authorizations,1);queue.authorize=authorize;
 // Revocation at the final job proof cannot disclose a previously read command.
 authorizations=0;queue.authorize=async job=>{if(++authorizations===2)throw new AppError('ACCESS_LOCKED');return authorize(job);};await assert.rejects(call(),{code:'ACCESS_LOCKED'});queue.authorize=authorize;
 let checks=0;await assert.rejects(call(undefined,{check:async()=>{if(++checks===2)throw new AppError('WORKSPACE_CHANGED');}}),{code:'WORKSPACE_CHANGED'});
 queue.check=async()=>{throw new AppError('ACCESS_LOCKED');};await assert.rejects(call(),{code:'ACCESS_LOCKED'});delete queue.check;
 const sourceFile='.observanda/materials/objects/'+dataset.id+'/'+dataset.revision+'.json',source=await workspace.readMetadata(sourceFile,1048576);assert.ok(source);
 await workspace.withLock(()=>workspace.removeMetadata(sourceFile));try{await assert.rejects(call(),{code:'MATERIAL_MISSING'});}finally{await workspace.withLock(()=>workspace.writeMetadata(sourceFile,source));}
 const owner=ResearchMaterials.prototype.assertOwner;let owners=0;ResearchMaterials.prototype.assertOwner=async function(...args){if(++owners===2)throw new AppError('ACCESS_LOCKED');return owner.apply(this,args);};try{await assert.rejects(call(),{code:'ACCESS_LOCKED'});}finally{ResearchMaterials.prototype.assertOwner=owner;}
 // Concurrent exact retry is visible before disclosure; this read never changes it.
 const read=ResearchMaterials.prototype.read;ResearchMaterials.prototype.read=async function(ref){const value=await read.call(this,ref);if(ref.id===dataset.id)await queue.control(id,'retry');return value;};try{await assert.rejects(call(),{code:'JOB_CHANGED'});}finally{ResearchMaterials.prototype.read=read;}
 await queue.control(id,'cancel');const cancelled=await call();assert.equal(cancelled.job.state,'cancelled');assert.deepEqual(cancelled.command,saved.input.command);
 const otherId=randomUUID();await queue.enqueue({id:otherId,type:'dataset.prepare',scope:recordId,input:{command:{recordId}}});await queue.control(otherId,'cancel');await assert.rejects(call({id:otherId,recordId}),{code:'JOB_CHANGED'});
 const malformed=await queue.read(id);malformed.input.command.recordId=book.entries[1].id;await queue.transaction(()=>queue.write(malformed));await assert.rejects(call(),{code:'JOB_CHANGED'});await queue.transaction(()=>queue.write({...saved,state:'cancelled',cancelRequested:true}));
 await queue.control(id,'retry');const final=await queue.claim(),prepared=await queue.definition(final).prepare(final,{signal:t.signal});await queue.complete(id,final.lease.token,prepared);await assert.rejects(call(),{code:'JOB_CHANGED'});
 const aborted=new AbortController();aborted.abort(new AppError('JOB_CANCELLED'));await assert.rejects(call(undefined,{signal:aborted.signal}),{code:'JOB_CANCELLED'});
});
