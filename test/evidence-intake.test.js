import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {ResearchMaterials,EVIDENCE_CHUNK} from '../src/research-materials.js';
import {clearVault} from '../src/encryption.js';
import {Workspace,digest} from '../src/storage.js';
import {workspaceJobs} from '../src/workspace-jobs.js';
import {fileFingerprint} from '../src/web/evidence-fingerprint.js';
import {copyPlan,copyWorkspace,encryptedCopy} from '../src/locations.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {contentBuffer} from '../src/file-content.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {buildPublication,verifyPublication} from '../src/publication.js';
import {associateOriginal} from '../src/evidence-associations.js';
async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-intake-')),f=await encryptedFixture(directory,sampleNotebook()),m=new ResearchMaterials(f.workspace),jobs=workspaceJobs(f.workspace),book=(await f.workspace.read()).book;
 t.after(async()=>{await jobs.worker.stop();clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 return {...f,...jobs,m,directory,recordId:book.entries[0].id,otherId:book.entries[1].id};
}
async function descriptor(name,bytes){
 const chunks=[];for(let at=0;at<bytes.length;at+=EVIDENCE_CHUNK){const c=bytes.subarray(at,at+EVIDENCE_CHUNK);chunks.push({size:c.length,sha256:digest(c)});}
 return {name,size:bytes.length,fingerprint:await fileFingerprint(bytes.length,chunks,digest)};
}
async function start(f,files,recordId=f.recordId){
 const command={id:randomUUID(),recordId,title:'Private field acquisitions',provenance:'Private path E:\\private\\captures',count:files.length,bytes:files.reduce((n,f)=>n+f.size,0)};
 const batch=await f.m.intakes.start(command);return {batch,command};
}
async function upload(f,id,bytes,from=0){
 for(let i=from;i<Math.ceil(bytes.length/EVIDENCE_CHUNK);i++)await f.m.appendImport(id,i,[bytes.subarray(i*EVIDENCE_CHUNK,(i+1)*EVIDENCE_CHUNK)]);
}
async function finish(f,id){
 await f.m.intakes.enqueue(id,f.queue);f.worker.start();
 try{const until=Date.now()+90000;while(Date.now()<until){const job=await f.queue.read(id);if(['completed','failed','cancelled'].includes(job.state)){assert.equal(job.state,'completed',JSON.stringify(job));return job;}await delay(50);}assert.fail('Timed out waiting for file set');}
 finally{await f.worker.stop();}
}

test('folder intake preserves distinct source paths through byte reuse, replay, association and encrypted recovery',async t=>{
 const f=await fixture(t),bytes=Buffer.from('Shared source bytes'),file=await descriptor('analysis.json',bytes);
 const files=['evidence/preparation/analysis.json','evidence/current/analysis.json','evidence/history/analysis.json'].map(sourcePath=>({...file,sourcePath}));
 const batch=await f.m.intakes.start({recordId:f.recordId,title:'Returned tree',count:3,bytes:3*bytes.length,sourceMode:'folder',purpose:'current-return'});
 const command={id:batch.id,offset:0,items:files};await f.m.intakes.append(command);await f.m.intakes.append(command);
 await assert.rejects(f.m.intakes.append({...command,items:[{...files[0],sourcePath:'elsewhere/analysis.json'},...files.slice(1)]}),{code:'MATERIAL_CHANGED'});
 const page=await f.m.intakes.page({id:batch.id});assert.deepEqual(page.items.map(f=>f.sourcePath),files.map(f=>f.sourcePath));
 await upload(f,page.items[0].id,bytes);const result=await finish(f,batch.id),refs=(await f.m.referencePage(result.result)).items;
 assert.equal(new Set(refs.map(r=>r.id)).size,3);
 for(let i=0;i<refs.length;i++){
  const {doc,content}=await f.m.artifact(refs[i]);assert.equal(doc.content.sourcePath,files[i].sourcePath);assert.equal(doc.content.sourcePurpose,'current-return');assert.deepEqual(await contentBuffer(content),bytes);
 }
 const shared=await associateOriginal(f.m,{recordId:f.otherId,ref:refs[1]});assert.equal((await f.m.read(shared)).content.sourcePath,files[1].sourcePath);
 const restoredRoot=await copyWorkspace(await copyPlan(f.workspace.root,path.join(f.directory,'folder-copy')),{vault:f.vault}),restored=new ResearchMaterials(new Workspace(restoredRoot,f.vault));
 await restored.verify();assert.equal((await restored.read(shared)).content.sourcePurpose,'current-return');
 const book=(await f.workspace.read()).book;book.entries.forEach(r=>{r.attachments=[];r.share=true;});const release=buildPublication(book);verifyPublication(release);
 for(const file of files)assert.ok(!JSON.stringify([...release.files]).includes(file.sourcePath));
 const next=await f.m.intakes.start({recordId:f.recordId,title:'Historical inputs',count:2,bytes:2*bytes.length,sourceMode:'folder',purpose:'historical-input'});
 for(const sourcePath of ['/analysis.json','../analysis.json','C:/analysis.json','tree//analysis.json','tree/../analysis.json','tree/other.json']){
  await assert.rejects(f.m.intakes.append({id:next.id,offset:0,items:[{...file,sourcePath}]}),{code:'MATERIAL_INVALID'});
 }
 await assert.rejects(f.m.intakes.append({id:next.id,offset:0,items:[file]}),{code:'MATERIAL_INVALID'});
 await assert.rejects(f.m.intakes.append({id:next.id,offset:0,items:[files[0],files[0]]}),{code:'MATERIAL_CHANGED'});
 assert.equal((await f.m.intakes.page({id:next.id})).batch.registered,0);
});

test('file-set transfers and attachment validate ownership without reloading the acquisition record',async t=>{
 const f=await fixture(t),bytes=Buffer.from('An exact original'),files=[await descriptor('capture.txt',bytes)],{batch}=await start(f,files);
 const read=ResearchCatalogue.prototype.record;let result;
 ResearchCatalogue.prototype.record=()=>{throw Error('Acquisition body reloaded after it was pinned');};
 try{
  await f.m.intakes.append({id:batch.id,offset:0,items:files});
  const file=(await f.m.intakes.page({id:batch.id})).items[0];
  await upload(f,file.id,bytes);result=await finish(f,batch.id);
 }finally{ResearchCatalogue.prototype.record=read;}
 const members=(await f.m.referencePage(result.result)).items;
 assert.deepEqual(await contentBuffer((await f.m.artifact(members[0])).content),bytes);
});
test('64 MiB originals, distinct identical acquisitions, empty files and same-record reuse survive restore',async t=>{
 const f=await fixture(t),bytes=Buffer.alloc(64*EVIDENCE_CHUNK,0xa3),files=[await descriptor('capture.bin',bytes),await descriptor('second-acquisition.bin',bytes),await descriptor('empty.txt',Buffer.alloc(0))],{batch,command}=await start(f,files);
 assert.deepEqual(await f.m.intakes.start(command),batch);
 await f.m.intakes.append({id:batch.id,offset:0,items:files});
 const page=await f.m.intakes.page({id:batch.id});assert.equal(page.items[1].reused,true);
 await upload(f,page.items[0].id,bytes);
 assert.equal((await f.m.overview(f.recordId)).imports.length,0);assert.equal((await f.m.overview(f.recordId)).items.length,0);
 const result=await finish(f,batch.id);assert.equal(result.state,'completed');
 assert.deepEqual((await f.m.intakes.enqueue(batch.id,f.queue)).result,result.result);
 const members=(await f.m.referencePage(result.result)).items;assert.equal(members.length,3);assert.notEqual(members[0].id,members[1].id);
 const a=await f.m.artifact(members[0]),b=await f.m.artifact(members[1]);assert.equal(a.content.sha256,digest(bytes));assert.equal(b.content.sha256,a.content.sha256);assert.equal(b.doc.content.originalId,a.doc.id);assert.notEqual(a.doc.content.name,b.doc.content.name);
 assert.deepEqual(await contentBuffer(a.content),bytes);assert.deepEqual(await readdir(await f.m.directory('originals/'+b.doc.id)),[]);
 const disk=await readFile(path.join(await f.m.directory('originals/'+a.doc.id),a.doc.content.storageId+'.original'));assert.ok(!disk.subarray(0,1024).equals(bytes.subarray(0,1024)));
 assert.equal((await f.m.intakes.list(f.recordId)).items.length,0);
 const publicBook=(await f.workspace.read()).book;publicBook.entries.forEach(r=>{r.attachments=[];});publicBook.entries.find(r=>r.id===f.recordId).share=true;
 const release=buildPublication(publicBook,{blockedValues:['E:\\private\\']});verifyPublication(release);
 const output=JSON.stringify([...release.files]);for(const value of ['capture.bin','second-acquisition.bin','Private field acquisitions',command.provenance,a.content.sha256])assert.ok(!output.includes(value));
 const next=await start(f,[files[0]]);await f.m.intakes.append({id:next.batch.id,offset:0,items:[files[0]]});
 assert.equal((await f.m.intakes.page({id:next.batch.id})).items[0].reused,true);await finish(f,next.batch.id);
 const other=await start(f,[files[0]],f.otherId);await f.m.intakes.append({id:other.batch.id,offset:0,items:[files[0]]});
 assert.equal((await f.m.intakes.page({id:other.batch.id})).items[0].reused,false);
 const copy=await copyWorkspace(await copyPlan(f.workspace.root,path.join(f.directory,'copy')),{vault:f.vault}),restored=new ResearchMaterials(new Workspace(copy,f.vault));await restored.verify();
 assert.equal((await restored.artifact(members[1])).content.sha256,digest(bytes));
 const access=await createAccess('','fresh evidence file set password'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const fresh=await encryptedCopy(await copyPlan(f.workspace.root,path.join(f.directory,'fresh')),access,vault,f.vault),rekeyed=new ResearchMaterials(new Workspace(fresh,vault));
 await rekeyed.verify();assert.deepEqual(await contentBuffer((await rekeyed.artifact(members[1])).content),bytes);
});
test('paged manifests replay exactly, reject changed sources and resume interrupted uploads after backup',async t=>{
 const f=await fixture(t),bytes=Buffer.alloc(2*EVIDENCE_CHUNK+7,0x41),file=await descriptor('measurement.dat',bytes),files=Array.from({length:130},(_,i)=>({...file,name:'measurement-'+i+'.dat'})),{batch,command}=await start(f,files);
 const first={id:batch.id,offset:0,items:files.slice(0,64)};
 const saved=await f.m.intakes.append(first);assert.deepEqual(await f.m.intakes.append(first),saved);
 await assert.rejects(f.m.intakes.append({...first,items:[{...file,name:'changed'}]}),{code:'MATERIAL_CHANGED'});
 await assert.rejects(f.m.intakes.start({...command,title:'Changed intent'}),{code:'MATERIAL_CHANGED'});
 for(const name of ['../capture','C:\\private\\capture','../','..','capture/path','capture\u0000']){
  await assert.rejects(f.m.intakes.append({id:batch.id,offset:64,items:[{...file,name}]}),{code:'MATERIAL_INVALID'});
 }
 const firstId=(await f.m.intakes.page({id:batch.id})).items[0].id;
 await f.m.appendImport(firstId,0,[bytes.subarray(0,EVIDENCE_CHUNK)]);
 await assert.rejects(f.m.intakes.enqueue(batch.id,f.queue),{code:'MATERIAL_INCOMPLETE'});
 const copy=await copyWorkspace(await copyPlan(f.workspace.root,path.join(f.directory,'resume')),{vault:f.vault}),ws=new Workspace(copy,f.vault),m=new ResearchMaterials(ws),jobs=workspaceJobs(ws);t.after(()=>jobs.worker.stop());
 const g={...f,workspace:ws,m,...jobs};await m.intakes.append({id:batch.id,offset:64,items:files.slice(64,128)});await m.intakes.append({id:batch.id,offset:128,items:files.slice(128)});
 assert.equal((await m.intakes.page({id:batch.id,offset:120})).items.length,10);
 await m.appendImport(firstId,1,[bytes.subarray(EVIDENCE_CHUNK,2*EVIDENCE_CHUNK)]);
 await assert.rejects(m.appendImport(firstId,2,[Buffer.alloc(7,0x42)]),{code:'MATERIAL_SOURCE_CHANGED'});
 assert.equal(m.uploads.count(await m.importState(firstId)),2);await m.appendImport(firstId,2,[bytes.subarray(2*EVIDENCE_CHUNK)]);
 const done=await finish(g,batch.id);assert.equal(done.state,'completed');
 const result=await m.read(done.result);assert.equal(result.content.inputsIndex.count,130);assert.ok(JSON.stringify(result).length<2500);
 assert.equal((await m.intakes.page({id:batch.id,offset:120})).items.length,10);await m.verify();
});
test('worker cancellation, expired leases and failed attachment retain originals and never attach a partial set',async t=>{
 const f=await fixture(t),files=[await descriptor('one.txt',Buffer.from('one')),await descriptor('two.txt',Buffer.from('two'))],{batch}=await start(f,files);
 await f.m.intakes.append({id:batch.id,offset:0,items:files});const items=(await f.m.intakes.page({id:batch.id})).items;
 await upload(f,items[0].id,Buffer.from('one'));await upload(f,items[1].id,Buffer.from('two'));
 await f.m.intakes.enqueue(batch.id,f.queue);const stale=await f.queue.claim(),controller=new AbortController();
 await assert.rejects(f.queue.definition(stale).prepare(stale,{signal:controller.signal,progress:async p=>{if(p.stage==='Verified files'){controller.abort();}}}),{name:'AbortError'});
 assert.equal((await f.m.overview(f.recordId)).items.length,0);
 await f.workspace.withLock(async()=>{const job=await f.queue.read(batch.id);job.lease.until=0;await f.queue.write(job);});
 const active=await f.queue.claim(),prepared=await f.queue.definition(active).prepare(active,{});
 await assert.rejects(f.queue.complete(stale.id,stale.lease.token,prepared),{code:'JOB_LEASE'});
 const write=f.workspace.writeMetadata.bind(f.workspace);let injected=false;
 f.workspace.writeMetadata=async(file,value)=>{if(!injected&&file.endsWith('/'+batch.id+'/batch.json')&&JSON.parse(value).state==='completed'){injected=true;throw Error('Simulated commit interruption');}return write(file,value);};
 await assert.rejects(f.queue.complete(active.id,active.lease.token,prepared),/Simulated commit interruption/);f.workspace.writeMetadata=write;
 assert.equal((await f.m.overview(f.recordId)).items.length,0);assert.equal((await f.m.importState(items[0].id)).completed,null);await f.m.verify();
 const done=await f.queue.complete(active.id,active.lease.token,prepared);assert.equal(done.state,'completed');assert.equal((await f.m.overview(f.recordId)).items.length,3);
 for(const item of items)assert.ok((await f.m.importState(item.id)).completed);
});

test('failed checkpoint groups retain earlier receipts and resume without orphaned originals or partial attachment',async t=>{
 const f=await fixture(t),files=[];
 for(let i=0;i<66;i++)files.push(await descriptor('take-'+i+'.txt',Buffer.from('Original '+i)));
 const {batch}=await start(f,files);
 for(let offset=0;offset<files.length;offset+=64)await f.m.intakes.append({id:batch.id,offset,items:files.slice(offset,offset+64)});
 const items=[...(await f.m.intakes.page({id:batch.id,limit:50})).items,...(await f.m.intakes.page({id:batch.id,offset:50})).items];
 for(let i=0;i<items.length;i++)await upload(f,items[i].id,Buffer.from('Original '+i));
 await f.m.intakes.enqueue(batch.id,f.queue);const first=await f.queue.claim(),put=f.workspace.writeMetadata.bind(f.workspace);let receipts=0;
 f.workspace.writeMetadata=async(file,value)=>{
  if(file.includes('/'+batch.id+'/prepared/')&&++receipts===45)throw Object.assign(Error('Synthetic disk full'),{code:'ENOSPC'});
  return put(file,value);
 };
 try{await assert.rejects(f.queue.definition(first).prepare(first,{}),{code:'ENOSPC'});}
 finally{f.workspace.writeMetadata=put;}
 const receipt=id=>f.m.intakes.json(f.m.intakes.file(batch.id,'prepared/'+id+'.json'));
 const saved=await f.m.readSnapshot(async()=>{
  const saved=[];for(let i=0;i<items.length;i++){
   const value=await receipt(items[i].id);
   if(i<32){assert.equal(value.storageId,first.lease.token);saved.push(value);}else assert.equal(value,null);
   assert.equal((await f.m.importState(items[i].id)).completed,null);
  }return saved;
 });
 assert.equal((await f.m.list({recordId:f.recordId})).items.length,0);
 await f.workspace.withLock(async()=>{const job=await f.queue.read(batch.id);job.lease.until=0;await f.queue.write(job);});
 const resumed=await f.queue.claim(),prepared=await f.queue.definition(resumed).prepare(resumed,{});
 await assert.rejects(f.queue.complete(first.id,first.lease.token,prepared),{code:'JOB_LEASE'});
 const completed=await f.queue.complete(resumed.id,resumed.lease.token,prepared);
 await f.m.readSnapshot(async()=>{
  for(let i=0;i<items.length;i++){
   const value=await receipt(items[i].id);
   if(i<32)assert.deepEqual(value,saved[i]);else assert.equal(value.storageId,resumed.lease.token);
   assert.deepEqual(await readdir(await f.m.directory('originals/'+items[i].id)),[value.storageId+'.original']);
   const original=await f.m.artifact((await f.m.importState(items[i].id)).completed);
   assert.deepEqual(await contentBuffer(original.content),Buffer.from('Original '+i));
  }
 });
 assert.equal((await f.m.read(completed.result)).content.inputsIndex.count,66);await f.m.verify();
});

test('cancel/retry and fresh-key recovery retain staged originals; altered manifest receipts fail verification',async t=>{
 const f=await fixture(t),bytes=Buffer.from('Creative field recording'),files=[await descriptor('take-one.bin',bytes),await descriptor('take-two.bin',bytes)],{batch}=await start(f,files);
 await f.m.intakes.append({id:batch.id,offset:0,items:files});const first=(await f.m.intakes.page({id:batch.id})).items[0];
 await upload(f,first.id,bytes);await f.m.intakes.enqueue(batch.id,f.queue);
 assert.equal((await f.queue.control(batch.id,'cancel')).state,'cancelled');assert.equal((await f.m.overview(f.recordId)).items.length,0);
 await f.queue.control(batch.id,'retry');const job=await f.queue.claim(),controller=new AbortController();
 await assert.rejects(f.queue.definition(job).prepare(job,{signal:controller.signal,progress:async p=>{if(p.stage==='Verified files')controller.abort();}}),{name:'AbortError'});
 await f.queue.release(job.id,job.lease.token,{paused:true});await f.m.verify();
 const access=await createAccess('','restored staged evidence key'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const fresh=await encryptedCopy(await copyPlan(f.workspace.root,path.join(f.directory,'resumed')),access,vault,f.vault),workspace=new Workspace(fresh,vault),m=new ResearchMaterials(workspace),jobs=workspaceJobs(workspace);t.after(()=>jobs.worker.stop());
 const g={...f,workspace,m,...jobs};const done=await finish(g,batch.id);const members=(await m.referencePage(done.result)).items;
 assert.equal(members.length,2);for(const member of members)assert.deepEqual(await contentBuffer((await m.artifact(member)).content),bytes);
 assert.equal((await m.intakes.list(f.recordId)).items.length,0);await m.verify();
 const receipt='.observanda/materials/intakes/'+batch.id+'/accepted/0.json';
 await workspace.withLock(async()=>{const value=JSON.parse(await workspace.readMetadata(receipt,1024));value.hash='0'.repeat(64);await workspace.writeMetadata(receipt,JSON.stringify(value));});
 await assert.rejects(m.intakes.append({id:batch.id,offset:0,items:files}),{code:'MATERIAL_CHANGED'});
 await assert.rejects(m.verify(),{code:'CATALOGUE_DAMAGED'});
 assert.deepEqual(await contentBuffer((await m.artifact(members[0])).content),bytes);
});
