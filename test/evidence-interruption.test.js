import {test} from 'node:test';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {Workspace,digest} from '../src/storage.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {workspaceJobs} from '../src/workspace-jobs.js';
import {fileFingerprint} from '../src/web/evidence-fingerprint.js';
import {initializeLocation,copyPlan,copyWorkspace} from '../src/locations.js';
import {sampleNotebook} from '../src/sample.js';
import {ResearchMaterials,EVIDENCE_CHUNK} from '../src/research-materials.js';
import {contentBuffer} from '../src/file-content.js';
import {interruptWorkspace} from './fixtures/interrupt-workspace.js';

test('a killed evidence upload can be backed up and resumed without copying unfinished bytes',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-evidence-crash-')),root=path.join(directory,'source');
 const access=await createAccess('','synthetic upload recovery'),vault=takeCreatedVault(access),book=sampleNotebook();
 t.after(async()=>{clearVault(vault);await rm(directory,{recursive:true,force:true});});
 await initializeLocation(root,book,access,vault);
 const workspace=new Workspace(root,vault),materials=new ResearchMaterials(workspace),original=Buffer.alloc(EVIDENCE_CHUNK+8192,0x5a);
 const session=await materials.startImport({recordId:book.entries[0].id,name:'returned-capture.bin',size:original.length});
 await materials.appendImport(session.id,0,[original.subarray(0,EVIDENCE_CHUNK)]);
 const before=await workspace.read();
 await interruptWorkspace(root,vault,'upload-stream',{upload:{id:session.id,index:1}});
 assert.ok((await readdir(path.join(root,'.observanda/materials/imports',session.id))).some(name=>name.startsWith('.stream-')));
 const reopened=new ResearchMaterials(new Workspace(root,vault));
 assert.equal(reopened.uploads.count(await reopened.importState(session.id)),1);
 await assert.rejects(reopened.finishImport(session.id),{code:'MATERIAL_INCOMPLETE'});
 const backup=await copyWorkspace(await copyPlan(root,path.join(directory,'backup')),{vault});
 assert.ok(!(await readdir(path.join(backup,'.observanda/materials/imports',session.id))).some(name=>name.startsWith('.stream-')));
 const restored=new ResearchMaterials(new Workspace(backup,vault));
 assert.equal(restored.uploads.count(await restored.importState(session.id)),1);
 await restored.appendImport(session.id,1,[original.subarray(EVIDENCE_CHUNK)]);
 const artifact=await restored.finishImport(session.id);
 assert.deepEqual(await contentBuffer((await restored.artifact(artifact)).content),original);
 assert.deepEqual(await restored.finishImport(session.id),artifact);
 assert.deepEqual(await workspace.read(),before);
 assert.equal(reopened.uploads.count(await reopened.importState(session.id)),1);
});


test('a killed intake worker and an exhausted checkpoint resume 161 MiB without reupload or duplicate originals',{timeout:180000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-intake-crash-')),book=sampleNotebook(),recordId=book.entries[0].id;
 const fixture=await encryptedFixture(directory,book),originals=new ResearchMaterials(fixture.workspace),initial=workspaceJobs(fixture.workspace);
 let resumed,running;
 t.after(async()=>{
  await initial.worker.stop();await resumed?.worker.stop();await running;clearVault(fixture.vault);
  assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-intake-crash-'));
  await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 });
 // One large capture and 65 different small files cross two durable receipt
 // groups. Generate one chunk at a time rather than retaining a 96 MiB buffer.
 const chunksFor=index=>index===0?96:1;
 const chunkFor=(index,chunk)=>{const bytes=Buffer.alloc(EVIDENCE_CHUNK,0x63);bytes.writeUInt32LE(index,0);bytes.writeUInt32LE(chunk,4);return bytes;};
 const files=[],hashes=[];
 for(let index=0;index<66;index++){
  const chunks=[],hash=createHash('sha256');
  for(let chunk=0;chunk<chunksFor(index);chunk++){const bytes=chunkFor(index,chunk);chunks.push({size:bytes.length,sha256:digest(bytes)});hash.update(bytes);}
  const size=chunksFor(index)*EVIDENCE_CHUNK;
  files.push({name:index===0?'large-capture.raw':'capture-'+index+'.raw',size,fingerprint:await fileFingerprint(size,chunks,digest)});hashes.push(hash.digest('hex'));
 }
 const batch=await originals.intakes.start({recordId,title:'Interrupted acquisition',count:files.length,bytes:161*EVIDENCE_CHUNK});
 for(let offset=0;offset<files.length;offset+=64)await originals.intakes.append({id:batch.id,offset,items:files.slice(offset,offset+64)});
 const items=[...(await originals.intakes.page({id:batch.id,limit:50})).items,...(await originals.intakes.page({id:batch.id,offset:50})).items];
 const uploadStarted=Date.now();
 for(let index=0;index<items.length;index++)for(let chunk=0;chunk<chunksFor(index);chunk++)await originals.appendImport(items[index].id,chunk,[chunkFor(index,chunk)]);
 const uploadMs=Date.now()-uploadStarted;await originals.intakes.enqueue(batch.id,initial.queue);
 const killedStarted=Date.now();
 await interruptWorkspace(fixture.workspace.root,fixture.vault,'evidence-intake-checkpoint',{intake:{id:batch.id,receiptAt:45}},{checkpointTimeoutMs:90000});
 const killedAttemptMs=Date.now()-killedStarted,workspace=new Workspace(fixture.workspace.root,fixture.vault),materials=new ResearchMaterials(workspace);
 resumed=workspaceJobs(workspace);const {queue,worker}=resumed,connections=[],open=workspace.openCatalogue.bind(workspace);
 const runWorker=async()=>{worker.enabled=true;running=workspace.withCatalogueConnections(()=>worker.runOnce());try{await running;}finally{running=null;await worker.stop();}};
 t.signal.addEventListener('abort',()=>worker.controller?.abort(t.signal.reason),{once:true});
 workspace.openCatalogue=async options=>{const db=await open(options),entry={closed:false},close=db.close.bind(db);connections.push(entry);db.close=async()=>{try{return await close();}finally{entry.closed=true;}};return db;};
 const receipt=id=>materials.intakes.json(materials.intakes.file(batch.id,'prepared/'+id+'.json'));
 const checkpoint=()=>materials.readSnapshot(async()=>{
  const saved=[];
  for(let index=0;index<items.length;index++){
   const value=await receipt(items[index].id);
   if(index<32){assert.ok(value);saved.push(value);}else assert.equal(value,null,'uncommitted receipt group must roll back');
   assert.equal((await materials.importState(items[index].id)).completed,null);
  }
  return saved;
 });
 const interrupted=await queue.read(batch.id);assert.equal(interrupted.state,'running');assert.equal(interrupted.attempt,1);
 assert.equal(await queue.claim(),null,'a second manager must honor the retained live lease');
 const saved=await checkpoint();assert.equal((await materials.list({recordId})).items.length,0);
 // Advance only this disposable job lease instead of waiting 30 seconds.
 await workspace.withLock(async()=>{const job=await queue.read(batch.id);job.lease.until=0;await queue.write(job);});
 const append=ResearchMaterials.prototype.appendImport;
 ResearchMaterials.prototype.appendImport=()=>{throw Error('Recovery must use retained chunks, not upload again');};
 try{
  const put=workspace.writeMetadata.bind(workspace);let writes=0,injected=false;
  workspace.writeMetadata=async(file,value)=>{
   if(file.includes('/'+batch.id+'/prepared/')&&++writes===13){injected=true;throw Object.assign(Error('Injected exhausted checkpoint'),{code:'ENOSPC'});}
   return put(file,value);
  };
  const exhaustedStarted=Date.now();
  try{await runWorker();}
  finally{workspace.writeMetadata=put;await worker.stop();}
  const exhaustedAttemptMs=Date.now()-exhaustedStarted,failed=await queue.read(batch.id);
  assert.equal(injected,true);assert.equal(failed.state,'failed');assert.equal(failed.attempt,2);
  assert.deepEqual(await checkpoint(),saved);assert.equal((await materials.list({recordId})).items.length,0);
  assert.ok(connections.every(entry=>entry.closed),'failed worker must close its operation connections');
  await queue.control(batch.id,'retry');
  const prepare=ResearchMaterials.prototype.prepareImport,preparedIds=[];
  ResearchMaterials.prototype.prepareImport=function(id,...args){preparedIds.push(id);return prepare.call(this,id,...args);};
  const resumedStarted=Date.now();
  try{await runWorker();}
  finally{ResearchMaterials.prototype.prepareImport=prepare;await worker.stop();}
  const resumedMs=Date.now()-resumedStarted,completed=await queue.read(batch.id);
  assert.equal(completed.state,'completed',JSON.stringify(completed));assert.equal(completed.attempt,3);
  assert.deepEqual(preparedIds,items.slice(32).map(item=>item.id),'checkpointed originals must not be reconstructed');
  assert.equal(worker.active,null);assert.equal(worker.controller,null);assert.equal(worker.running,null);assert.equal(worker.enabled,false);
  const manifest=await materials.read(completed.result),refs=[];
  for await(const ref of materials.references(manifest.content))refs.push(ref);
  assert.equal(refs.length,items.length);assert.equal(new Set(refs.map(ref=>ref.id)).size,items.length);
  const verifyStarted=Date.now();
  await materials.readSnapshot(async()=>{
   for(let index=0;index<items.length;index++){
    const item=items[index],retained=await receipt(item.id),session=await materials.importState(item.id);
    assert.equal(refs[index].id,item.id);assert.deepEqual(refs[index],session.completed);
    if(index<32)assert.deepEqual(retained,saved[index]);else assert.notEqual(retained.storageId,interrupted.lease.token);
    assert.deepEqual(await readdir(await materials.directory('originals/'+item.id)),[retained.storageId+'.original']);
    const {doc,content}=await materials.artifact(refs[index]);assert.equal(doc.content.name,files[index].name);assert.equal(content.size,files[index].size);assert.equal(content.sha256,hashes[index]);await content.verify();
   }
  });
  const verifyMs=Date.now()-verifyStarted;
  assert.deepEqual((await materials.intakes.enqueue(batch.id,queue)).result,completed.result,'retrying completed intake must keep its exact edition');
  assert.equal(await queue.claim(),null);assert.equal((await materials.intakes.list(recordId)).items.length,0);
  assert.ok(connections.every(entry=>entry.closed),'successful recovery must close all operation connections');
  t.diagnostic(JSON.stringify({files:files.length,largeCaptureMiB:96,totalMiB:161,durableReceipts:32,reconstructedAfterRetry:preparedIds.length,uploadMs,killedAttemptMs,exhaustedAttemptMs,resumedMs,verifyMs,connectionsOpened:connections.length,connectionsClosed:connections.filter(entry=>entry.closed).length,faults:['killed worker process','injected ENOSPC at checkpoint']}));
 }finally{ResearchMaterials.prototype.appendImport=append;}
});
