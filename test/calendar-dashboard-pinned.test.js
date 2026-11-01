import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {Workspace} from '../src/storage.js';
import {CalendarSources} from '../src/calendar/service.js';
import {calendarPage} from '../src/calendar/pages.js';
import {calendarDashboardCollection} from '../src/calendar-dashboard-collection.js';
import {RecordCollectionPages} from '../src/record-collection-pages.js';
import {defaultPanelConfig} from '../src/web/dashboard-model.js';
import {pinnedQueryResults} from '../src/pinned-query-result.js';
import {clearVault} from '../src/encryption.js';
import {digest} from '../src/storage-format.js';
import {queryCacheMemoryFiles} from './fixtures/query-cache-memory.js';
test('calendar collection continuations admit source versions without reprojecting rows or reparsing feeds',async t=>{
 t.mock.method(pinnedQueryResults,'open',queryCacheMemoryFiles);const shared=Array.from({length:4},()=>randomUUID()),owners=[1000,10000].map(count=>{
  const workspaceId=randomUUID(),storage=new Workspace(path.resolve('synthetic-calendar-query',workspaceId),{id:randomUUID(),key:randomBytes(32)}),address={workspaceId,projectId:randomUUID(),labBookId:null,projectTitle:'Project '+count},book={id:workspaceId,title:'Workspace',projects:[],notebooks:[]},source={id:randomUUID(),name:'Tasks',projectId:null},subscription={id:randomUUID(),type:'subscription',data:{name:'Feed',projectId:null,color:'#123456',url:'https://calendar.invalid/'+workspaceId,enabled:true}},rows=Array.from({length:count},(_,i)=>({id:shared[i]??randomUUID(),sourceId:source.id,source,title:'Event '+(count-i),startsAt:'2026-10-01',endsAt:'2026-10-02',allDay:true,projectId:null})),stats={events:0,parses:0,fetches:0,heads:0};let revision=1;
  storage.outline=async()=>({metadata:book});
  const service=new CalendarSources({read:async(_workspace,_book,_range,{connectionsOnly,emit,emitSource}={})=>{if(connectionsOnly){stats.heads++;return {revision,connections:[subscription],events:[],sources:[]};}if(emitSource)await emitSource(source);for(const row of rows){stats.events++;if(emit)await emit(row);}return {revision,connections:[subscription],events:emit?[]:rows,sources:emitSource?[]:[source]};},fetch:async()=>{stats.fetches++;return 'retained feed';},parse:async()=>{stats.parses++;return [{id:'feed-event',title:'ZZ Feed',startsAt:'2026-10-01',endsAt:'2026-10-02',allDay:true,notes:'PRIVATE NOTES'}];}});
  const context={book,encode:value=>Buffer.from(JSON.stringify(value)).toString('base64url'),decode:value=>JSON.parse(Buffer.from(value,'base64url'))},reader={context:(_id,operation)=>operation(context)};return {workspaceId,storage,address,book,rows,stats,service,reader,changed:()=>{revision++;}};
 });
 const pages=new RecordCollectionPages(),client={},base={workspaceId:randomUUID(),config:defaultPanelConfig(),options:{},from:'2026-10-01',to:'2026-11-01',timeZone:'UTC',mode:'agenda',limit:25,key:null,cursor:null,offset:0,search:''},visit=async operation=>{for(const owner of owners)await operation(owner.storage,owner.address,{projectIds:new Set([null]),projectLabels:{}});},read=patch=>calendarDashboardCollection(pages,client,{...base,...patch},{visit,read:(storage,_address,command,options)=>{const owner=owners.find(value=>value.storage===storage);return calendarPage(storage,owner.service,command,{...options,reader:owner.reader});}}),reset=()=>owners.forEach(owner=>Object.keys(owner.stats).forEach(key=>owner.stats[key]=0));
 try{
  const first=await read();assert.equal(first.total,11002);assert.equal(first.events.length,25);assert.deepEqual(owners.map(owner=>owner.stats.events),[1000,10000]);assert.deepEqual(owners.map(owner=>owner.stats.parses),[1,1]);assert.equal(JSON.stringify(first).includes('PRIVATE NOTES'),false);reset();
  const next=await read({cursor:first.nextCursor});assert.equal(next.events.length,25);assert.deepEqual((await read({cursor:next.previousCursor})).events,first.events);const third=await read({cursor:next.nextCursor}),fourth=await read({cursor:third.nextCursor});assert.deepEqual((await read({cursor:fourth.previousCursor})).events,third.events);assert.deepEqual((await read({cursor:third.previousCursor})).events,next.events);assert.deepEqual(owners.map(owner=>owner.stats.events),[0,0]);assert.deepEqual(owners.map(owner=>owner.stats.parses),[0,0]);assert.ok(owners.every(owner=>owner.stats.heads>0));
  const discovery=await read({mode:'discovery'});assert.equal(discovery.total,11002);reset();const crossing=await read({mode:'discovery',offset:995});assert.equal(crossing.events.length,25);assert.deepEqual(crossing.events.slice(0,5).map(row=>row.collectionKey),owners[0].rows.slice(995).map(row=>owners[0].workspaceId+'/'+digest(JSON.stringify([row.sourceId,row.id]))));assert.equal(crossing.events[5].title,'ZZ Feed');assert.equal(crossing.events[6].owner.workspaceId,owners[1].workspaceId);assert.deepEqual(owners.map(owner=>owner.stats.events),[0,0]);assert.deepEqual(owners.map(owner=>owner.stats.parses),[0,0]);
  const verify=owners[0].service.verify;owners[0].service.verify=async function(...args){await this.clear();return verify.apply(this,args);};await assert.rejects(read({cursor:first.nextCursor}),{code:'ACCESS_LOCKED'});owners[0].service.verify=verify;
  owners[1].changed();await assert.rejects(read({cursor:first.nextCursor}),{code:'RECORD_QUERY_CURSOR'});
  t.diagnostic(JSON.stringify({eventsPerOwner:[1000,10000],continuedEventProjections:0,continuedFeedParses:0,sourceHeadsRead:true}));
 }finally{pages.clear();await Promise.all(owners.map(owner=>owner.service.clear()));await Promise.all(owners.map(owner=>clearVault(owner.storage.vault)));}
});
