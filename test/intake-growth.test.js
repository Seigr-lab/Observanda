import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {ResearchMaterials,EVIDENCE_CHUNK} from '../src/research-materials.js';
import {EvidenceIntake} from '../src/evidence-intake.js';
import {clearVault} from '../src/encryption.js';
import {workspaceJobs} from '../src/workspace-jobs.js';
import {digest} from '../src/storage-format.js';
import {fileFingerprint} from '../src/web/evidence-fingerprint.js';
const bytesFor=index=>{const bytes=Buffer.alloc(EVIDENCE_CHUNK);bytes.writeUInt32LE(index);return bytes;};
const chunksFor=index=>index%246<22?2:1;
async function descriptor(index){
 const size=chunksFor(index)*EVIDENCE_CHUNK,sha256=digest(bytesFor(index));
 return {name:'capture-'+String(index).padStart(5,'0')+'.raw',size,fingerprint:await fileFingerprint(size,Array.from({length:chunksFor(index)},()=>({size:EVIDENCE_CHUNK,sha256})),digest)};
}
test('physical file-set intake qualifies declared 246-file/268 MiB and tenfold workloads',async t=>{
 t.diagnostic(JSON.stringify({platform:process.platform,node:process.version,cpu:os.cpus()[0].model,totalMemoryGiB:Math.round(os.totalmem()/1024**3)}));
 for(const count of [246,2460])await t.test(count+' distinct physical originals',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-intake-growth-')),f=await encryptedFixture(directory,sampleNotebook()),m=new ResearchMaterials(f.workspace),jobs=workspaceJobs(f.workspace),recordId=(await f.workspace.read()).book.entries[0].id;
  t.after(async()=>{await jobs.worker.stop();clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
  const total=count/246*268*EVIDENCE_CHUNK,start=performance.now();let peakHeap=0,commitMs=0,commitQueries=0,commitSqlMs=0;
  const sampler=setInterval(()=>{peakHeap=Math.max(peakHeap,process.memoryUsage().heapUsed);},25);sampler.unref();
  try{
   const batch=await m.intakes.start({recordId,title:'Synthetic field acquisitions',count,bytes:total});
   for(let offset=0;offset<count;offset+=64){
    const items=[];for(let i=offset;i<Math.min(count,offset+64);i++)items.push(await descriptor(i));
    await m.intakes.append({id:batch.id,offset,items});
   }
   const registered=performance.now();assert.ok(registered-start<120000,'manifest budget');
   for(let offset=0;offset<count;offset+=50){
    const page=await m.intakes.page({id:batch.id,offset,limit:50});
    for(const [n,file] of page.items.entries()){
     const i=offset+n,bytes=bytesFor(i);assert.equal(file.reused,false);
     for(let chunk=0;chunk<chunksFor(i);chunk++)await m.appendImport(file.id,chunk,[bytes]);
    }
   }
   const uploaded=performance.now();assert.ok(uploaded-registered<240000,'upload budget');
   assert.equal((await m.list({recordId})).items.length,0,'No partially attached originals');
   const commit=EvidenceIntake.prototype.commit;
   EvidenceIntake.prototype.commit=async function(...args){
    const before=performance.now();
    try{return await this.workspace.catalogue(async store=>{
     const run=store.db.run;
     store.db.run=async function(sql,...args){
      const start=performance.now();commitQueries++;
      try{return await run.call(this,sql,...args);}finally{commitSqlMs+=performance.now()-start;}
     };
     try{return await commit.apply(this,args);}finally{store.db.run=run;}
    });}finally{commitMs=performance.now()-before;}
   };
   try{await m.intakes.enqueue(batch.id,jobs.queue);jobs.worker.enabled=true;await jobs.worker.runOnce();jobs.worker.enabled=false;}
   finally{EvidenceIntake.prototype.commit=commit;}
   const job=await jobs.queue.read(batch.id),finished=performance.now();assert.equal(job.state,'completed',JSON.stringify(job));
   t.diagnostic(JSON.stringify({phase:'commit',count,commitMs:Math.round(commitMs),commitQueries,commitSqlMs:Math.round(commitSqlMs)}));
   assert.ok(finished-uploaded<240000,'verification and attachment budget');
   assert.ok(commitMs<30000,'complete-set metadata transaction budget: '+Math.round(commitMs));
   const doc=await m.read(job.result);assert.equal(doc.content.inputsIndex.count,count);assert.ok(JSON.stringify(doc).length<2500);
   let ordinal=0,retainedBytes=0;
   await m.readSnapshot(async()=>{for await(const ref of m.references(doc.content)){
    const item=await m.read(ref),bytes=bytesFor(ordinal),hash=createHash('sha256');for(let j=0;j<chunksFor(ordinal);j++)hash.update(bytes);
    assert.equal(item.content.sha256,hash.digest('hex'));assert.equal(item.content.name,(await descriptor(ordinal)).name);
    assert.equal(item.content.size,chunksFor(ordinal)*EVIDENCE_CHUNK);retainedBytes+=item.content.size;ordinal++;
   }});
   assert.equal(ordinal,count);assert.equal(retainedBytes,total);assert.ok(peakHeap<256*1024*1024);
   t.diagnostic(JSON.stringify({count,totalBytes:total,manifestMs:Math.round(registered-start),uploadMs:Math.round(uploaded-registered),verifyAttachMs:Math.round(finished-uploaded),commitMs:Math.round(commitMs),commitQueries,commitSqlMs:Math.round(commitSqlMs),sampledHeapMiB:Math.round(peakHeap/1024**2)}));
  }finally{clearInterval(sampler);}
 });
});
