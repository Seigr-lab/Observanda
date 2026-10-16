// Synthetic physical evidence at the declared adoption sizes. The fixture uses
// public intake, dataset and analysis commands in an existing authored workspace.
import assert from 'node:assert/strict';
import {open} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {ResearchMaterials,EVIDENCE_CHUNK} from '../src/research-materials.js';
import {Workspace} from '../src/storage.js';
import {workspaceJobs} from '../src/workspace-jobs.js';
import {enqueueDataset,enqueuePlot} from '../src/dataset-jobs.js';
import {fileFingerprint} from '../src/web/evidence-fingerprint.js';
import {digest} from '../src/storage-format.js';

export async function adoptionEvidenceFixture(f,directory,{copies=1,onStage=()=>{},exerciseRecovery=false}={}){
 let materials=new ResearchMaterials(f.workspace);
 const recordId=f.first.id,jobs=workspaceJobs(f.workspace),metrics={},retained={},originals=new Map();
 const timed=async(name,budget,operation)=>{onStage(name);const started=performance.now(),result=await operation();metrics[name]=Math.round(performance.now()-started);assert.ok(metrics[name]<budget,name+' budget: '+metrics[name]);return result;};
 const perform=async id=>{
  jobs.worker.enabled=true;try{await jobs.worker.runOnce();}finally{jobs.worker.enabled=false;}
  const job=await jobs.queue.read(id);assert.equal(job.state,'completed',JSON.stringify(job));return job.result;
 };
 const datasetFile=await open(path.join(directory,'observations.jsonl'),'wx+'),rows=4344*copies,hash=createHash('sha256');let datasetBytes=0;
 try{
  for(let i=0;i<rows;i++){
   const bytes=Buffer.from(JSON.stringify({reading:i%4,counter:'18446744073709551615',native:'105',notes:'Synthetic acquired detail. '.repeat(165)})+'\n');
   await datasetFile.write(bytes);datasetBytes+=bytes.length;hash.update(bytes);
  }
  assert.ok(datasetBytes>16*1024*1024*copies);
  const sourceHash=hash.digest('hex');
  async function recoveredCommit(id){
   const {queue}=jobs,first=await queue.claim(),definition=queue.definition(first),controller=new AbortController();
   assert.equal(first.id,id);
   await assert.rejects(definition.prepare(first,{signal:controller.signal,progress:async value=>{if(value.stage==='Verified files')controller.abort();}}),{name:'AbortError'});
   assert.equal(await materials.current(id),null);
   await f.workspace.withLock(async()=>{const stale=await queue.read(id);stale.lease.until=0;await queue.write(stale);});
   const active=await queue.claim(),prepared=await definition.prepare(active,{}),commit=definition.commit;
   await assert.rejects(queue.complete(id,first.lease.token,prepared),{code:'JOB_LEASE'});
   definition.commit=async(...args)=>{await commit(...args);throw Object.assign(Error('Synthetic interrupted attachment'),{code:'ENOSPC'});};
   try{await assert.rejects(queue.complete(id,active.lease.token,prepared),{code:'ENOSPC'});}finally{definition.commit=commit;}
   assert.equal(await materials.current(id),null);
   const done=await queue.complete(id,active.lease.token,prepared);
   assert.equal((await queue.read(id)).result.revision,done.result.revision);return done.result;
  }
  async function batch(kind,count,total){
   const captureBytes=96*EVIDENCE_CHUNK*copies,rest=total-captureBytes-datasetBytes,unit=Math.floor(rest/(count-2));
   const sizeAt=index=>kind==='preparation'?(index%246<22?2:1)*EVIDENCE_CHUNK:index===0?captureBytes:index===1?datasetBytes:unit+(index===count-1?rest-unit*(count-2):0);
   async function chunkAt(index,offset){
    const size=Math.min(EVIDENCE_CHUNK,sizeAt(index)-offset);
    if(kind==='returned'&&index===1){const bytes=Buffer.alloc(size),result=await datasetFile.read(bytes,0,size,offset);assert.equal(result.bytesRead,size);return bytes;}
    const bytes=Buffer.alloc(size,(index+Math.floor(offset/EVIDENCE_CHUNK))%251);
    // Distinct names, lengths and byte fingerprints model physical files; no
    // multiplication of declared sizes stands in for uploaded content.
    if(size>=8){bytes.writeUInt32LE(index,0);bytes.writeUInt32LE(Math.floor(offset/EVIDENCE_CHUNK),4);}return bytes;
   }
   const intake=await materials.intakes.start({recordId,title:kind+' evidence',count,bytes:total});
   await timed(kind+'ManifestMs',120000,async()=>{
    for(let offset=0;offset<count;offset+=64){
     const items=[];
     for(let i=offset;i<Math.min(count,offset+64);i++){
      const chunks=[],originalHash=createHash('sha256');for(let n=0;n<sizeAt(i);n+=EVIDENCE_CHUNK){const bytes=await chunkAt(i,n);originalHash.update(bytes);chunks.push({size:bytes.length,sha256:digest(bytes)});}
      const name=kind+'-'+String(i).padStart(5,'0')+(kind==='returned'&&i===1?'.jsonl':'.raw');
      originals.set(name,{recordId,size:sizeAt(i),sha256:originalHash.digest('hex')});
      items.push({name,size:sizeAt(i),fingerprint:await fileFingerprint(sizeAt(i),chunks,digest)});
     }
     await materials.intakes.append({id:intake.id,offset,items});
    }
   });
   await timed(kind+'UploadMs',360000,async()=>{
    for(let offset=0;offset<count;offset+=50){
     const page=await materials.intakes.page({id:intake.id,offset,limit:50});
     for(const [n,file] of page.items.entries()){
      const i=offset+n;
      for(let at=0;at<sizeAt(i);at+=EVIDENCE_CHUNK){
       const index=at/EVIDENCE_CHUNK,bytes=await chunkAt(i,at);
       if(exerciseRecovery&&kind==='returned'&&i===0&&index===2){
        const ws=materials.workspace,write=ws.writeMetadata;
        ws.writeMetadata=function(fileName,...args){if(fileName.endsWith('/'+file.id+'/session.json'))throw Object.assign(Error('Synthetic full disk during capture'),{code:'ENOSPC'});return write.call(this,fileName,...args);};
        try{await assert.rejects(materials.appendImport(file.id,index,[bytes]),{code:'ENOSPC'});}finally{ws.writeMetadata=write;}
        materials=new ResearchMaterials(new Workspace(f.workspace.root,f.vault));
        assert.equal(materials.uploads.count(await materials.importState(file.id)),index);
       }
       await materials.appendImport(file.id,index,[bytes]);
       if(exerciseRecovery&&kind==='returned'&&i===0&&index===2){
        await assert.rejects(materials.appendImport(file.id,index,[bytes]),{code:'MATERIAL_CHANGED'});
        assert.equal(materials.uploads.count(await materials.importState(file.id)),index+1);
       }
      }
     }
     if(offset===50){materials=new ResearchMaterials(new Workspace(f.workspace.root,f.vault));assert.equal((await materials.intakes.page({id:intake.id,offset,limit:50})).items[0].id,page.items[0].id);}
    }
   });
   const result=await timed(kind+'CommitMs',240000,async()=>{await materials.intakes.enqueue(intake.id,jobs.queue);return exerciseRecovery&&kind==='returned'?recoveredCommit(intake.id):perform(intake.id);});
   const doc=await materials.read(result);assert.equal(doc.content.inputsIndex.count,count);
   let seen=0,bytes=0;
   await materials.readSnapshot(async()=>{for await(const ref of materials.references(doc.content)){
    const item=await materials.read(ref);assert.equal(item.content.size,sizeAt(seen));bytes+=item.content.size;
    if(kind==='returned'&&seen===1){retained.artifact=ref;assert.equal(item.content.sha256,sourceHash);}
    if(kind==='returned'&&seen===0)retained.capture=ref;
    seen++;
   }});
   assert.equal(seen,count);assert.equal(bytes,total);return result;
  }
  retained.preparation=await batch('preparation',246*copies,268*EVIDENCE_CHUNK*copies);
  retained.returned=await batch('returned',27*copies,127*EVIDENCE_CHUNK*copies);
  const column=(name,representation='text')=>({name,representation,radix:10,unit:'',missing:[],time:{kind:'none',reference:'',resolution:'',uncertainty:''}});
  retained.dataset=await timed('datasetMs',240000,async()=>{
   const id=randomUUID();await enqueueDataset(materials,jobs.queue,{recordId,title:'Acquired observations',artifact:retained.artifact,
    sourceMapping:{format:'jsonl',fields:['reading','counter','native','notes'].map(name=>({name,path:'/'+name}))},
    columns:[column('Reading','integer'),column('Counter','integer'),{...column('Native','radix'),radix:6},column('Notes')]},id);
   if(exerciseRecovery){
    const first=await jobs.queue.claim();let pages=0;
    await assert.rejects(materials.prepareDataset(first.input.command,{writePage:fn=>jobs.queue.transaction(async()=>{
     await jobs.queue.held(first.id,first.lease.token);await fn();if(++pages===2)throw Object.assign(Error('Synthetic failed dataset checkpoint'),{code:'ENOSPC'});
    })}),{code:'ENOSPC'});
    assert.equal(await materials.current(id),null);
    await jobs.queue.release(id,first.lease.token,{error:Object.assign(Error('Full disk'),{code:'ENOSPC'})});await jobs.queue.control(id,'retry');
   }
   return perform(id);
  });
  const dataset=await materials.read(retained.dataset);assert.equal(dataset.content.rowCount,rows);
  const last=await materials.datasetPage(retained.dataset,dataset.content.pageIndex.count-1);
  assert.equal(last.rows.at(-1).cells[1],'18446744073709551615');assert.equal(last.rows.at(-1).cells[2],'105');
  retained.figure=await timed('calculationMs',120000,async()=>{
   const id=randomUUID();await enqueuePlot(materials,jobs.queue,{recordId,title:'Observed values by native value',dataset:retained.dataset,
    mapping:{x:2,xKind:'category',values:[{column:0,error:null}],group:null,operation:'mean',kind:'bar',order:'source',mode:'replace',decimal:'.'}},id);return perform(id);
  });
  const figure=await materials.read(retained.figure);assert.equal(figure.content.denominator.included,rows);assert.equal(figure.content.figure.series[0].points[0].y,1.5);
  retained.collection=await materials.collection({recordId,title:'Declared acquisition',inputs:[retained.preparation,retained.returned,retained.dataset]});
  retained.analysis=await materials.analysis({recordId,title:'Retained comparison',inputs:[retained.collection,retained.figure],outputs:[retained.artifact],tool:'Synthetic external analysis',version:'fixture-1',parameters:'Exact original acquisition and independently checked mean.'});
  return {retained,originals,metrics:{...metrics,files:273*copies,physicalBytes:395*EVIDENCE_CHUNK*copies,rows,datasetBytes,recoveryFaults:exerciseRecovery},sourceHash};
 }finally{await datasetFile.close();await jobs.worker.stop();}
}
