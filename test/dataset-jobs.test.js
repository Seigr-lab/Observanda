import {DATASET_ROWS_PER_PAGE} from '../src/dataset-row-position.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {ResearchMaterials,EVIDENCE_CHUNK} from '../src/research-materials.js';
import {workspaceJobs} from '../src/workspace-jobs.js';
import {enqueueDataset,datasetJobs} from '../src/dataset-jobs.js';
import {AppError} from '../src/errors.js';
import {clearVault} from '../src/encryption.js';
import {copyPlan,copyWorkspace,encryptedCopy} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
const mapping={format:'json',rowsPath:'/measurements',fields:[{name:'Counter',path:'/counter'},{name:'Senary',path:'/native'},{name:'Reading',path:'/reading'}]};
async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-dataset-jobs-')),book=sampleNotebook(),f=await encryptedFixture(directory,book);
 const materials=new ResearchMaterials(f.workspace),jobs=workspaceJobs(f.workspace);
 t.after(async()=>{await jobs.worker.stop();clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 return {...f,...jobs,materials,directory,recordId:book.entries[0].id};
}
async function upload(f,bytes){
 const s=await f.materials.startImport({recordId:f.recordId,name:'measurements.json',size:bytes.length});
 for(let i=0;i<bytes.length;i+=EVIDENCE_CHUNK)await f.materials.appendImport(s.id,i/EVIDENCE_CHUNK,[bytes.subarray(i,i+EVIDENCE_CHUNK)]);
 return f.materials.finishImport(s.id);
}
async function perform(f,id){
 const job=await f.queue.claim();assert.equal(job.id,id);
 const prepared=await f.queue.definition(job).prepare(job,{});
 return f.queue.complete(job.id,job.lease.token,prepared);
}
test('large JSON evidence becomes exact, bounded pages through a durable job and survives portable restore',async t=>{
 const f=await fixture(t);
 // 4,344 measurements, over 16 MiB, without materializing diagnostics in rows.
 const bytes=Buffer.from('{"measurements":['+Array.from({length:4344},(_,i)=>'{"counter":18446744073709551615,"native":"105","reading":'+(i===4343?'null':i)+',"diagnostic":"'+ 'x'.repeat(4096)+'"}').join(',')+']}');
 assert.ok(bytes.length>16*1024*1024);
 const artifact=await upload(f,bytes),command={recordId:f.recordId,title:'Exact measurements',artifact,sourceMapping:mapping};
 const preview=await f.materials.previewDataset(command);assert.equal(preview.rows.length,5);assert.equal(preview.rows[0].cells[0],'18446744073709551615');assert.deepEqual(await Array.fromAsync(f.materials.names('tables')),[]);
 const id=randomUUID(),queued=await enqueueDataset(f.materials,f.queue,command,id);
 assert.deepEqual(await enqueueDataset(f.materials,f.queue,command,id),queued);
 const read=f.workspace.read;f.workspace.read=()=>{throw Error('Dataset operation assembled every record');};
 let completed;try{completed=await perform(f,id);}finally{f.workspace.read=read;}
 assert.equal(completed.state,'completed');
 const retained=await f.materials.read(completed.result);assert.equal(retained.content.rowCount,4344);assert.equal(retained.content.pageIndex.count,Math.ceil(4344/DATASET_ROWS_PER_PAGE));const {fields,...sourceMapping}=mapping;assert.deepEqual(retained.content.sourceMapping,{...sourceMapping,fieldsInSchema:true});assert.deepEqual((await f.materials.datasetColumns(retained)).map(column=>column.sourceField),fields);
 let count=0;for await(const row of f.materials.iterateDataset(completed.result)){assert.equal(row.cells[0],'18446744073709551615');assert.equal(row.cells[1],'105');assert.ok(!JSON.stringify(row).includes('diagnostic'));count++;}
 await assert.rejects(f.materials.datasetRows(completed.result,{maxBytes:128}),{code:'MATERIAL_PLOT_LIMIT'});
 assert.equal((await f.materials.current(completed.result.id)).revision,completed.result.revision);
 assert.equal(count,4344);const last=await f.materials.datasetPage(completed.result,retained.content.pageIndex.count-1);assert.equal(last.rows.at(-1).valueKinds[2],'null');
 assert.equal((await datasetJobs(f.materials,f.queue,f.recordId)).items[0].id,id);
 assert.equal((await enqueueDataset(f.materials,f.queue,command,id)).result.revision,completed.result.revision);
 const copy=await copyWorkspace(await copyPlan(f.workspace.root,path.join(f.directory,'restored')),{vault:f.vault});
 const restored=new ResearchMaterials(new Workspace(copy,f.vault));assert.equal((await restored.datasetPage(completed.result,0)).rows[0].cells[0],'18446744073709551615');
 const original=await restored.artifact(artifact),hash=createHash('sha256');for await(const chunk of original.content.read())hash.update(chunk);
 assert.equal(hash.digest('hex'),createHash('sha256').update(bytes).digest('hex'));assert.equal((await restored.verify()).originalBytes,bytes.length);
});
test('interrupted preparation reuses verified pages; a stale worker cannot attach a dataset',async t=>{
 const f=await fixture(t),bytes=Buffer.from('{"measurements":['+Array.from({length:900},(_,i)=>'{"counter":'+i+',"native":"15","reading":1}').join(',')+']}'),artifact=await upload(f,bytes);
 const command={recordId:f.recordId,title:'Retryable dataset',artifact,sourceMapping:mapping},id=randomUUID();await enqueueDataset(f.materials,f.queue,command,id);
 const first=await f.queue.claim();let pages=0;const put=f.materials.put;f.materials.put=async function(file,value){await put.call(this,file,value);if(path.basename(path.dirname(file))==='tables')pages++;};
 await assert.rejects(f.materials.prepareDataset(first.input.command,{writePage:fn=>f.queue.transaction(async()=>{
  await f.queue.held(first.id,first.lease.token);await fn();if(pages>=2)throw new AppError('STORAGE_FULL');
 })}),{code:'STORAGE_FULL'});f.materials.put=put;
 await f.queue.release(first.id,first.lease.token,{error:new AppError('STORAGE_FULL')});
 assert.equal((await f.materials.heads()).filter(h=>h.kind==='dataset').length,0);
 assert.equal((await Array.fromAsync(f.materials.names('tables'))).length,1);
 await f.queue.control(id,'retry');const claim=await f.queue.claim(),prepared=await f.queue.definition(claim).prepare(claim,{});
 await assert.rejects(f.queue.complete(id,first.lease.token,prepared),{code:'JOB_LEASE'});
 const done=await f.queue.complete(id,claim.lease.token,prepared);
 assert.equal((await Array.fromAsync(f.materials.names('tables'))).length,Math.ceil(900/DATASET_ROWS_PER_PAGE));assert.equal((await f.materials.read(done.result)).content.rowCount,900);
 assert.equal((await f.materials.heads()).filter(h=>h.kind==='dataset').length,1);
});
test('schema edits reuse retained values and preserve exclusions on other pages and earlier revisions',async t=>{
 const f=await fixture(t),artifact=await upload(f,Buffer.from('{"measurements":['+Array.from({length:600},(_,i)=>'{"counter":18446744073709551615,"native":"15","reading":'+i+'}').join(',')+']}'));
 const original=await f.materials.dataset({recordId:f.recordId,title:'Values',artifact,sourceMapping:mapping,exclusions:{[artifact.id+':300']:'Not acquired reliably'}});
 const doc=await f.materials.read(original),columns=await f.materials.datasetColumns(doc);columns[0].representation='integer';columns[1].representation='radix';columns[1].radix=6;
 const method=f.materials.artifact;f.materials.artifact=()=>{throw Error('Unchanged original was reparsed');};
 let next;try{next=await f.materials.dataset({recordId:f.recordId,title:'Values',artifact,id:original.id,expectedRevision:original.revision,baseDataset:original,columns,exclusions:{[artifact.id+':1']:'Partial acquisition'}});}finally{f.materials.artifact=method;}
 assert.equal((await f.materials.datasetPage(next,Math.floor(299/DATASET_ROWS_PER_PAGE))).rows[299%DATASET_ROWS_PER_PAGE].excluded,'Not acquired reliably');
 assert.equal((await f.materials.datasetPage(next,0)).rows[0].excluded,'Partial acquisition');
 assert.equal((await f.materials.datasetPage(original,0)).rows[0].excluded,null);
 assert.equal((await f.materials.read(next)).previous,original.revision);
 const malformed=await upload(f,Buffer.from('{"measurements":[{"counter":1}]} trailing'));
 await assert.rejects(f.materials.dataset({recordId:f.recordId,title:'Invalid replacement',artifact:malformed,sourceMapping:mapping,id:next.id,expectedRevision:next.revision}),{code:'MATERIAL_TABLE'});
 assert.equal((await f.materials.current(next.id)).revision,next.revision);
});

test('dataset jobs commit their head and completion together, and cancellation can be retried',async t=>{
 const f=await fixture(t),artifact=await upload(f,Buffer.from('{"measurements":[{"counter":42,"native":"15","reading":1}]}')),command={recordId:f.recordId,title:'Atomic dataset',artifact,sourceMapping:mapping};
 const id=randomUUID();await enqueueDataset(f.materials,f.queue,command,id);
 const first=await f.queue.claim(),prepared=await f.queue.definition(first).prepare(first,{}),definition=f.queue.definitions['dataset.prepare'],commit=definition.commit;
 definition.commit=async(...args)=>{await commit(...args);throw new AppError('STORAGE_FULL');};
 await assert.rejects(f.queue.complete(id,first.lease.token,prepared),{code:'STORAGE_FULL'});
 assert.equal(await f.materials.current(id),null);assert.equal((await f.queue.read(id)).state,'running');
 definition.commit=commit;await f.queue.control(id,'cancel');
 await assert.rejects(f.queue.complete(id,first.lease.token,prepared),{code:'JOB_CANCELLED'});
 await f.queue.release(id,first.lease.token);
 assert.equal((await f.queue.read(id)).state,'cancelled');
 await f.queue.control(id,'retry');const done=await perform(f,id);
 assert.equal(done.state,'completed');assert.equal((await f.materials.current(id)).revision,done.result.revision);
});

test('wide schemas page independently, edits span pages, and unchanged retained rows stay shared',async t=>{
 const f=await fixture(t),names=Array.from({length:36},(_,i)=>'Field '+i),bytes=Buffer.from(names.join(',')+'\n'+Array.from({length:600},()=>names.map((_,i)=>i===0?'18446744073709551615':i===32?'105':String(i)).join(',')).join('\n'));
 const artifact=await upload(f,bytes),original=await f.materials.dataset({recordId:f.recordId,title:'Wide readings',artifact}),doc=await f.materials.read(original);
 assert.equal(doc.content.columns,undefined);assert.equal(doc.content.pages,undefined);
 assert.equal(doc.content.schemaIndex.count,36);assert.equal(doc.content.pageIndex.count,Math.ceil(600/DATASET_ROWS_PER_PAGE));
 const reads=[],read=f.workspace.readMetadata;f.workspace.readMetadata=function(key,...args){reads.push(key);return read.call(this,key,...args);};
 let last;try{last=await f.materials.schemaPage(original,{offset:32});}finally{f.workspace.readMetadata=read;}
 assert.equal(last.items.length,4);assert.equal(reads.filter(p=>p.includes('/sequences/chunks/')).length,1);
 const table=await f.materials.datasetPage(original,doc.content.pageIndex.count-1,{columnOffset:32});
 assert.equal(table.columns.length,4);assert.equal(table.rows.length,600%DATASET_ROWS_PER_PAGE);assert.equal(table.rows[0].cells[0],'105');
 const first=(await f.materials.schemaPage(original)).items[0],changes=[{index:0,column:{...first,representation:'integer'}},{index:32,column:{...last.items[0],representation:'radix',radix:6}}];
 const command={recordId:f.recordId,title:doc.title,id:original.id,expectedRevision:original.revision,baseDataset:original,artifact,columnChanges:changes};
 const next=await f.materials.dataset(command),nextDoc=await f.materials.read(next);
 assert.deepEqual(nextDoc.content.pageIndex,doc.content.pageIndex);
 assert.equal((await f.materials.schemaPage(next,{offset:32})).items[0].radix,6);
 assert.equal((await f.materials.schemaPage(original,{offset:32})).items[0].representation,'text');
 assert.equal((await f.materials.datasetPage(next)).rows[0].cells[0],'18446744073709551615');
 await assert.rejects(f.materials.validateDataset({...command,expectedRevision:next.revision,baseDataset:next,columnChanges:[changes[0],changes[0]]}),{code:'MATERIAL_INVALID'});
 await assert.rejects(f.materials.dataset({...command,expectedRevision:next.revision,baseDataset:next,columnChanges:[{index:36,column:first}]}),{code:'MATERIAL_INVALID'});
 assert.equal((await f.materials.current(next.id)).revision,next.revision);
 const copy=await copyWorkspace(await copyPlan(f.workspace.root,path.join(f.directory,'wide-copy')),{vault:f.vault}),restored=new ResearchMaterials(new Workspace(copy,f.vault));
 assert.deepEqual(await restored.schemaPage(next,{offset:32}),await f.materials.schemaPage(next,{offset:32}));
 assert.deepEqual((await restored.datasetPage(original,2)).rows,(await f.materials.datasetPage(original,2)).rows);
 await restored.verify();
 const access=await createAccess('','fresh dataset test key'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const rekeyed=await encryptedCopy(await copyPlan(f.workspace.root,path.join(f.directory,'rekeyed')),access,vault,f.vault),fresh=new ResearchMaterials(new Workspace(rekeyed,vault));
 assert.deepEqual(await fresh.schemaPage(next,{offset:32}),await f.materials.schemaPage(next,{offset:32}));
 assert.deepEqual((await fresh.datasetPage(original,2)).rows,(await f.materials.datasetPage(original,2)).rows);await fresh.verify();
});
