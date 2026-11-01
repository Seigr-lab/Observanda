import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {moduleDashboardCollection} from '../src/module-dashboard-collection.js';
import {ProjectModuleQueries} from '../src/project-module-queries.js';
import {ModuleReader} from '../src/modules/reader.js';
import {RecordCollectionPages} from '../src/record-collection-pages.js';
import {defaultPanelConfig} from '../src/web/dashboard-model.js';
import {pinnedQueryResults} from '../src/pinned-query-result.js';
import {clearVault} from '../src/encryption.js';
import {queryCacheMemoryFiles} from './fixtures/query-cache-memory.js';
const order=(a,b)=>{const x=a.title.toLowerCase(),y=b.title.toLowerCase();return x<y?-1:x>y?1:a.key<b.key?-1:a.key>b.key?1:0;};
test('module dashboard pages and discovery offsets reuse qualified owner results while labels stay direct',async t=>{
 t.mock.method(pinnedQueryResults,'open',queryCacheMemoryFiles);const shared=Array.from({length:6},()=>randomUUID()),owners=[1000,10000].map(count=>{
  const workspaceId=randomUUID(),address={workspaceId,projectId:randomUUID(),labBookId:null,projectTitle:'Project '+count},storage={root:path.resolve('synthetic-module-dashboard',workspaceId),vault:{id:randomUUID(),key:randomBytes(32)}},rows=Array.from({length:count},(_,i)=>({id:shared[i]??randomUUID(),type:'task',title:'Task '+(count-i),status:'open',createdAt:'2026-01-01T00:00:00.000Z'})),byId=new Map(rows.map(row=>[row.id,row])),calls={view:0,scan:0,member:0};
  const context={book:{id:workspaceId,projects:[],notebooks:[]},head:{revision:'a'.repeat(64)},async *members(){calls.scan++;yield* rows;},async member(id){calls.member++;return byId.get(id);},async view(member){calls.view++;return member;},async references(){return {projectId:null,ownerId:null,links:[]};},async search(member){return member.title.toLowerCase();},encode:value=>Buffer.from(JSON.stringify(value)).toString('base64url'),decode:value=>JSON.parse(Buffer.from(value,'base64url'))};
  const reader=new ModuleReader(storage,{context:(_id,operation)=>operation(context)});return {address,storage,context,reader,rows,calls};
 });
 t.mock.method(ProjectModuleQueries.prototype,'context',async function(_area,_type,operation){const owner=owners.find(value=>value.storage===this.storage);return operation(owner.context,owner.reader);});
 const pages=new RecordCollectionPages(),client={},workspaceId=randomUUID(),base={workspaceId,area:'planning',type:'task',config:defaultPanelConfig(),options:{},mode:'choices',key:null,cursor:null,limit:25,offset:0,keys:null},selection={projectIds:new Set([null]),projectLabels:{}},visit=async operation=>{for(const owner of owners)await operation(owner.storage,owner.address,selection);},read=patch=>moduleDashboardCollection(pages,client,{...base,...patch},{visit}),reset=()=>owners.forEach(owner=>Object.keys(owner.calls).forEach(key=>owner.calls[key]=0));
 const choices=owners.flatMap(owner=>owner.rows.map(row=>({key:owner.address.workspaceId+'/'+row.id,title:row.title,owner:{...owner.address,notebookTitle:''}}))).sort(order);
 try{
  const first=await read();assert.deepEqual(first.items,choices.slice(0,25));assert.equal(first.total,11000);assert.deepEqual(owners.map(owner=>owner.calls.view),[1000,10000]);reset();
  const second=await read({cursor:first.nextCursor}),third=await read({cursor:second.nextCursor});assert.deepEqual(second.items,choices.slice(25,50));assert.deepEqual(third.items,choices.slice(50,75));assert.deepEqual((await read({cursor:third.previousCursor})).items,second.items);assert.deepEqual(owners.map(owner=>owner.calls),[{view:0,scan:0,member:0},{view:0,scan:0,member:0}]);
  const expectedDiscovery=owners.flatMap(owner=>owner.rows.map(row=>({key:owner.address.workspaceId+'/'+row.id,title:row.title,subtitle:owner.address.projectTitle})));assert.deepEqual((await read({mode:'discovery'})).items,expectedDiscovery.slice(0,25));reset();
  const crossing=await read({mode:'discovery',offset:995});assert.deepEqual(crossing.items,expectedDiscovery.slice(995,1020));assert.equal(crossing.total,11000);assert.deepEqual(owners.map(owner=>owner.calls.view),[0,0]);assert.deepEqual((await read({mode:'discovery',offset:15000})).items,[]);
  const keys=owners.map(owner=>owner.address.workspaceId+'/'+shared[0]),labels=await read({mode:'labels',keys});assert.deepEqual(new Set(labels.items.map(row=>row.key)),new Set(keys));assert.deepEqual(owners.map(owner=>owner.calls),[{view:1,scan:0,member:1},{view:1,scan:0,member:1}]);
  owners[0].context.book.projects.push({id:randomUUID(),title:'Scope changed'});await assert.rejects(read({cursor:first.nextCursor}),{code:'RECORD_QUERY_CURSOR'});
  t.diagnostic(JSON.stringify({ownerRows:[1000,10000],page:25,repeatedSummaryReads:0,crossOwnerDiscoveryReads:0,selectedLabelReads:2}));
 }finally{pages.clear();await Promise.all(owners.map(owner=>clearVault(owner.storage.vault)));}
});
