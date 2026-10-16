import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {WorkspaceReader} from '../src/workspace-reader.js';
import {RecordHistory} from '../src/record-history.js';
import {recordSelectionReader,validateRecordReceipt} from '../src/web/record-selection-reader.js';
import {validateRecordScope} from '../src/web/record-scope.js';
import {recordCreationBase} from '../src/web/record-creation.js';
import {SnapshotIndex} from '../src/snapshot-index.js';
import {defaultPageLayout} from '../src/web/website-layouts.js';
import {largeRecordBook} from './record-capacity-fixture.js';

async function fixture(t,count=4){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-record-selection-')),book=upgradeNotebook(sampleNotebook()),source=book.entries[2];
 book.entries=Array.from({length:count},(_,i)=>({...structuredClone(source),id:randomUUID(),title:'Selected work '+i,body:'Original observation '+i,relations:[],figures:[],attachments:[]}));
 const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 return {...f,book,reader:new WorkspaceReader(f.workspace),records:new ResearchRecords(f.workspace,{})};
}

test('selection reads and concurrent saves load only the requested bodies across tenfold growth',async t=>{
 for(const size of [40,400]){
  const f=await fixture(t,size),id=f.book.entries[0].id,other=f.book.entries[1],base=await f.reader.selection({workspaceId:f.book.id,ids:[id]});
  await f.records.save({workspaceId:f.book.id,baseEtag:base.etag,changes:[{id:other.id,expectedRevision:recordRevision(other),record:{...other,title:'Concurrent unrelated change'}}]},{compact:true});
  const read=ResearchCatalogue.prototype.read,record=ResearchCatalogue.prototype.record,patch=ResearchCatalogue.prototype.recordPatch;let bodies=0;
  ResearchCatalogue.prototype.read=()=>{throw Error('Whole workspace read');};ResearchCatalogue.prototype.recordPatch=()=>{throw Error('Whole workspace reconciliation');};
  ResearchCatalogue.prototype.record=function(recordId,revision){assert.equal(recordId,id);bodies++;return record.call(this,recordId,revision);};
  try{
   const opened=await f.reader.selection({workspaceId:f.book.id,ids:[id]});assert.equal(bodies,1);assert.equal(opened.recordScope.total,size);assert.equal(opened.book.entries.length,1);validateRecordScope(opened,{workspaceId:f.book.id,ids:[id]});
   bodies=0;const value={...opened.book.entries[0],title:'Edited selected record'},saved=await f.records.save({workspaceId:f.book.id,baseEtag:base.etag,changes:[{id,expectedRevision:base.recordRevisions[id],record:value}]},{compact:true,recordIds:[id]});
   assert.equal(saved.book.entries.length,1);assert.equal(saved.book.entries[0].title,value.title);assert.ok(bodies<=3,'At most three reads of the selected record');assert.equal(saved.recordScope.total,size);assert.deepEqual(Object.keys(saved.recordRevisions),[id]);
   t.diagnostic(size+' records: open reads 1 body; save reads '+bodies+' selected bodies');
  }finally{ResearchCatalogue.prototype.read=read;ResearchCatalogue.prototype.record=record;ResearchCatalogue.prototype.recordPatch=patch;}
  const current=await f.workspace.read();assert.equal(current.book.entries[1].title,'Concurrent unrelated change');
 }
});
test('the active selection budget does not limit separately authored large records or assemble an oversized reply',async t=>{
 const f=await fixture(t),large=largeRecordBook().entries[0],ids=f.book.entries.slice(0,2).map(r=>r.id);
 for(const id of ids){
  const prior=(await f.reader.selection({workspaceId:f.book.id,ids:[id]})).book.entries[0];
  await f.records.save({workspaceId:f.book.id,changes:[{id,expectedRevision:recordRevision(prior),record:{...large,id,notebookId:prior.notebookId,sections:large.sections.map(s=>({...s,id:randomUUID()}))}}]},{recordIds:[id]});
 }
 for(const id of ids)assert.equal((await f.reader.selection({workspaceId:f.book.id,ids:[id]})).book.entries.length,1);
 const read=ResearchCatalogue.prototype.record;let bodies=0;
 t.mock.method(ResearchCatalogue.prototype,'record',function(...args){bodies++;return read.apply(this,args);});
 await assert.rejects(f.reader.selection({workspaceId:f.book.id,ids}),{code:'RECORD_SELECTION_LIMIT'});assert.equal(bodies,2);
});

test('selection validates identities before writes, reports missing records and pins complete-view promotion',async t=>{
 const f=await fixture(t),id=f.book.entries[0].id,ids=[id],command={workspaceId:f.book.id,ids},base=await f.reader.selection(command),missing=randomUUID();
 for(const bad of [[],[id,id],Array.from({length:21},()=>randomUUID()),['wrong']])await assert.rejects(f.reader.selection({...command,ids:bad}),{code:'INVALID'});
 await assert.rejects(f.reader.selection({...command,workspaceId:randomUUID()}),{code:'WORKSPACE_CHANGED'});
 const selected=await f.reader.selection({...command,ids:[missing,id]});assert.deepEqual(selected.recordScope.missing,[missing]);validateRecordScope(selected,{workspaceId:f.book.id,ids:[missing,id]});
 const change={workspaceId:f.book.id,baseEtag:base.etag,changes:[{id,expectedRevision:base.recordRevisions[id],record:{...base.book.entries[0],title:'New title'}}]};
 await assert.rejects(f.records.save(change,{compact:true,recordIds:[missing]}),{code:'INVALID'});assert.equal((await f.reader.selection(command)).etag,base.etag);
 await f.records.save(change,{compact:true,recordIds:ids});
 const start=await f.reader.start({snapshotId:base.etag,workspaceId:f.book.id}),page=await f.reader.page({workspaceId:f.book.id,cursor:start.cursor});assert.equal(start.etag,base.etag);assert.equal(page.records.find(r=>r.record.id===id).record.title,base.book.entries[0].title);
 await assert.rejects(f.reader.start({snapshotId:base.etag,workspaceId:randomUUID()}),{code:'WORKSPACE_CHANGED'});
});

test('conflicts keep their original base and scoped history restore leaves unrelated bodies unloaded',async t=>{
 const f=await fixture(t),id=f.book.entries[0].id,ids=[id],base=await f.reader.selection({workspaceId:f.book.id,ids}),history=new RecordHistory(f.workspace,{});
 const changed=await f.records.save({workspaceId:f.book.id,baseEtag:base.etag,changes:[{id,expectedRevision:base.recordRevisions[id],record:{...base.book.entries[0],title:'Revised'}}]},{compact:true,recordIds:ids});
 await assert.rejects(f.records.save({workspaceId:f.book.id,baseEtag:base.etag,changes:[{id,expectedRevision:base.recordRevisions[id],record:base.book.entries[0]}]},{compact:true,recordIds:ids}),{code:'RECORD_CHANGED'});
 const versions=await history.list({workspaceId:f.book.id,recordId:id}),target=versions.versions.at(-1),read=ResearchCatalogue.prototype.read,record=ResearchCatalogue.prototype.record;
 ResearchCatalogue.prototype.read=()=>{throw Error('Full restore read');};ResearchCatalogue.prototype.record=function(recordId,revision){assert.equal(recordId,id);return record.call(this,recordId,revision);};
 try{const result=await history.restore({workspaceId:f.book.id,recordId:id,expectedRevision:changed.recordRevisions[id],baseEtag:changed.etag,...target},{compact:true,recordIds:ids});assert.equal(result.book.entries[0].title,base.book.entries[0].title);assert.equal(result.book.entries[0].share,false);validateRecordScope(result,{workspaceId:f.book.id,ids});}
 finally{ResearchCatalogue.prototype.read=read;ResearchCatalogue.prototype.record=record;}
});

test('invalid scoped responses are rejected before adoption and cancelled selections stop reading',async t=>{
 const f=await fixture(t),ids=[f.book.entries[0].id],options={workspaceId:f.book.id,ids},good=await f.reader.selection(options);
 for(const mutate of [r=>delete r.recordScope,r=>{r.recordPatch={};},r=>{r.outline=true;},r=>r.book.entries.push(r.book.entries[0]),r=>delete r.recordRevisions[ids[0]],r=>r.recordScope.missing.push(ids[0]),r=>r.recordScope.ids.push(randomUUID()),r=>r.recordScope.total++,r=>r.book.id=randomUUID()]){const bad=structuredClone(good);mutate(bad);assert.throws(()=>validateRecordScope(bad,options),{code:'WORKSPACE_READ_INVALID'});}
 const controller=new AbortController();controller.abort();await assert.rejects(f.reader.selection(options,{signal:controller.signal}),{name:'AbortError'});assert.equal((await f.reader.selection(options)).etag,good.etag);
});

test('creation and removal retain bounded selections and original revisions at tenfold corpus size',async t=>{
 for(const count of [40,400]){
  const f=await fixture(t,count),base=await f.workspace.read(),record={...structuredClone(f.book.entries[0]),id:randomUUID(),title:'New field note'};
  const original=f.book.entries[0];
  await f.records.save({workspaceId:f.book.id,changes:[{id:original.id,expectedRevision:recordRevision(original),record:{...original,title:'Concurrent unrelated edit'}}]},{recordIds:[original.id]});
  const old={read:ResearchCatalogue.prototype.read,record:ResearchCatalogue.prototype.record},members=SnapshotIndex.prototype.members,loaded=[];
  ResearchCatalogue.prototype.read=()=>{throw Error('Whole workspace read');};
  SnapshotIndex.prototype.members=()=>{throw Error('Whole membership scan');};
  ResearchCatalogue.prototype.record=function(id,...args){assert.equal(id,record.id);loaded.push(id);return old.record.call(this,id,...args);};
  let saved,removed;
  try{
   saved=await f.records.save({workspaceId:f.book.id,baseEtag:base.etag,changes:[{id:record.id,expectedRevision:null,record}]},{recordIds:[record.id]});
   validateRecordScope(saved,{workspaceId:f.book.id,ids:[record.id]});assert.equal(saved.recordScope.total,count+1);assert.equal(loaded.length,1);
   const command={workspaceId:f.book.id,recordId:record.id,expectedRevision:saved.recordRevisions[record.id]};
   removed=await f.records.remove(command);validateRecordScope(removed,{workspaceId:f.book.id,ids:[record.id]});
   assert.equal(removed.recordScope.total,count);assert.deepEqual(removed.book.entries,[]);assert.deepEqual(removed.recordScope.missing,[record.id]);assert.equal(loaded.length,1,'Removal checks the saved identity without reading the original');
   assert.equal((await f.records.remove(command)).etag,removed.etag,'Retry does not add another snapshot');
   const historical=await f.workspace.catalogue(store=>store.recordSelection([record.id],{snapshotId:saved.etag}));
   assert.deepEqual(historical.book.entries,saved.book.entries);
  }finally{Object.assign(ResearchCatalogue.prototype,old);SnapshotIndex.prototype.members=members;}
  const current=await f.workspace.read();assert.equal(current.book.entries[0].title,'Concurrent unrelated edit');assert.deepEqual(current.book.entries.slice(1),base.book.entries.slice(1));
  t.diagnostic(count+' records: create reads 1 body, remove reads 0 bodies; prior revision retained');
 }
});

test('removal checks revisions, atomically cleans presentation targets and keeps incoming references',async t=>{
 const f=await fixture(t),id=f.book.entries[0].id,other=f.book.entries[1].id;
 const base=await f.workspace.update(book=>{
  book.branding.push({target:'entry:'+id,logos:[{id:randomUUID(),alt:'Original logo'}]});book.website.layouts.push(defaultPageLayout('entry:'+id));
  book.entries[1].relations=[{id:randomUUID(),type:'supports',target:{workspaceId:book.id,kind:'record',id},label:'Source observation'}];
  return book;
 });
 const command={workspaceId:f.book.id,recordId:id,expectedRevision:recordRevision(base.book.entries[0])};
 const revised=await f.records.save({workspaceId:f.book.id,changes:[{id,expectedRevision:command.expectedRevision,record:{...base.book.entries[0],title:'Revised observation'}}]},{recordIds:[id]});
 await assert.rejects(f.records.remove(command),{code:'RECORD_CHANGED'});
 await assert.rejects(f.records.remove({...command,workspaceId:randomUUID()}),{code:'WORKSPACE_CHANGED'});
 for(const bad of [{...command,expectedRevision:null},{...command,recordId:'invalid'},{...command,extra:true}])await assert.rejects(f.records.remove(bad),{code:'INVALID'});
 command.expectedRevision=revised.recordRevisions[id];
 const commit=ResearchCatalogue.prototype.commitChanges;
 ResearchCatalogue.prototype.commitChanges=async function(...args){await commit.apply(this,args);throw Error('Interrupted after index and history writes');};
 try{await assert.rejects(f.records.remove(command),/Interrupted/);}finally{ResearchCatalogue.prototype.commitChanges=commit;}
 assert.equal((await f.workspace.read()).etag,revised.etag);
 await f.records.remove(command);const after=(await f.workspace.read()).book;
 assert.equal(after.branding.some(b=>b.target==='entry:'+id),false);assert.equal(after.website.layouts.some(l=>l.target==='entry:'+id),false);
 assert.deepEqual(after.entries.find(r=>r.id===other),base.book.entries[1]);
});

test('creation bases retain only an absent draft identity and no existing record bodies',()=>{
 const book=upgradeNotebook(sampleNotebook()),id=randomUUID(),etag='a'.repeat(64),recordRevisions=Object.fromEntries(book.entries.map(r=>[r.id,recordRevision(r)]));
 const full={book,etag,recordRevisions},created=recordCreationBase(full,id);
 validateRecordScope(created,{workspaceId:book.id,ids:[id]});assert.deepEqual(created.book.entries,[]);assert.deepEqual(created.recordRevisions,{});
 const outline={book:{...book,entries:[]},etag,outline:true,total:created.recordScope.total,notebookCounts:created.recordScope.notebookCounts};
 assert.deepEqual(recordCreationBase(outline,id),created);
 const selected={...full,book:{...book,entries:[book.entries[0]]},recordScope:{ids:[book.entries[0].id],missing:[],notebookCounts:created.recordScope.notebookCounts,total:book.entries.length}};
 assert.deepEqual(recordCreationBase(selected,id),created);
});

test('batched selections and save acknowledgements stay scoped across growth and concurrent changes',async t=>{
 for(const size of [40,400]){
  const f=await fixture(t,size),ids=f.book.entries.slice(0,25).map(r=>r.id),commands=[],loaded=[];
  const original={read:ResearchCatalogue.prototype.read,record:ResearchCatalogue.prototype.record,recordPatch:ResearchCatalogue.prototype.recordPatch},members=SnapshotIndex.prototype.members;
  ResearchCatalogue.prototype.read=ResearchCatalogue.prototype.recordPatch=()=>{throw Error('Whole workspace reconciliation');};
  SnapshotIndex.prototype.members=()=>{throw Error('Whole membership scan');};
  ResearchCatalogue.prototype.record=function(id,...args){assert.ok(ids.includes(id));loaded.push(id);return original.record.call(this,id,...args);};
  try{
   const reader=recordSelectionReader(async(route,data,options)=>{commands.push(data);return f.reader.selection(data,options);},{workspaceId:f.book.id,ids});
   const opened=await reader.read();assert.deepEqual(opened.book.entries,f.book.entries.slice(0,25));
   assert.deepEqual(commands.map(c=>c.ids.length),[20,5]);assert.equal(commands[1].snapshotId,opened.etag);assert.equal(loaded.length,25);
   const changes=opened.book.entries.map(record=>({id:record.id,expectedRevision:recordRevision(record),record:{...record,title:'Recovered '+record.title}}));
   loaded.length=0;const result=await f.records.save({workspaceId:f.book.id,changes},{receipt:true});
   const receipt=validateRecordReceipt(result,f.book.id);assert.deepEqual(Object.keys(result),['recordReceipt']);assert.ok(JSON.stringify(result).length<200);assert.equal(loaded.length,0,'Stored replacement bases and a receipt do not reconstruct originals');
   const latest=await recordSelectionReader((route,data,options)=>f.reader.selection(data,options),{workspaceId:f.book.id,ids,snapshotId:receipt.etag}).read();
   assert.equal(latest.book.entries[24].title,'Recovered Selected work 24');
   const older=await recordSelectionReader((route,data,options)=>f.reader.selection(data,options),{workspaceId:f.book.id,ids,snapshotId:opened.etag}).read();
   assert.deepEqual(older.book.entries,opened.book.entries);
   await assert.rejects(f.records.save({workspaceId:f.book.id,changes},{receipt:true}),{code:'RECORD_CHANGED'});
   assert.equal((await f.workspace.outline()).etag,receipt.etag);
   await assert.rejects(f.records.save({workspaceId:f.book.id,changes},{receipt:true,recordIds:[ids[0]]}),{code:'INVALID'});
  }finally{Object.assign(ResearchCatalogue.prototype,original);SnapshotIndex.prototype.members=members;}
  assert.deepEqual((await f.workspace.read()).book.entries.slice(25),f.book.entries.slice(25));
  t.diagnostic(size+' saved records: recovery reads 25 originals in 20/5 batches; save returns a body-free acknowledgement.');
 }
});

test('a retried selection stays pinned after concurrent edits and missing identities remain explicit',async t=>{
 const f=await fixture(t,30),ids=f.book.entries.slice(0,24).map(r=>r.id).concat(randomUUID()),calls=[];let fail=true;
 const client=recordSelectionReader(async(route,data,options)=>{
  calls.push(data);if(calls.length===2&&fail)throw Error('Interrupted second batch');return f.reader.selection(data,options);
 },{workspaceId:f.book.id,ids});
 await assert.rejects(client.read(),/Interrupted/);
 const target=f.book.entries[23];
 const changed=await f.records.save({workspaceId:f.book.id,changes:[{id:target.id,expectedRevision:recordRevision(target),record:{...target,title:'Concurrent saved change'}}]},{receipt:true});
 fail=false;const selected=await client.read();
 assert.deepEqual(calls[2],calls[1]);assert.notEqual(selected.etag,changed.recordReceipt.etag);assert.equal(selected.book.entries.at(-1).title,target.title);assert.deepEqual(selected.recordScope.missing,[ids.at(-1)]);
 const current=await recordSelectionReader((route,data,options)=>f.reader.selection(data,options),{workspaceId:f.book.id,ids}).read();assert.equal(current.book.entries.at(-1).title,'Concurrent saved change');
 for(const snapshotId of ['invalid',false])await assert.rejects(f.reader.selection({workspaceId:f.book.id,ids:ids.slice(0,20),snapshotId}),{code:'INVALID'});
 await assert.rejects(f.reader.selection({workspaceId:randomUUID(),ids:ids.slice(0,20),snapshotId:selected.etag}),{code:'WORKSPACE_CHANGED'});
});

test('selection cancellation and malformed pages never expose a partial editor',async t=>{
 const f=await fixture(t,25),ids=f.book.entries.map(r=>r.id),options={workspaceId:f.book.id,ids},controller=new AbortController();let calls=0;
 const client=recordSelectionReader(async(route,data,{signal})=>{const page=await f.reader.selection(data,{signal});if(++calls===2)controller.abort();return page;},options);
 await assert.rejects(client.read({signal:controller.signal}),{name:'AbortError'});
 const completed=await client.read();assert.equal(calls,3);assert.equal(completed.book.entries.length,25);
 for(const mutate of [page=>{page.etag='a'.repeat(64);},page=>{page.book.title='Mismatched metadata';},page=>{page.book.entries.pop();},page=>{page.recordScope.total++;}]){
  let count=0;const reader=recordSelectionReader(async(route,data)=>{
   const page=await f.reader.selection(data);if(++count===2)mutate(page);return page;
  },options);
  await assert.rejects(reader.read(),{code:'WORKSPACE_READ_INVALID'});
 }
 assert.throws(()=>recordSelectionReader(()=>{throw Error('No request expected');},{...options,ids:Array.from({length:1001},()=>randomUUID())}),{code:'WORKSPACE_READ_INVALID'});
 for(const bad of [{},{recordReceipt:{workspaceId:randomUUID(),etag:completed.etag}},{recordReceipt:{workspaceId:f.book.id,etag:'invalid'}},{recordReceipt:{workspaceId:f.book.id,etag:completed.etag},book:{}}])assert.throws(()=>validateRecordReceipt(bad,f.book.id),{code:'WORKSPACE_READ_INVALID'});
});

test('acknowledgements follow atomic commits and support selected history restore',async t=>{
 const f=await fixture(t,25),base=f.book.entries[0],changes=f.book.entries.map(record=>({id:record.id,expectedRevision:recordRevision(record),record:{...record,title:'Changed '+record.title}})),before=await f.workspace.outline(),commit=ResearchCatalogue.prototype.commitChanges;
 ResearchCatalogue.prototype.commitChanges=async function(...args){await commit.apply(this,args);throw Error('Interrupted commit');};
 try{await assert.rejects(f.records.save({workspaceId:f.book.id,changes},{receipt:true}),/Interrupted commit/);}
 finally{ResearchCatalogue.prototype.commitChanges=commit;}
 assert.equal((await f.workspace.outline()).etag,before.etag);
 const saved=await f.records.save({workspaceId:f.book.id,changes},{receipt:true}),history=new RecordHistory(f.workspace,{}),versions=await history.list({workspaceId:f.book.id,recordId:base.id}),target=versions.versions.at(-1);
 const current=(await f.reader.selection({workspaceId:f.book.id,ids:[base.id]})).book.entries[0];
 const restored=await history.restore({workspaceId:f.book.id,recordId:base.id,expectedRevision:recordRevision(current),baseEtag:saved.recordReceipt.etag,...target},{recordIds:[base.id]});
 validateRecordScope(restored,{workspaceId:f.book.id,ids:[base.id]});assert.notEqual(restored.etag,saved.recordReceipt.etag);
 const selected=await f.reader.selection({workspaceId:f.book.id,ids:[base.id],snapshotId:restored.etag});
 assert.equal(selected.book.entries[0].title,base.title);assert.equal(selected.book.entries[0].share,false);
 assert.equal((await f.workspace.read()).book.entries[24].title,'Changed Selected work 24');
});
