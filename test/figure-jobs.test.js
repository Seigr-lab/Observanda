import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {ResearchMaterials,EVIDENCE_CHUNK} from '../src/research-materials.js';
import {workspaceJobs} from '../src/workspace-jobs.js';
import {enqueuePlot,datasetJobs} from '../src/dataset-jobs.js';
import {AppError} from '../src/errors.js';
import {clearVault} from '../src/encryption.js';
import {copyPlan,copyWorkspace} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
const column=(name,representation='text')=>({name,representation,radix:10,unit:'',missing:[{value:'',meaning:'Not acquired'}],time:{kind:'none',reference:'',resolution:'',uncertainty:''}});
const mapping={x:0,xKind:'category',values:[{column:1,error:null}],group:null,operation:'median',kind:'bar',order:'source',mode:'replace',decimal:'.'};
async function fixture(t,count=43440){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-plot-jobs-')),book=sampleNotebook(),f=await encryptedFixture(directory,book);
 const materials=new ResearchMaterials(f.workspace),jobs=workspaceJobs(f.workspace),recordId=book.entries[0].id;
 t.after(async()=>{await jobs.worker.stop();clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const expected=new Map(),bytes=Buffer.from(Array.from({length:count},(_,i)=>{
  const group='Take '+(i%3),reading=i%101===0?null:((i*17)%701)-350;
  if(i!==99&&reading!==null){if(!expected.has(group))expected.set(group,[]);expected.get(group).push(reading);}
  return JSON.stringify({group,reading,private:'Private retained notes '+ 'x'.repeat(512),counter:'18446744073709551615',senary:'105'});
 }).join('\n'));
 const session=await materials.startImport({recordId,name:'takes.jsonl',size:bytes.length});
 for(let i=0;i<bytes.length;i+=EVIDENCE_CHUNK)await materials.appendImport(session.id,i/EVIDENCE_CHUNK,[bytes.subarray(i,i+EVIDENCE_CHUNK)]);
 const artifact=await materials.finishImport(session.id),sourceMapping={format:'jsonl',fields:['group','reading','private','counter','senary'].map(name=>({name,path:'/'+name}))};
 const dataset=await materials.dataset({recordId,title:'Individual takes',artifact,sourceMapping,columns:[column('Take'),column('Level','decimal'),column('Private notes'),column('Counter','integer'),{...column('Native','radix'),radix:6}],exclusions:{[artifact.id+':100']:'Recorder interrupted'}});
 return {...f,...jobs,materials,directory,recordId,dataset,artifact,expected,count,bytes:bytes.length,command:{recordId,title:'Median by take',dataset,mapping}};
}
async function perform(f,id){
 const job=await f.queue.claim();assert.equal(job.id,id);
 const prepared=await f.queue.definition(job).prepare(job,{progress:p=>f.queue.pulse(id,job.lease.token,p)});
 return f.queue.complete(id,job.lease.token,prepared);
}
test('43,440 retained measurements calculate without loading a table; medians, coverage and exact inputs survive restore',async t=>{
 const f=await fixture(t);assert.ok(f.bytes>16*1024*1024);
 const old=f.materials.datasetRows,read=f.workspace.read;f.materials.datasetRows=()=>{throw Error('Loaded whole table');};f.workspace.read=()=>{throw Error('Assembled workspace');};
 // The production worker creates its own service instance: block every whole-table read too.
 const rows=ResearchMaterials.prototype.datasetRows;ResearchMaterials.prototype.datasetRows=()=>{throw Error('Loaded whole table');};
 const id=randomUUID();let completed;
 try{await enqueuePlot(f.materials,f.queue,f.command,id);completed=await perform(f,id);}
 finally{f.materials.datasetRows=old;f.workspace.read=read;ResearchMaterials.prototype.datasetRows=rows;}
 const doc=await f.materials.read(completed.result),d=doc.content.denominator;
 assert.equal(d.rows,f.count);assert.equal(d.included,f.count-1);assert.equal(d.excludedCount,1);assert.equal(d.missing[1].count,Math.ceil(f.count/101));assert.deepEqual(d.dataset,f.dataset);
 assert.ok(JSON.stringify(d).length<2000,'coverage references retained row identities instead of copying every id');
 for(const point of doc.content.figure.series[0].points){const values=f.expected.get(point.x).sort((a,b)=>a-b),m=Math.floor(values.length/2);assert.equal(point.y,values.length%2?values[m]:values[m-1]/2+values[m]/2);}
 assert.equal((await enqueuePlot(f.materials,f.queue,f.command,id)).result.revision,completed.result.revision);
 assert.equal((await datasetJobs(f.materials,f.queue,f.recordId)).items[0].type,'figure.calculate');
 assert.deepEqual((await f.workspace.metadataPage(f.materials.plotWork(id))).items,[]);
 await assert.rejects(f.materials.plot({...f.command,mapping:{...mapping,operation:'raw'}}),{code:'MATERIAL_ANALYSIS_LIMIT'});
 const original=await f.materials.read(f.dataset),columns=await f.materials.datasetColumns(original);columns[1].unit='relative level';
 const updated=await f.materials.dataset({id:f.dataset.id,expectedRevision:f.dataset.revision,baseDataset:f.dataset,recordId:f.recordId,title:original.title,artifact:f.artifact,columns,sourceMapping:original.content.sourceMapping});
 assert.ok((await f.materials.overview(f.recordId)).items.find(i=>i.id===completed.result.id).changed.some(i=>i.id===updated.id));
 assert.deepEqual((await f.materials.read(completed.result)).content,doc.content);
 const copy=await copyWorkspace(await copyPlan(f.workspace.root,path.join(f.directory,'restored')),{vault:f.vault}),restored=new ResearchMaterials(new Workspace(copy,f.vault));
 assert.deepEqual((await restored.read(completed.result)).content,doc.content);
 const source=await restored.datasetPage(d.dataset,0);assert.equal(source.rows[0].cells[3],'18446744073709551615');assert.equal(source.rows[0].cells[4],'105');assert.equal(source.rows[99].excluded,'Recorder interrupted');
 assert.equal((await restored.artifact(f.artifact)).doc.content.size,f.bytes);
});
test('figure jobs fence retries, cancel partial sorting and atomically retain an immutable result',async t=>{
 const f=await fixture(t,5000),id=randomUUID();
 const implicitRaw={...mapping,values:[{column:1,error:3}]};delete implicitRaw.operation;
 await assert.rejects(f.materials.plot({...f.command,mapping:implicitRaw}),{code:'MATERIAL_PRECISION'});
 await enqueuePlot(f.materials,f.queue,f.command,id);
 const first=await f.queue.claim(),controller=new AbortController();
 let partial=false;
 await assert.rejects(f.materials.preparePlot(first.input.command,{jobId:id,attempt:first.lease.token,signal:controller.signal,progress:async p=>{
  // A separate writer can run while calculation is in progress.
  await f.workspace.withLock(()=>f.workspace.writeMetadata('.observanda/analysis-check.json','{"ok":true}'));
  if(p.stage==='calculating dataset rows'&&p.done>=2304){partial=true;controller.abort(new AppError('JOB_CANCELLED'));}
 }}),{code:'JOB_CANCELLED'});
 assert.equal(partial,true);assert.deepEqual((await f.workspace.metadataPage(f.materials.plotWork(id))).items,[]);
 assert.equal(await f.materials.current(id),null);
 await f.queue.control(id,'cancel');await f.queue.release(id,first.lease.token);await f.queue.control(id,'retry');
 const second=await f.queue.claim();await assert.rejects(f.queue.complete(id,first.lease.token,{}),{code:'JOB_LEASE'});
 // Simulate scratch left behind by a killed process. The next lease clears it.
 await f.workspace.withLock(()=>f.workspace.writeMetadata(f.materials.plotWork(id,first.lease.token)+'/0.json','[[0,100]]'));
 let writes=0;
 await assert.rejects(f.materials.preparePlot(second.input.command,{jobId:id,attempt:second.lease.token,writePage:fn=>f.queue.transaction(async()=>{await f.queue.held(id,second.lease.token);await fn();if(++writes===2)throw new AppError('STORAGE_FULL');})}),{code:'STORAGE_FULL'});
 assert.equal(await f.materials.current(id),null);
 const prepared=await f.queue.definition(second).prepare(second,{});
 assert.deepEqual((await f.workspace.metadataPage(f.materials.plotWork(id))).items,[]);
 const write=f.queue.write.bind(f.queue);f.queue.write=async job=>{if(job.state==='completed')throw new AppError('STORAGE_FULL');return write(job);};
 await assert.rejects(f.queue.complete(id,second.lease.token,prepared),{code:'STORAGE_FULL'});
 assert.equal(await f.materials.current(id),null);assert.equal((await f.queue.read(id)).state,'running');
 f.queue.write=write;const completed=await f.queue.complete(id,second.lease.token,prepared);assert.equal(completed.state,'completed');
 assert.equal((await f.materials.read(completed.result)).content.denominator.rows,5000);
});

test('plot preparation bounds owner connections and closes them on cancellation while preserving fresh transactions',{timeout:60000},async t=>{
 const f=await fixture(t,129),open=f.workspace.openCatalogue.bind(f.workspace),entries=[];let readTransactions=0;
 f.workspace.openCatalogue=async options=>{const db=await open(options),close=db.close.bind(db),run=db.run.bind(db),entry={closed:false};db.run=async(...args)=>{if(args[0]==='BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')readTransactions++;return run(...args);};entries.push(entry);db.close=async()=>{try{return await close();}finally{entry.closed=true;}};return db;};
 t.after(()=>{f.workspace.openCatalogue=open;});
 const marker='.observanda/plot-connection-test.json',controller=new AbortController();let progressed=false;
 await assert.rejects(f.materials.preparePlot(f.command,{signal:controller.signal,progress:async p=>{
  if(p.stage!=='calculating dataset rows'||progressed)return;progressed=true;assert.equal(p.done,64);
  assert.equal(await f.workspace.readMetadata(marker,1024),null);
  // The producer holds no read transaction or writer lock across this callback.
  await f.workspace.withLock(()=>f.workspace.writeMetadata(marker,'{"done":64}'));
  assert.equal(await f.workspace.readMetadata(marker,1024),'{"done":64}');
  controller.abort(new AppError('JOB_CANCELLED'));
 }}),{code:'JOB_CANCELLED'});
 assert.equal(progressed,true);assert.ok(entries.length<=3,'cancelled producer reuses bounded owner handles');assert.ok(entries.every(entry=>entry.closed),'cancelled preparation drains and closes every handle');
 entries.length=0;
 const pageReads=[],prepared=await f.materials.preparePlot(f.command,{signal:t.signal,progress:async p=>{if(p.stage==='calculating dataset rows')pageReads.push({done:p.done,reads:readTransactions});}});
 assert.deepEqual(pageReads.map(p=>p.done),[64,128,129]);for(let i=1;i<pageReads.length;i++)assert.equal(pageReads[i].reads-pageReads[i-1].reads,2,'one discovery check and one bounded source-page snapshot');
 assert.equal(prepared.content.denominator.rows,129);assert.equal(prepared.content.figure.document.counts.points,3);
 assert.ok(entries.length<=3,'complete producer reuses bounded owner handles');assert.ok(entries.every(entry=>entry.closed),'successful preparation also closes every handle');
 f.workspace.openCatalogue=open;
 const ref=await f.workspace.withLock(()=>f.materials.commitPlot(f.command,prepared));assert.deepEqual((await f.materials.read(ref)).content.figure,prepared.content.figure);
});
