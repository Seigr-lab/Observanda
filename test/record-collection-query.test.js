import {recordCollectionTypes} from '../src/record-collection-types.js';
import {RECORD_TYPES} from '../src/web/record-types.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {RecordCollectionPages} from '../src/record-collection-pages.js';
import {recordCollectionQuery} from '../src/record-collection-query.js';
import {viewQuery} from '../src/web/record-view-model.js';
const hash=n=>String(n).padStart(64,'0');
function fixture(){
 const pages=new RecordCollectionPages(),client={},project=randomUUID(),same=randomUUID();let inspected=0;
 const sources=Array.from({length:3},(_,i)=>{const id=randomUUID(),book=randomUUID(),records=Array.from({length:9},(_,j)=>({id:j===0?same:randomUUID(),notebookId:book,title:'Record '+String(j*3+i).padStart(2,'0'),occurredOn:'2026-01-01',type:'observation',status:'draft',tags:[],share:false}));return {id,book,records,head:hash(i+1),versions:new Map([[hash(i+1),records]])};});
 const visit=async consume=>{for(const source of sources){const store={head:async()=>source.head,snapshot:async id=>({id,metadata:{id:source.id,notebooks:[{id:source.book,title:'Book',projectId:project}],projects:[{id:project,title:'Project'}]}}),async *members(snapshot){yield* source.versions.get(snapshot.id);},async *searchMembers(snapshot){yield* source.versions.get(snapshot.id);},async *queryDocuments(rows){for await(const row of rows){inspected++;yield row;}},record(){throw Error('Body reads are forbidden');}};await consume({catalogue:fn=>fn(store)},{workspaceId:source.id,projectId:project,labBookId:source.book,projectTitle:'Project'},null);}};
 const command={workspaceId:randomUUID(),query:viewQuery({recordBrowse:{sort:'title'}}),mode:'browse',cursor:null,limit:4},read=(data=command,who=client)=>recordCollectionQuery(pages,who,data,{scope:project,visit});
 return {sources,pages,client,command,read,visit,project,inspected:()=>inspected};
}
test('collection paging preserves namespaces, immutable snapshots, filters and previous pages',async()=>{
 const f=fixture(),first=await f.read();assert.equal(first.total,27);assert.equal(first.counts.other,27);assert.equal(first.records.length,4);assert.equal(new Set(first.records.filter(r=>r.id===f.sources[0].records[0].id).map(r=>r.owner.workspaceId)).size,3);
 const source=f.sources[1];source.head=hash(99);source.versions.set(source.head,source.records.slice(1));
 const found=[...first.records];let page=first;
 while(page.nextCursor){const previous=page;page=await f.read({...f.command,cursor:page.nextCursor});assert.equal(page.changed,true);const back=await f.read({...f.command,cursor:page.previousCursor});assert.deepEqual(back.records,previous.records);found.push(...page.records);}
 assert.equal(found.length,27);assert.equal(new Set(found.map(r=>r.owner.workspaceId+':'+r.id)).size,27);assert.equal((await f.read()).total,26);assert.equal((await f.read({...f.command,query:{...f.command.query,filter:'hypothesis'}})).total,0);
 await assert.rejects(f.read({...f.command,cursor:first.nextCursor+'x'}),{code:'RECORD_QUERY_CURSOR'});await assert.rejects(f.read({...f.command,cursor:first.nextCursor},{}),{code:'RECORD_QUERY_CURSOR'});await assert.rejects(f.read({...f.command,cursor:first.nextCursor,limit:3}),{code:'RECORD_QUERY_CURSOR'});
 f.sources.pop();await assert.rejects(f.read({...f.command,cursor:first.nextCursor}),{code:'RECORD_QUERY_CURSOR'});
});
test('collection cursor lifetime and memory are bounded and access failures retain no page',async()=>{
 let now=0;const pages=new RecordCollectionPages({now:()=>now,max:2,ttl:10}),client={};const start=()=>pages.begin(client,'query',null),a=start(),first=pages.retain(a,{})(0,null);assert.equal(pages.begin(client,'query',first).id,a.id);pages.retain(start(),{});pages.retain(start(),{});assert.equal(pages.sessions.size,2);assert.throws(()=>pages.begin(client,'query',first),{code:'RECORD_QUERY_CURSOR'});now=11;pages.expire();assert.equal(pages.sessions.size,0);
 const f=fixture();await assert.rejects(recordCollectionQuery(f.pages,f.client,f.command,{scope:null,visit:async()=>{throw Object.assign(Error(),{code:'ACCESS_LOCKED'});}}),{code:'ACCESS_LOCKED'});assert.equal(f.pages.sessions.size,0);
 const controller=new AbortController();controller.abort();await assert.rejects(recordCollectionQuery(f.pages,f.client,f.command,{scope:null,signal:controller.signal,visit:async consume=>consume({},{workspaceId:randomUUID()},null)}),{name:'AbortError'});
});

test('collection retains one bounded page across large independent summaries',async()=>{
 const f=fixture();for(const source of f.sources){const seed=source.records[0];source.records=Array.from({length:5000},(_,i)=>({...seed,id:randomUUID(),title:'Entry '+String(i).padStart(5,'0')}));source.versions.set(source.head,source.records);}
 const first=await f.read({...f.command,limit:100});assert.equal(first.total,15000);assert.equal(first.records.length,100);assert.equal(f.inspected(),15000);assert.equal(f.pages.sessions.size,1);const retained=[...f.pages.sessions.values()][0];assert.deepEqual(Object.keys(retained.snapshots).sort(),f.sources.map(s=>s.id).sort());assert.equal(JSON.stringify(retained).includes('Entry'),false);
});

test('aggregate type discovery deduplicates copied templates and pages the same owner scope',async()=>{
 const f=fixture(),templates=Array.from({length:70},(_,i)=>({id:randomUUID(),label:'Field type '+i}));
 for(const source of f.sources){source.records=templates.map(template=>({...source.records[0],id:randomUUID(),template,updatedAt:'2026-01-01T00:00:00.000Z'}));source.versions.set(source.head,source.records);}
 const command={workspaceId:f.command.workspaceId,etag:hash(1),projectId:null,notebookId:null,selected:'template:'+templates[6].id,search:'',limit:25,cursor:null},read=command=>recordCollectionTypes(f.pages,f.client,command,{scope:f.project,visit:f.visit});
 const first=await read(command);assert.equal(first.total,70+RECORD_TYPES.length);assert.equal(first.selected.label,'Field type 6');assert.equal(first.items.length,25);const second=await read({...command,cursor:first.nextCursor});assert.equal(second.offset,25);assert.deepEqual((await read({...command,cursor:second.previousCursor})).items,first.items);assert.equal((await read({...command,search:'Field type 69'})).total,1);
 await assert.rejects(read({...command,cursor:first.nextCursor,search:'Field'}),{code:'RECORD_QUERY_CURSOR'});
});

test('dashboard snapshot sessions share equivalent views and evict by bytes without touching record pages',()=>{
 const pages=new RecordCollectionPages({max:256,maxBytes:100,reuse:true}),client={},start=signature=>pages.begin(client,signature,null),snapshots={owner:'a'.repeat(30)};
 const a=pages.retain(start('same'),snapshots)(0,null),b=pages.retain(start('same'),{...snapshots})(0,null);assert.equal(a,b);assert.equal(pages.sessions.size,1);
 const c=pages.retain(start('other'),snapshots)(0,null);assert.equal(pages.sessions.size,2);pages.retain(start('third'),snapshots);assert.equal(pages.sessions.size,2);assert.throws(()=>pages.begin(client,'same',a),{code:'RECORD_QUERY_CURSOR'});assert.ok(pages.begin(client,'other',c));
 assert.throws(()=>pages.retain(start('large'),{value:'x'.repeat(100)}),{code:'LIMIT'});
});
