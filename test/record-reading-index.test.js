import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {RecordReadingIndex} from '../src/record-reading-index.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {compareRecordDates} from '../src/web/record-date.js';
import {copyPlan,copyWorkspace} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
const order=(a,b)=>compareRecordDates(a,b,{descending:true})||(a.id<b.id?-1:a.id>b.id?1:0);
async function fixture(t,count=135){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-reading-index-')),book=sampleNotebook(),seed=book.entries[0];
 book.notebooks.push({...structuredClone(book.notebooks[0]),id:randomUUID(),title:'Other book'});
 book.entries=Array.from({length:count},(_,i)=>({...structuredClone(seed),id:randomUUID(),title:'Reading '+i,body:'',sections:[],figures:[],attachments:[],relations:[],contributors:[],tags:[],notebookId:book.notebooks[i%book.notebooks.length].id,
  occurredOn:[{kind:'unknown'},'2026-01-02',{kind:'year',value:'2025',estimated:true},{kind:'month',value:'2026-01',estimated:false},{kind:'range',from:'2026-01-02',to:'2026-01-09',estimated:true}][i%5]}));
 const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 return {...f,book,directory};
}
async function rows(workspace,etag=null,options={}){
 return workspace.catalogue(async store=>Array.fromAsync(new RecordReadingIndex(store).rows(await store.snapshot(etag),new Set((await store.snapshot(etag)).metadata.notebooks.map(n=>n.id)),options)));
}
test('reading order preserves exact date ordering, reverse cursors and immutable snapshots through recovery',async t=>{
 const f=await fixture(t),etag=(await f.workspace.outline()).etag,expected=[...f.book.entries].sort(order),first=await rows(f.workspace);
 assert.deepEqual(first.map(r=>r.id),expected.map(r=>r.id));
 assert.deepEqual((await rows(f.workspace,null,{after:first[67]})).map(r=>r.id),expected.slice(68).map(r=>r.id));
 assert.deepEqual((await rows(f.workspace,null,{after:first[67],backward:true})).map(r=>r.id),expected.slice(0,67).reverse().map(r=>r.id));
 assert.deepEqual((await rows(f.workspace,null,{order:'position'})).map(r=>r.id),f.book.entries.map(r=>r.id));
 const service=new ResearchRecords(f.workspace,{}),record=f.book.entries[4];
 const result=await service.save({workspaceId:f.book.id,changes:[{id:record.id,expectedRevision:recordRevision(record),record:{...record,title:'Changed',notebookId:f.book.notebooks[1].id,occurredOn:'2030-01-01'}}]},{recordIds:[record.id]});
 assert.equal((await rows(f.workspace))[0].id,record.id);assert.deepEqual(await rows(f.workspace,etag),first);
 await service.remove({workspaceId:f.book.id,recordId:record.id,expectedRevision:recordRevision(result.book.entries[0])});
 assert.equal((await rows(f.workspace)).length,first.length-1);
 await f.workspace.catalogue(async store=>new RecordReadingIndex(store).verify(await store.snapshot()));
 const copy=await copyWorkspace(await copyPlan(f.workspace.root,path.join(f.directory,'copy')),{vault:f.vault}),restored=new Workspace(copy,f.vault);
 assert.deepEqual(await rows(restored,etag),first);assert.deepEqual(await rows(restored),await rows(f.workspace));
});
test('old snapshots page beyond the fallback window and are not rewritten when a later save builds the index',async t=>{
 const f=await fixture(t),etag=(await f.workspace.outline()).etag;
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{const value=await store.snapshot();delete value.readingIndex;await store.db.run('UPDATE snapshots SET payload=$1 WHERE id=$2',store.encode('snapshot',etag,value),etag);}));
 const expected=[...f.book.entries].sort(order).map(r=>r.id);
 assert.deepEqual((await rows(f.workspace,etag)).map(r=>r.id),expected);
 assert.deepEqual((await rows(f.workspace,etag,{backward:true})).map(r=>r.id),[...expected].reverse());
 const record=f.book.entries[0];await new ResearchRecords(f.workspace,{}).save({workspaceId:f.book.id,changes:[{id:record.id,expectedRevision:recordRevision(record),record:{...record,title:'Indexed'}}]},{recordIds:[record.id]});
 await f.workspace.catalogue(async store=>{assert.equal((await store.snapshot(etag)).readingIndex,undefined);await new RecordReadingIndex(store).verify(await store.snapshot());});
 assert.deepEqual((await rows(f.workspace,etag)).map(r=>r.id),expected);
});
test('missing or substituted reading entries fail verification',async t=>{
 const f=await fixture(t,8);
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{
  const snapshot=await store.snapshot(),index=new RecordReadingIndex(store),row=await store.member(snapshot,f.book.entries[0].id),[key]=await index.keys(row);
  const root=await index.change(snapshot.readingIndex.root,key,null);await index.flush(root);
  await assert.rejects(index.verify({...snapshot,readingIndex:{version:1,root}}),{code:'CATALOGUE_DAMAGED'});
  const other=await store.member(snapshot,f.book.entries[1].id),wrong=await index.change(snapshot.readingIndex.root,key,await index.membership.retain(other));await index.flush(wrong);
  await assert.rejects(index.verify({...snapshot,readingIndex:{version:1,root:wrong}}),{code:'CATALOGUE_DAMAGED'});
 }));
});
