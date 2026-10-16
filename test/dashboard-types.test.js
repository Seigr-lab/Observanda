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
import {RecordTypeIndex} from '../src/record-type-index.js';
import {DashboardRecords} from '../src/dashboard-records.js';
import {DashboardTypeQuery} from '../src/dashboard-type-query.js';
import {dashboardRecordTypeChoices} from '../src/web/dashboard-record-type-choices.js';
import {defaultPanelConfig} from '../src/web/dashboard-model.js';
import {RECORD_TYPES} from '../src/web/record-types.js';
import {compareTitles,compareKey} from '../src/web/query-order.js';
const order=(a,b)=>compareTitles(a.label,b.label)||compareKey(a.value,b.value);
async function fixture(t,count=70,decorate=()=>{}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-dashboard-types-')),book=upgradeNotebook(sampleNotebook()),seed=book.entries[0];
 book.notebooks.push({...structuredClone(book.notebooks[0]),id:randomUUID(),title:'Other records'});
 book.entries=Array.from({length:count},(_,i)=>({...structuredClone(seed),id:randomUUID(),title:'Record '+i,body:'Private source',notebookId:book.notebooks[i%book.notebooks.length].id,
  updatedAt:new Date(Date.UTC(2026,0,1,0,i)).toISOString(),attachments:[],sections:[],relations:[],figures:[],
  template:{id:randomUUID(),profileId:null,label:'Type '+i,description:'',fields:[],values:{}}}));
 decorate(book);const f=await encryptedFixture(directory,book);
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const etag=await f.workspace.catalogue(store=>store.head());
 return {...f,book,query:new DashboardTypeQuery(f.workspace),command:{workspaceId:book.id,etag,config:defaultPanelConfig(),options:{},search:'',cursor:null,limit:25}};
}
test('type discovery pages alphabetically without originals or membership scans and pins scope, search and snapshot',async t=>{
 for(const count of [70,700]){
 const f=await fixture(t,count),methods={record:ResearchCatalogue.prototype.record,read:ResearchCatalogue.prototype.read,members:ResearchCatalogue.prototype.members};
 for(const key of Object.keys(methods))ResearchCatalogue.prototype[key]=()=>{throw Error('Discovery loaded '+key);};
 try{
  const first=await f.query.read(f.command),second=await f.query.read({...f.command,cursor:first.nextCursor});
  assert.equal(first.items.length,25);assert.equal(first.total,count+10);assert.equal(first.previousCursor,null);
  assert.deepEqual((await f.query.read({...f.command,cursor:second.previousCursor})).items,first.items);
  const all=[...first.items,...second.items];let next=second;
  while(next.nextCursor){next=await f.query.read({...f.command,cursor:next.nextCursor});assert.ok(next.items.length<=25);all.push(...next.items);}
  const expected=[...RECORD_TYPES.map(v=>({value:v.id,label:v.label})),...f.book.entries.map(e=>({value:'template:'+e.template.id,label:e.template.label}))].sort(order);
  assert.deepEqual(all,expected);assert.equal(next.offset,Math.floor((count+9)/25)*25);assert.equal(next.items.length,(count+9)%25+1);
  const selected=f.book.entries.at(-1).template,value='template:'+selected.id;
  const searched=await f.query.read({...f.command,search:'Type 1',options:{recordType:value}});
  assert.deepEqual(searched.selected,{value,label:selected.label});assert.equal(searched.total,f.book.entries.filter(r=>r.template.label.includes('Type 1')).length);
  assert.ok(searched.items.every(item=>item.label.includes('Type 1')));
  const scoped=await f.query.read({...f.command,options:{notebookMode:'selected',notebookIds:[f.book.notebooks[0].id]},search:'Type'});
  assert.equal(scoped.total,f.book.entries.filter(e=>e.notebookId===f.book.notebooks[0].id).length);
  const empty=await f.query.read({...f.command,options:{scopeMode:'selected',projectIds:[],includeWorkspace:false}});assert.equal(empty.total,10);
  assert.ok(Buffer.byteLength(JSON.stringify(first))<16000);t.diagnostic(count+' distinct types: at most 25 choices, no originals or membership scans.');
  await assert.rejects(f.query.read({...f.command,cursor:first.nextCursor,search:'changed'}),{code:'RECORD_QUERY_CURSOR'});
  const bytes=Buffer.from(first.nextCursor,'base64url');bytes[20]^=1;
  await assert.rejects(f.query.read({...f.command,cursor:bytes.toString('base64url')}),{code:'RECORD_QUERY_CURSOR'});
  await assert.rejects(f.query.read({...f.command,workspaceId:randomUUID()}),{code:'WORKSPACE_CHANGED'});
  await assert.rejects(f.query.read({...f.command,limit:26}),{code:'INVALID'});
  await assert.rejects(f.query.read({...f.command,options:{notebookMode:'selected',notebookIds:[randomUUID()]}}),{code:'RECORD_VIEW_SCOPE'});
  await assert.rejects(f.query.read(f.command,{signal:AbortSignal.abort()}),{name:'AbortError'});
 }finally{Object.assign(ResearchCatalogue.prototype,methods);}
 const card=await new DashboardRecords(f.workspace).read({workspaceId:f.book.id,etag:f.command.etag,config:f.command.config,options:{},limit:3,key:null});
 assert.equal(card.records.length,3);assert.equal(Object.hasOwn(card,'recordTypes'),false);
 }
});
test('type index tracks edited and moved records, deduplicates renamed types, and verifies completeness',async t=>{
 const f=await fixture(t,6,book=>{book.entries.at(-1).template={...book.entries[0].template,label:'Renamed type'};}),service=new ResearchRecords(f.workspace,{}),before=await f.query.read(f.command),first=f.book.entries[0],last=f.book.entries.at(-1);
 const replacement={...last,notebookId:first.notebookId};
 const saved=await service.save({workspaceId:f.book.id,baseEtag:f.command.etag,changes:[{id:last.id,expectedRevision:recordRevision(last),record:replacement}]},{compact:true});
 const command={...f.command,etag:saved.etag,search:'type'},after=await f.query.read(command);
 assert.equal(after.total,5);assert.equal(after.items.filter(v=>v.value==='template:'+first.template.id).length,1);
 assert.ok(after.items.some(v=>v.label==='Renamed type'));
 assert.deepEqual(await f.query.read(f.command),before);
 await f.workspace.catalogue(async store=>new RecordTypeIndex(store).verify(await store.snapshot()));
 const record=saved.recordPatch.records.find(r=>r.id===last.id);
 const removed=await service.save({workspaceId:f.book.id,baseEtag:saved.etag,changes:[{id:last.id,expectedRevision:recordRevision(record),record:{...record,template:null}}]},{compact:true});
 const reverted=await f.query.read({...command,etag:removed.etag});assert.ok(reverted.items.some(v=>v.label===first.template.label));assert.equal(reverted.total,5);
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{const snapshot=await store.snapshot();snapshot.typeIndex.root=null;await store.db.run('UPDATE snapshots SET payload=$1 WHERE id=$2',store.encode('snapshot',removed.etag,snapshot),removed.etag);}));
 await assert.rejects(f.workspace.catalogue(async store=>new RecordTypeIndex(store).verify(await store.snapshot())),{code:'CATALOGUE_DAMAGED'});
});
test('retained pre-index snapshots use bounded identity windows without writes and gain an index on save',async t=>{
 const f=await fixture(t,140);
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{const snapshot=await store.snapshot();delete snapshot.typeIndex;await store.db.run('UPDATE snapshots SET payload=$1 WHERE id=$2',store.encode('snapshot',f.command.etag,snapshot),f.command.etag);}));
 const original=await f.workspace.catalogue(store=>store.snapshot()),all=[];let cursor=null;
 do{const page=await f.query.read({...f.command,search:'Type',cursor});all.push(...page.items);cursor=page.nextCursor;}while(cursor);
 assert.equal(all.length,140);assert.equal(new Set(all.map(v=>v.value)).size,140);assert.deepEqual(all,[...all].sort(order));
 assert.deepEqual(await f.workspace.catalogue(store=>store.snapshot()),original);
 const record=f.book.entries[0];await new ResearchRecords(f.workspace,{}).save({workspaceId:f.book.id,changes:[{id:record.id,expectedRevision:recordRevision(record),record:{...record,title:'Edited'}}]},{compact:true});
 await f.workspace.catalogue(async store=>{const next=await store.snapshot();assert.ok(next.typeIndex);await new RecordTypeIndex(store).verify(next);});
});

test('choice adapter rejects unbounded, foreign and inconsistent replies',async()=>{
 const book={id:randomUUID()},panel={config:defaultPanelConfig(),options:{}},context={book,etag:'pinned'};
 const valid={workspaceId:book.id,etag:context.etag,items:[{value:'experiment',label:'Experiment'}],selected:null,total:1,offset:0,nextCursor:null,previousCursor:null};
 const load=result=>dashboardRecordTypeChoices.loadChoices({api:async()=>result,context,panel,search:'',cursor:null});
 assert.deepEqual(await load(valid),valid);
 for(const change of [{workspaceId:randomUUID()},{items:Array(26).fill(valid.items[0])},{offset:1},{total:2},{previousCursor:'wrong'},{nextCursor:'wrong'},{selected:{value:'note',label:'Note'}},{items:[{value:'experiment',label:'x'.repeat(161)}]}])await assert.rejects(load({...valid,...change}),/choices response is invalid/);
});

test('old summaries with no ownership or template fields still obey the selected lab book without rewriting history',async t=>{
 const f=await fixture(t,6);
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{
  const snapshot=await store.snapshot(),records=await Array.fromAsync(store.members(snapshot));
  for(const row of records)for(const key of ['notebookId','template','updatedAt','queryRevision','summaryRevision'])delete row[key];
  const legacy={metadata:snapshot.metadata,records};
  await store.db.run('UPDATE snapshots SET payload=$1 WHERE id=$2',store.encode('snapshot',f.command.etag,legacy),f.command.etag);
 }));
 const before=await f.workspace.catalogue(store=>store.snapshot());
 const result=await f.query.read({...f.command,search:'Type',options:{notebookMode:'selected',notebookIds:[f.book.notebooks[0].id]}});
 assert.equal(result.total,3);
 assert.deepEqual(new Set(result.items.map(v=>v.value)),new Set(f.book.entries.filter(r=>r.notebookId===f.book.notebooks[0].id).map(r=>'template:'+r.template.id)));
 assert.deepEqual(await f.workspace.catalogue(store=>store.snapshot()),before);
});
