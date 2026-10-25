import {defaultStructuredCalculationPolicy} from '../src/web/tools/calculation-policy.js';
import {verifyPlotProjection} from '../src/dataset-plot-provenance.js';
import {plotNumericalMetadata} from '../src/plot-resource-policy.js';
import {CATALOGUE_MAX_GENERATION} from '../src/catalogue-format.js';
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {serialize} from '../src/storage-format.js';
import {RetainedFigureDocuments} from '../src/retained-figure-document.js';
import {MaterialSequence} from '../src/material-sequence.js';
import {retainDatasetCell} from '../src/dataset-cell-storage.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
import {createFigure} from '../src/web/figure-model.js';

// Replace only the encrypted scratch transport; exercise the real plot producer,
// external sorter, retained document writer and authenticated document reader.
const moduleURL=new URL('../src/retained-figure-plot.js?point-batches-test',import.meta.url).href,key='pointBatchWork_'+randomUUID().replaceAll('-','');
let currentWork;
globalThis[key]=operation=>operation(currentWork);
const hooks=registerHooks({resolve(specifier,context,next){return context.parentURL===moduleURL&&specifier==='./scratch-work.js'?{url:'point-batch:scratch',shortCircuit:true}:next(specifier,context);},load(url,context,next){return url==='point-batch:scratch'?{format:'module',shortCircuit:true,source:'export const withScratch=operation=>globalThis['+JSON.stringify(key)+'](operation);'}:next(url,context);}});
let prepareRetainedPlot;try{({prepareRetainedPlot}=await import(moduleURL));}finally{hooks.deregister();}
after(()=>{delete globalThis[key];});

function fixture(rows,{mapping={},policy,onBatch,onGet,onWriteBatch,onWrittenBatch,columnComputations=[],rowMetadata=[]}={}){
 const files=new Map(),scratch=new Map(),batches=[],reads=new Map(),writes=[],writeBatches=[],writeBatchBytes=[],retainedBatches=[],retainedReads=[];let transaction=null,retainedFault=null;
 const workspace={root:path.join(os.tmpdir(),'absent-plot-batch-'+randomUUID()),readMetadata:async(name,limit)=>{retainedReads.push({name,transaction:transaction!==null});const text=files.get(name)??null;if(text!==null&&Buffer.byteLength(text)>limit)throw Object.assign(Error('Metadata limit'),{code:'LIMIT'});return text;},writeMetadata:async(name,text)=>{transaction?.push({name,text});files.set(name,text);}},sequences=new MaterialSequence(workspace),pages=Array.from({length:Math.ceil(rows.length/41)},(_,i)=>({rows:rows.slice(i*41,(i+1)*41).map((cells,row)=>({cells,...rowMetadata[i*41+row]}))}));
 const write=async operation=>{assert.equal(transaction,null,'retained writes cannot nest transactions');const before=new Map(files),batch=[];transaction=batch;let committed=false;try{const result=await operation();const fault=await retainedFault?.(batch);retainedBatches.push(batch);if(fault?.error){committed=!!fault.durable;throw fault.error;}committed=true;return result;}catch(error){if(!committed){files.clear();for(const [key,value]of before)files.set(key,value);}throw error;}finally{transaction=null;}};
 const columns=rows[0].map((_,i)=>({...defaultColumn({label:'Column '+i}),representation:'decimal',...(columnComputations[i]?{computation:columnComputations[i]}:{}),...(policy?{resourcePolicy:policy}:{})})),indices=columns.map((_,i)=>i*3+4),selection={columns,indices,mapping:{x:0,xKind:'number',group:null,values:[{column:1,error:null}],kind:'scatter',operation:'raw',order:'source',...(policy?{resourcePolicy:policy}:{}),...mapping}};
 const work={async get(id){assert.ok(!id.startsWith('point:'),'point reads must use the bounded batch contract');reads.set(id,(reads.get(id)??0)+1);const value=structuredClone(scratch.get(id));await onGet?.(id,value);return value;},async getMany(ids){assert.ok(ids.length>0&&ids.length<=32);assert.equal(new Set(ids).size,ids.length);const values=new Map([...ids].reverse().filter(id=>scratch.has(id)).map(id=>[id,structuredClone(scratch.get(id))]));if(ids[0].startsWith('point:')){batches.push([...ids]);await onBatch?.(values,batches);}return values;},async put(id,value){writes.push(id);scratch.set(id,structuredClone(value));},async putMany(entries){assert.ok(entries.length>0&&entries.length<=32);assert.equal(new Set(entries.map(([id])=>id)).size,entries.length);await onWriteBatch?.(entries,scratch);writeBatches.push(entries.map(([id])=>id));writeBatchBytes.push(entries.reduce((bytes,[id,value])=>bytes+Buffer.byteLength(id)+Buffer.byteLength(JSON.stringify(value)),0));for(const [id,value]of entries)scratch.set(id,structuredClone(value));await onWrittenBatch?.(entries,scratch);},async add(id){if(scratch.has(id))return false;scratch.set(id,true);return true;},async removeMany(ids){for(const id of ids)scratch.delete(id);}};
 let sourceReads=0;const materials={workspace,sequences,datasetPageCount:()=>pages.length,readSnapshot:fn=>fn(),retainedDatasetPage:async(doc,page,selected)=>{sourceReads++;assert.deepEqual(selected.columns,indices);return pages[page];}};
 return {materials,batches,selection,pages,reads,writes,writeBatches,writeBatchBytes,scratch,files,retainedBatches,retainedReads,write,setRetainedFault:fn=>{retainedFault=fn;},sourceReads:()=>sourceReads,async run(options={}){scratch.clear();currentWork=work;const result=await prepareRetainedPlot(materials,{content:{rowCount:rows.length}},{dataset:{kind:'dataset',id:randomUUID(),revision:'a'.repeat(64)},base:createFigure()},selection,{write,...options}),reader=await new RetainedFigureDocuments(workspace,{readOnly:true}).open(result.figure),points=[];for(let at=0;at<result.figure.document.counts.points;at++)points.push((await reader.rawPoint({offset:at})).value);return {result,reader,points};}};
}
const source=at=>({page:Math.floor(at/41),row:at%41});
function assertBatches(f,count,series=1){assert.equal(f.batches.length,Math.ceil(count/32)*series);assert.deepEqual(f.batches.flat(),Array.from({length:series},(_,s)=>Array.from({length:count},(_,at)=>'point:'+s+':'+at)).flat());}

test('source and categorical traversal retain every series point across unordered scratch batches',async()=>{
 for(const category of [false,true]){
  const rows=Array.from({length:65},(_,i)=>[category?'C'+(i%7):String(i%7),i===33?'':String(i),String(100+i)]),f=fixture(rows,{mapping:{xKind:category?'category':'number',kind:category?'bar':'scatter',order:category?'ascending':'source',values:[{column:1,error:null},{column:2,error:null}]}}),{points,result}=await f.run();
  assertBatches(f,65,2);assert.equal(result.figure.document.counts.points,130);
  for(let s=0;s<2;s++)for(let i=0;i<65;i++){const p=points[s*65+i];assert.equal(p.x,category?rows[i][0]:i%7);assert.equal(p.y,s?100+i:i===33?null:i);assert.deepEqual(p.source.source,source(i));assert.equal(p.source.column,s?10:7);}
 }
});

test('ascending numeric and date traversal preserve stable ties across sorter runs and batch tails',async()=>{
 for(const date of [false,true]){
  const rows=Array.from({length:161},(_,i)=>[date?'2026-01-'+String(i%7+1).padStart(2,'0'):String(i%7),String(i)]),f=fixture(rows,{mapping:{xKind:date?'date':'number',order:'ascending'}}),{points}=await f.run(),order=Array.from({length:161},(_,i)=>i).sort((a,b)=>a%7-b%7||a-b);
  assertBatches(f,161);assert.deepEqual(points.map(p=>p.y),order);assert.deepEqual(points.map(p=>p.source.source),order.map(source));assert.deepEqual(points.map(p=>p.x),order.map(i=>date?rows[i][0]:i%7));
 }
});

test('reduced point batches preserve complete group membership and exact reductions',async()=>{
 const rows=Array.from({length:130},(_,i)=>[String(64-i%65),String(i)]),f=fixture(rows,{mapping:{operation:'sum',order:'ascending'}}),{points,result}=await f.run();assertBatches(f,65);assert.equal(result.plotMembersIndex.count,130);
 for(let i=0;i<65;i++){const p=points[i],first=64-i;assert.equal(p.x,i);assert.equal(p.y,first*2+65);assert.equal(p.source.members.count,2);assert.deepEqual((await f.materials.sequences.page(result.plotMembersIndex,{offset:p.source.members.offset,limit:2})).items,[source(first),source(first+65)]);}
});

test('policy-owned long exact coordinates and receipts remain complete across batch and sorter pages',async()=>{
 const policy=defaultDatasetResourcePolicy();Object.assign(policy.resources,{maxScalarCharacters:12000,maxOperations:1000000,maxMilliseconds:30000});const origin='1'+'0'.repeat(9000),base=BigInt(origin),q=spelling=>({spelling,representation:'decimal',radix:10}),rows=Array.from({length:33},(_,i)=>[String(base+BigInt(i%3)),String(i)]),projection={version:2,resourcePolicy:policy,x:{origin:q(origin),scale:q('1')}},f=fixture(rows,{policy,mapping:{order:'ascending',projection}});
 for(const row of rows)row[0]=(await retainDatasetCell(f.materials,{value:row[0],kind:'string'},fn=>fn())).value;
 const {points,reader}=await f.run(),order=Array.from({length:33},(_,i)=>i).sort((a,b)=>a%3-b%3||a-b);assertBatches(f,33);assert.deepEqual(points.map(p=>p.y),order);
 for(let i=0;i<33;i++){const p=points[i];assert.equal(p.x,order[i]%3);assert.equal(p.source.coordinates.x.exact,String(base+BigInt(order[i]%3))+'/1');assert.deepEqual(p.source.coordinates.x.error,{numerator:'0',denominator:'1'});assert.deepEqual(p.source.source,source(order[i]));}
 const header=(await reader.header()).header;assert.equal(header.projection.x.origin.spelling.characters,origin.length);assert.deepEqual(header.projection.resourcePolicy,policy);let retainedOrigin='';for await(const part of reader.textChunks({collection:'header',id:header.id,field:'projection.x.origin.spelling'}))retainedOrigin+=part;assert.equal(retainedOrigin,origin);
});

test('missing batch points fail closed and cancellation after a batch read stops traversal',async()=>{
 const rows=Array.from({length:65},(_,i)=>[String(i),String(i)]);
 for(const order of ['source','ascending']){
  const missing=fixture(rows,{mapping:{order},onBatch:(values,batches)=>{if(batches.length===2)values.delete('point:0:40');}});await assert.rejects(missing.run(),{code:'MATERIAL_MISSING'});assert.equal(missing.batches.length,2);
  const stopped=new AbortController(),cancelled=fixture(rows,{mapping:{order},onBatch:(values,batches)=>{if(batches.length===2)stopped.abort();}});await assert.rejects(cancelled.run({signal:stopped.signal}),{name:'AbortError'});assert.equal(cancelled.batches.length,2);
 }
});

const dynamic={version:2,kind:'per-cell'},approximateCell={version:2,kind:'approximate',method:'pearson-centered-pairs-v1',engine:4,policy:defaultStructuredCalculationPolicy()},approximateFigure={version:1,kind:'approximate-inputs'};
test('mixed computed plots inspect contributing rows once and ignore excluded or unmapped approximations',async()=>{
 const policy=defaultDatasetResourcePolicy(),rows=Array.from({length:65},(_,i)=>[String(i),'0.5','0.25']),metadata=rows.map(()=>({cellComputations:[null,null,approximateCell]}));metadata[64]={excluded:'Explicit exclusion',cellComputations:[null,approximateCell,approximateCell]};
 for(const includedApproximate of [false,true]){const rowMetadata=structuredClone(metadata);if(includedApproximate)rowMetadata[42].cellComputations[1]=approximateCell;const f=fixture(rows,{policy,columnComputations:[null,dynamic,dynamic],rowMetadata}),{reader,result}=await f.run();assert.equal(f.sourceReads(),2,'source pages are not reread to classify computation');assert.equal(result.figure.document.counts.points,64);assert.deepEqual((await reader.header()).header.computation,includedApproximate?approximateFigure:undefined);}
});
test('plot reduction flags only included numeric contributors while count ignores unused value columns',async()=>{
 const policy=defaultDatasetResourcePolicy(),rows=[['0','0.5'],['0',''],['0','0.25']],rowMetadata=[{cellComputations:[null,null]},{cellComputations:[null,approximateCell]},{excluded:'Skip',cellComputations:[null,approximateCell]}];
 const reduced=fixture(rows,{policy,columnComputations:[null,dynamic],rowMetadata,mapping:{operation:'mean'}}),result=await reduced.run();assert.equal(result.points[0].y,0.5);assert.equal((await result.reader.header()).header.computation,undefined);
 const count=fixture(rows,{policy,columnComputations:[null,dynamic],rowMetadata,mapping:{operation:'count'}}),counted=await count.run();assert.equal(counted.points[0].y,2);assert.equal((await counted.reader.header()).header.computation,undefined);
 const bounds=fixture([['0','0.5','0.125']],{policy,columnComputations:[null,dynamic,dynamic],rowMetadata:[{cellComputations:[null,null,approximateCell]}],mapping:{values:[{column:1,error:2}]}}),bounded=await bounds.run();assert.equal(bounded.points[0].error,0.125);assert.deepEqual((await bounded.reader.header()).header.computation,approximateFigure);
 const invalid=fixture([['0','0.5']],{policy,columnComputations:[null,dynamic],rowMetadata:[{cellComputations:[null,undefined]}]});await assert.rejects(invalid.run(),{code:'DATASET_CELL_COMPUTATION'});
});
test('retained plot receipt verification replays actual computation in the existing bounded source pass',async()=>{
 const policy=defaultDatasetResourcePolicy(),f=fixture([['0','0.5'],['1','0.25']],{policy,columnComputations:[null,dynamic],rowMetadata:[{cellComputations:[null,approximateCell]},{cellComputations:[null,null]}]}),{result}=await f.run(),mapping={...f.selection.mapping,x:4,values:[{column:7,error:null}]},columns=Array.from({length:270},(_,i)=>({...defaultColumn({label:'Unselected '+i}),representation:'decimal'}));columns[4]=f.selection.columns[0];columns[7]=f.selection.columns[1];
 const source={content:{datasetFormat:3,rowCount:2,columns}},document={content:{tool:'Observanda table mapping',version:'10',figure:result.figure,mapping,parameters:JSON.stringify(mapping),inputs:[result.denominator.dataset],denominator:result.denominator,numericTransform:plotNumericalMetadata(mapping)}};
 f.materials.read=async()=>source;f.materials.datasetColumn=async(doc,index)=>doc.content.columns[index];f.materials.workspace.catalogue=async operation=>operation({db:{all:async()=>[{version:String(CATALOGUE_MAX_GENERATION)}]}});
 const before=f.sourceReads();await verifyPlotProjection(f.materials,document);assert.equal(f.sourceReads()-before,1,'verification uses its existing one-page source cache');
 f.pages[0].rows[0].cellComputations[1]=null;await assert.rejects(verifyPlotProjection(f.materials,document),{code:'CATALOGUE_DAMAGED'});
 delete f.pages[0].rows[1].cellComputations[1];await assert.rejects(verifyPlotProjection(f.materials,document),{code:'CATALOGUE_DAMAGED'});
});

test('hot mean reductions stage complete contributions in bounded batches without losing ordered members',async t=>{
 const rows=Array.from({length:132},(_,i)=>['105',String(i%4)]),committed=[];
 const f=fixture(rows,{mapping:{xKind:'category',kind:'bar',operation:'mean'},onWrittenBatch:entries=>{const reduced=entries.find(([id])=>id==='reduction:0');if(reduced)committed.push(reduced[1]);}}),{points,result}=await f.run();
 assert.equal(points.length,1);assert.equal(points[0].x,'105');assert.equal(points[0].y,1.5);assert.equal(points[0].source.members.count,rows.length);assert.equal(result.denominator.included,rows.length);
 assert.equal(f.reads.get('group:[1,null]'),1);assert.equal(f.reads.get('bucket:0:105'),1);assert.equal(f.reads.get('series:0')??0,0);assert.equal(f.reads.get('reduction:0')??0,0);
 assert.ok(f.writeBatches.length<rows.length/8);assert.ok(f.writeBatchBytes.every(bytes=>bytes<=256*1024));assert.ok(f.writeBatches.flat().filter(id=>id==='series:0').length<=2);
 let count=0;for(const [index,ids]of f.writeBatches.entries()){
  const members=ids.filter(id=>id.startsWith('member:'));assert.deepEqual(members,Array.from({length:members.length},(_,at)=>'member:0:'+(count+at)));count+=members.length;
  assert.ok(ids.includes('reduction:0'));assert.equal(committed[index].members,count);assert.equal(committed[index].n,count);
  assert.equal(committed[index].sum,rows.slice(0,count).reduce((sum,row)=>sum+Number(row[1]),0)+'/1','later updates cannot mutate an earlier flushed reduction');
 }
 assert.equal(count,rows.length);t.diagnostic(JSON.stringify({rows:rows.length,writeBatches:f.writeBatches.length,maximumBatchBytes:Math.max(...f.writeBatchBytes)}));
 assert.equal(f.writes.some(id=>/^(group|series|bucket|reduction|member|point):/.test(id)),false);
 assert.deepEqual(await Array.fromAsync(f.materials.sequences.items(result.plotMembersIndex)),rows.map((_,i)=>source(i)));
});

test('interleaved reduction groups survive count eviction with exact results and complete ordered memberships',async()=>{
 const count=70,rows=Array.from({length:count*2},(_,i)=>{const at=i%count;return ['C'+at,at===count-1?'':String(at+(i>=count?2:0)),'G'+at%7];});
 for(const operation of ['sum','mean','min','max','median','count']){
  const f=fixture(rows,{mapping:{xKind:'category',kind:'bar',group:2,operation}}),{points,result}=await f.run(),order=Array.from({length:7},(_,group)=>Array.from({length:10},(_,at)=>group+at*7)).flat();
  assert.equal(points.length,count);assert.equal(result.plotMembersIndex.count,rows.length);assert.ok(f.reads.get('bucket:0:C0')>=2,'evicted bucket identities must be reread');
  for(const [index,at]of order.entries()){
   const point=points[index],expected=operation==='count'?2:at===count-1?null:operation==='sum'?at*2+2:operation==='min'?at:operation==='max'?at+2:at+1;
   assert.equal(point.x,'C'+at);assert.equal(point.y,expected);assert.equal(point.source.group,'G'+at%7);assert.equal(point.source.members.count,2);
   assert.deepEqual((await f.materials.sequences.page(result.plotMembersIndex,{offset:point.source.members.offset,limit:2})).items,[source(at),source(at+count)]);
  }
 }
});

test('grouping cache byte eviction counts UTF-8 keys and oversized metadata falls back to scratch',async()=>{
 const categories=Array.from({length:10},(_,i)=>'観'.repeat(10000)+i),rows=categories.map(category=>[category,'1']);rows.push([categories[0],'3']);
 const f=fixture(rows,{mapping:{xKind:'category',kind:'bar',operation:'mean'}}),{points,result}=await f.run();
 assert.ok(f.writeBatchBytes.every(bytes=>bytes<=256*1024),'UTF-8 key bytes bound staged contributions');assert.ok(f.writeBatches.length>1);
 assert.equal(points.length,categories.length);assert.equal(points[0].y,2);assert.equal(points[0].x,categories[0]);assert.equal(f.reads.get('bucket:0:'+categories[0]),2,'key bytes must evict before the 64-entry bound');assert.equal(result.plotMembersIndex.count,rows.length);
 // This producer accepts already selected scalar strings; oversized grouping
 // metadata must still use scratch instead of bypassing the cache byte bound.
 const group='界'.repeat(90000),large=fixture([['A','1',group],['A','3',group]],{mapping:{xKind:'category',kind:'bar',group:2,operation:'mean'}}),retained=await large.run();
 assert.ok(large.writeBatchBytes.some(bytes=>bytes>256*1024),'oversized complete contributions go directly to scratch');
 assert.equal(retained.points[0].y,2);assert.equal(retained.points[0].source.group,group);assert.equal(large.reads.get('group:'+JSON.stringify([1,group])),2);assert.equal(large.reads.get('series:0'),3);
 assert.deepEqual(await Array.fromAsync(large.materials.sequences.items(retained.result.plotMembersIndex)),[source(0),source(1)]);
});

test('failed contribution batches preserve prior complete members and flush failures precede figure writes',async()=>{
 for(const count of [40,65]){
  const reason=Error('failed reduction batch');let attempted=0,prior;
  const f=fixture(Array.from({length:count},(_,i)=>['A',String(i)]),{mapping:{xKind:'category',kind:'bar',operation:'mean'},onWriteBatch:(_entries,scratch)=>{if(++attempted===2){prior=structuredClone(scratch.get('reduction:0'));throw reason;}}});
  await assert.rejects(f.run(),error=>error===reason);assert.deepEqual(f.scratch.get('reduction:0'),prior);assert.ok(prior.members>1&&prior.members<count);
  for(let i=0;i<prior.members;i++)assert.deepEqual(f.scratch.get('member:0:'+i),source(i));assert.equal(f.scratch.has('member:0:'+prior.members),false);assert.equal(f.scratch.get('series:0').count,1);assert.equal(f.files.size,0);
  if(count===40)assert.equal(f.sourceReads(),1,'the final partial batch can fail after all source rows were consumed');
 }
});

test('grouping cache cancellation after scratch reads or row writes stops before publication',async()=>{
 const reason=Object.assign(Error('cancel reduction'),{name:'AbortError'});
 const reading=new AbortController(),read=fixture([['A','1']],{mapping:{xKind:'category',kind:'bar',operation:'mean'},onGet:id=>{if(id==='group:[1,null]')reading.abort(reason);}});
 await assert.rejects(read.run({signal:reading.signal}),error=>error===reason);assert.equal(read.writeBatches.length,0);assert.equal(read.files.size,0);
 const writing=new AbortController(),written=fixture(Array.from({length:65},(_,i)=>['A',String(i)]),{mapping:{xKind:'category',kind:'bar',operation:'mean'},onWrittenBatch:entries=>{if(entries.some(([id])=>id==='member:0:0'))writing.abort(reason);}});
 await assert.rejects(written.run({signal:writing.signal}),error=>error===reason);const members=written.scratch.get('reduction:0').members;assert.ok(members>1&&members<65);assert.equal(written.scratch.has('member:0:'+members),false);assert.equal(written.writeBatches.length,1);assert.equal(written.files.size,0);
 const pending=new AbortController(),staged=fixture(Array.from({length:10},(_,i)=>['A',String(i)]),{mapping:{xKind:'category',kind:'bar',operation:'mean'}});
 await assert.rejects(staged.run({signal:pending.signal,progress:()=>pending.abort(reason)}),error=>error===reason);assert.equal(staged.writeBatches.length,0);assert.equal(staged.files.size,0);
});

const sequencePath='.observanda/materials/sequences/';
const memberBatches=f=>f.retainedBatches.filter(batch=>batch.some(entry=>entry.name.startsWith(sequencePath)));
const meanFixture=count=>fixture(Array.from({length:count},()=>['A','2']),{mapping:{xKind:'category',kind:'bar',operation:'mean'}});
async function preserveEarlierMaterial(f){
 const builder=f.materials.sequences.builder('plot-members',f.write),earlier=[{page:1000,row:0},{page:1000,row:1}];
 for(const item of earlier)await builder.append(item);const root=await builder.finish();
 await f.write(()=>f.materials.workspace.writeMetadata('.observanda/unrelated-material.json','{"retained":"unchanged"}'));
 const original=new Map(f.files);f.retainedBatches.length=0;
 return async()=>{for(const [key,text]of original)assert.equal(f.files.get(key),text,'earlier retained material must remain unchanged');assert.deepEqual(await Array.fromAsync(f.materials.sequences.items(root)),earlier);};
}
async function assertMembers(f,result,count){
 assert.equal(result.plotMembersIndex.count,count);
 assert.deepEqual(await Array.fromAsync(f.materials.sequences.items(result.plotMembersIndex)),Array.from({length:count},(_,i)=>source(i)));
}

test('plot member retention batches immutable children through the supplied writer before returning its final root',async t=>{
 const count=2049,f=meanFixture(count),preserved=await preserveEarlierMaterial(f),before=new Set(f.files.keys()),sequences=f.materials.sequences,{result,points}=await f.run();
 const batches=memberBatches(f);assert.ok(batches.length>1);assert.ok(batches.length<Math.ceil(count/64)/2,'member chunks must share bounded writer transactions');
 for(const batch of batches){assert.ok(batch.length<=32);assert.ok(batch.every(entry=>entry.name.startsWith(sequencePath)),'figure blocks keep their original writer');assert.ok(batch.reduce((n,entry)=>n+Buffer.byteLength(entry.text),0)<=256*1024);}
 const authorized=new Set(f.retainedBatches.flat().map(entry=>entry.name));for(const key of f.files.keys())if(!before.has(key))assert.ok(authorized.has(key),'every retained object must use the supplied writer');
 assert.equal(f.materials.sequences,sequences,'staging must not replace the source owner');assert.equal(f.sourceReads(),Math.ceil(count/41));assert.equal(points.length,1);assert.equal(points[0].y,2);assert.deepEqual(points[0].source.members,{offset:0,count});
 await assertMembers(f,result,count);await preserved();t.diagnostic(JSON.stringify({members:count,memberChunks:Math.ceil(count/64),retainedTransactions:batches.length}));
});

test('plot member commits authenticate existing chunks and nodes, including raw node size limits',async()=>{
 for(const damaged of ['chunk','node','node-limit']){
  const f=meanFixture(129),preserved=await preserveEarlierMaterial(f),{result}=await f.run();
  const nodePath=sequencePath+'nodes/'+result.plotMembersIndex.root.hash+'.json',node=JSON.parse(f.files.get(nodePath)),name=damaged==='chunk'?sequencePath+'chunks/'+node.revision+'.json':nodePath,original=f.files.get(name);
  const corrupt=damaged==='node-limit'?original+' '.repeat(8193-Buffer.byteLength(original)):serialize({corrupt:true});f.files.set(name,corrupt);let returned=false;
  await assert.rejects(f.run().then(value=>{returned=true;return value;}),{code:damaged==='node-limit'?'LIMIT':'MATERIAL_MISSING'});assert.equal(returned,false);assert.equal(f.files.get(name),corrupt,'failed authentication must not replace existing bytes');await preserved();
  f.files.set(name,original);const retried=await f.run();assert.deepEqual(retried.result.plotMembersIndex,result.plotMembersIndex);await assertMembers(f,retried.result,129);
 }
});

test('middle and final plot member writes reject rollback and lost acknowledgements without exposing a result',async()=>{
 const count=2049,baseline=meanFixture(count),expected=(await baseline.run()).result,total=memberBatches(baseline).length;assert.ok(total>2);
 for(const at of [Math.floor(total/2),total])for(const durable of [false,true]){
  const f=meanFixture(count),preserved=await preserveEarlierMaterial(f),reason=Error('Retained write interrupted');let writes=0,failed,returned=false;
  f.setRetainedFault(batch=>{if(batch.some(entry=>entry.name.startsWith(sequencePath))&&++writes===at){failed=batch;return {error:reason,durable};}});
  await assert.rejects(f.run().then(value=>{returned=true;return value;}),error=>error===reason);assert.equal(returned,false);assert.equal(writes,at);assert.ok(failed.length);
  for(const entry of failed)assert.equal(f.files.has(entry.name),durable,'the fixture distinguishes rollback from a lost durable acknowledgement');await preserved();
  f.setRetainedFault(null);const retried=await f.run();assert.deepEqual(retried.result.plotMembersIndex,expected.plotMembersIndex);assert.equal(retried.points[0].y,2);await assertMembers(f,retried.result,count);await preserved();
 }
});

test('cancellation during middle or final member commits cannot return a prepared plot',async()=>{
 for(const count of [129,2049]){
  const f=meanFixture(count),preserved=await preserveEarlierMaterial(f),controller=new AbortController(),reason=Object.assign(Error('Cancel retained members'),{name:'AbortError'});let writes=0,returned=false;
  f.setRetainedFault(batch=>{if(batch.some(entry=>entry.name.startsWith(sequencePath))&&++writes===1)controller.abort(reason);});
  await assert.rejects(f.run({signal:controller.signal}).then(value=>{returned=true;return value;}),error=>error===reason);assert.equal(returned,false);assert.equal(writes,1);await preserved();
  f.setRetainedFault(null);const retried=await f.run();await assertMembers(f,retried.result,count);await preserved();
 }
});
