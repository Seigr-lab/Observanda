import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {Workspace} from '../src/storage.js';
import {initializeLocation} from '../src/locations.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {clearVault,unseal} from '../src/encryption.js';
import {RecordBlockStore,rekeyRecordBlock,RECORD_BLOCK_PREFIX} from '../src/record-block-store.js';

async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-record-block-')),book=upgradeNotebook(sampleNotebook());
 const access=await createAccess('','synthetic block password'),vault=takeCreatedVault(access);
 await initializeLocation(root,book,access,vault);const workspace=new Workspace(root,vault);
 t.after(async()=>{clearVault(vault);await rm(root,{recursive:true,force:true});});return {workspace,book};
}
test('record blocks keep notebook isolation, bounded payloads, immutable revisions and fresh-key recovery',async t=>{
 const source=await fixture(t),target=await fixture(t),record=structuredClone(source.book.entries[0]);
 record.sections=Array.from({length:1103},(_,i)=>({id:crypto.randomUUID(),title:'Section '+i,body:'Private exact '+i+' '+('α🔬'.repeat(180))}));
 const expected=structuredClone(record),scope=record.notebookId;let first,next;
 await source.workspace.withLock(()=>source.workspace.catalogue(async store=>{
  const key=await store.scopeKey(scope),blocks=new RecordBlockStore(store,scope,1,key);
  try{
   first=await blocks.retain(record);const before=(await store.db.get('SELECT COUNT(*) AS n FROM state WHERE starts_with(slot,$1)',RECORD_BLOCK_PREFIX)).n;
   record.sections[1].body='Amended exact value';next=await new RecordBlockStore(store,scope,1,key).retain(record);
   const after=(await store.db.get('SELECT COUNT(*) AS n FROM state WHERE starts_with(slot,$1)',RECORD_BLOCK_PREFIX)).n;
   assert.ok(after-before<20,(after-before)+' new stored blocks');
   assert.ok((await store.db.get('SELECT MAX(octet_length(payload)) AS n FROM state WHERE starts_with(slot,$1)',RECORD_BLOCK_PREFIX)).n<128*1024);
  }finally{key.fill(0);}
 }));
 await source.workspace.catalogue(async store=>{
  const key=await store.scopeKey(scope),blocks=new RecordBlockStore(store,scope,1,key);
  try{
   assert.deepEqual(await blocks.tree().read(first.root),expected);assert.deepEqual(await blocks.tree().read(next.root),record);
   let reads=0;const get=store.db.get.bind(store.db);store.db.get=async(...args)=>{reads++;return get(...args);};
   const page=await new RecordBlockStore(store,scope,1,key).tree().page(next.root,['sections'],{offset:1099,limit:4});
   assert.deepEqual(page.values,record.sections.slice(1099));assert.ok(reads<60,reads+' reads');store.db.get=get;
   const slot=blocks.slot('value',first.root),row=await store.db.get('SELECT payload FROM state WHERE slot=$1',slot);
   assert.ok(!row.payload.includes(Buffer.from('Private exact')));
   const envelope=store.decode('state',slot,row.payload);
   assert.throws(()=>unseal(Buffer.from(envelope.content,'base64'),source.workspace.vault.key,blocks.aad(slot)),{code:'ENCRYPTION_DAMAGED'});
   const wrong=Buffer.alloc(32,42);assert.throws(()=>new RecordBlockStore(store,scope,1,wrong).decode(slot,envelope,first.root),{code:'ENCRYPTION_DAMAGED'});
  }finally{key.fill(0);}
 });
 await target.workspace.withLock(()=>target.workspace.catalogue(async to=>source.workspace.catalogue(async from=>{
  const key=await to.scopeKey(scope,1,{create:true});key.fill(0);
  for await(const row of from.db.rows('SELECT slot,payload FROM state WHERE starts_with(slot,$1)',[RECORD_BLOCK_PREFIX])){
   const value=await rekeyRecordBlock(from,to,row.slot,from.decode('state',row.slot,row.payload));
   await to.db.run('INSERT INTO state VALUES ($1,$2)',row.slot,to.encode('state',row.slot,value));
  }
 })));
 await target.workspace.catalogue(async store=>{
  const key=await store.scopeKey(scope);try{const blocks=new RecordBlockStore(store,scope,1,key);assert.deepEqual(await blocks.tree().read(first.root),expected);assert.deepEqual(await blocks.tree().read(next.root),record);}
  finally{key.fill(0);}
 });
 await source.workspace.withLock(()=>source.workspace.catalogue(async store=>{
  const key=await store.scopeKey(scope),blocks=new RecordBlockStore(store,scope,1,key);
  try{
   const slot=blocks.slot('value',first.root),row=await store.db.get('SELECT payload FROM state WHERE slot=$1',slot),envelope=store.decode('state',slot,row.payload);
   const bytes=Buffer.from(envelope.content,'base64');bytes[bytes.length-1]^=1;envelope.content=bytes.toString('base64');
   await store.db.run('UPDATE state SET payload=$1 WHERE slot=$2',store.encode('state',slot,envelope),slot);
   await assert.rejects(new RecordBlockStore(store,scope,1,key).tree().read(first.root),{code:'ENCRYPTION_DAMAGED'});
  }finally{key.fill(0);}
 }));
});
test('unpublished record block writes roll back with their transaction',async t=>{
 const {workspace,book}=await fixture(t),before=await workspace.read();
 await assert.rejects(workspace.withLock(()=>workspace.catalogue(async store=>{
  const record={...book.entries[0],body:'Interrupted '.repeat(50000)},key=await store.scopeKey(record.notebookId);
  try{await new RecordBlockStore(store,record.notebookId,1,key).retain(record);throw Error('Synthetic interruption');}finally{key.fill(0);}
 })),/Synthetic interruption/);
 assert.deepEqual(await workspace.read(),before);
 await workspace.catalogue(async store=>assert.equal(Number((await store.db.get('SELECT COUNT(*) AS n FROM state WHERE starts_with(slot,$1)',RECORD_BLOCK_PREFIX)).n),0));
});
