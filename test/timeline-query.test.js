import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {queryFixture} from './record-query-fixture.js';
import {upgradeNotebook} from '../src/model.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {TimelineQuery} from '../src/timeline-query.js';
import {timelineDefaults,timelineQuery,timelineOrder} from '../src/web/tools/timeline-model.js';
import {validateTimelinePage} from '../src/web/tools/timeline-page.js';
import {timelineRecords} from '../src/web/tools/timeline.js';
import {copyPlan,copyWorkspace} from '../src/locations.js';
import {Workspace} from '../src/storage.js';

async function fixture(t,count=63){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-timeline-')),book=upgradeNotebook(queryFixture()),seeds=book.entries;
 book.entries=Array.from({length:count},(_,i)=>({...structuredClone(seeds[i%seeds.length]),id:randomUUID(),title:'Take '+String(i).padStart(3,'0'),body:'PRIVATE_ORIGINAL_'+i,occurredOn:i%7===0?{kind:'unknown'}:i%7===1?{kind:'month',value:'2026-06',estimated:true}:seeds[i%seeds.length].occurredOn}));
 const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 return {...f,directory,book,service:new TimelineQuery(f.workspace),command:{workspaceId:book.id,query:timelineQuery(timelineDefaults()),limit:20}};
}
async function summariesOnly(fn){
 const read=ResearchCatalogue.prototype.read,record=ResearchCatalogue.prototype.record;
 ResearchCatalogue.prototype.read=()=>{throw Error('Full book read');};ResearchCatalogue.prototype.record=()=>{throw Error('Original body read');};
 try{return await fn();}finally{ResearchCatalogue.prototype.read=read;ResearchCatalogue.prototype.record=record;}
}

test('timeline uses bounded summary pages for combined sources, filters and uncertain dates at tenfold growth',async t=>{
 for(const count of [42,420]){
  const f=await fixture(t,count),before=JSON.stringify(f.book);
  for(const settings of [{},{projects:[f.book.projects[0].id],books:[f.book.notebooks[1].id],descendants:false},{projects:[f.book.projects[0].id],descendants:true,from:'2026-06-15',to:'2026-06-30',descending:true},{query:'sound',status:'incomplete'}]){
   const query=timelineQuery({...timelineDefaults(),...settings}),expected=timelineRecords(f.book,query),ids=[];let cursor=null,last;
   do{last=await summariesOnly(()=>f.service.list({...f.command,query,cursor}));validateTimelinePage(last,{...f.command,query});assert.equal(last.total,expected.length);assert.ok(last.records.length<=20);assert.ok(last.books.length<=20);assert.ok(last.projects.length<=20);assert.ok(!JSON.stringify(last).includes('PRIVATE_ORIGINAL'));assert.ok(last.records.every(r=>Object.keys(r).sort().join() === 'id,notebookId,occurredOn,status,title'));ids.push(...last.records.map(r=>r.id));cursor=last.nextCursor;}while(cursor);
   assert.deepEqual(ids,expected.map(r=>r.id));
   if(last.previousCursor){const previous=await summariesOnly(()=>f.service.list({...f.command,query,cursor:last.previousCursor}));assert.deepEqual(previous.records.map(r=>r.id),ids.slice(last.offset-20,last.offset));}
  }
  assert.equal(JSON.stringify(f.book),before);
 }
});

test('timeline pages remain pinned across edits and ordinary restore, and reject altered scope or cursors',async t=>{
 const f=await fixture(t),first=await f.service.list(f.command),second=await f.service.list({...f.command,cursor:first.nextCursor}),record=f.book.entries[0];
 await new ResearchRecords(f.workspace,{}).save({workspaceId:f.book.id,changes:[{id:record.id,expectedRevision:recordRevision(record),record:{...record,title:'Changed title',occurredOn:'2027-01-01'}}]},{recordIds:[record.id]});
 const after=await summariesOnly(()=>f.service.list({...f.command,cursor:first.nextCursor}));assert.deepEqual(after.records,second.records);assert.equal(after.changed,true);
 const back=await f.service.list({...f.command,cursor:after.previousCursor});assert.deepEqual(back.records,first.records);
 const destination=await copyWorkspace(await copyPlan(f.workspace.root,path.join(f.directory,'copy')),{vault:f.vault});
 const restored=new Workspace(destination,f.vault);await restored.catalogue(()=>{}); // First reopening verifies restored originals.
 assert.deepEqual((await summariesOnly(()=>new TimelineQuery(restored).list({...f.command,cursor:first.nextCursor}))).records,second.records);
 for(const command of [{query:{...f.command.query,descending:true}},{limit:10},{cursor:first.nextCursor.slice(0,-5)+'xxxxx'}])await assert.rejects(f.service.list({...f.command,cursor:first.nextCursor,...command}),{code:'RECORD_QUERY_CURSOR'});
 await assert.rejects(f.service.list({...f.command,workspaceId:randomUUID()}),{code:'WORKSPACE_CHANGED'});
 const missing=await f.service.list({...f.command,query:{...f.command.query,books:[randomUUID()]}});assert.equal(missing.total,0);assert.equal(missing.missingSources,1);
});

test('invalid timeline requests and cancellation do not change stored records',async t=>{
 const f=await fixture(t,6),before=await f.workspace.read();
 for(const query of [{...f.command.query,from:'2026-02-30'},{...f.command.query,from:'2027-01-01',to:'2026-01-01'},{...f.command.query,books:[f.book.notebooks[0].id,f.book.notebooks[0].id]},{...f.command.query,extra:true}])await assert.rejects(f.service.list({...f.command,query}),{code:'INVALID'});
 await assert.rejects(f.service.list({...f.command,limit:101}),{code:'INVALID'});
 const controller=new AbortController();controller.abort();await assert.rejects(f.service.list(f.command,{signal:controller.signal}),{name:'AbortError'});
 assert.equal((await f.workspace.read()).etag,before.etag);
});
test('date ties use portable ID order and response validation rejects duplicates, disorder and hidden bodies',()=>{
 const query=timelineQuery(timelineDefaults()),workspaceId=randomUUID(),projectId=randomUUID(),notebookId=randomUUID(),records=['bbbbbbbb-0000-4000-8000-000000000000','aaaaaaaa-0000-4000-8000-000000000000'].map(id=>({id,notebookId,title:id,occurredOn:'2026-06-01',status:'completed'})).sort(timelineOrder(query));
 assert.ok(records[0].id.startsWith('aaaa'));
 const page={workspaceId,snapshotId:'a'.repeat(64),records,books:[{id:notebookId,projectId,title:'Book'}],projects:[{id:projectId,title:'Project'}],total:2,offset:0,changed:false,missingSources:0,cursor:'first',previousCursor:null,nextCursor:null},options={workspaceId,query,limit:50};
 assert.equal(validateTimelinePage(page,options),page);
 for(const altered of [{records:[...records].reverse()},{records:[records[0],records[0]]},{records:records.map(r=>({...r,body:'Unexpected original'}))},{books:[]},{projects:[]},{total:3},{nextCursor:'unexpected'},{workspaceId:randomUUID()},{snapshotId:'invalid'}])assert.throws(()=>validateTimelinePage({...page,...altered},options),/TIMELINE_RESPONSE/);
 assert.throws(()=>validateTimelinePage(page,{...options,snapshotId:'b'.repeat(64)}),/TIMELINE_RESPONSE/);
});
