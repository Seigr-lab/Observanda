import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {RecordBlockStore} from '../src/record-block-store.js';
import {withCatalogueVerification} from '../src/catalogue-verification.js';
import {digest,serialize} from '../src/storage-format.js';

test('authenticated leaf batches reduce dense record reads without increasing cache or transport bounds',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-block-prefetch-')),book=sampleNotebook(),f=await encryptedFixture(directory,book),record=structuredClone(book.entries[0]);
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 record.notebookId=book.notebooks[0].id;record.sections=Array.from({length:1025},(_,i)=>({id:crypto.randomUUID(),title:'Section '+i,body:('Measurement '+i+'; ').repeat(30)}));
 let retained,member;
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{
  const key=await store.scopeKey(record.notebookId,1,{create:true});
  try{retained=await new RecordBlockStore(store,record.notebookId,1,key).retain(record);}finally{key.fill(0);}
 }));
 const scan=async batching=>f.workspace.catalogue(async store=>{
  const key=await store.scopeKey(record.notebookId),blocks=new RecordBlockStore(store,record.notebookId,1,key),run=store.db.run;let queries=0,batches=0,peakTransport=0;
  if(!batching)blocks.prefetch=undefined;
  store.db.run=async function(sql,...args){queries++;const result=await run.call(this,sql,...args);if(sql.includes('octet_length(payload)<=16384')){batches++;assert.ok(result.rows.length<=32);peakTransport=Math.max(peakTransport,result.rows.reduce((n,row)=>n+row.payload.length,0));assert.ok(peakTransport<=32*16384);}return result;};
  const keep=blocks.keep;blocks.keep=function(...args){keep.apply(this,args);assert.ok(this.cache.size<=64);assert.ok(this.cacheBytes<=1024*1024);};
  const start=performance.now();
  try{
   const hash=createHash('sha256');for await(const chunk of blocks.tree().json(retained.root))hash.update(chunk);hash.update('\n');assert.equal(hash.digest('hex'),digest(serialize(record)));
   return {queries,batches,peakTransport,ms:Math.round(performance.now()-start)};
  }finally{store.db.run=run;key.fill(0);}
 });
 const before=await scan(false),after=await scan(true);assert.ok(after.queries<before.queries/4,JSON.stringify({before,after}));assert.ok(after.batches>0);t.diagnostic(JSON.stringify({before,after}));
 await f.workspace.catalogue(async store=>{
  const key=await store.scopeKey(record.notebookId),blocks=new RecordBlockStore(store,record.notebookId,1,key);
  try{
   assert.deepEqual(await blocks.tree().read(retained.root),record);
   const selected=await blocks.tree().select(retained.root,['sections']),node=await blocks.tree().node(selected.revision),entry=await blocks.tree().index.entryAt({root:node.root},1024),child=await blocks.tree().node(entry.revision);member=child.value;
   const wrong=new RecordBlockStore(store,record.notebookId,1,Buffer.alloc(32,11));await assert.rejects(wrong.prefetch('value',[member]),{code:'ENCRYPTION_DAMAGED'});
  }finally{key.fill(0);}
 });
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{
  const key=await store.scopeKey(record.notebookId),blocks=new RecordBlockStore(store,record.notebookId,1,key),slot=blocks.slot('value',member);
  try{
   const row=await store.db.get('SELECT payload FROM state WHERE slot=$1',slot),damaged=Buffer.from(row.payload);damaged[damaged.length-1]^=1;await store.db.run('UPDATE state SET payload=$1 WHERE slot=$2',damaged,slot);
   await assert.rejects(blocks.prefetch('value',[member]),{code:'ENCRYPTION_DAMAGED'});
   await store.db.run('DELETE FROM state WHERE slot=$1',slot);
   await assert.rejects(new RecordBlockStore(store,record.notebookId,1,key).tree().read(retained.root),{code:'CATALOGUE_DAMAGED'});
  }finally{key.fill(0);}
 }));
});

test('audit readers reuse unchanged encrypted blocks across owners without sharing notebook-key authority or trusting later audits',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-block-audit-')),book=sampleNotebook(),f=await encryptedFixture(directory,book),record=structuredClone(book.entries[0]);
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 record.sections=Array.from({length:130},(_,i)=>({id:crypto.randomUUID(),title:'Section '+i,body:('Original measurement '+i+'; ').repeat(20)}));let retained,cache;
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{const key=await store.scopeKey(record.notebookId);try{retained=await new RecordBlockStore(store,record.notebookId,1,key).retain(record);}finally{key.fill(0);}}));
 async function scan(shared){return f.workspace.catalogue(store=>withCatalogueVerification(store,async()=>{
  const key=await store.scopeKey(record.notebookId),run=store.db.run,previous=store.readCache;let queries=0;
  if(!shared)store.readCache=null;else cache=store.readCache;
  store.db.run=function(...args){queries++;return run.apply(this,args);};
  try{
   for(let i=0;i<4;i++)assert.deepEqual(await new RecordBlockStore(store,record.notebookId,1,key).tree().read(retained.root),record);
   if(shared){
    const wrong=new RecordBlockStore(store,record.notebookId,1,Buffer.alloc(32,31));
    await assert.rejects(wrong.read('value',retained.root),{code:'ENCRYPTION_DAMAGED'});
    await assert.rejects(wrong.prefetch('value',[retained.root]),{code:'ENCRYPTION_DAMAGED'});
    assert.ok(cache.rows.size<=cache.maxRows);assert.ok(cache.bytes<=cache.maxBytes);
   }
   return queries;
  }finally{store.db.run=run;store.readCache=previous;key.fill(0);}
 }));}
 const before=await scan(false),after=await scan(true);assert.ok(after<before/3,JSON.stringify({before,after}));t.diagnostic(JSON.stringify({unchangedBlockQueriesBefore:before,unchangedBlockQueriesAfter:after}));
 assert.equal(cache.rows.size,0);assert.equal(cache.bytes,0);
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{const slot='record-block:'+record.notebookId+':1:value:'+retained.root,row=await store.db.get('SELECT payload FROM state WHERE slot=$1',slot),bytes=Buffer.from(row.payload);bytes[bytes.length-1]^=1;await store.db.run('UPDATE state SET payload=$1 WHERE slot=$2',bytes,slot);}));
 await assert.rejects(scan(true),{code:'ENCRYPTION_DAMAGED'});
});
