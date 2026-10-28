import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {clearVault} from '../src/encryption.js';
import {withRecordDocument} from '../src/record-document.js';
import {RecordMemberCollections} from '../src/record-member-collections.js';

test('full-record title saves reuse unchanged derived data within a database query budget',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-save-cost-')),book=sampleNotebook();
 const record=book.entries[0];record.sections=Array.from({length:129},(_,i)=>({id:randomUUID(),title:'Section '+i,body:('Exact observation '+i+' ').repeat(50)}));
 const f=await encryptedFixture(directory,book);
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const records=new ResearchRecords(f.workspace,{}),initial=await f.workspace.read(),previous=initial.book.entries[0];
 const changed={...previous,title:'Corrected synthetic protocol title'};
 let queries=0;const query=Client.prototype.query;
 const counter=t.mock.method(Client.prototype,'query',function(...args){queries++;return query.apply(this,args);});
 const start=performance.now();
 try{await records.save({workspaceId:book.id,changes:[{id:changed.id,record:changed,expectedRevision:recordRevision(previous)}]},{receipt:true});}
 finally{counter.mock.restore();}
 t.diagnostic('129-section title save: '+queries+' queries, '+Math.round(performance.now()-start)+' ms');
 // Count round trips, not wall time: this also catches regressions on fast
 // local drives which become much more expensive on slower storage.
 assert.ok(queries<2500,queries+' queries for a title-only full-record save');
 const saved=(await f.workspace.read()).book.entries.find(row=>row.id===changed.id);
 assert.equal(saved.title,changed.title);assert.deepEqual(saved.sections,previous.sections);
 await f.workspace.catalogue(store=>store.verifySnapshot(undefined,book.id));
 // Reuse must invalidate when source content or publication permissions change.
 const edited={...saved,share:!saved.share,sections:saved.sections.map((s,i)=>i===128?{...s,body:'New final observation'}:s)};
 await records.save({workspaceId:book.id,changes:[{id:edited.id,record:edited,expectedRevision:recordRevision(saved)}]},{receipt:true});
 const actual=(await f.workspace.read()).book.entries.find(row=>row.id===edited.id);
 assert.equal(actual.share,edited.share);assert.deepEqual(actual.sections,edited.sections);
 await f.workspace.catalogue(store=>store.verifySnapshot(undefined,book.id));
});

test('document windows batch authenticated reads without reading outside the requested range',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-document-window-')),book=sampleNotebook();
 const record=book.entries[0];record.sections=Array.from({length:129},(_,i)=>({id:randomUUID(),title:'Section '+i,body:('Window observation '+i+' ').repeat(50)}));
 const f=await encryptedFixture(directory,book);
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 await f.workspace.catalogue(async store=>{
  const row=await store.member(await store.snapshot(),record.id);
  await withRecordDocument(store,row.id,row.revision,async document=>{
   const batches=[],prefetch=document.blocks.prefetch.bind(document.blocks);
   const counter=t.mock.method(document.blocks,'prefetch',async(kind,versions)=>{batches.push(versions.length);return prefetch(kind,versions);});
   let queries=0;const query=Client.prototype.query,sql=t.mock.method(Client.prototype,'query',function(...args){queries++;return query.apply(this,args);});
   const selected=[];
   try{for await(const item of document.items(['sections'],{offset:31,limit:65}))selected.push({index:item.index,value:await document.tree.read(item.value)});}
   finally{sql.mock.restore();counter.mock.restore();}
   assert.deepEqual(selected,record.sections.slice(31,96).map((value,i)=>({index:31+i,value})));
   assert.ok(batches.every(size=>size<=32));
   // Locating the sections field first reads the record's property metadata.
   assert.deepEqual(batches.slice(-6),[32,32,32,32,1,1]);
   assert.ok(queries<40,queries+' queries to read a 65-item document window');
   const abort=new AbortController();abort.abort(Error('Stop window'));
   await assert.rejects(Array.fromAsync(document.items(['sections'],{signal:abort.signal})),/Stop window/);
   assert.deepEqual(await Array.fromAsync(document.items(['sections'],{offset:129})),[]);
  });
  const all=store.db.all.bind(store.db);let swapped=false;
  const corrupt=t.mock.method(store.db,'all',async(sql,...args)=>{
   const rows=await all(sql,...args);
   if(sql.includes('octet_length(payload)<=8192')&&args[0]?.[0]?.startsWith('record-member-item:')&&rows.length>1){swapped=true;rows[0]={...rows[0],payload:rows[1].payload};}
   return rows;
  });
  try{await assert.rejects(Array.fromAsync(new RecordMemberCollections(store).ids(row,'sections')));assert.ok(swapped,'Exercised batched membership authentication');}
  finally{corrupt.mock.restore();}
 });
});
