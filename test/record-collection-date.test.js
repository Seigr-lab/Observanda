import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {RecordCollectionPages} from '../src/record-collection-pages.js';
import {recordCollectionQuery} from '../src/record-collection-query.js';
import {RecordReadingIndex,readingKey} from '../src/record-reading-index.js';
import {RecordFacetIndex} from '../src/record-facet-index.js';
import {SnapshotIndex} from '../src/snapshot-index.js';
import {digest,serialize} from '../src/storage-format.js';
import {viewQuery} from '../src/web/record-view-model.js';
import {recordQueryOrder} from '../src/web/record-query.js';
import {timelineCollectionQuery} from '../src/timeline-collection-query.js';
import {timelineDefaults,timelineQuery} from '../src/web/tools/timeline-model.js';

function owner(count,shared){
 const workspaceId=randomUUID(),notebookId=randomUUID(),projectId=randomUUID(),state=new Map(),rows=[],calls={summaries:0,scans:0};
 for(let i=0;i<count;i++)rows.push({id:i<shared.length?shared[i]:randomUUID(),notebookId,type:'note',title:'Record '+i,occurredOn:i%7?'2026-05-'+String(1+i%4).padStart(2,'0'):{kind:'unknown'},status:'completed',tags:[],share:false});
 const store={head:async()=>digest(workspaceId),snapshot:async()=>snapshot,encode:(_kind,_id,value)=>Buffer.from(serialize(value)),decode:(_kind,_id,value)=>JSON.parse(value),db:{async get(_sql,key){return {payload:state.get(key)};}},async *searchMembers(){calls.scans++;yield* members;},async *queryDocuments(source){for await(const row of source){calls.summaries++;yield documents.get(row.id);}}};
 const documents=new Map(rows.map(row=>[row.id,row])),members=rows.map((row,position)=>({...row,revision:digest(row.id),position,bytes:1,sections:[],runOf:[]}));
 for(const member of members)state.set('record-member:'+digest(serialize(member)),Buffer.from(serialize(member)));
 const tree=(Index,entries)=>{
  const index=new Index(store);entries.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  const build=(start,end)=>{if(start===end)return null;const at=Math.floor((start+end)/2),entry=entries[at];return index.make(entry.id,entry.revision,build(start,at),build(at+1,end));};
  const root=build(0,entries.length);for(const [slot,node] of index.writes)state.set(slot,Buffer.from(serialize(node)));return root;
 };
 const membership=tree(SnapshotIndex,members.map(row=>({id:'record:'+row.id,revision:digest(serialize(row))})));
 const reading=tree(RecordReadingIndex,members.flatMap(row=>['date','position'].map(order=>({id:order+':'+notebookId+':'+readingKey(row,order),revision:digest(serialize(row))}))));
 const facet=tree(RecordFacetIndex,members.flatMap(row=>['count:other:','domain::'].map(kind=>({id:notebookId+':'+kind+row.id,revision:digest(serialize(row))}))));
 const snapshot={indexVersion:1,count,metadata:{id:workspaceId,notebooks:[{id:notebookId,title:'Book',projectId}],projects:[{id:projectId,title:'Project'}]},membership,readingIndex:{version:1,root:reading},facetIndex:{version:1,root:facet}};
 const address={workspaceId,projectId,projectTitle:'Project'};return {address,store,snapshot,rows,calls};
}
const compare=sort=>(a,b)=>recordQueryOrder({sort})(a,b)||(a.owner.workspaceId<b.owner.workspaceId?-1:a.owner.workspaceId>b.owner.workspaceId?1:0);
const identity=row=>row.owner.workspaceId+'/'+row.id;
function collection(counts,sort='date-desc'){
 const shared=Array.from({length:5},()=>randomUUID()),owners=counts.map(count=>owner(count,shared)),pages=new RecordCollectionPages(),client={},command={workspaceId:randomUUID(),query:viewQuery({recordBrowse:{sort}}),mode:'browse',cursor:null,limit:7};
 const visit=async consume=>{for(const value of owners)await consume({catalogue:fn=>fn(value.store)},value.address,null);};
 const read=patch=>recordCollectionQuery(pages,client,{...command,...patch},{scope:null,visit}),expected=owners.flatMap(value=>value.rows.map(row=>({...row,owner:{...value.address,notebookTitle:'Book'}}))).sort(compare(sort));
 return {owners,read,expected,pages,command,visit,client};
}

test('indexed independent-owner date pages preserve copied IDs, equal dates, previous boundaries and mixed legacy snapshots',async()=>{
 for(const legacy of [false,true])for(const sort of ['date-desc','date-asc']){
  const f=collection([37,28,0],sort);if(legacy)delete f.owners[1].snapshot.facetIndex;
  const seen=[];let page=await f.read();
  for(;;){
   assert.equal(page.total,f.expected.length);assert.deepEqual(page.counts,{experiments:0,runs:0,other:f.expected.length});assert.deepEqual(page.records,f.expected.slice(page.offset,page.offset+7));seen.push(...page.records.map(identity));
   if(!page.nextCursor)break;const previous=page;page=await f.read({cursor:page.nextCursor});assert.deepEqual((await f.read({cursor:page.previousCursor})).records,previous.records);
  }
  assert.deepEqual(seen,f.expected.map(identity));if(!legacy)assert.ok(f.owners.every(owner=>owner.calls.scans===0));
 }
});

test('timeline collections merge bounded indexed windows in both directions with copied record IDs',async()=>{
 for(const descending of [false,true]){
  const f=collection([1000,10000],descending?'date-desc':'date-asc'),workspaceId=f.command.workspaceId,query=timelineQuery({...timelineDefaults(),descending}),command={workspaceId,query,limit:25,cursor:null};
  const projects=f.owners.map(({address})=>({projectId:address.projectId,namespaceId:address.workspaceId,parentId:null,summary:{title:'Project'}})),registry={workspaceId,directory:async()=>({revision:'directory',projects})};
  const read=patch=>timelineCollectionQuery(f.pages,f.client,{...command,...patch},{scope:null,registry,visit:f.visit}),expected=f.expected.map(({id,notebookId,title,occurredOn,status,owner})=>({id,notebookId,title,occurredOn,status,owner}));
  let page=await read();assert.deepEqual(page.records,expected.slice(0,25));assert.equal(page.total,11000);assert.deepEqual(f.owners.map(owner=>owner.calls.summaries),[25,25]);
  page=await read({cursor:page.nextCursor});assert.deepEqual(page.records,expected.slice(25,50));assert.deepEqual(f.owners.map(owner=>owner.calls.summaries),[50,50]);
  page=await read({cursor:page.nextCursor});assert.deepEqual(page.records,expected.slice(50,75));assert.deepEqual((await read({cursor:page.previousCursor})).records,expected.slice(25,50));assert.ok(f.owners.every(owner=>owner.calls.scans===0));
 }
});

test('large owner collections decode only their requested windows and discard access-failed sessions',async t=>{
 const f=collection([1000,10000]),page=await f.read({limit:25});assert.deepEqual(page.records,f.expected.slice(0,25));assert.equal(page.total,11000);assert.deepEqual(f.owners.map(owner=>owner.calls.summaries),[25,25]);assert.ok(f.owners.every(owner=>owner.calls.scans===0));
 const next=await f.read({limit:25,cursor:page.nextCursor});assert.deepEqual(next.records,f.expected.slice(25,50));assert.deepEqual(f.owners.map(owner=>owner.calls.summaries),[50,50]);
 t.diagnostic(JSON.stringify({ownerRecords:[1000,10000],page:25,firstPageSummaryReads:50}));
 const broken=collection([10,10]);broken.owners[1].store.snapshot=async()=>{throw Object.assign(Error('Locked owner'),{code:'ACCESS_LOCKED'});};await assert.rejects(broken.read(),{code:'ACCESS_LOCKED'});assert.equal(broken.pages.sessions.size,0);
});
