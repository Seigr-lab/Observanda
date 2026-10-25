import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,open,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {ResearchMaterials,EVIDENCE_CHUNK} from '../src/research-materials.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {workspaceJobs} from '../src/workspace-jobs.js';
import {enqueueDataset,enqueuePlot} from '../src/dataset-jobs.js';
import {RetainedFigureDocuments} from '../src/retained-figure-document.js';
import {DATASET_ROWS_PER_PAGE} from '../src/dataset-row-position.js';
import {MaterialSequence} from '../src/material-sequence.js';
import {sampleWorkloadCpu} from './workload-cpu-sample.js';

// Focused diagnostic; the normal adoption test covers the combined workload.
// Run explicitly with: node scripts/test.js --test-concurrency=1 test/dataset-import-plot-capacity.benchmark.js
test('tenfold long-cell dataset preparation and reduction meet their declared workload budgets',{timeout:480000},async t=>{
 const cpu=sampleWorkloadCpu();t.after(()=>t.diagnostic(JSON.stringify({cpuObserved:cpu.stop()})));
 const parent=path.resolve(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-dataset-capacity-')),book=sampleNotebook();let f,jobs,activeRun,peak=0;
 const sampler=setInterval(()=>{peak=Math.max(peak,process.memoryUsage().heapUsed);},25);sampler.unref();
 t.after(async()=>{clearInterval(sampler);await jobs?.worker.stop();await activeRun?.catch(()=>{});if(f)clearVault(f.vault);assert.equal(path.dirname(directory),parent);assert.ok(path.basename(directory).startsWith('observanda-dataset-capacity-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 f=await encryptedFixture(directory,book);jobs=workspaceJobs(f.workspace);const materials=new ResearchMaterials(f.workspace),recordId=book.entries[0].id,rows=43440;
 const names=['reading','counter','native','notes'],parts=Array.from({length:4},(_,reading)=>Buffer.from(JSON.stringify({reading,counter:'18446744073709551615',native:'105',notes:'Synthetic acquired detail. '.repeat(165)})+'\n')),size=rows*parts[0].length;
 assert.ok(parts.every(part=>part.length===parts[0].length));const source=await open(path.join(directory,'observations.jsonl'),'wx+');let artifact;
 try{
  for(let at=0;at<rows;at+=256)await source.write(Buffer.concat(Array.from({length:Math.min(256,rows-at)},(_,i)=>parts[(at+i)%4])));
  assert.equal((await source.stat()).size,size);
  const upload=await materials.startImport({recordId,name:'observations.jsonl',size});
  for(let at=0,index=0;at<size;at+=EVIDENCE_CHUNK,index++){const bytes=Buffer.alloc(Math.min(EVIDENCE_CHUNK,size-at)),read=await source.read(bytes,0,bytes.length,at);assert.equal(read.bytesRead,bytes.length);await materials.appendImport(upload.id,index,[bytes]);}
  artifact=await materials.finishImport(upload.id);
 }finally{await source.close();}
 const perform=async id=>{t.signal.throwIfAborted();jobs.worker.enabled=true;try{activeRun=jobs.worker.runOnce();await activeRun;}finally{jobs.worker.enabled=false;}const job=await jobs.queue.read(id);assert.equal(job.state,'completed',JSON.stringify(job));return job.result;};
 const columns=names.map((name,index)=>({...defaultColumn({label:name}),representation:index===3?'text':index===2?'radix':'integer',radix:index===2?6:10}));
 process.stdout.write('Dataset capacity: preparing 43440 rows\n');let at=performance.now();const datasetId=randomUUID();
 await enqueueDataset(materials,jobs.queue,{recordId,title:'Acquired observations',artifact,sourceMapping:{format:'jsonl',fields:names.map(name=>({name,path:'/'+name}))},columns},datasetId);
 // Distinguish parsing from retained writes in a failed capacity report.
 const build=MaterialSequence.prototype.builder;let retaining=0,parsedMs=null,dataset;
 MaterialSequence.prototype.builder=function(kind,...args){if(kind==='cells'){if(parsedMs===null){parsedMs=Math.round(performance.now()-at);process.stdout.write('Dataset capacity: parsed in '+parsedMs+' ms\n');}if(++retaining%10000===0)process.stdout.write('Dataset capacity: retaining row '+retaining+'\n');}return build.call(this,kind,...args);};
 try{dataset=await perform(datasetId);}finally{MaterialSequence.prototype.builder=build;}
 const datasetMs=Math.round(performance.now()-at);process.stdout.write('Dataset capacity: preparation '+datasetMs+' ms\n');
 at=performance.now();const retained=await materials.read(dataset);assert.equal(retained.content.rowCount,rows);const last=await materials.datasetPage(dataset,retained.content.pageIndex.count-1);assert.deepEqual(last.rows.at(-1).cells.slice(0,3),['3','18446744073709551615','105']);
 let notes='';for(let offset=0;offset!==null;){const part=await materials.readDatasetCell(last.rows.at(-1).cells[3],{offset,limit:4096});notes+=part.text;offset=part.next;}assert.equal(notes,'Synthetic acquired detail. '.repeat(165));
 const datasetReadMs=Math.round(performance.now()-at);process.stdout.write('Dataset capacity: inspected last page in '+datasetReadMs+' ms\n');
 process.stdout.write('Dataset capacity: calculating all rows\n');at=performance.now();const figureId=randomUUID();
 await enqueuePlot(materials,jobs.queue,{recordId,title:'Observed mean',dataset,mapping:{x:2,xKind:'category',values:[{column:0,error:null}],group:null,operation:'mean',kind:'bar',order:'source',mode:'replace',decimal:'.'}},figureId);
 const figure=await perform(figureId),calculationMs=Math.round(performance.now()-at);process.stdout.write('Dataset capacity: calculation '+calculationMs+' ms\n');
 const result=await materials.read(figure),reader=await new RetainedFigureDocuments(f.workspace,{readOnly:true}).open(result.content.figure),points=await reader.window({collection:'points',limit:2});
 assert.equal(result.content.denominator.included,rows);assert.equal(points.total,1);assert.equal(points.items[0].value.x,'105');assert.equal(points.items[0].value.y,1.5);assert.equal(result.content.plotMembersIndex.count,rows);
 assert.deepEqual((await reader.rawPoint({offset:0})).value.source.members,{offset:0,count:rows});let member=0;
 await materials.readSnapshot(async()=>{for await(const source of materials.sequences.items(result.content.plotMembersIndex)){assert.deepEqual(source,{page:Math.floor(member/DATASET_ROWS_PER_PAGE),row:member%DATASET_ROWS_PER_PAGE});member++;}});assert.equal(member,rows);
 t.diagnostic(JSON.stringify({rows,size,parsedMs,datasetMs,datasetReadMs,calculationMs,peakHeapMiB:Math.ceil(peak/1024/1024)}));assert.ok(datasetMs<240000,'datasetMs budget: '+datasetMs);assert.ok(calculationMs<120000,'calculationMs budget: '+calculationMs);assert.ok(peak<512*1024*1024);
});
