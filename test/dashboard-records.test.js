import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {populateImageEvidence} from './image-evidence-fixture.js';
import {clearVault} from '../src/encryption.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {WorkspaceReader} from '../src/workspace-reader.js';
import {workspaceReader} from '../src/web/workspace-reader.js';
import {DashboardRecords} from '../src/dashboard-records.js';
import {defaultPanelConfig} from '../src/web/dashboard-model.js';
import {researchCardItems} from '../src/web/research-card-items.js';
import {queryPanel} from '../src/web/dashboard-queries.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {SnapshotIndex} from '../src/snapshot-index.js';
import {RecordSearchIndex} from '../src/record-search-index.js';
import {DashboardDiscovery} from '../src/dashboard-discovery.js';
import {starterTemplate} from '../src/web/project-templates.js';

async function fixture(t,count,decorate=()=>{}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-dashboard-read-')),book=upgradeNotebook(sampleNotebook()),seed=book.entries[0];
 book.entries=Array.from({length:count},(_,i)=>({...structuredClone(seed),id:randomUUID(),notebookId:book.notebooks[i%book.notebooks.length].id,
  title:'Take '+i,body:'Private evidence '.repeat(40),tags:i%2?['field']:['bench'],status:i%2?'draft':'completed',updatedAt:new Date(Date.UTC(2026,0,1,0,i)).toISOString(),attachments:[],sections:[],relations:[],figures:[]}));
 decorate(book);const f=await encryptedFixture(directory,book,{populate:workspace=>populateImageEvidence(workspace,book.entries.flatMap(r=>r.attachments.filter(a=>a.kind==='image').map(a=>a.id)))});
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 return {...f,book,reader:new WorkspaceReader(f.workspace),cards:new DashboardRecords(f.workspace)};
}

test('lab-book type cards discover summaries and load only their selected page across tenfold growth',async t=>{
 for(const count of [65,650]){
  const f=await fixture(t,count,book=>{
   book.notebooks.push({...structuredClone(book.notebooks[0]),id:randomUUID(),title:'Computing'});
   book.entries.forEach((record,i)=>{record.notebookId=book.notebooks[i%2].id;});
   book.notebooks[0].configuration=starterTemplate('research-development').configuration;
   book.notebooks[1].configuration=starterTemplate('computer-it').configuration;
   book.entries.forEach((r,i)=>{r.template={id:randomUUID(),profileId:i%4?'research-development':'computer-it',label:'Study',description:'',fields:[],values:{}};});
  }),etag=(await f.workspace.outline()).etag,provider='laboratory-research-development-records',expected=f.book.entries.filter(r=>r.notebookId===f.book.notebooks[0].id&&r.template.profileId==='research-development');
  const original=ResearchCatalogue.prototype.record;let bodies=0;
  t.mock.method(ResearchCatalogue.prototype,'record',function(...args){bodies++;return original.apply(this,args);});
  t.mock.method(ResearchCatalogue.prototype,'read',()=>{throw Error('Whole workspace for a profile card');});
  const discovery=await new DashboardDiscovery(f.workspace).read({workspaceId:f.book.id,etag,provider,search:'',offset:0,limit:12});
  assert.equal(discovery.total,expected.length);assert.equal(bodies,0);
  const command={workspaceId:f.book.id,etag,provider,config:defaultPanelConfig(),options:{},limit:5,key:null};
  const start=performance.now(),first=await f.cards.read(command);assert.equal(first.total,expected.length);assert.equal(bodies,5);assert.ok(first.records.every(r=>expected.some(e=>e.id===r.id)));
  bodies=0;const next=await f.cards.read({...command,cursor:first.nextCursor});assert.equal(bodies,5);assert.equal(next.offset,5);assert.ok(next.records.every(r=>!first.records.some(e=>e.id===r.id)));
  assert.deepEqual((await f.cards.read({...command,cursor:next.previousCursor})).records,first.records);
  bodies=0;const rejected=await f.cards.read({...command,key:f.book.entries[0].id});assert.equal(rejected.total,0);assert.equal(bodies,0);
  const searched=await f.cards.read({...command,options:{search:'Private evidence'}});assert.equal(searched.total,expected.length);
  await assert.rejects(f.cards.read({...command,provider:'laboratory-computer-it-records',cursor:first.nextCursor}),{code:'RECORD_QUERY_CURSOR'});
  assert.ok(performance.now()-start<15000);t.mock.restoreAll();
  t.diagnostic(JSON.stringify({count,visible:5,discoveryBodies:0,ms:Math.round(performance.now()-start)}));
 }
});

test('dashboard startup reads zero bodies, and a visible card reads at most its requested seven bodies at tenfold growth',async t=>{
 for(const count of [42,420]){
  const f=await fixture(t,count),previous={read:ResearchCatalogue.prototype.read,manifest:ResearchCatalogue.prototype.manifest,record:ResearchCatalogue.prototype.record};let bodies=0,pages=0;
  ResearchCatalogue.prototype.read=ResearchCatalogue.prototype.manifest=()=>{throw Error('Complete workspace assembled');};
  ResearchCatalogue.prototype.record=function(...args){bodies++;return previous.record.apply(this,args);};
  try{
   const client=workspaceReader((route,data,options)=>{if(route.endsWith('/start'))return f.reader.start(options);pages++;return f.reader.page(data,options);});
   const outline=await client.read({metadataOnly:true});assert.equal(outline.outline,true);assert.equal(bodies,0);assert.equal(pages,0);
   assert.deepEqual(outline.book.entries,[]);assert.equal(Object.values(outline.notebookCounts).reduce((sum,n)=>sum+n,0),count);
   const command={workspaceId:f.book.id,etag:outline.etag,config:defaultPanelConfig(),options:{},limit:7,key:null};
   const card=await f.cards.read(command);assert.equal(bodies,7);assert.equal(card.total,count);
   assert.deepEqual(card.records.map(r=>r.id),queryPanel(f.book,{config:command.config,options:{}}).entries.slice(0,7).map(r=>r.id));
   bodies=0;const pinned=await f.cards.read({...command,key:f.book.entries[0].id,limit:1});assert.equal(bodies,1);assert.equal(pinned.records[0].id,f.book.entries[0].id);
   bodies=0;const empty=await f.cards.read({...command,options:{scopeMode:'selected',projectIds:[],includeWorkspace:false}});assert.deepEqual(empty.records,[]);assert.equal(bodies,0);
   t.diagnostic(count+' records: metadata-only startup; seven bodies for the visible card and one for a pinned item.');
  }finally{Object.assign(ResearchCatalogue.prototype,previous);}
 }
});

test('card filters preserve project unions, exact saved revisions, and empty selections',async t=>{
 const f=await fixture(t,42),start=await f.reader.start(),command={workspaceId:f.book.id,etag:start.etag,config:defaultPanelConfig(),options:{scopeMode:'selected',projectIds:[f.book.projects[0].id],includeDescendants:true,includeWorkspace:false,tag:'bench',status:'completed'},limit:7,key:null};
 const expected=queryPanel(f.book,{config:{...command.config,...command.options},options:command.options}).entries.slice(0,7);
 assert.deepEqual((await f.cards.read(command)).records,expected);
 const record=f.book.entries[0];await new ResearchRecords(f.workspace,{}).save({workspaceId:f.book.id,baseEtag:start.etag,changes:[{id:record.id,expectedRevision:recordRevision(record),record:{...record,title:'Changed after opening'}}]},{compact:true});
 assert.deepEqual((await f.cards.read(command)).records,expected);
 await assert.rejects(f.cards.read({...command,workspaceId:randomUUID()}),{code:'WORKSPACE_CHANGED'});
 await assert.rejects(f.cards.read({...command,limit:101}),{code:'INVALID'});
 await assert.rejects(f.cards.read({...command,options:{recordType:true}}),{code:'INVALID'});
 await assert.rejects(f.cards.read({...command,options:{scopeMode:'selected',projectIds:[randomUUID()]}}),{code:'RECORD_VIEW_SCOPE'});
 await assert.rejects(f.cards.read(command,{signal:AbortSignal.abort()}),{name:'AbortError'});
});

test('older summaries retain their identities and still show exact recent records without rewriting on read',async t=>{
 const f=await fixture(t,12),start=await f.reader.start();
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{
  const snapshot=await store.snapshot(start.etag),rows=await Array.fromAsync(store.members(snapshot));
  delete snapshot.typeIndex;delete snapshot.recentIndex;delete snapshot.readingIndex;delete snapshot.publicationIndex;
  rows.forEach(row=>{delete row.updatedAt;delete row.template;delete row.cardItems;});
  snapshot.membership=await new SnapshotIndex(store).build(rows);
  snapshot.searchIndex=await new RecordSearchIndex(store).build(snapshot);
  await store.db.run('UPDATE snapshots SET payload=$1 WHERE id=$2',store.encode('snapshot',start.etag,snapshot),start.etag);
 }));
 const before=await f.workspace.catalogue(store=>store.snapshot(start.etag));
 const card=await f.cards.read({workspaceId:f.book.id,etag:start.etag,config:defaultPanelConfig(),options:{},limit:3,key:null});
 assert.deepEqual(card.records,f.book.entries.slice(-3).reverse());
 const credits=await f.cards.read({workspaceId:f.book.id,etag:start.etag,config:defaultPanelConfig(),options:{},provider:'contributors',limit:3,key:null});
 assert.deepEqual(credits.items,f.book.entries.toReversed().flatMap(record=>researchCardItems('contributors',record)).slice(0,3));
 await f.workspace.catalogue(store=>store.verifySnapshot(start.etag,f.book.id));
 assert.deepEqual(await f.workspace.catalogue(store=>store.snapshot(start.etag)),before);
 assert.deepEqual((await f.workspace.read()).book,f.book);
});

test('metadata-only loading rejects incomplete or misleading lab-book counts',async t=>{
 const f=await fixture(t,12),start=await f.reader.start();
 const mutations=[value=>{value.notebookCounts={};},value=>{value.notebookCounts=[];},value=>{value.notebookCounts=null;},value=>{value.notebookCounts=0;},value=>{value.notebookCounts[start.metadata.notebooks[0].id]++;},value=>{value.notebookCounts[start.metadata.notebooks[0].id]=-1;}];
 for(const mutate of mutations){
  const corrupt=structuredClone(start);mutate(corrupt);let requests=0;
  const client=workspaceReader(async()=>{requests++;return corrupt;});
  await assert.rejects(client.read({metadataOnly:true}),{code:'WORKSPACE_READ_INVALID'});assert.equal(requests,1);
 }
});

test('nested research cards retrieve only the requested original items and keep old snapshots intact',async t=>{
 for(const count of [42,420]){
  const f=await fixture(t,count,book=>{for(const [i,record] of book.entries.entries()){
   record.contributors=i%3===0?[]:Array.from({length:3},(_,j)=>({id:randomUUID(),name:'Contributor '+i+' / '+j,role:'Reviewer'}));
   record.sections=[{id:randomUUID(),title:'Method '+i,body:'Section content '+i}];
   record.figures=[{...structuredClone(sampleNotebook().entries[0].figures[0]),id:randomUUID(),title:'Measured height '+i}];
   record.attachments=[{id:randomUUID(),kind:'image',caption:'Field image '+i,alt:'Synthetic field image',transcript:'',share:false}];
   record.relations=[{id:randomUUID(),label:'Supports '+i,type:'Supports',target:{workspaceId:book.id,kind:'record',id:book.entries[0].id}}];
  }}),start=await f.reader.start(),base={workspaceId:f.book.id,etag:start.etag,config:defaultPanelConfig(),options:{},limit:7,key:null};
  const original={record:ResearchCatalogue.prototype.record,read:ResearchCatalogue.prototype.read};let bodies=0;
  ResearchCatalogue.prototype.read=()=>{throw Error('Card assembled the workspace');};
  ResearchCatalogue.prototype.record=function(...args){bodies++;return original.record.apply(this,args);};
  try{
   for(const provider of ['contributors','sections','relations','figures','files','media']){
    const expected=f.book.entries.toReversed().flatMap(record=>researchCardItems(provider,record));bodies=0;
    const result=await f.cards.read({...base,provider});assert.deepEqual(result.items,expected.slice(0,7));assert.equal(result.total,expected.length);assert.ok(bodies<=7);assert.equal(result.records,undefined);
    if(provider==='contributors')assert.ok(!JSON.stringify(result).includes('Private evidence'));
    if(expected.length){bodies=0;const item=expected.at(-1),pinned=await f.cards.read({...base,provider,key:item.key});assert.deepEqual(pinned.items,[item]);assert.equal(bodies,1);}
   }
   await assert.rejects(f.cards.read({...base,provider:'__proto__'}),{code:'INVALID'});
   t.diagnostic(count+' records: nested cards read at most seven owning records; pinned items read one.');
  }finally{Object.assign(ResearchCatalogue.prototype,original);}
  const command={...base,provider:'contributors'},before=await f.cards.read(command),record=f.book.entries.at(-1);
  await new ResearchRecords(f.workspace,{}).save({workspaceId:f.book.id,baseEtag:start.etag,changes:[{id:record.id,expectedRevision:recordRevision(record),record:{...record,contributors:[],attachments:[]}}]},{compact:true});
  const after=await f.cards.read(command);assert.deepEqual(after.items,before.items);assert.equal(after.total,before.total);
 }
});

test('card cursors page within a record, pin exact revisions and reject reuse with other filters',async t=>{
 const f=await fixture(t,12,book=>{for(const record of book.entries)record.contributors=Array.from({length:9},(_,i)=>({id:randomUUID(),name:'Credit '+i,role:'Analysis'}));}),start=await f.reader.start();
 const command={workspaceId:f.book.id,etag:start.etag,config:defaultPanelConfig(),options:{},limit:7,key:null,provider:'contributors'},first=await f.cards.read(command),expected=f.book.entries.toReversed().flatMap(record=>researchCardItems('contributors',record));
 const record=f.book.entries.at(-1);await new ResearchRecords(f.workspace,{}).save({workspaceId:f.book.id,baseEtag:start.etag,changes:[{id:record.id,expectedRevision:recordRevision(record),record:{...record,contributors:[],attachments:[]}}]},{compact:true});
 const found=[...first.items];let cursor=first.nextCursor,last=first;
 assert.equal(first.previousCursor,null);
 while(cursor){const result=await f.cards.read({...command,cursor});assert.equal(result.offset,found.length);assert.ok(result.items.length<=7);found.push(...result.items);cursor=result.nextCursor;last=result;}
 assert.deepEqual(found,expected);assert.deepEqual((await f.cards.read({...command,cursor:first.cursor})).items,first.items);
 const backwards=[...last.items];
 while(last.previousCursor){
  const result=await f.cards.read({...command,cursor:last.previousCursor});
  assert.equal(result.offset+result.items.length,last.offset);assert.ok(result.items.length<=7);
  assert.deepEqual(result.items,expected.slice(result.offset,result.offset+result.items.length));
  assert.deepEqual((await f.cards.read({...command,cursor:result.cursor})).items,result.items);
  assert.deepEqual((await f.cards.read({...command,cursor:result.nextCursor})).items,expected.slice(last.offset,last.offset+7));
  backwards.unshift(...result.items);last=result;
 }
 assert.deepEqual(backwards,expected);assert.equal(last.offset,0);
 await assert.rejects(f.cards.read({...command,cursor:first.nextCursor,options:{tag:'bench'}}),{code:'RECORD_QUERY_CURSOR'});
 await assert.rejects(f.cards.read({...command,cursor:first.nextCursor,provider:'sections'}),{code:'RECORD_QUERY_CURSOR'});
 const corrupt=Buffer.from(first.nextCursor,'base64url');corrupt[30]^=1;await assert.rejects(f.cards.read({...command,cursor:corrupt.toString('base64url')}),{code:'RECORD_QUERY_CURSOR'});
});

test('card pages bound transmitted bodies by bytes without truncating an oversized record',async t=>{
 const f=await fixture(t,4,book=>{for(const record of book.entries){record.body='Evidence '.repeat(6500);record.sections=Array.from({length:5},(_,i)=>({id:randomUUID(),title:'Part '+i,body:'Original '.repeat(6500)}));}}),start=await f.reader.start();
 const base={workspaceId:f.book.id,etag:start.etag,config:defaultPanelConfig(),options:{},limit:100,key:null,provider:'records'};
 const first=await f.cards.read(base);assert.equal(first.records.length,1);assert.deepEqual(first.records[0],f.book.entries.at(-1));assert.ok(first.nextCursor);
 const sections=await f.cards.read({...base,provider:'sections'});assert.ok(sections.items.length>0&&sections.items.length<20);assert.ok(Buffer.byteLength(JSON.stringify(sections.items))<256*1024);assert.ok(sections.nextCursor);
 const more=await f.cards.read({...base,provider:'sections',cursor:sections.nextCursor});assert.equal(more.offset,sections.items.length);assert.equal(more.items[0].key,researchCardItems('sections',f.book.entries.at(-1))[sections.items.length].key);
 for(const provider of ['records','sections']){
  const rows=result=>provider==='records'?result.records:result.items,expected=provider==='records'?f.book.entries.toReversed():f.book.entries.toReversed().flatMap(record=>researchCardItems(provider,record));
  let result=await f.cards.read({...base,provider}),found=[...rows(result)];
  while(result.nextCursor){const next=await f.cards.read({...base,provider,cursor:result.nextCursor});assert.equal(next.offset,result.offset+rows(result).length);found.push(...rows(next));result=next;}
  assert.deepEqual(found,expected);found=[...rows(result)];
  while(result.previousCursor){const previous=await f.cards.read({...base,provider,cursor:result.previousCursor});assert.equal(previous.offset+rows(previous).length,result.offset);found.unshift(...rows(previous));result=previous;}
  assert.deepEqual(found,expected);
 }
});

test('backward pages keep bounded reads and stable ordering for tied timestamps and filtered scopes',async t=>{
 const f=await fixture(t,42,book=>{for(const record of book.entries)record.updatedAt=book.entries[0].updatedAt;}),start=await f.reader.start();
 const command={workspaceId:f.book.id,etag:start.etag,config:defaultPanelConfig(),options:{tag:'bench'},limit:4,key:null,provider:'records'};
 const expected=f.book.entries.filter(record=>record.tags.includes('bench')).sort((a,b)=>a.id.localeCompare(b.id)),original=ResearchCatalogue.prototype.record;let bodies=0;
 ResearchCatalogue.prototype.record=function(...args){bodies++;return original.apply(this,args);};
 try{
  let page=await f.cards.read(command);
  while(page.nextCursor){bodies=0;page=await f.cards.read({...command,cursor:page.nextCursor});assert.ok(bodies<=4);}
  const found=[...page.records];
  while(page.previousCursor){
   bodies=0;const previous=await f.cards.read({...command,cursor:page.previousCursor});assert.ok(bodies<=4);
   assert.equal(previous.offset+previous.records.length,page.offset);assert.ok(previous.previousCursor===null||previous.previousCursor.length<1024);
   found.unshift(...previous.records);page=previous;
  }
  assert.deepEqual(found,expected);
 }finally{ResearchCatalogue.prototype.record=original;}
});
