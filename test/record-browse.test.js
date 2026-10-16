import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault,encrypted} from '../src/encryption.js';
import {RecordQuery} from '../src/record-query.js';
import {RecordViews} from '../src/record-views.js';
import {ResearchRecords,recordRevision,recordRevisions} from '../src/research.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {Workspace} from '../src/storage.js';
import {copyWorkspace,copyPlan} from '../src/locations.js';
import {queryFixture} from './record-query-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {queryRecords,recordBrowse,recordQueryDocument} from '../src/web/record-query.js';
import {recordsIn} from '../src/web/workspace-structure.js';
import {applyRecordPatch} from '../src/web/record-patch.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {digest,serialize} from '../src/storage-format.js';
const query=(extra={})=>({projectId:null,notebookId:null,filter:'all',search:'',browse:recordBrowse(),...extra});
async function fixture(t,book=upgradeNotebook(queryFixture())){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-record-browse-')),f=await encryptedFixture(directory,book);
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 return {...f,directory,book,queries:new RecordQuery(f.workspace),records:new ResearchRecords(f.workspace,{})};
}
const visible=records=>records.map(record=>{const {searchText,referenceTargets,cardSources,...value}=recordQueryDocument(record);return value;});

test('target selection pages pin saved revisions, filter before pagination and never read bodies',async t=>{
 const book=upgradeNotebook(sampleNotebook()),source={...book.entries[0],figures:[],contributors:[],sections:[],relations:[]};
 book.entries=Array.from({length:63},(_,i)=>({...source,id:randomUUID(),title:'Target '+i,type:i%3?'note':'run',body:'Private original '+i}));
 const f=await fixture(t,book),command={workspaceId:book.id,query:query({browse:recordBrowse({sort:'title'})}),selection:{excludeId:book.entries[0].id,recordType:'all'}};
 book.entries=(await f.workspace.read()).book.entries;
 const read=ResearchCatalogue.prototype.read,record=ResearchCatalogue.prototype.record;
 ResearchCatalogue.prototype.read=()=>{throw Error('Whole workspace loaded for target picker');};
 ResearchCatalogue.prototype.record=()=>{throw Error('Body loaded for target picker');};
 let first;
 try{
  first=await f.queries.list(command);assert.equal(first.total,62);assert.equal(first.records.length,25);assert.deepEqual(first.recordTypes,[]);assert.deepEqual(first.domains,[]);
  const allScopes=await f.queries.list({...command,selection:{excludeId:null,recordType:'all'}});
  assert.equal(allScopes.total,63);assert.equal(allScopes.records.length,25);assert.deepEqual(allScopes.recordTypes,[]);assert.deepEqual(allScopes.domains,[]);
  await assert.rejects(f.queries.list({...command,selection:{excludeId:null,recordType:'all'},cursor:first.nextCursor}),{code:'RECORD_QUERY_CURSOR'});
  const second=await f.queries.list({...command,cursor:first.nextCursor}),third=await f.queries.list({...command,cursor:second.nextCursor});
  assert.deepEqual((await f.queries.list({...command,cursor:second.previousCursor})).records,first.records);
  const all=[...first.records,...second.records,...third.records];assert.equal(new Set(all.map(r=>r.id)).size,62);assert.equal(third.nextCursor,null);
  for(const row of all)assert.equal(row.revision,recordRevision(book.entries.find(r=>r.id===row.id)));
  assert.ok(!JSON.stringify(first).includes('Private original'));assert.ok(JSON.stringify(first).length<22000);
  for(const [type,total] of [['run',20],['non-run',42]]){
   const selected=await f.queries.list({...command,selection:{...command.selection,recordType:type}});assert.equal(selected.total,total);assert.ok(selected.records.every(r=>type==='run'?r.type==='run':r.type!=='run'));
   await assert.rejects(f.queries.list({...command,selection:{...command.selection,recordType:type},cursor:first.nextCursor}),{code:'RECORD_QUERY_CURSOR'});
  }
 }finally{ResearchCatalogue.prototype.read=read;ResearchCatalogue.prototype.record=record;}
 const selected=first.records[0],original=book.entries.find(r=>r.id===selected.id);
 const updated=await f.records.save({workspaceId:book.id,changes:[{id:original.id,expectedRevision:selected.revision,record:{...original,title:'Revised method'}}]},{recordIds:[original.id]}),changed=updated.book.entries[0];
 const anchored=await f.queries.list({...command,cursor:first.cursor});assert.equal(anchored.changed,true);assert.deepEqual(anchored.records,first.records);
 const materials=new ResearchMaterials(f.workspace);await assert.rejects(materials.pinRecord(selected.id,selected.revision),{code:'RECORD_CHANGED'});
 const current=await f.queries.list({...command,query:query({search:'Revised method'})}),pin=await materials.pinRecord(selected.id,current.records[0].revision);
 await f.records.save({workspaceId:book.id,changes:[{id:changed.id,expectedRevision:recordRevision(changed),record:{...changed,body:'Later method'}}]});
 assert.deepEqual(await materials.read(pin),changed);
 for(const selection of [{...command.selection,recordType:'invented'}, {...command.selection,excludeId:'bad'}, {...command.selection,unexpected:true}])await assert.rejects(f.queries.list({...command,selection}),{code:'INVALID'});
 await assert.rejects(f.queries.list({...command,selection:null,cursor:first.nextCursor}),{code:'RECORD_QUERY_CURSOR'});
});

test('encrypted browsing shares filters and scopes without loading record bodies; saved views use only metadata',async t=>{
 const f=await fixture(t),queries=[query(),query({projectId:f.book.projects[0].id,browse:recordBrowse({tags:'sound,summer',from:'2026-06-01',to:'2026-06-30'})}),query({notebookId:f.book.notebooks[1].id,search:'stopped'}),query({browse:recordBrowse({domain:'arts-creative',sort:'title'})}),query({browse:recordBrowse({tags:'wildlife,sound',tagMode:'any',status:'completed'})})];
 const read=ResearchCatalogue.prototype.read,record=ResearchCatalogue.prototype.record;
 ResearchCatalogue.prototype.read=()=>{throw Error('Full workspace loaded during query');};
 ResearchCatalogue.prototype.record=()=>{throw Error('Record body loaded during query');};
 try{
  for(const q of queries){
   const result=await f.queries.list({workspaceId:f.book.id,query:q});
   assert.deepEqual(result.records,visible(queryRecords(recordsIn(f.book,q.projectId),{...q,notebook:q.notebookId??'all'})));
   assert.ok(result.records.every(r=>!('searchText' in r)&&!('body' in r)&&!('figures' in r)&&!('cardSources' in r)));
  }
  const views=new RecordViews(f.workspace),view={id:randomUUID(),name:'Sound studies',query:queries[1]};
  const saved=await views.save({workspaceId:f.book.id,expectedRevision:null,view});
  assert.equal((await views.list({workspaceId:f.book.id})).views[0].name,view.name);
  await views.remove({workspaceId:f.book.id,id:view.id,expectedRevision:saved.view.revision});
 }finally{ResearchCatalogue.prototype.read=read;ResearchCatalogue.prototype.record=record;}
 await assert.rejects(f.queries.list({workspaceId:f.book.id,query:query({notebookId:randomUUID()})}),{code:'RECORD_VIEW_SCOPE'});
 await assert.rejects(f.queries.list({workspaceId:randomUUID(),query:query()}),{code:'WORKSPACE_CHANGED'});
});

test('pages remain stable during new saves, bound their payload and open current content with a compact patch',async t=>{
 const book=upgradeNotebook(sampleNotebook()),source={...book.entries[0],figures:[],contributors:[],sections:[],type:'note'};
 book.entries=Array.from({length:63},(_,i)=>({...source,id:randomUUID(),title:'Study '+i,body:'PRIVATE BODY SENTINEL '.repeat(100),status:i%3?'completed':'incomplete'}));
 const f=await fixture(t,book),base=await f.workspace.read(),q=query({search:'private body sentinel',browse:recordBrowse({sort:'title'})});
 const first=await f.queries.list({workspaceId:book.id,query:q});assert.equal(first.total,63);assert.equal(first.records.length,25);
 assert.ok(!JSON.stringify(first.records).includes('PRIVATE BODY SENTINEL'));assert.ok(JSON.stringify(first).length<20000);
 const changed={...base.book.entries[0],title:'Changed study'},added={...source,id:randomUUID(),title:'New study',body:'PRIVATE BODY SENTINEL'};
 await f.records.save({workspaceId:book.id,baseEtag:base.etag,changes:[{id:changed.id,expectedRevision:recordRevision(base.book.entries[0]),record:changed},{id:added.id,expectedRevision:null,record:added}]},{compact:true});
 const second=await f.queries.list({workspaceId:book.id,query:q,cursor:first.nextCursor}),third=await f.queries.list({workspaceId:book.id,query:q,cursor:second.nextCursor});
 assert.equal(second.changed,true);assert.equal(third.nextCursor,null);assert.equal(third.records.length,13);
 assert.deepEqual([...first.records,...second.records,...third.records].map(r=>r.id),queryRecords(base.book.entries,q).map(r=>r.id));
 assert.equal((await f.queries.list({workspaceId:book.id,query:q})).total,64);
 const opened=await f.queries.open({workspaceId:book.id,recordId:added.id,baseEtag:base.etag});assert.equal(opened.recordPatch.records.length,2);
 assert.deepEqual(applyRecordPatch(base.book,base.etag,recordRevisions(base.book),opened).book,(await f.workspace.read()).book);
 const tampered=Buffer.from(first.nextCursor,'base64url');tampered[50]^=1;
 await assert.rejects(f.queries.list({workspaceId:book.id,query:q,cursor:tampered.toString('base64url')}),{code:'RECORD_QUERY_CURSOR'});
 await assert.rejects(f.queries.list({workspaceId:book.id,query:query(),cursor:first.nextCursor}),{code:'RECORD_QUERY_CURSOR'});
 await assert.rejects(f.queries.list({workspaceId:book.id,query:q,limit:0}),{code:'INVALID'});
});

test('derived search documents stay encrypted, roll back with failed saves, survive backup and reject corruption',async t=>{
 const f=await fixture(t),base=await f.workspace.read(),record=base.book.entries[0];
 const before=await f.workspace.catalogue(async store=>({rows:Number((await store.db.get("SELECT count(*) AS n FROM state WHERE starts_with(slot,'record-query:')")).n),head:await store.head()}));
 const original=ResearchCatalogue.prototype.putRecord;
 ResearchCatalogue.prototype.putRecord=async()=>{throw Error('Interrupted save after search indexing');};
 try{await assert.rejects(f.records.save({workspaceId:f.book.id,changes:[{id:record.id,expectedRevision:recordRevision(record),record:{...record,title:'Never committed'}}]}),/Interrupted save/);}
 finally{ResearchCatalogue.prototype.putRecord=original;}
 await f.workspace.catalogue(async store=>{
  assert.equal(await store.head(),before.head);assert.equal(Number((await store.db.get("SELECT count(*) AS n FROM state WHERE starts_with(slot,'record-query:')")).n),before.rows);
  for(const row of await store.db.all("SELECT payload FROM state WHERE starts_with(slot,'record-query:')")){assert.ok(encrypted(Buffer.from(row.payload)));assert.ok(!Buffer.from(row.payload).includes(Buffer.from('Shared measurement notes')));}
 });
 const command={workspaceId:f.book.id,query:query(),limit:2},first=await f.queries.list(command);
 const backup=await copyWorkspace(await copyPlan(f.workspace.root,path.join(f.directory,'backup')),{vault:f.vault});
 const copy=new RecordQuery(new Workspace(backup,f.vault));
 assert.deepEqual((await copy.list({...command,cursor:first.nextCursor})).records,(await f.queries.list({...command,cursor:first.nextCursor})).records);
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{
  const row=(await store.manifest()).records[0];await store.db.run('DELETE FROM state WHERE slot=$1','record-summary:'+row.id+':'+row.summaryRevision);
 }));
 await assert.rejects(f.queries.list(command),{code:'CATALOGUE_DAMAGED'});
 assert.deepEqual(await f.workspace.read(),base); // Original records are independent of the damaged derivative.
 clearVault(f.vault);await assert.rejects(f.queries.list(command),{code:'ACCESS_LOCKED'});
});

test('cancelled queries stop scanning and release their read transaction',async t=>{
 const f=await fixture(t),controller=new AbortController(),original=ResearchCatalogue.prototype.queryDocuments;let seen=0;
 ResearchCatalogue.prototype.queryDocuments=async function*(...args){for await(const value of original.apply(this,args)){if(++seen===2)controller.abort();yield value;}};
 try{await assert.rejects(f.queries.list({workspaceId:f.book.id,query:query()},{signal:controller.signal}),{name:'AbortError'});}
 finally{ResearchCatalogue.prototype.queryDocuments=original;}
 assert.equal(seen,2);assert.equal((await f.queries.list({workspaceId:f.book.id,query:query()})).total,f.book.entries.length);
});

test('date pages preserve declared precision, ties and unknown dates in both directions',async t=>{
 const book=upgradeNotebook(sampleNotebook()),source={...book.entries[0],figures:[],contributors:[],sections:[],type:'note'};
 const dates=['2026-06-13',{kind:'unknown'},{kind:'month',value:'2026-06',estimated:true},{kind:'year',value:'2025',estimated:false},{kind:'range',from:'2026-06-10',to:'2026-06-20',estimated:true},'2026-06-13'];
 book.entries=Array.from({length:35},(_,i)=>({...source,id:randomUUID(),title:'Study '+i,occurredOn:dates[i%dates.length]}));
 const f=await fixture(t,book);
 for(const sort of ['date-asc','date-desc']){
  const q=query({browse:recordBrowse({sort})}),seen=[];let cursor=null;
  do{
   const page=await f.queries.list({workspaceId:book.id,query:q,limit:4,cursor});
   assert.equal(page.offset,seen.length);assert.equal(page.total,35);seen.push(...page.records);cursor=page.nextCursor;
  }while(cursor);
  assert.deepEqual(seen,visible(queryRecords(book.entries,q)));
  assert.equal(new Set(seen.map(r=>r.id)).size,35);assert.deepEqual(seen.at(-1).occurredOn,{kind:'unknown'});
  // Backwards traversal needs only the current page, not a browser cursor trail.
  let page=await f.queries.list({workspaceId:book.id,query:q,limit:4});
  while(page.nextCursor)page=await f.queries.list({workspaceId:book.id,query:q,limit:4,cursor:page.nextCursor});
  while(page.previousCursor){
   const offset=page.offset-4;page=await f.queries.list({workspaceId:book.id,query:q,limit:4,cursor:page.previousCursor});
   assert.equal(page.offset,offset);assert.deepEqual(page.records,seen.slice(offset,offset+4));
  }
  assert.equal(page.offset,0);assert.equal(page.previousCursor,null);
 }
});

test('older target summaries resolve only the chosen page and canonical revision caches are verified',async t=>{
 const book=upgradeNotebook(sampleNotebook()),source=book.entries[2];
 book.entries=Array.from({length:40},(_,i)=>({...source,id:randomUUID(),title:'Older target '+i}));
 const putQuery=ResearchCatalogue.prototype.putQuery;
 const cache=function(withRevision){return async function(record){
  const value={...recordQueryDocument(record),...(withRevision?{recordRevision:'0'.repeat(64)}:{})},revision=digest(serialize(value)),slot='record-query:'+record.id+':'+revision;
  await this.db.run('INSERT INTO state VALUES ($1,$2) ON CONFLICT(slot) DO NOTHING',slot,this.encode('state',slot,value));return {queryRevision:revision};
 };};
 let f;
 try{ResearchCatalogue.prototype.putQuery=cache(false);f=await fixture(t,book);}
 finally{ResearchCatalogue.prototype.putQuery=putQuery;}
 const command={workspaceId:book.id,query:query({browse:recordBrowse({sort:'title'})}),selection:{excludeId:book.entries[0].id,recordType:'all'},limit:5};
 const record=ResearchCatalogue.prototype.record,read=ResearchCatalogue.prototype.read,loaded=[];
 ResearchCatalogue.prototype.record=function(id,...args){loaded.push(id);return record.call(this,id,...args);};
 ResearchCatalogue.prototype.read=()=>{throw Error('Whole workspace read during old-summary fallback');};
 try{
  const page=await f.queries.list(command);assert.equal(page.total,39);assert.deepEqual(loaded.sort(),page.records.map(r=>r.id).sort());assert.equal(loaded.length,5);
  for(const row of page.records)assert.equal(row.revision,recordRevision(book.entries.find(r=>r.id===row.id)));
 }finally{ResearchCatalogue.prototype.record=record;ResearchCatalogue.prototype.read=read;}
 await f.workspace.catalogue(store=>store.verifySnapshot(undefined,book.id));
 try{
  ResearchCatalogue.prototype.putQuery=cache(true);
  const original=book.entries[0];await f.records.save({workspaceId:book.id,changes:[{id:original.id,expectedRevision:recordRevision(original),record:{...original,title:'Damaged derived cache'}}]},{recordIds:[original.id]});
 }finally{ResearchCatalogue.prototype.putQuery=putQuery;}
 await assert.rejects(f.workspace.catalogue(store=>store.verifySnapshot(undefined,book.id)),{code:'CATALOGUE_DAMAGED'});
});

test('page discovery can pin the first query to the editor snapshot without resolving record revisions',async t=>{
 const book=upgradeNotebook(sampleNotebook()),seed=book.entries[0];
 book.entries=Array.from({length:55},(_,i)=>({...structuredClone(seed),id:randomUUID(),title:'Page '+String(i).padStart(2,'0'),body:'PRIVATE PAGE ORIGINAL',relations:[],attachments:[]}));
 const f=await fixture(t,book),base=await f.workspace.read();
 const changed={...base.book.entries[0],title:'Later title'};
 const current=await f.records.save({workspaceId:book.id,changes:[{id:changed.id,expectedRevision:recordRevision(base.book.entries[0]),record:changed}]},{compact:true});
 const command={workspaceId:book.id,snapshotId:base.etag,query:query({browse:recordBrowse({sort:'title'})}),selection:{excludeId:null,recordType:'all',includeRevisions:false}};
 const read=ResearchCatalogue.prototype.read,record=ResearchCatalogue.prototype.record,documents=ResearchCatalogue.prototype.queryDocuments;
 ResearchCatalogue.prototype.read=()=>{throw Error('Whole workspace loaded for page discovery');};
 ResearchCatalogue.prototype.record=()=>{throw Error('Original loaded for page discovery');};
 // A destination does not need a canonical content revision, including when
 // an older cached query document has not stored one yet.
 ResearchCatalogue.prototype.queryDocuments=async function*(...args){for await(const value of documents.apply(this,args))yield {...value,revision:null};};
 try{
  const first=await f.queries.list(command),second=await f.queries.list({...command,cursor:first.nextCursor}),third=await f.queries.list({...command,cursor:second.nextCursor});
  assert.equal(first.snapshotId,base.etag);assert.equal(first.changed,true);assert.equal(first.records[0].title,'Page 00');
  assert.deepEqual([...first.records,...second.records,...third.records].map(r=>r.id),book.entries.map(r=>r.id));assert.equal(third.nextCursor,null);
  assert.deepEqual((await f.queries.list({...command,cursor:second.previousCursor})).records,first.records);
  assert.deepEqual(first.recordTypes,[]);assert.deepEqual(first.domains,[]);assert.ok(!JSON.stringify(first).includes('PRIVATE PAGE ORIGINAL'));
  assert.ok(first.records.every(r=>!Object.hasOwn(r,'storageRevision')));
  const search=await f.queries.list({...command,query:query({search:'Page 00',browse:recordBrowse({sort:'title'})})});assert.equal(search.total,1);
  await assert.rejects(f.queries.list({...command,snapshotId:current.etag,cursor:first.nextCursor}),{code:'RECORD_QUERY_CURSOR'});
  await assert.rejects(f.queries.list({...command,selection:{...command.selection,includeRevisions:true},cursor:first.nextCursor}),{code:'RECORD_QUERY_CURSOR'});
  await assert.rejects(f.queries.list({...command,snapshotId:'bad'}),{code:'INVALID'});
  await assert.rejects(f.queries.list({...command,selection:{...command.selection,includeRevisions:'false'}}),{code:'INVALID'});
  await assert.rejects(f.queries.list({...command,workspaceId:randomUUID()}),{code:'WORKSPACE_CHANGED'});
 }finally{ResearchCatalogue.prototype.read=read;ResearchCatalogue.prototype.record=record;ResearchCatalogue.prototype.queryDocuments=documents;}
});
