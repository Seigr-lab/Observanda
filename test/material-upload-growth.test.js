import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {Workspace} from '../src/storage.js';
import {clearVault} from '../src/encryption.js';
import {ResearchMaterials,EVIDENCE_CHUNK} from '../src/research-materials.js';
test('declared 96 MiB capture and tenfold upload resume with bounded checkpoints and exact originals',async t=>{
 t.diagnostic(JSON.stringify({platform:process.platform,arch:process.arch,cpu:os.cpus()[0].model,node:process.version,totalMemoryGiB:Math.round(os.totalmem()/1024**3)}));
 for(const chunks of [96,960]){
  const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-upload-growth-')),f=await encryptedFixture(directory,sampleNotebook());
  t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
  let m=new ResearchMaterials(f.workspace);
  const recordId=(await f.workspace.read()).book.entries[0].id,session=await m.startImport({recordId,name:'synthetic-capture.bin',size:chunks*EVIDENCE_CHUNK});
  const buffer=Buffer.alloc(EVIDENCE_CHUNK),hash=createHash('sha256'),start=performance.now();let peakHeap=0,peakCheckpoint=0,peakResponse=0;
  for(let i=0;i<chunks;i++){
   buffer.fill(i%251);hash.update(buffer);
   const current=await m.appendImport(session.id,i,[buffer]),summary=await m.uploads.summary(current);
   peakCheckpoint=Math.max(peakCheckpoint,Buffer.byteLength(JSON.stringify(current)));peakResponse=Math.max(peakResponse,Buffer.byteLength(JSON.stringify(summary)));
   peakHeap=Math.max(peakHeap,process.memoryUsage().heapUsed);
   assert.equal(summary.receivedChunks,i+1);assert.equal(summary.receivedBytes,(i+1)*EVIDENCE_CHUNK);
   if(i===Math.floor(chunks/2)){
    m=new ResearchMaterials(new Workspace(f.workspace.root,f.vault));
    assert.equal(m.uploads.count(await m.importState(session.id)),i+1);
    await assert.rejects(m.appendImport(session.id,i,[buffer]),{code:'MATERIAL_CHANGED'});
   }
  }
  const uploadMs=performance.now()-start,verifyStart=performance.now(),ref=await m.finishImport(session.id),artifact=await m.artifact(ref);
  assert.equal(artifact.doc.content.sha256,hash.digest('hex'));assert.equal(artifact.content.size,chunks*EVIDENCE_CHUNK);
  await artifact.content.verify();const verifyMs=performance.now()-verifyStart;
  assert.ok(peakCheckpoint<2048);assert.ok(peakResponse<1024);assert.ok(peakHeap<256*1024*1024,'sampled JS heap stays within 256 MiB');
  assert.ok(uploadMs<360000,'upload within six minutes');assert.ok(verifyMs<180000,'verify within three minutes');
  t.diagnostic(JSON.stringify({bytes:chunks*EVIDENCE_CHUNK,uploadMs:Math.round(uploadMs),verifyMs:Math.round(verifyMs),peakCheckpoint,peakResponse,sampledHeapMiB:Math.round(peakHeap/1024**2)}));
 }
});
