import {moduleDraftOwners} from './module-domain-fixture.js';
import {ProjectDraftCatalogue} from '../src/project-draft-catalogue.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {digest,serialize} from '../src/storage-format.js';
import {writeModuleCheckpoint} from '../src/web/modules/draft-transfer.js';
import {moduleRecovery} from '../src/web/modules/recovery.js';
import {DRAFT_CHUNK_BYTES} from '../src/web/modules/draft-protocol.js';
import {workspaceModules} from '../src/modules/index.js';
import {Workspace} from '../src/storage.js';
import {copyPlan,copyWorkspace,encryptedCopy} from '../src/locations.js';
import {createAccess,takeCreatedVault} from '../src/access.js';

async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-draft-transfer-')),book=sampleNotebook(),f=await encryptedFixture(directory,book);
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const {drafts,transfer,run:draftContext}=moduleDraftOwners(f.workspace,book.id,'resources'),data={name:'Large category',description:'',archived:false,fields:[{key:'part',label:'Part',type:'select',unit:'',required:false,choices:Array.from({length:30000},(_,i)=>String(i).padStart(8,'0')+'x'.repeat(150))}]};
 const itemId=randomUUID();await workspaceModules(f.workspace).execute({workspaceId:book.id,commandId:randomUUID(),action:'category.save',payload:{id:itemId,expectedRevision:null,data}},{compact:true});
 const command={workspaceId:book.id,id:randomUUID(),moduleId:'resources',etag:null,drafts:[{id:itemId,type:'category',expectedRevision:1,baseRevision:1,data:{...data,name:'Unfinished large category'}}]},calls=[];
 const api=async(route,body)=>{
  calls.push({route,bytes:Buffer.byteLength(JSON.stringify(body))});
  if(route.endsWith('/list')){const {moduleId,...query}=body;return drafts.list(moduleId,query);}
  if(route.endsWith('/read'))return drafts.read(body.id);
  if(route.endsWith('/write')){const result=await drafts.write(body);return {etag:result.etag};}
  return transfer[route.split('/').at(-1)](body);
 };
 return {...f,directory,book,data,command,drafts,transfer,api,calls,draftContext};
}
async function stage(f,command=f.command){
 const bytes=Buffer.from(JSON.stringify(command)),start={workspaceId:command.workspaceId,id:command.id,baseEtag:command.etag,size:bytes.length,sha256:digest(bytes)};
 await f.transfer.start(start);
 const parts=[];
 for(let index=0;index*DRAFT_CHUNK_BYTES<bytes.length;index++){
  const value=bytes.subarray(index*DRAFT_CHUNK_BYTES,(index+1)*DRAFT_CHUNK_BYTES),part={workspaceId:start.workspaceId,id:start.id,transferHash:start.sha256,index,bytes:value.toString('base64'),sha256:digest(value)};
  await f.transfer.part(part);parts.push(part);
 }
 return {start,parts,finish:{workspaceId:start.workspaceId,id:start.id,transferHash:start.sha256}};
}

test('large checkpoint transfer retries lost replies, retains newer edits and uses bounded requests',async t=>{
 const f=await fixture(t);let lose=true;
 const recovery=await moduleRecovery({workspaceId:f.book.id,moduleId:'resources',api:async(route,body)=>{const result=await f.api(route,body);if(lose&&route.endsWith('/finish')){lose=false;throw Error('Lost completion reply');}return result;}});t.after(()=>recovery.stop());
 recovery.schedule(f.command.drafts);await recovery.flush();assert.match(recovery.error.message,/Lost completion/);
 recovery.schedule([{...f.command.drafts[0],data:{...f.command.drafts[0].data,name:'Newer typing'}}]);await recovery.flush();assert.equal(recovery.error,null);
 await recovery.park();await recovery.refresh();assert.equal(recovery.available.length,1);
 const restored=await recovery.restore(recovery.available[0].id);assert.deepEqual(restored[0].base,f.data);assert.equal(restored[0].data.name,'Newer typing');
 assert.ok(Math.max(...f.calls.map(v=>v.bytes))<2*1024*1024);
 const staging=await f.draftContext(({workspace})=>Array.fromAsync(workspace.metadataNames('.observanda/module-draft-transfers')));assert.equal(staging.length,1);
 assert.deepEqual(await f.draftContext(({workspace})=>Array.fromAsync(workspace.metadataNames('.observanda/module-draft-transfers/'+staging[0]))),['manifest.json']);
 t.diagnostic(JSON.stringify({checkpointBytes:Buffer.byteLength(JSON.stringify(f.command)),largestRequestBytes:Math.max(...f.calls.map(v=>v.bytes)),heapMiB:Math.round(process.memoryUsage().heapUsed/1024/1024)}));
});

test('checkpoint and transfer receipt roll back together on disk full, abort and corruption',async t=>{
 const f=await fixture(t),staged=await stage(f),prefix='.observanda/module-draft-transfers/'+f.command.id;
 await f.transfer.part(staged.parts[0]);
 await assert.rejects(f.transfer.part({...staged.parts[0],sha256:'a'.repeat(64)}),{code:'MODULE_INVALID'});
 const put=ProjectDraftCatalogue.prototype.putObject;
 t.mock.method(ProjectDraftCatalogue.prototype,'putObject',function(id,value,...args){if(id==='metadata:'+prefix+'/manifest.json'&&JSON.parse(value.text).etag!==null)throw Object.assign(Error('Disk full'),{code:'ENOSPC'});return put.call(this,id,value,...args);});
 await assert.rejects(f.transfer.finish(staged.finish),{code:'ENOSPC'});t.mock.restoreAll();
 assert.equal(await f.drafts.read(f.command.id),null);assert.equal((await f.transfer.manifest(f.command.id)).etag,null);
 await assert.rejects(f.transfer.finish(staged.finish,{signal:AbortSignal.abort()}),{name:'AbortError'});assert.equal(await f.drafts.read(f.command.id),null);
 const file=prefix+'/0.json',original=await f.draftContext(({workspace})=>workspace.readMetadata(file,2*DRAFT_CHUNK_BYTES));
 await f.draftContext(({workspace})=>workspace.writeMetadata(file,serialize({bytes:'AAAA',sha256:digest(Buffer.from('AAAA','base64'))})),true);
 await assert.rejects(f.transfer.finish(staged.finish),{code:'MODULE_FORMAT'});assert.equal(await f.drafts.read(f.command.id),null);
 await f.draftContext(({workspace})=>workspace.writeMetadata(file,original),true);
 const result=await f.transfer.finish(staged.finish);assert.equal((await f.transfer.finish(staged.finish)).etag,result.etag);
 const updated={...f.command,etag:result.etag,drafts:[{...f.command.drafts[0],data:{...f.data,name:'Next generation'}}]};await writeModuleCheckpoint(f.api,updated,{});
 await assert.rejects(f.transfer.finish(staged.finish),{code:'DRAFT_CHANGED'});await assert.rejects(f.transfer.part(staged.parts[0]),{code:'DRAFT_CHANGED'});await assert.rejects(f.transfer.start(staged.start),{code:'DRAFT_CHANGED'});
 assert.equal((await f.drafts.read(f.command.id)).draft.drafts[0].data.name,'Next generation');
});

test('interrupted chunks resume from ordinary and fresh-key copies with pinned bases',async t=>{
 const f=await fixture(t),staged=await stage(f),access=await createAccess('','transfer recovery password'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const ordinary=await copyWorkspace(await copyPlan(f.workspace.root,path.join(f.directory,'ordinary')),{vault:f.vault});
 const fresh=await encryptedCopy(await copyPlan(f.workspace.root,path.join(f.directory,'fresh')),access,vault,f.vault);
 for(const workspace of [new Workspace(ordinary,f.vault),new Workspace(fresh,vault)]){
  const owner=moduleDraftOwners(workspace,f.book.id,'resources');await owner.transfer.finish(staged.finish);
  const recovered=await owner.drafts.read(f.command.id);assert.deepEqual(recovered.draft.drafts[0].base,f.data);assert.deepEqual(recovered.draft.drafts[0].data,f.command.drafts[0].data);
 }
 assert.equal(await f.drafts.read(f.command.id),null);
});

test('a completed transfer cannot acknowledge an older checkpoint after a direct save',async t=>{
 const f=await fixture(t),staged=await stage(f),saved=await f.transfer.finish(staged.finish);
 // A small subsequent checkpoint uses the ordinary writer, leaving the old
 // transfer receipt in place. Every retry endpoint must inspect current state.
 const draft={...f.command.drafts[0],data:{...f.data,name:'Direct save',fields:[]}};
 const current=await f.drafts.write({...f.command,etag:saved.etag,drafts:[draft]});
 for(const retry of [()=>f.transfer.start(staged.start),()=>f.transfer.part(staged.parts[0]),()=>f.transfer.finish(staged.finish)])await assert.rejects(retry(),{code:'DRAFT_CHANGED'});
 assert.equal((await f.drafts.read(f.command.id)).etag,current.etag);
});

test('short choice values choose chunked recovery based on stored bytes rather than compact JSON',async t=>{
 const f=await fixture(t),data={...f.data,fields:[{...f.data.fields[0],choices:Array.from({length:250000},(_,i)=>String(i))}]};
 const command={...f.command,id:randomUUID(),drafts:[{id:randomUUID(),type:'category',expectedRevision:null,baseRevision:null,data}]};
 assert.ok(Buffer.byteLength(JSON.stringify(command))<3*1024*1024);assert.ok(Buffer.byteLength(serialize(command))>4*1024*1024);
 await assert.rejects(f.drafts.write(command),{code:'LIMIT'});
 const result=await writeModuleCheckpoint(f.api,command,{});assert.equal((await f.drafts.read(command.id)).etag,result.etag);
 assert.ok(f.calls.some(call=>call.route.endsWith('/transfer/part')));
});
