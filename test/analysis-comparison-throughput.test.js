import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {EventEmitter} from 'node:events';
import {requestWriterWait} from '../src/writer-wait.js';
import {comparisonFixture} from './analysis-comparison-fixture.js';
import {addressedComparisonInputs} from '../src/web/analysis-model.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
import {withWorkspaceMetadataBatch} from '../src/metadata-batch.js';
import {ResearchRecords} from '../src/research.js';

function request(operation){
 const req={waitForWriter:true,checkWriter:async()=>{},socket:{timeout:60000,destroyed:false,setTimeout(){}}},res=new EventEmitter();res.setTimeout=()=>{};res.writableEnded=false;
 return requestWriterWait(req,res,operation);
}

// Independent group growth and repeatedly updated distributions/transitions
// exercise a different dimension from the distinct-value capacity workload.
// Exact read counts are regression gates; timings describe this runner only.
// Timing and retained storage include the three foreground revisions. Heap is
// sampled at batch boundaries, not measured continuously.
for(const groups of [16,160])test('comparison update workload with '+groups+' groups preserves foreground authoring and bounded authenticated reads',{timeout:600000},async t=>{
 const f=await comparisonFixture(t,{groups,rowsPerGroup:9,repeatValues:true}),namespace=(await f.workspace.outline()).metadata.id;
 const command={...f.command,...addressedComparisonInputs(f.command,namespace)};Object.assign(command.comparison,{version:3,resourcePolicy:defaultDatasetResourcePolicy()});
 const storage=()=>f.workspace.catalogue(async store=>{const row=await store.db.get('SELECT count(*) AS count,COALESCE(sum(octet_length(payload)),0) AS bytes FROM objects');return {objects:Number(row.count),bytes:Number(row.bytes)};}),before=await storage();
 const reads={groups:0,distribution:0,transitions:0,observations:0},read=f.m.sequences.read.bind(f.m.sequences);f.m.sequences.read=async(kind,...args)=>{const value=await read(kind,...args);if(kind==='comparison-values'&&value)reads[value.table]++;return value;};
 let firstBatch;const writing=new Promise(resolve=>{firstBatch=resolve;});let batches=0,longestWriterMs=0,sampledPeakHeapBytes=process.memoryUsage().heapUsed;
 const began=performance.now(),pending=request(()=>f.m.comparisons.save(command,{writePage:fn=>f.workspace.withLock(async()=>{firstBatch();const start=performance.now();try{return await withWorkspaceMetadataBatch(f.workspace,fn);}finally{batches++;longestWriterMs=Math.max(longestWriterMs,performance.now()-start);sampledPeakHeapBytes=Math.max(sampledPeakHeapBytes,process.memoryUsage().heapUsed);}})}));
 // Attach rejection immediately; an early validation failure must release the
 // foreground wait rather than leave a second test task hanging indefinitely.
 pending.catch(()=>firstBatch());const foregroundMs=[];let record=structuredClone(f.book.entries.find(item=>item.id!==f.recordId));assert.ok(record);
 let ref;try{
  await writing;const records=new ResearchRecords(f.workspace,{});
  for(let i=0;i<3;i++){const start=performance.now(),selected=await f.workspace.catalogue(store=>store.recordSelection([record.id])),next={...selected.book.entries[0],title:'Foreground observation '+(i+1)};await request(()=>records.save({workspaceId:namespace,changes:[{id:record.id,expectedRevision:selected.recordRevisions[record.id],record:next}]},{receipt:true}));foregroundMs.push(performance.now()-start);record=next;}
  ref=await pending;
 }finally{await pending.catch(()=>{});f.m.sequences.read=read;}
 const prepareAndAuthorMs=performance.now()-began,after=await storage(),doc=await f.m.read(ref),summary=doc.content.summary;
 assert.equal(summary.algorithmVersion,'4');assert.equal(summary.rows,groups*9);assert.deepEqual(summary.counts,{groups,distribution:groups*3,transitions:groups*3,observations:groups*9});assert.equal(summary.raw.correct,groups*6);assert.equal(summary.raw.mismatched,groups*3);
 assert.deepEqual(reads,{groups:groups*8,distribution:groups*6,transitions:groups*5,observations:0});assert.ok(batches>=Math.ceil(groups*9/32));
 const retained=f.m.retainedDatasetPage;f.m.retainedDatasetPage=()=>{throw Error('Direct inspection replayed source rows');};
 try{const last=(await f.m.comparisons.page({ref,view:'groups',offset:groups-1,limit:1})).items[0],values=(await f.m.comparisons.page({ref,view:'distribution',group:last.key})).items;assert.equal(last.rows,9);assert.deepEqual(values.map(value=>value.count),[3,3,3]);assert.deepEqual(values.map(value=>value.exact.numerator),['9007199254740993','9007199254740994','9007199254740995']);assert.ok(values.every(value=>value.locator.ref.revision===f.dataset.revision));const transitions=await f.m.comparisons.page({ref,view:'transitions',group:last.key});assert.deepEqual(transitions.items.map(value=>value.count),[3,3,2]);}
 finally{f.m.retainedDatasetPage=retained;}
 const saved=await f.workspace.catalogue(store=>store.recordSelection([record.id]));assert.equal(saved.book.entries[0].title,record.title);
 const verificationStart=performance.now();await f.m.comparisons.verify(command,summary);assert.ok(after.objects>before.objects);assert.ok(after.bytes>before.bytes);
 t.diagnostic(JSON.stringify({groups,rows:groups*9,authenticatedValueReads:reads,prepareAndAuthorMs:Math.round(prepareAndAuthorMs),verifyMs:Math.round(performance.now()-verificationStart),batches,longestWriterMs:Math.round(longestWriterMs),foregroundSaveMs:foregroundMs.map(Math.round),retainedObjectDelta:after.objects-before.objects,retainedByteDelta:after.bytes-before.bytes,sampledPeakHeapMiB:Math.round(sampledPeakHeapBytes/1048576)}));
});
