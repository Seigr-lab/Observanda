import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {dashboardCollectionRecords} from '../src/dashboard-collection-records.js';
import {RecordCollectionPages} from '../src/record-collection-pages.js';
import {defaultPanelConfig} from '../src/web/dashboard-model.js';

test('dashboard pages distinguish copied record IDs and reverse byte-limited owner pages',async()=>{
 const projectId=randomUUID(),bookId=randomUUID(),ids=[randomUUID(),randomUUID()].sort(),head='a'.repeat(64),sources=Array.from({length:3},()=>({workspaceId:randomUUID(),projectId,labBookId:bookId,projectTitle:'Project',notebookTitle:'Book'})),pages=new RecordCollectionPages(),client={};let reads=0,closed=0;
 const stores=new Map(sources.map(owner=>{const records=ids.map((id,i)=>({id,notebookId:bookId,title:'Record '+i,updatedAt:'2026-10-16T00:00:00.000Z',body:'x'.repeat(i?80000:200000)})),rows=records.map(record=>({...record,body:undefined,revision:head,bytes:Buffer.byteLength(JSON.stringify(record))}));return [owner.workspaceId,{head:async()=>head,snapshot:async()=>({metadata:{id:owner.workspaceId,projects:[{id:projectId,title:'Project'}],notebooks:[{id:bookId,projectId,title:'Book'}]}}),async *searchMembers(){yield* rows;},async member(_snapshot,id){return rows.find(row=>row.id===id);},async record(id){reads++;return records.find(row=>row.id===id);}}];}));
 const visit=async(consume,{namespaces})=>{for(const owner of sources)if(!namespaces||namespaces.has(owner.workspaceId))await consume({catalogue:fn=>fn(stores.get(owner.workspaceId))},owner,{projectIds:new Set([projectId]),notebookIds:null});};
 const reader={use:async(owner,_snapshot,consume)=>consume(stores.get(owner.workspaceId),await stores.get(owner.workspaceId).snapshot()),verify:async()=>{},close:async()=>closed++};
 const command={workspaceId:sources[0].workspaceId,etag:head,provider:'records',config:defaultPanelConfig(),options:{},cursor:null,key:null,limit:3},read=(change={})=>dashboardCollectionRecords(pages,client,{...command,...change},{visit,reader});
 const all=[];let page=await read();assert.ok(page.records.length<command.limit);
 for(;;){
  assert.equal(page.offset,all.length);all.push(...page.records.map(row=>row.collectionKey));
  if(page.previousCursor){const back=await read({cursor:page.previousCursor});assert.deepEqual(back.records.map(row=>row.collectionKey),all.slice(back.offset,page.offset));}
  if(!page.nextCursor)break;page=await read({cursor:page.nextCursor});
 }
 assert.equal(all.length,6);assert.equal(new Set(all).size,6);assert.equal(page.total,6);assert.ok(reads>0&&closed>0);
 const pinned=await read({key:sources[1].workspaceId+'/'+ids[0]});assert.equal(pinned.records.length,1);assert.equal(pinned.records[0].owner.workspaceId,sources[1].workspaceId);
 const legacy=await read({key:ids[0]});assert.equal(legacy.records.length,1);assert.equal(legacy.records[0].owner.workspaceId,command.workspaceId);
 await assert.rejects(read({cursor:page.cursor,options:{includeWorkspace:false}}),{code:'RECORD_QUERY_CURSOR'});
});
