import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {Workspace} from '../src/storage.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {ResearchCatalogue,catalogueDescriptor} from '../src/research-catalogue.js';
import {SnapshotIndex} from '../src/snapshot-index.js';
import {ResearchRecords,recordRevision,recordRevisions} from '../src/research.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {RecordHistory} from '../src/record-history.js';
import {RecordQuery} from '../src/record-query.js';
import {recordBrowse} from '../src/web/record-query.js';
import {applyRecordPatch} from '../src/web/record-patch.js';
import {recordUpdateReader} from '../src/web/record-update-reader.js';
import {WorkspaceReader} from '../src/workspace-reader.js';
import {createRun} from '../src/web/record-workflow.js';
import {copyWorkspace,copyPlan} from '../src/locations.js';
import {WorkspaceEdits} from '../src/workspace-edits.js';
async function fixture(t,count=16){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-snapshot-index-')),book=upgradeNotebook(sampleNotebook()),seed=book.entries[0];
 book.entries=Array.from({length:count},(_,n)=>({...structuredClone(seed),id:randomUUID(),title:'Private source '+n,attachments:[],relations:[],sections:[{id:randomUUID(),title:'Evidence',body:''}]}));
 const {workspace:ws,vault}=await encryptedFixture(directory,book);
 t.after(async()=>{clearVault(vault);await rm(directory,{recursive:true,force:true});});
 return {directory,ws,vault,service:new ResearchRecords(ws,{}),base:await ws.read()};
}
const save=(f,base,records)=>f.service.save({workspaceId:base.book.id,baseEtag:base.etag,changes:records.map(record=>({id:record.id,expectedRevision:base.book.entries.some(r=>r.id===record.id)?recordRevision(base.book.entries.find(r=>r.id===record.id)):null,record}))},{compact:true});
const state=ws=>ws.catalogue(s=>s.db.all("SELECT slot,payload FROM state WHERE starts_with(slot,'snapshot-index:') OR starts_with(slot,'record-member:') ORDER BY slot"));

test('old browser bases reconcile insertions, deletions and repeated edits without loading unchanged membership or history',async t=>{
 // Fixed budgets for each refresh: <=350 index reads, <=8 snapshot reads and
 // exactly two changed bodies, for both the baseline and tenfold workload.
 for(const count of [42,420]){
  const f=await fixture(t,count),{ws,base}=f;let current=base.book.entries[0],etag=base.etag;
  for(let i=0;i<70;i++){
   const result=await f.service.save({workspaceId:base.book.id,baseEtag:etag,changes:[{id:current.id,expectedRevision:recordRevision(current),record:{...current,title:'Repeated take '+i}}]},{compact:true});
   current=result.recordPatch.records[0];etag=result.etag;
  }
  const added={...structuredClone(current),id:randomUUID(),sections:[],title:'New independent take'},temporary={...added,id:randomUUID(),title:'Temporary note'};
  const insertion=await f.service.save({workspaceId:base.book.id,baseEtag:etag,changes:[added,temporary].map(record=>({id:record.id,expectedRevision:null,record}))},{compact:true});
  const transient=insertion.recordPatch.records.find(r=>r.id===temporary.id),removed=base.book.entries[1];
  await new WorkspaceEdits(ws,{}).save({workspaceId:base.book.id,baseEtag:insertion.etag,metadata:{title:'Updated workspace title'},projects:[],changes:[],removed:[removed,transient].map(r=>({id:r.id,expectedRevision:recordRevision(r)}))});
  const prior={read:ResearchCatalogue.prototype.read,manifest:ResearchCatalogue.prototype.manifest,record:ResearchCatalogue.prototype.record,decode:ResearchCatalogue.prototype.decode},members=SnapshotIndex.prototype.members;
  let bodies=0,nodes=0,snapshots=0,result;
  ResearchCatalogue.prototype.read=ResearchCatalogue.prototype.manifest=()=>{throw Error('Full catalogue assembly during refresh');};
  SnapshotIndex.prototype.members=()=>{throw Error('Full membership enumeration during refresh');};
  ResearchCatalogue.prototype.record=function(...args){bodies++;return prior.record.apply(this,args);};
  ResearchCatalogue.prototype.decode=function(table,id,...args){if(id.startsWith('snapshot-index:'))nodes++;if(table==='snapshot')snapshots++;return prior.decode.call(this,table,id,...args);};
  try{
   result=await new WorkspaceReader(ws).changes({workspaceId:base.book.id,baseEtag:base.etag});
   assert.equal(result.recordPatch.order,null);assert.deepEqual(result.recordPatch.appended,[added.id]);
   assert.deepEqual(result.recordPatch.removed,[removed.id]);assert.equal(bodies,2);assert.ok(nodes<=350,'index reads: '+nodes);assert.ok(snapshots<=8,'snapshot reads: '+snapshots);
   t.diagnostic(count+' records after 72 saves: '+nodes+' index reads, '+snapshots+' snapshot reads, '+bodies+' changed bodies.');
  }finally{Object.assign(ResearchCatalogue.prototype,prior);SnapshotIndex.prototype.members=members;}
  assert.deepEqual(applyRecordPatch(base.book,base.etag,recordRevisions(base.book),result).book,(await ws.read()).book);
  assert.equal(result.recordPatch.metadata.title,'Updated workspace title');
  assert.ok(!result.recordPatch.records.some(r=>r.id===temporary.id));
  await assert.rejects(ws.catalogue(store=>store.recordPatch(base.etag,{signal:AbortSignal.abort()})),{name:'AbortError'});
 }
});

test('reordering retained records sends identities without rereading unchanged bodies',async t=>{
 const {ws,base}=await fixture(t,16),book=structuredClone(base.book);book.entries.reverse();
 await ws.save(book,base.etag);
 const record=ResearchCatalogue.prototype.record,manifest=ResearchCatalogue.prototype.manifest;
 ResearchCatalogue.prototype.record=ResearchCatalogue.prototype.manifest=()=>{throw Error('Unchanged body or complete manifest loaded');};
 let result;
 try{const first=await ws.catalogue(store=>store.recordPatch(base.etag));result=await recordUpdateReader((route,data,options)=>new WorkspaceReader(ws).changePage(data,options),first).read();}
 finally{ResearchCatalogue.prototype.record=record;ResearchCatalogue.prototype.manifest=manifest;}
 assert.deepEqual(result.recordPatch.order,book.entries.map(r=>r.id));assert.deepEqual(result.recordPatch.records,[]);
 assert.deepEqual(applyRecordPatch(base.book,base.etag,recordRevisions(base.book),result).book,(await ws.read()).book);
});

test('point ownership, history and concurrent record saves avoid full membership scans as the book grows',async t=>{
 for(const count of [32,384]){
  const f=await fixture(t,count),{base,ws}=f,a=base.book.entries[0],b=base.book.entries[1],before=await state(ws);
  const manifest=ResearchCatalogue.prototype.manifest,read=ResearchCatalogue.prototype.read,members=SnapshotIndex.prototype.members,decode=ResearchCatalogue.prototype.decode;
  let indexReads=0,recordReads=0,snapshotBytes=0;
  const record=ResearchCatalogue.prototype.record;
  ResearchCatalogue.prototype.manifest=()=>{throw Error('Full membership scan');};
  ResearchCatalogue.prototype.read=()=>{throw Error('Full record load');};
  SnapshotIndex.prototype.members=()=>{throw Error('Full membership iterator');};
  ResearchCatalogue.prototype.decode=function(table,id,bytes){if(id.startsWith('snapshot-index:'))indexReads++;if(table==='snapshot')snapshotBytes=Math.max(snapshotBytes,bytes.length);return decode.call(this,table,id,bytes);};
  ResearchCatalogue.prototype.record=function(...args){recordReads++;return record.apply(this,args);};
  let first,second;
  try{
   first=await save(f,base,[{...a,title:'First saved take'}]);
   assert.equal(first.recordPatch.order,null);assert.equal(first.recordPatch.records.length,1);
   assert.ok(indexReads<250,'point save index-read budget: '+indexReads);
   assert.ok(recordReads<=2,'only the saved body and response body are loaded');
   t.diagnostic(count+' records: one save decoded '+indexReads+' index nodes and '+recordReads+' record bodies.');
   indexReads=0;
   second=await save(f,base,[{...b,title:'Concurrent field study'}]);
   assert.equal(second.recordPatch.records.length,2);assert.equal(second.recordPatch.order,null);
   const owned=await new ResearchMaterials(ws).owner(a.id);assert.equal(owned.entries[0].title,'First saved take');
   const history=new RecordHistory(ws,{}),command={workspaceId:base.book.id,recordId:a.id},page=await history.list(command);
   assert.equal(page.versions.length,2);
   assert.equal((await history.read({...command,...page.versions.at(-1)})).record.title,a.title);
   assert.ok(snapshotBytes<Buffer.byteLength(JSON.stringify(base.book))+2000);
  }finally{
   ResearchCatalogue.prototype.manifest=manifest;ResearchCatalogue.prototype.read=read;SnapshotIndex.prototype.members=members;ResearchCatalogue.prototype.decode=decode;ResearchCatalogue.prototype.record=record;
  }
  const patched=applyRecordPatch(base.book,base.etag,recordRevisions(base.book),second),current=await ws.read();
  assert.deepEqual(patched.book,current.book);
  const after=await state(ws),afterMap=new Map(after.map(r=>[r.slot,r.payload]));
  assert.ok(before.every(row=>afterMap.get(row.slot)?.equals(row.payload)),'retained ciphertext is immutable');
  assert.ok(after.length-before.length<100,'two edits retain only affected paths: '+(after.length-before.length));
  await ws.catalogue(async s=>{
   const old=await s.snapshot(base.etag),head=await s.snapshot();
   assert.equal(old.count,count);assert.equal(head.count,count);
   assert.equal((await s.member(old,a.id)).revision,(await s.member(await s.snapshot(base.etag),a.id)).revision);
   assert.ok(Buffer.byteLength(JSON.stringify(head))<Buffer.byteLength(JSON.stringify(head.metadata))+2500);
  });
 }
});

test('indexed validation preserves global section identities and run parent rules atomically',async t=>{
 const f=await fixture(t),{ws,base}=f,a=base.book.entries[0],b=base.book.entries[1];
 const replace=SnapshotIndex.prototype.replace;let scratchCreates=0;
 SnapshotIndex.prototype.replace=async function(...args){
  const prototype=Object.getPrototypeOf(this.store.db),run=prototype.run;
  prototype.run=function(sql,...values){if(sql.startsWith('CREATE TEMP TABLE '))scratchCreates++;return run.call(this,sql,...values);};
  try{return await replace.apply(this,args);}finally{prototype.run=run;}
 };
 t.after(()=>{SnapshotIndex.prototype.replace=replace;});
 await assert.rejects(save(f,base,[{...a,sections:[{...a.sections[0],id:b.sections[0].id}]}]),{code:'INVALID'});
 await assert.rejects(save(f,base,[{...a,sections:[{...a.sections[0],id:b.id}]}]),{code:'INVALID'});
 assert.equal((await ws.read()).etag,base.etag);
 // A deliberate section move is one transaction; both IDs must stay unique.
 const moved=await save(f,base,[{...a,sections:[]},{...b,sections:[...b.sections,a.sections[0]]}]);
 const current=await ws.read(),parent=current.book.entries[0],child=createRun(current.book,parent,{uuid:randomUUID});
 await save(f,current,[child]);
 const withRun=await ws.read();
 await assert.rejects(save(f,withRun,[{...withRun.book.entries[0],type:'run'}]),{code:'INVALID'});
 // The same command may turn the former child into an independent record.
 await save(f,withRun,[{...withRun.book.entries[0],type:'run'},{...withRun.book.entries.at(-1),type:'observation',relations:[]}]);
 assert.equal((await ws.read()).book.entries.at(-1).type,'observation');
 assert.ok(moved.recordPatch.records.some(r=>r.sections.some(section=>section.id===a.sections[0].id)));
 assert.equal(scratchCreates,0,'Small membership edits must not create scratch tables');
 const prior=await ws.read(),expanded={...prior.book.entries[1],sections:Array.from({length:260},(_,i)=>({id:randomUUID(),title:'Section '+i,body:'Retained finding'}))};
 await save(f,prior,[expanded]);assert.ok(scratchCreates>0,'A larger identity set must spill instead of retaining unbounded memory');
 const large=await ws.read();assert.deepEqual(large.book.entries[1].sections,expanded.sections);
 const retained=await ws.catalogue(s=>s.read(prior.etag));assert.deepEqual(retained,prior);
 await ws.withLock(()=>ws.catalogue(async store=>{
  const snapshot=await store.snapshot(),row=await store.member(snapshot,expanded.id),memberIndex=new SnapshotIndex(store);
  await assert.rejects(memberIndex.replace(snapshot.membership,[],[row,row]),{code:'CATALOGUE_DAMAGED'});
  throw Object.assign(Error('Rollback duplicate member attempt'),{code:'TEST_ROLLBACK'});
 })).then(()=>assert.fail('Expected rollback'),error=>assert.equal(error.code,'TEST_ROLLBACK'));
 assert.deepEqual(await ws.read(),large);

 await ws.catalogue(s=>s.verify(catalogueDescriptor(base.book)));
});

test('failed snapshot commits roll back every new index node; restored copies retain old membership',async t=>{
 const f=await fixture(t),{ws,base}=f,before=await state(ws),original=ResearchCatalogue.prototype.rememberHistory;
 ResearchCatalogue.prototype.rememberHistory=()=>{throw Object.assign(Error('Simulated disk full'),{code:'ENOSPC'});};
 try{await assert.rejects(save(f,base,[{...base.book.entries[0],title:'Interrupted save'}]),{code:'ENOSPC'});}
 finally{ResearchCatalogue.prototype.rememberHistory=original;}
 assert.deepEqual(await state(ws),before);assert.deepEqual(await ws.read(),base);
 const result=await save(f,base,[{...base.book.entries[0],title:'Recovered save'}]);
 const copy=await copyWorkspace(await copyPlan(ws.root,path.join(f.directory,'restored')),{vault:f.vault}),restored=new Workspace(copy,f.vault);
 assert.deepEqual(await restored.read(),await ws.read());
 assert.deepEqual(await restored.catalogue(s=>s.read(base.etag)),base);
 const book=structuredClone((await ws.read()).book);book.entries=book.entries.slice(1).reverse();
 const deleted=await ws.save(book,result.etag),first=await ws.catalogue(s=>s.recordPatch(base.etag)),patch=await recordUpdateReader((route,data,options)=>new WorkspaceReader(ws).changePage(data,options),first).read();
 assert.deepEqual(applyRecordPatch(base.book,base.etag,recordRevisions(base.book),patch).book,deleted.book);
 assert.equal((await restored.read()).book.entries.length,base.book.entries.length);
});

test('missing or swapped immutable branches fail closed and legacy snapshots update in place',async t=>{
 const f=await fixture(t),{ws,base}=f;
 // Simulate a retained flat snapshot without changing its identity or contents.
 await ws.withLock(()=>ws.catalogue(async s=>{const manifest=await s.manifest(base.etag);await s.db.run('UPDATE snapshots SET payload=$2 WHERE id=$1',base.etag,s.encode('snapshot',base.etag,manifest));}));
 await save(f,base,[{...base.book.entries[0],title:'Indexed in the same workspace'}]);
 const head=await ws.catalogue(s=>s.snapshot()),slot='snapshot-index:'+head.membership.hash,db=await ws.openCatalogue();
 try{
  const row=await db.get('SELECT payload FROM state WHERE slot=$1',slot);
  await db.run('DELETE FROM state WHERE slot=$1',slot);
  await assert.rejects(new ResearchMaterials(ws).owner(base.book.entries[0].id),{code:'CATALOGUE_DAMAGED'});
  await assert.rejects(ws.catalogue(s=>s.verify(catalogueDescriptor(base.book))),{code:'CATALOGUE_DAMAGED'});
  await db.run('INSERT INTO state VALUES ($1,$2)',slot,row.payload);
  const other=await db.get("SELECT payload FROM state WHERE starts_with(slot,'snapshot-index:') AND slot<>$1 LIMIT 1",slot);
  await db.run('UPDATE state SET payload=$2 WHERE slot=$1',slot,other.payload);
  await assert.rejects(new ResearchMaterials(ws).owner(base.book.entries[0].id),e=>['ENCRYPTION_DAMAGED','CATALOGUE_DAMAGED'].includes(e.code));
  await db.run('UPDATE state SET payload=$2 WHERE slot=$1',slot,row.payload);
 }finally{await db.close();}
 assert.deepEqual(await ws.catalogue(s=>s.read(base.etag)),base);
});

test('lab-book browsing visits only the selected encrypted branch and keeps pages pinned after a move',async t=>{
 const f=await fixture(t,192),{ws}=f,book=structuredClone(f.base.book);
 const other={...structuredClone(book.notebooks[0]),id:randomUUID(),title:'Field listening'};book.notebooks.push(other);
 book.entries.slice(-3).forEach(record=>record.notebookId=other.id);
 const base=await ws.save(book,f.base.etag),query={projectId:null,notebookId:other.id,filter:'all',search:'',browse:recordBrowse()},service=new RecordQuery(ws);
 const original={manifest:ResearchCatalogue.prototype.manifest,read:ResearchCatalogue.prototype.read,record:ResearchCatalogue.prototype.record,decode:ResearchCatalogue.prototype.decode};
 let members=0;
 ResearchCatalogue.prototype.manifest=()=>{throw Error('Assembled snapshot during scoped browse');};
 ResearchCatalogue.prototype.read=()=>{throw Error('Full book during scoped browse');};
 ResearchCatalogue.prototype.record=()=>{throw Error('Record body during scoped browse');};
 ResearchCatalogue.prototype.decode=function(table,id,bytes){if(id.startsWith('record-member:'))members++;return original.decode.call(this,table,id,bytes);};
 let first;
 try{
  first=await service.list({workspaceId:book.id,query,limit:2});
  assert.equal(first.total,3);assert.equal(first.records.length,2);assert.equal(members,3,'other lab books stay unread');
 }finally{for(const [key,fn] of Object.entries(original))ResearchCatalogue.prototype[key]=fn;}
 await save(f,base,[{...base.book.entries[0],notebookId:other.id}]);
 const next=await service.list({workspaceId:book.id,query,limit:2,cursor:first.nextCursor});
 assert.equal(next.total,3);assert.equal(next.records.length,1);assert.equal(next.changed,true);
 assert.deepEqual(new Set([...first.records,...next.records].map(r=>r.id)),new Set(book.entries.slice(-3).map(r=>r.id)));
 assert.equal((await service.list({workspaceId:book.id,query})).total,4);
});

test('backup verification rejects incomplete or cyclic save deltas rather than hiding concurrent edits',async t=>{
 const f=await fixture(t,5),{ws,base}=f;
 const result=await save(f,base,[{...base.book.entries[0],title:'Retained revised interpretation'}]);
 const snapshot=await ws.catalogue(s=>s.snapshot(result.etag));
 for(const delta of [{...snapshot.delta,changed:[]},{...snapshot.delta,parent:result.etag}]){
  await ws.withLock(()=>ws.catalogue(s=>s.db.run('UPDATE snapshots SET payload=$2 WHERE id=$1',result.etag,s.encode('snapshot',result.etag,{...snapshot,delta}))));
  try{await assert.rejects(ws.catalogue(s=>s.verify(catalogueDescriptor(base.book))),{code:'CATALOGUE_DAMAGED'});}
  finally{await ws.withLock(()=>ws.catalogue(s=>s.db.run('UPDATE snapshots SET payload=$2 WHERE id=$1',result.etag,s.encode('snapshot',result.etag,snapshot))));}
 }
 await ws.catalogue(s=>s.verify(catalogueDescriptor(base.book)));
});
