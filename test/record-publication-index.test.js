import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {RecordPublicationIndex} from '../src/record-publication-index.js';
import {catalogueDescriptor} from '../src/research-catalogue.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {verifyDerivedRecordChange} from '../src/record-index-verification.js';
import {copyPlan,copyWorkspace} from '../src/locations.js';
import {Workspace} from '../src/storage.js';

async function fixture(t,count=80,configure=()=>{}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-publication-index-')),book=sampleNotebook(),seed=book.entries[0];
 book.projects.push({...structuredClone(book.projects[0]),id:randomUUID(),title:'Second project'});
 book.notebooks.push({...structuredClone(book.notebooks[0]),id:randomUUID(),projectId:book.projects[1].id,title:'Other book'});
 const shared=new Set(Array.from({length:43},(_,i)=>Math.floor(i*(count-1)/42)));
 book.entries=Array.from({length:count},(_,i)=>({...structuredClone(seed),id:randomUUID(),title:'Selection '+i,body:'Private body '+i,sections:[],figures:[],attachments:[],relations:[],contributors:[],tags:[],share:shared.has(i),notebookId:book.notebooks[i%2].id}));
 configure(book);
 const f=await encryptedFixture(directory,book);t.after(async()=>{await clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 // Publication requests name the research snapshot together with the website revision.
 return {...f,book,directory,source:await head({...f,book})};
}
// The current research head with the current website revision, as the app requests it.
async function head(f){return {workspaceId:f.book.id,etag:(await f.workspace.outline()).etag};}
async function indexedRows(f,etag=f.source.etag,options={}){
 return f.workspace.catalogue(async store=>{
  const snapshot=await store.snapshot(etag),scopes=new Map(snapshot.metadata.notebooks.map(n=>[n.id,'shared']));
  return Array.fromAsync(new RecordPublicationIndex(store).rows(snapshot,scopes,options));
 });
}

test('position-only publication indexes remain readable and an atomic write adds date and owner ranges without rewriting earlier snapshots',async t=>{
 const f=await fixture(t),record=f.book.entries.find(r=>r.share);
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{
  const snapshot=await store.snapshot(),index=new RecordPublicationIndex(store);let root=snapshot.publicationIndex.root;
  for await(const row of store.members(snapshot))for(const key of (await index.keys(row,snapshot.publicationIndex.version,snapshot.metadata.id)).slice(1))root=await index.change(root,key,null);
  await index.flush(root);snapshot.publicationIndex={version:1,root};await store.db.run('UPDATE snapshots SET payload=$1 WHERE id=$2',store.encode('snapshot',f.source.etag,snapshot),f.source.etag);
  await index.verify(snapshot);
 }));
 const options={order:'date'},before=await indexedRows(f,f.source.etag,options),service=new ResearchRecords(f.workspace,{}),change={workspaceId:f.book.id,changes:[{id:record.id,expectedRevision:recordRevision(record),record:{...record,occurredOn:'2027-01-01'}}]};
 const build=RecordPublicationIndex.prototype.build;RecordPublicationIndex.prototype.build=()=>{throw Error('Interrupted date index');};
 try{await assert.rejects(service.save(change,{receipt:true}),/Interrupted date index/);}finally{RecordPublicationIndex.prototype.build=build;}
 assert.equal((await f.workspace.outline()).etag,f.source.etag);await service.save(change,{receipt:true});
 const after=(await f.workspace.outline()).etag;assert.equal((await indexedRows(f,after,options))[0].id,record.id);assert.deepEqual(await indexedRows(f,f.source.etag,options),before);
 await f.workspace.catalogue(async store=>{assert.equal((await store.snapshot(f.source.etag)).publicationIndex.version,1);assert.equal((await store.snapshot()).publicationIndex.version,3);await store.verify(catalogueDescriptor(f.book));});
 const copied=await copyWorkspace(await copyPlan(f.workspace.root,path.join(f.directory,'copy'),{vault:f.vault}),{vault:f.vault});assert.deepEqual(await indexedRows({...f,workspace:new Workspace(copied,f.vault)},f.source.etag,options),before);
});

test('missing or substituted date lanes fail direct reading and full and incremental verification',async t=>{
 const f=await fixture(t),service=new ResearchRecords(f.workspace,{}),record=f.book.entries.find(r=>r.share);
 await service.save({workspaceId:f.book.id,changes:[{id:record.id,expectedRevision:recordRevision(record),record:{...record,occurredOn:'2027-01-01'}}]},{receipt:true});
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{
  const before=await store.snapshot(f.source.etag),snapshot=await store.snapshot(),index=new RecordPublicationIndex(store),row=await store.member(snapshot,record.id),key=(await index.keys(row,snapshot.publicationIndex.version,snapshot.metadata.id))[1];
  const replacement=await index.membership.retain(await store.member(snapshot,f.book.entries.find(r=>r.id!==record.id).id));
  for(const value of [null,replacement]){
   const root=await index.change(snapshot.publicationIndex.root,key,value);await index.flush(root);const wrong={...snapshot,publicationIndex:{...snapshot.publicationIndex,root}};
   await assert.rejects(index.verify(wrong),{code:'CATALOGUE_DAMAGED'});await assert.rejects(verifyDerivedRecordChange(store,index,'publicationIndex',before,wrong),{code:'CATALOGUE_DAMAGED'});
   if(value!==null)await assert.rejects(Array.fromAsync(index.rows(wrong,new Map([[record.notebookId,'shared']]),{order:'date'})),{code:'CATALOGUE_DAMAGED'});
  }
 }));
});

test('sharing, moves, removal and failed index writes preserve pinned choices and verified portable recovery',async t=>{
 const f=await fixture(t),before=await indexedRows(f),service=new ResearchRecords(f.workspace,{}),record=f.book.entries.find(r=>!r.share);
 const changed={...record,share:true,notebookId:f.book.notebooks.find(n=>n.id!==record.notebookId).id};
 const saved=await service.save({workspaceId:f.book.id,changes:[{id:record.id,expectedRevision:recordRevision(record),record:changed}]},{recordIds:[record.id]});
 const moved=saved.book.entries[0];assert.equal(moved.share,false,'Moving a record requires renewed publication consent');assert.equal((await indexedRows(f,saved.etag)).length,43);
 const approved=await service.save({workspaceId:f.book.id,changes:[{id:moved.id,expectedRevision:recordRevision(moved),record:{...moved,share:true}}]},{recordIds:[moved.id]});
 const next=approved.book.entries[0],etag=approved.etag;assert.equal((await indexedRows(f,etag)).length,44);assert.deepEqual(await indexedRows(f),before);
 await f.workspace.catalogue(async store=>{const a=await store.snapshot(f.source.etag),b=await store.snapshot(etag);assert.equal(await verifyDerivedRecordChange(store,new RecordPublicationIndex(store),'publicationIndex',a,b),true);});
 const replace=RecordPublicationIndex.prototype.replace;RecordPublicationIndex.prototype.replace=async function(...args){await replace.apply(this,args);throw Error('Interrupted index write');};
 try{await assert.rejects(service.save({workspaceId:f.book.id,changes:[{id:next.id,expectedRevision:recordRevision(next),record:{...next,share:false}}]},{recordIds:[next.id]}),/Interrupted index write/);}
 finally{RecordPublicationIndex.prototype.replace=replace;}
 assert.equal((await f.workspace.outline()).etag,etag);assert.equal((await indexedRows(f,etag)).length,44);
 await service.remove({workspaceId:f.book.id,recordId:next.id,expectedRevision:recordRevision(next)});
 const current=(await f.workspace.outline()).etag;assert.equal((await indexedRows(f,current)).length,43);
 const copy=await copyWorkspace(await copyPlan(f.workspace.root,path.join(f.directory,'copy'),{vault:f.vault}),{vault:f.vault}),restored=new Workspace(copy,f.vault);
 assert.deepEqual(await restored.catalogue(async store=>Array.fromAsync(new RecordPublicationIndex(store).rows(await store.snapshot(f.source.etag),new Map(f.book.notebooks.map(n=>[n.id,'shared']))))),before);
 const controller=new AbortController();controller.abort();await assert.rejects(indexedRows(f,current,{signal:controller.signal}),{name:'AbortError'});
});

test('older snapshots keep their identity and fallback until the next atomic write builds the selection index',async t=>{
 const f=await fixture(t);
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{const snapshot=await store.snapshot();delete snapshot.publicationIndex;await store.db.run('UPDATE snapshots SET payload=$1 WHERE id=$2',store.encode('snapshot',f.source.etag,snapshot),f.source.etag);}));
assert.equal((await f.workspace.outline()).etag,f.source.etag);
 const record=f.book.entries[0];await new ResearchRecords(f.workspace,{}).save({workspaceId:f.book.id,changes:[{id:record.id,expectedRevision:recordRevision(record),record:{...record,title:'Revised'}}]},{recordIds:[record.id]});
 await f.workspace.catalogue(async store=>{assert.equal((await store.snapshot(f.source.etag)).publicationIndex,undefined);await new RecordPublicationIndex(store).verify(await store.snapshot());await store.verify(catalogueDescriptor(f.book));});
});

test('missing, substituted and unrelated changed index entries cannot pass full or incremental verification',async t=>{
 const f=await fixture(t),service=new ResearchRecords(f.workspace,{}),record=f.book.entries[0];
 await service.save({workspaceId:f.book.id,changes:[{id:record.id,expectedRevision:recordRevision(record),record:{...record,share:!record.share}}]},{recordIds:[record.id]});
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{
  const before=await store.snapshot(f.source.etag),snapshot=await store.snapshot(),index=new RecordPublicationIndex(store),row=await store.member(snapshot,f.book.entries[5].id),key=await index.key(row);
  for(const value of [null,await index.membership.retain(await store.member(snapshot,f.book.entries[6].id))]){
   const root=await index.change(snapshot.publicationIndex.root,key,value);await index.flush(root);
   const wrong={...snapshot,publicationIndex:{...snapshot.publicationIndex,root}};
   await assert.rejects(index.verify(wrong),{code:'CATALOGUE_DAMAGED'});
   await assert.rejects(verifyDerivedRecordChange(store,index,'publicationIndex',before,wrong),{code:'CATALOGUE_DAMAGED'});
  }
 }));
});


test('version two snapshots retain date paging while new writes add namespace-bound publication ranges',async t=>{
 const f=await fixture(t,16),record=f.book.entries[0];
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{
  const snapshot=await store.snapshot(),index=new RecordPublicationIndex(store);let root=snapshot.publicationIndex.root;
  for await(const row of store.members(snapshot))for(const key of (await index.keys(row,3,snapshot.metadata.id)).slice(2))root=await index.change(root,key,null);
  await index.flush(root);snapshot.publicationIndex={version:2,root};await store.db.run('UPDATE snapshots SET payload=$1 WHERE id=$2',store.encode('snapshot',f.source.etag,snapshot),f.source.etag);await index.verify(snapshot);
 }));
 const before=await indexedRows(f,f.source.etag,{order:'date'});
 await new ResearchRecords(f.workspace,{}).save({workspaceId:f.book.id,changes:[{id:record.id,expectedRevision:recordRevision(record),record:{...record,title:'Current title'}}]},{receipt:true});
 assert.deepEqual(await indexedRows(f,f.source.etag,{order:'date'}),before);
 await f.workspace.catalogue(async store=>{
  const old=await store.snapshot(f.source.etag),snapshot=await store.snapshot(),index=new RecordPublicationIndex(store);
  assert.equal(old.publicationIndex.version,2);assert.equal(snapshot.publicationIndex.version,3);await index.verify(old);await index.verify(snapshot);
  const wrong={...snapshot,publicationIndex:{...snapshot.publicationIndex,workspaceId:randomUUID()}};
  await assert.rejects(index.verify(wrong),{code:'CATALOGUE_DAMAGED'});
  await assert.rejects(Array.fromAsync(index.rows(wrong,new Map([[record.notebookId,'all']]),{order:'date'})),{code:'CATALOGUE_DAMAGED'});
  await assert.rejects(verifyDerivedRecordChange(store,index,'publicationIndex',snapshot,wrong),{code:'CATALOGUE_DAMAGED'});
 });
});


test('publication order and direct identity entries reject substitution during full and incremental verification',async t=>{
 const f=await fixture(t,12),record=f.book.entries[0];
 await new ResearchRecords(f.workspace,{}).save({workspaceId:f.book.id,changes:[{id:record.id,expectedRevision:recordRevision(record),record:{...record,title:'Updated record'}}]},{receipt:true});
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{
  const before=await store.snapshot(f.source.etag),snapshot=await store.snapshot(),index=new RecordPublicationIndex(store),row=await store.member(snapshot,record.id),keys=await index.keys(row,3,snapshot.metadata.id),other=await index.membership.retain(await store.member(snapshot,f.book.entries[1].id));
  const id=keys[3].slice('record:'.length);assert.equal((await index.record(snapshot,id)).id,record.id);assert.equal(await index.record(snapshot,randomUUID()),null);
  for(const key of keys.slice(2))for(const value of [null,other]){
   const root=await index.change(snapshot.publicationIndex.root,key,value);await index.flush(root);const wrong={...snapshot,publicationIndex:{...snapshot.publicationIndex,root}};
   await assert.rejects(index.verify(wrong),{code:'CATALOGUE_DAMAGED'});await assert.rejects(verifyDerivedRecordChange(store,index,'publicationIndex',before,wrong),{code:'CATALOGUE_DAMAGED'});
   if(key===keys[3]&&value!==null)await assert.rejects(index.record(wrong,id),{code:'CATALOGUE_DAMAGED'});
  }
 }));
});
