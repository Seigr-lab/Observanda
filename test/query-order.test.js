import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {digest,serialize} from '../src/storage-format.js';
import {RecordQuery} from '../src/record-query.js';
import {DashboardRecords} from '../src/dashboard-records.js';
import {TimelineQuery} from '../src/timeline-query.js';
import {queryRecords,recordBrowse} from '../src/web/record-query.js';
import {defaultPanelConfig} from '../src/web/dashboard-model.js';
import {runsOf} from '../src/web/record-workflow.js';
import {sectionItems} from '../src/web/website-model.js';
import {createDataRegistry} from '../src/web/data-registry.js';
import {registerResearchData} from '../src/web/research-data.js';
import {queryPanel} from '../src/web/dashboard-queries.js';
import {timelineDefaults,timelineQuery,timelineOrder} from '../src/web/tools/timeline-model.js';
import {copyPlan,copyWorkspace} from '../src/locations.js';
import {Workspace} from '../src/storage.js';

const ids=['aaaaaaaa','bbbbbbbb','cccccccc','dddddddd'].map(prefix=>prefix+'-0000-4000-8000-000000000000');
function fixtureBook(){
 const book=upgradeNotebook(sampleNotebook()),seed=book.entries[0];
 book.entries=['Aardvark 10','Bee','Aardvark 2','Bee'].map((title,i)=>({...structuredClone(seed),id:ids[i],title,occurredOn:'2026-06-01',updatedAt:'2026-06-01T00:00:00.000Z',figures:[],sections:[],relations:[]}));
 return book;
}
// Simulate hosts with opposite default collation without changing comparisons
// that explicitly declare their locale. Norwegian orders "aa" after "b".
async function defaultLocale(locale,run){
 const compare=String.prototype.localeCompare;
 String.prototype.localeCompare=function(other,locales,options){return compare.call(this,other,locales??locale,options);};
 try{return await run();}finally{String.prototype.localeCompare=compare;}
}

test('English title order, date ties and recent cards agree across English and Norwegian hosts',async()=>{
 assert.ok('aa'.localeCompare('b','en')<0);assert.ok('aa'.localeCompare('b','nb')>0);
 const book=fixtureBook(),panel={config:defaultPanelConfig(),options:{}},registry=createDataRegistry();registerResearchData(registry);
 for(const locale of ['en','nb'])await defaultLocale(locale,()=>{
  assert.deepEqual(queryRecords(book.entries,{browse:{sort:'title'}}).map(r=>r.id),[ids[2],ids[0],ids[1],ids[3]]);
  assert.deepEqual(queryRecords(book.entries,{browse:{sort:'date-asc'}}).map(r=>r.id),ids);
  assert.deepEqual(queryPanel(book,panel).entries.map(r=>r.id),ids);
  assert.deepEqual(registry.get('records').items({book},null).map(r=>r.key),ids);
  assert.deepEqual([...book.entries].sort(timelineOrder(timelineDefaults())).map(r=>r.id),ids);
  assert.deepEqual(sectionItems({kind:'records'},{entries:book.entries,notebooks:book.notebooks}).map(r=>r.id),ids);
  const runs=book.entries.map(r=>({...r,type:'run',relations:[{role:'run-of',target:{workspaceId:book.id,id:'investigation'}}]}));
  assert.deepEqual(runsOf({...book,entries:runs},'investigation').map(r=>r.id),ids);
 });
});

test('record, dashboard and timeline cursors survive a restored workspace with another host locale',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-portable-order-')),book=fixtureBook(),f=await encryptedFixture(directory,book);
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const etag=await f.workspace.catalogue(s=>s.head()),query={projectId:null,notebookId:null,filter:'all',search:'',browse:recordBrowse({sort:'title'})};
 const records={workspaceId:book.id,query,limit:2},cards={workspaceId:book.id,etag,config:defaultPanelConfig(),options:{},limit:2,key:null,provider:'records'},timeline={workspaceId:book.id,query:timelineQuery(timelineDefaults()),limit:2};
 const readers=workspace=>[command=>new RecordQuery(workspace).list(command),command=>new DashboardRecords(workspace).read(command),command=>new TimelineQuery(workspace).list(command)];
 const commands=[records,cards,timeline],expected=[[ids[2],ids[0],ids[1],ids[3]],ids,ids],first=[];
 await defaultLocale('nb',async()=>{for(const [i,read] of readers(f.workspace).entries())first.push(await read(commands[i]));});
 const destination=await copyWorkspace(await copyPlan(f.workspace.root,path.join(directory,'restored')),{vault:f.vault}),restored=new Workspace(destination,f.vault);
 await defaultLocale('en',async()=>{
  for(const [i,read] of readers(restored).entries()){
   const second=await read({...commands[i],cursor:first[i].nextCursor});
   assert.deepEqual([...first[i].records,...second.records].map(r=>r.id),expected[i]);
   assert.deepEqual((await read({...commands[i],cursor:second.previousCursor})).records,first[i].records);
  }
 });
 // Pre-versioned cursors must restart, rather than being silently reinterpreted.
 const old=await f.workspace.catalogue(store=>{
  const encode=(kind,cursor,change)=>{const anchor=store.decode(kind,book.id,Buffer.from(cursor,'base64url'));return store.encode(kind,book.id,{...anchor,...change}).toString('base64url');};
  return [encode('record-query-page',first[0].nextCursor,{queryHash:digest(JSON.stringify(query))}),encode('dashboard-page',first[1].nextCursor,{signature:digest(serialize(cards))}),encode('timeline-page',first[2].nextCursor,{queryHash:digest(JSON.stringify(timeline.query))})];
 });
 for(const [i,read] of readers(f.workspace).entries())await assert.rejects(read({...commands[i],cursor:old[i]}),{code:'RECORD_QUERY_CURSOR'});
});
