import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {RecordCollectionPages} from '../src/record-collection-pages.js';
import {recordCollectionQuery} from '../src/record-collection-query.js';
import {timelineCollectionQuery} from '../src/timeline-collection-query.js';
import {pinnedQueryResults} from '../src/pinned-query-result.js';
import {viewQuery} from '../src/web/record-view-model.js';
import {recordQueryOrder} from '../src/web/record-query.js';
import {timelineDefaults,timelineQuery,timelineOrder} from '../src/web/tools/timeline-model.js';
function fakeFiles(_workspace,{check}){const files=new Map();return {id:randomUUID(),async read(file,at,size){check();return files.get(file).subarray(at,at+size);},async write(file,at,bytes){check();const before=files.get(file)??Buffer.alloc(0),next=Buffer.alloc(Math.max(before.length,at+bytes.length));before.copy(next);bytes.copy(next,at);files.set(file,next);},async truncate(file,size){files.set(file,(files.get(file)??Buffer.alloc(0)).subarray(0,size));},async finish(){check();},async assertNamed(){check();},async close(){files.clear();}};}
test('filtered independent-owner record and timeline pages reuse exact pinned result windows',async t=>{
 t.mock.method(pinnedQueryResults,'open',fakeFiles);const workspaceId=randomUUID(),shared=Array.from({length:6},()=>randomUUID()),owners=[1000,10000].map(count=>{
  const id=randomUUID(),projectId=randomUUID(),notebookId=randomUUID(),owner={workspaceId:id,projectId,projectTitle:'Project'},metadata={id,projects:[{id:projectId,title:'Project'}],notebooks:[{id:notebookId,projectId,title:'Book'}]},rows=Array.from({length:count},(_,i)=>({id:shared[i]??randomUUID(),notebookId,title:'Sample '+(count-i),occurredOn:i%5?'2026-06-01':{kind:'unknown'},status:i%3?'completed':'incomplete',tags:['batch'],type:'note',share:false}));let reads=0;
  const snapshot={metadata,records:rows},store={head:async()=>id.replaceAll('-','').padEnd(64,'0'),snapshot:async()=>snapshot,async *searchMembers(){yield* rows;},async *queryDocuments(values){for await(const row of values){reads++;yield row;}}},storage={root:path.resolve('synthetic-query-owner',id),vault:{id:randomUUID(),key:randomBytes(32)},catalogue:operation=>operation(store)};
  return {owner,storage,rows,reads:()=>reads,reset:()=>{reads=0;}};
 });
 const pages=new RecordCollectionPages(),client={},visit=async operation=>{for(const value of owners)await operation(value.storage,value.owner,null);},registry={workspaceId,directory:async()=>({revision:'directory',projects:owners.map(({owner})=>({projectId:owner.projectId,namespaceId:owner.workspaceId,parentId:null,summary:{title:'Project'}}))})};
 try{
  const query=viewQuery({recordBrowse:{sort:'title',status:'completed',tags:'batch'}}),command={workspaceId,query,mode:'browse',limit:25,cursor:null},expected=owners.flatMap(value=>value.rows.filter(row=>row.status==='completed').map(row=>({...row,owner:{...value.owner,notebookTitle:'Book'}}))).sort((a,b)=>recordQueryOrder(query.browse)(a,b)||a.owner.workspaceId.localeCompare(b.owner.workspaceId));
  const read=patch=>recordCollectionQuery(pages,client,{...command,...patch},{scope:null,visit});let page=await read();assert.deepEqual(page.records,expected.slice(0,25));assert.deepEqual(owners.map(value=>value.reads()),[1000,10000]);owners.forEach(value=>value.reset());
  page=await read({cursor:page.nextCursor});assert.deepEqual(page.records,expected.slice(25,50));page=await read({cursor:page.nextCursor});assert.deepEqual(page.records,expected.slice(50,75));assert.deepEqual((await read({cursor:page.previousCursor})).records,expected.slice(25,50));assert.deepEqual(owners.map(value=>value.reads()),[0,0]);
  const timeline=timelineQuery({...timelineDefaults(),status:'completed'}),timelineCommand={workspaceId,query:timeline,limit:25,cursor:null},timelineExpected=[...expected].sort((a,b)=>timelineOrder(timeline)(a,b)||a.owner.workspaceId.localeCompare(b.owner.workspaceId)).map(({id,notebookId,title,occurredOn,status,owner})=>({id,notebookId,title,occurredOn,status,owner}));
  const readTimeline=patch=>timelineCollectionQuery(pages,client,{...timelineCommand,...patch},{scope:null,registry,visit});page=await readTimeline();assert.deepEqual(page.records,timelineExpected.slice(0,25));owners.forEach(value=>value.reset());page=await readTimeline({cursor:page.nextCursor});assert.deepEqual(page.records,timelineExpected.slice(25,50));assert.deepEqual(owners.map(value=>value.reads()),[0,0]);
  await assert.rejects(timelineCollectionQuery(pages,client,{...timelineCommand,cursor:page.nextCursor},{scope:null,registry,visit:async()=>{throw Object.assign(Error('Revoked owner'),{code:'ACCESS_DENIED'});}}),{code:'ACCESS_DENIED'});
  t.diagnostic(JSON.stringify({owners:[1000,10000],page:25,repeatedRecordSummaryReads:0,repeatedTimelineSummaryReads:0}));
 }finally{await pinnedQueryResults.clear();for(const value of owners)value.storage.vault.key.fill(0);pages.clear();}
});
