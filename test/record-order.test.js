import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {recordOrder} from '../src/record-order.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {SnapshotIndex} from '../src/snapshot-index.js';
import {RecordSearchIndex} from '../src/record-search-index.js';
async function fixture(t,count){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-record-order-')),book=sampleNotebook(),seed=book.entries[2];
 book.entries=Array.from({length:count},(_,i)=>({...structuredClone(seed),id:randomUUID(),title:'Record '+i,body:'Synthetic observation',attachments:[],relations:[],sections:[],figures:[],contributors:[]}));
 const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});return {...f,book};
}
test('saved ordering streams indexed and retained legacy roots at 65 and 650 records without originals or full membership assembly',async t=>{
 for(const count of [65,650]){
  const f=await fixture(t,count),record=ResearchCatalogue.prototype.record,rows=SnapshotIndex.prototype.rows;
  ResearchCatalogue.prototype.record=SnapshotIndex.prototype.rows=()=>{throw Error('Full assembly or original read');};
  try{await f.workspace.catalogue(async store=>{
   const snapshot=await store.snapshot(),{searchIndex,...legacy}=snapshot;void searchIndex;
   for(const source of [snapshot,legacy]){
    const start=performance.now();let position=0;
    for await(const member of recordOrder(store,source)){assert.equal(member.id,f.book.entries[position].id);assert.equal(member.position,position++);}
    const ms=performance.now()-start;assert.equal(position,count);assert.ok(ms<15000);t.diagnostic(JSON.stringify({count,indexed:!!source.searchIndex,ms:Math.round(ms)}));
   }
   await assert.rejects(Array.fromAsync(recordOrder(store,snapshot,{signal:AbortSignal.abort()})),{name:'AbortError'});
   let read=0;for await(const member of recordOrder(store,snapshot)){assert.equal(member.id,f.book.entries[0].id);read++;break;}assert.equal(read,1);
  });}finally{ResearchCatalogue.prototype.record=record;SnapshotIndex.prototype.rows=rows;}
 }
});
test('saved ordering rejects missing, extra and swapped authenticated positions',async t=>{
 const f=await fixture(t,4);
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{
  const snapshot=await store.snapshot(),index=new RecordSearchIndex(store),root=snapshot.searchIndex.root,first='position:0000000000000000',second='position:0000000000000001',a=await index.find({root},first),b=await index.find({root},second);
  for(const [key,value] of [[first,null],[first,b.revision],['position:0000000000000004',a.revision],['position:invalid',a.revision]]){
   const next=await index.change(root,key,value);await index.flush(next);
   await assert.rejects(Array.fromAsync(recordOrder(store,{...snapshot,searchIndex:{...snapshot.searchIndex,root:next}})),{code:'CATALOGUE_DAMAGED'});
  }
 }));
});
