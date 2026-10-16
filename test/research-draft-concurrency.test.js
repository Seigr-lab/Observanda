import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {ResearchDraftTransfer} from '../src/research-draft-transfer.js';
import {ResearchDrafts} from '../src/research-drafts.js';
import {RecordDraftChunks} from '../src/record-draft-chunks.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {digest} from '../src/storage-format.js';
import {RECORD_DRAFT_CHUNK_BYTES as SIZE} from '../src/web/record-draft-protocol.js';

async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-draft-concurrency-')),book=sampleNotebook(),f=await encryptedFixture(directory,book);
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const record={...book.entries[0],sections:Array.from({length:40},(_,index)=>({id:randomUUID(),title:'Observation '+index,body:'exact '.repeat(10000)}))};
 const owner={id:randomUUID(),workspaceId:book.id},change={record,baseRevision:recordRevision(book.entries[0]),expectedRevision:recordRevision(book.entries[0])};
 return {...f,book,record,owner,change,transfer:new ResearchDraftTransfer(f.workspace),drafts:new ResearchDrafts(f.workspace)};
}
async function stage(f,{title=f.record.title,expectedRevision=null}={}){
 const content=Buffer.from(JSON.stringify([{...f.change,record:{...f.record,title}}])),transferHash=digest(content);
 await f.transfer.start({...f.owner,expectedRevision,bytes:content.length,sha256:transferHash});
 for(let index=0;index*SIZE<content.length;index++){
  const bytes=content.subarray(index*SIZE,(index+1)*SIZE);await f.transfer.part({...f.owner,transferHash,index,bytes:bytes.toString('base64'),sha256:digest(bytes)});
 }
 return {...f.owner,transferHash};
}
function holdInspection(t,id){
 let release,arrived,held=false;const gate=new Promise(resolve=>release=resolve),reached=new Promise(resolve=>arrived=resolve),original=RecordDraftChunks.prototype.chunks;
 t.mock.method(RecordDraftChunks.prototype,'chunks',async function*(...args){
  for await(const bytes of original.apply(this,args)){
   yield bytes;
   if(this.id===id&&!held){held=true;arrived();await gate;}
  }
 });
 t.after(()=>release());return {reached,release};
}
async function foreground(operation){
 let timer;try{return await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Checkpoint inspection blocked a foreground writer')),10000);})]);}finally{clearTimeout(timer);}
}

test('checkpoint validation lets a foreground record save commit and keeps its original recovery base',async t=>{
 const f=await fixture(t),command=await stage(f),hold=holdInspection(t,f.owner.id),finishing=f.transfer.finish(command);
 try{
  await hold.reached;
  const base=f.book.entries[0],next={...base,title:'Saved during checkpoint inspection'};
  await foreground(new ResearchRecords(f.workspace,{}).save({workspaceId:f.book.id,changes:[{id:base.id,record:next,expectedRevision:recordRevision(base)}]},{receipt:true}));
  assert.equal(await f.drafts.read(f.owner.id,{header:true}),null);
 }finally{hold.release();}
 const saved=await finishing,recovered=await f.drafts.read(f.owner.id);
 assert.equal(recovered.revision,saved.revision);assert.deepEqual(recovered.draft.changes[0].base,f.book.entries[0]);assert.deepEqual(recovered.draft.changes[0].record,f.record);
});

test('a replaced transfer cannot publish from an older validation snapshot',async t=>{
 const f=await fixture(t),prior=await f.drafts.write({...f.owner,expectedRevision:null,changes:[{...f.change,record:{...f.book.entries[0],title:'Last recoverable checkpoint'}}]});
 const command=await stage(f,{expectedRevision:prior.revision}),hold=holdInspection(t,f.owner.id),finishing=f.transfer.finish(command);
 try{
  await hold.reached;
  const replacement=Buffer.from(JSON.stringify([{...f.change,record:{...f.record,title:'Replacement transfer'}}]));
  await foreground(f.transfer.start({...f.owner,expectedRevision:prior.revision,bytes:replacement.length,sha256:digest(replacement)}));
 }finally{hold.release();}
 await assert.rejects(finishing,{code:'DRAFT_CHANGED'});
 assert.equal((await f.drafts.read(f.owner.id,{header:true})).revision,prior.revision);
 // The replacement remains resumable; it did not inherit the old inspection.
 const replacement=await stage(f,{expectedRevision:prior.revision,title:'Replacement transfer'}),saved=await f.transfer.finish(replacement);
 assert.equal((await f.drafts.read(f.owner.id,{header:true})).revision,saved.revision);
});

test('identical concurrent finishes share a receipt while cancellation preserves the previous checkpoint',async t=>{
 const f=await fixture(t),command=await stage(f),hold=holdInspection(t,f.owner.id),first=f.transfer.finish(command);let second;
 try{await hold.reached;second=await foreground(f.transfer.finish(command));}finally{hold.release();}
 assert.deepEqual(await first,second);assert.equal((await f.drafts.list()).drafts.length,1);t.mock.restoreAll();
 const next=await stage(f,{title:'Cancelled replacement',expectedRevision:second.revision}),paused=holdInspection(t,f.owner.id),controller=new AbortController(),cancelled=f.transfer.finish(next,{signal:controller.signal});
 await paused.reached;controller.abort(Error('Cancelled validation'));paused.release();await assert.rejects(cancelled,/Cancelled validation/);
 assert.equal((await f.drafts.read(f.owner.id,{header:true})).revision,second.revision);
 assert.notEqual((await f.transfer.finish(next)).revision,second.revision);
});

test('history removed after inspection prevents publication of an unrecoverable checkpoint',async t=>{
 const f=await fixture(t),command=await stage(f),hold=holdInspection(t,f.owner.id),finishing=f.transfer.finish(command);
 try{
  await hold.reached;
  await foreground(f.workspace.withLock(()=>f.workspace.catalogue(store=>store.db.run('DELETE FROM state WHERE slot=$1','history-index:'+f.record.id+':view:'+f.change.baseRevision))));
 }finally{hold.release();}
 await assert.rejects(finishing,{code:'RECORD_HISTORY_MISSING'});assert.equal(await f.drafts.read(f.owner.id,{header:true}),null);
});
