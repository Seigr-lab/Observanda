import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {RecordStarterTransfer} from '../src/record-starter-transfer.js';
import {RecordStarterCapture} from '../src/record-starter-capture.js';
import {RecordDocument} from '../src/record-document.js';
import {verifyRecordStarters} from '../src/record-starter-verification.js';
import {StarterValueBlocks} from '../src/record-starter-documents.js';
import {openStarterStream} from '../src/record-starter-stream.js';
import {copyPlan,copyWorkspace,encryptedCopy} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {catalogueFormat} from '../src/catalogue-format.js';
const password='separate template test password',sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const blueprint=count=>({name:'Wide native template',title:'Next declared experiment',type:'experiment',body:'Reviewed instructions',tags:['precision'],sections:Array.from({length:count},(_,i)=>({title:'Section '+(i+1),body:'Instruction '+i+' '+('exact measurement '.repeat(700))}))});
async function fixture(t){
 const dir=await mkdtemp(path.join(os.tmpdir(),'observanda-template-doc-')),book=sampleNotebook(),f=await encryptedFixture(dir,book);
 t.after(async()=>{clearVault(f.vault);await rm(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 return {...f,dir,book,workspaceId:book.id,owner:new RecordStarterTransfer(f.workspace)};
}
async function save(f,count=65){const id=randomUUID(),result=await f.owner.save({workspaceId:f.workspaceId,id,expectedRevision:null,draft:blueprint(count)});return {id,...result};}
async function publish(f,current){return f.owner.publish({workspaceId:f.workspaceId,id:current.id,expectedRevision:current.header.revision,note:'Reviewed reusable instructions'},{compact:true});}
async function bytesOf(source){const parts=[];for await(const bytes of source)parts.push(bytes);return Buffer.concat(parts);}
async function upload(f,bytes,id=randomUUID()){
 const target={workspaceId:f.workspaceId,uploadId:id},value=await f.owner.upload({...target,bytes:bytes.length,sha256:sha(bytes)});
 for(let index=value.received;index<Math.ceil(bytes.length/value.chunkBytes);index++)await f.owner.uploadPart({...target,index,encoded:bytes.subarray(index*value.chunkBytes,(index+1)*value.chunkBytes).toString('base64')});
 return target;
}
test('retained templates grow past old envelopes and edit one late field without reading other instruction values',async t=>{
 const f=await fixture(t);const saved=await save(f);const target={workspaceId:f.workspaceId,id:saved.id,release:null};
 const original=RecordDocument.prototype.field,paths=[];RecordDocument.prototype.field=function(path,...args){paths.push(path);return original.call(this,path,...args);};
 try{
  const view=await f.owner.view({...target,offset:60});assert.equal(view.sections.total,65);assert.equal(view.sections.values.length,5);assert.equal(paths.some(path=>path.at(-1)==='body'),false);
  const field=await f.owner.field({...target,field:'section',position:64}),command={workspaceId:f.workspaceId,id:saved.id,expectedRevision:field.header.revision,commandId:randomUUID(),operation:'section',position:64,value:{...field.value,body:'Corrected last instruction'}};
  paths.length=0;const changed=await f.owner.change(command);assert.equal(paths.some(path=>path[0]==='sections'&&path[1]!=='64'&&path.at(-1)==='body'),false);
  const later=await f.owner.change({...command,commandId:randomUUID(),expectedRevision:changed.header.revision,operation:'details',position:0,value:{name:'Renamed retained template',title:'Next run',type:'experiment'}});
  assert.deepEqual(await f.owner.change(command),changed);assert.equal((await f.owner.view({...target,offset:0})).header.revision,later.header.revision);
  await assert.rejects(f.owner.change({...command,commandId:randomUUID()}),{code:'STARTER_CHANGED'});
  const released=await publish(f,{id:saved.id,header:later.header}),recordId=randomUUID();await f.owner.create({workspaceId:f.workspaceId,id:saved.id,release:released.release.revision,recordId,notebookId:f.book.notebooks[0].id});
  const created=(await f.workspace.read()).book.entries.find(r=>r.id===recordId);assert.equal(created.sections.length,65);assert.equal(created.sections[64].body,'Corrected last instruction');assert.equal(created.status,'draft');assert.deepEqual(created.attachments,[]);
 }finally{RecordDocument.prototype.field=original;}
 await verifyRecordStarters(f.workspace);
 const dest=await copyWorkspace(await copyPlan(f.workspace.root,path.join(f.dir,'copy')),{vault:f.vault});await verifyRecordStarters(new Workspace(dest,f.vault));
});
test('streamed portable packages retain exact releases, resume upload and reject damage before import becomes visible',async t=>{
 const f=await fixture(t),saved=await save(f),published=await publish(f,saved),bytes=await bytesOf(f.owner.download({workspaceId:f.workspaceId,id:saved.id,release:published.release.revision,password}));
 assert.ok(bytes.length>512*1024);assert.equal(bytes.subarray(0,9).toString(),'OBSSTART2');assert.ok(!bytes.includes(Buffer.from('Reviewed instructions')));
 const dest=await fixture(t),target=await upload(dest,bytes),resumed=await dest.owner.upload({...target,uploadId:randomUUID(),bytes:bytes.length,sha256:sha(bytes)});assert.equal(resumed.uploadId,target.uploadId);assert.equal(resumed.received,Math.ceil(bytes.length/resumed.chunkBytes));
 await assert.rejects(dest.owner.review({...target,password:'incorrect template password'}),{code:'STARTER_PACKAGE'});assert.equal((await dest.owner.list({workspaceId:dest.workspaceId,cursor:null})).items.length,0);
 const review=await dest.owner.review({...target,password});assert.equal(review.fingerprint,published.release.revision);const view=await dest.owner.packageView({...target,offset:60});assert.equal(view.sections.total,65);
 const command={...target,id:randomUUID(),fingerprint:review.fingerprint},accepted=await dest.owner.accept(command);assert.deepEqual(await dest.owner.accept(command),accepted);
 await dest.owner.discard(target);const imported=await dest.owner.view({workspaceId:dest.workspaceId,id:command.id,release:null,offset:64});assert.equal(imported.sections.values[0].title,'Section 65');assert.equal(imported.header.latest,null);
 for(const variant of [bytes.subarray(0,-1),Buffer.concat([bytes,Buffer.from('x')]),Buffer.from(bytes)]){
  if(variant.length===bytes.length)variant[80]^=1;
  const blocks=new StarterValueBlocks(dest.workspace,{staging:randomUUID()});await assert.rejects(dest.workspace.withLock(()=>openStarterStream((async function*(){for(let i=0;i<variant.length;i+=1093)yield variant.subarray(i,i+1093);})(),password,blocks)),{code:'STARTER_PACKAGE'});
 }
 await verifyRecordStarters(dest.workspace);
});
test('legacy roots upgrade atomically, remain exact and survive fresh-key recovery with interrupted uploads',async t=>{
 const f=await fixture(t),saved=await save(f,2),published=await publish(f,saved),target={workspaceId:f.workspaceId,id:saved.id,release:published.release.revision},release=await f.owner.release(target),{revision,...legacy}=release;
 await f.workspace.withLock(async()=>{await f.workspace.writeMetadata('.observanda/record-starters/drafts/'+saved.id+'.json',JSON.stringify(saved.draft));await f.workspace.writeMetadata('.observanda/record-starters/releases/'+saved.id+'/'+revision+'.json',JSON.stringify(legacy));await f.workspace.catalogue(store=>store.db.run('UPDATE catalogue_format SET version=20'));});
 await verifyRecordStarters(f.workspace);assert.deepEqual(await f.owner.release(target),release);
 const write=f.workspace.writeMetadata.bind(f.workspace),command={workspaceId:f.workspaceId,id:saved.id,expectedRevision:published.header.revision,commandId:randomUUID(),operation:'section',position:1,value:{title:'Corrected heading',body:'New instruction'}};
 f.workspace.writeMetadata=async(file,text)=>{if(file.includes('/headers/'))throw Error('Injected interrupted header');return write(file,text);};
 await assert.rejects(f.owner.change(command),/Injected interrupted header/);f.workspace.writeMetadata=write;assert.equal(await f.workspace.catalogue(store=>catalogueFormat(store.db)),20);assert.equal((await f.owner.read({workspaceId:f.workspaceId,id:saved.id})).header.revision,published.header.revision);
 await f.owner.change(command);assert.equal(await f.workspace.catalogue(store=>catalogueFormat(store.db)),21);assert.deepEqual(await f.owner.release(target),release);
 const old=await f.owner.export({...target,password}),oldBytes=Buffer.from(old.encoded,'base64'),oldTarget=await upload(f,oldBytes);assert.equal((await f.owner.review({...oldTarget,password})).fingerprint,revision);assert.equal((await f.owner.packageView({...oldTarget,offset:0})).sections.total,2);
 const partial=Buffer.alloc(180000,73),partialId=randomUUID(),part={workspaceId:f.workspaceId,uploadId:partialId};await f.owner.upload({...part,bytes:partial.length,sha256:sha(partial)});await f.owner.uploadPart({...part,index:0,encoded:partial.subarray(0,128*1024).toString('base64')});
 const access=await createAccess('','fresh template recovery password'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));const root=await encryptedCopy(await copyPlan(f.workspace.root,path.join(f.dir,'fresh-key')),access,vault,f.vault),restored=new RecordStarterTransfer(new Workspace(root,vault));await verifyRecordStarters(restored.workspace);
 assert.equal((await restored.upload({...part,uploadId:randomUUID(),bytes:partial.length,sha256:sha(partial)})).received,1);assert.deepEqual(await restored.release(target),release);
 const pointer=JSON.parse(await restored.workspace.readMetadata('.observanda/record-starters/drafts/'+saved.id+'.json',4096));await restored.workspace.withLock(()=>restored.workspace.removeMetadata('.observanda/record-starter-values/value/'+pointer.root+'.json'));await assert.rejects(verifyRecordStarters(restored.workspace),{code:'CATALOGUE_DAMAGED'});
});
test('native capture commits selected instructions in resumable batches from a pinned source',async t=>{
 const f=await fixture(t),saved=await save(f,41),published=await publish(f,saved),recordId=randomUUID();
 await f.owner.create({workspaceId:f.workspaceId,id:saved.id,release:published.release.revision,recordId,notebookId:f.book.notebooks[0].id});
 const record=(await f.workspace.read()).book.entries.find(e=>e.id===recordId),owner=new RecordStarterCapture(f.workspace),id=randomUUID(),target={workspaceId:f.workspaceId,id},start={...target,recordId,snapshotId:(await f.workspace.outline()).etag,body:false};
 await owner.begin(start);assert.equal((await f.owner.list({workspaceId:f.workspaceId,cursor:null})).items.length,1);
 for(let index=0;index<record.sections.length;index+=20){
  const command={...target,index,sections:record.sections.slice(index,index+20).map((s,i)=>({id:s.id,position:index+i,body:index+i===40}))};
  const result=await owner.append(command);assert.deepEqual(await owner.append(command),result);assert.equal((await owner.begin(start)).received,result.received);
 }
 await assert.rejects(owner.finish({...target,count:40}),{code:'STARTER_CHANGED'});const result=await owner.finish({...target,count:41});assert.deepEqual(await owner.finish({...target,count:41}),result);
 assert.equal((await f.owner.field({...target,release:null,field:'section',position:0})).value.body,'');assert.equal((await f.owner.field({...target,release:null,field:'section',position:40})).value.body,record.sections[40].body);
 await verifyRecordStarters(f.workspace);
});

test('small legacy packages remain readable without writing during their preview',async t=>{
 const f=await fixture(t),saved=await save(f,0),published=await publish(f,saved),old=await f.owner.export({workspaceId:f.workspaceId,id:saved.id,release:published.release.revision,password});
 const target=await upload(f,Buffer.from(old.encoded,'base64'));await f.owner.review({...target,password});
 assert.equal((await f.owner.packageView({...target,offset:0})).sections.total,0);
 assert.equal((await f.owner.packageField({...target,field:'body',position:0})).value,'Reviewed instructions');
});
