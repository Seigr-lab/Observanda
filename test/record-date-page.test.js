import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {RecordQuery} from '../src/record-query.js';
import {RecordReadingIndex,readingKey} from '../src/record-reading-index.js';
import {RecordFacetIndex} from '../src/record-facet-index.js';
import {SnapshotIndex} from '../src/snapshot-index.js';
import {digest,serialize} from '../src/storage-format.js';
import {recordBrowse,recordQueryOrder} from '../src/web/record-query.js';
import {sampleNotebook} from '../src/sample.js';
import {recordCounts} from '../src/web/record-workflow.js';
import {indexedRecordDateQuery} from '../src/record-date-page.js';

function fixture(count){
 const book=sampleNotebook(),snapshotId=digest('snapshot'),state=new Map(),documents=new Map(),members=[],calls={summaries:0,nodes:0};book.entries=[];
 const store={async head(){return snapshotId;},async snapshot(){return snapshot;},encode:(_kind,_id,value)=>Buffer.from(JSON.stringify(value)),decode:(_kind,_id,value)=>JSON.parse(value),db:{async get(_sql,key){calls.nodes++;return {payload:state.get(key)};}},async *queryDocuments(rows){for await(const row of rows){calls.summaries++;yield documents.get(row.id);}},members(){assert.fail('A date page must not scan membership');},searchMembers(){assert.fail('A date page must not scan candidates');}};
 const rows=[];for(let i=0;i<count;i++){
  const id=randomUUID(),notebookId=book.notebooks[0].id,occurredOn=i%9?'2026-'+String(1+i%12).padStart(2,'0')+'-01':{kind:'unknown'},type=i%3?'note':'experiment',template=i%7?null:{profileId:'arts-creative',id:randomUUID(),label:'Template'};
  const row={id,revision:digest('record'+i),notebookId,type,occurredOn,template,position:i,sections:[],runOf:[],bytes:1};members.push(row);state.set('record-member:'+digest(serialize(row)),Buffer.from(serialize(row)));
  const value={id,notebookId,type,title:'Record '+i,occurredOn,tags:[],status:'completed',share:false,...(template?{template}: {})};documents.set(id,value);rows.push(value);
 }
 const tree=(Index,entries)=>{
  const index=new Index(store);entries.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  const build=(start,end)=>{if(start===end)return null;const at=Math.floor((start+end)/2),entry=entries[at];return index.make(entry.id,entry.revision,build(start,at),build(at+1,end));};
  const root=build(0,entries.length);for(const [slot,node] of index.writes)state.set(slot,Buffer.from(serialize(node)));return root;
 };
 const membership=tree(SnapshotIndex,members.map(row=>({id:'record:'+row.id,revision:digest(serialize(row))})));
 const reading=tree(RecordReadingIndex,members.flatMap(row=>['date','position'].map(order=>({id:order+':'+row.notebookId+':'+readingKey(row,order),revision:digest(serialize(row))}))));
 const facets=tree(RecordFacetIndex,members.flatMap(row=>{const value=documents.get(row.id),kind=value.type==='experiment'&&!value.template?'experiments':'other';return [row.notebookId+':count:'+kind+':'+row.id,row.notebookId+':domain:'+encodeURIComponent(row.template?.profileId??'')+':'+row.id].map(id=>({id,revision:digest(serialize(row))}));}));
 const snapshot={indexVersion:1,metadata:book,count,membership,readingIndex:{version:1,root:reading},facetIndex:{version:1,root:facets}},workspace={storageKind:async()=>'catalogue',catalogue:operation=>operation(store)},query={workspaceId:book.id,query:{projectId:null,notebookId:null,filter:'all',search:'',browse:recordBrowse()}};
 return {reader:new RecordQuery(workspace),query,calls,rows,snapshot,store};
}
for(const count of [1000,10000])test('indexed record date pages read a bounded summary window at '+count+' records',async t=>{
 const f=fixture(count),expected=[...f.rows].sort(recordQueryOrder()),first=await f.reader.list(f.query);assert.deepEqual(first.records,expected.slice(0,25));assert.equal(first.total,count);assert.deepEqual(first.counts,recordCounts(f.rows));assert.deepEqual(first.domains,['arts-creative']);assert.equal(f.calls.summaries,25);const firstReads=f.calls.nodes;
 f.calls.summaries=0;const second=await f.reader.list({...f.query,cursor:first.nextCursor});assert.deepEqual(second.records,expected.slice(25,50));assert.equal(f.calls.summaries,25);
 f.calls.summaries=0;const third=await f.reader.list({...f.query,cursor:second.nextCursor});assert.deepEqual(third.records,expected.slice(50,75));assert.equal(f.calls.summaries,26);assert.deepEqual((await f.reader.list({...f.query,cursor:third.previousCursor})).records,second.records);
 const cursor=JSON.parse(Buffer.from(second.cursor,'base64url'));cursor.offset++;await assert.rejects(f.reader.list({...f.query,cursor:Buffer.from(JSON.stringify(cursor)).toString('base64url')}),{code:'RECORD_QUERY_CURSOR'});
 t.diagnostic(JSON.stringify({records:count,page:25,firstSummaryReads:25,firstIndexReads:firstReads}));
});
test('only semantically unfiltered newest-date queries use the fast path',()=>{
 const base={filter:'all',search:'',browse:recordBrowse()};assert.equal(indexedRecordDateQuery(base),true);
 for(const patch of [{filter:'note'},{search:'needle'},{browse:recordBrowse({sort:'title'})},{browse:recordBrowse({sort:'date-asc'})},{browse:recordBrowse({tags:'sound'})},{browse:recordBrowse({domain:'arts-creative'})},{browse:recordBrowse({status:'completed'})}])assert.equal(indexedRecordDateQuery({...base,...patch}),false);
 for(const option of ['selection','relatedTo','runOf'])assert.equal(indexedRecordDateQuery(base,{[option]:{}}),false);
});
