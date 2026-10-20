import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,opendir,lstat} from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {ResearchMaterials,EVIDENCE_CHUNK} from '../src/research-materials.js';
import {EvidenceIntake} from '../src/evidence-intake.js';
import {appendMaterialUploadBatch} from '../src/material-upload-batch.js';
import {UPLOAD_BATCH_FRAMES} from '../src/web/evidence-upload-batch.js';
import {RecordValues} from '../src/record-values.js';
import {clearVault} from '../src/encryption.js';
import {workspaceJobs} from '../src/workspace-jobs.js';
import {databaseCapacity} from '../src/postgres.js';
import {requestWriterWait} from '../src/writer-wait.js';
import {digest} from '../src/storage-format.js';
import {fileFingerprint} from '../src/web/evidence-fingerprint.js';
const MiB=1024**2;
const bytesFor=index=>{const bytes=Buffer.alloc(EVIDENCE_CHUNK);bytes.writeUInt32LE(index);return bytes;};
const profiles=[
 {name:'small originals',files:246,chunks:index=>index%246<22?2:1,bytes:268*MiB},
 {name:'large captures',files:3,chunks:()=>96,bytes:288*MiB}
];
async function descriptor(index,profile){
 const chunks=profile.chunks(index),size=chunks*EVIDENCE_CHUNK,sha256=digest(bytesFor(index));
 return {name:'capture-'+String(index).padStart(5,'0')+'.raw',size,fingerprint:await fileFingerprint(size,Array.from({length:chunks},()=>({size:EVIDENCE_CHUNK,sha256})),digest)};
}
async function filesSize(directory){
 let bytes=0,files=0;
 for await(const entry of await opendir(directory)){
  const file=path.join(directory,entry.name),stat=await lstat(file);assert.equal(stat.isSymbolicLink(),false);
  if(stat.isDirectory()){const child=await filesSize(file);bytes+=child.bytes;files+=child.files;}
  else{assert.ok(stat.isFile());bytes+=stat.size;files++;}
 }
 return {bytes,files};
}
async function storageSize(workspace){
 const files=await filesSize(workspace.root),databaseBytes=await workspace.catalogue(async store=>Number((await store.db.get(
  "SELECT coalesce(sum(pg_total_relation_size(c.oid)),0) AS bytes FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind IN ('r','m')",store.db.schema)).bytes));
 return {...files,databaseBytes};
}
function writerRequest(operation){
 const req={waitForWriter:true,checkWriter:async()=>{},socket:{timeout:60000,destroyed:false,setTimeout(){}}},res=new EventEmitter();res.setTimeout=()=>{};res.writableEnded=false;
 return requestWriterWait(req,res,operation);
}
function measureConnections(t,workspace,metrics){
 const open=workspace.openCatalogue;
 t.mock.method(workspace,'openCatalogue',async function(...args){
  const opening=performance.now(),db=await open.apply(this,args),lock=db.lock,run=db.run,close=db.close;metrics.openMs+=performance.now()-opening;let held=null,closed=false;metrics.opens++;
  const finish=()=>{if(held===null)return;const elapsed=performance.now()-held;metrics.writerCount++;metrics.writerMs+=elapsed;metrics.maximumWriterMs=Math.max(metrics.maximumWriterMs,elapsed);held=null;};
  db.lock=async function(...args){const result=await lock.apply(this,args);held=performance.now();return result;};
  db.run=async function(sql,...args){const at=performance.now();try{return await run.call(this,sql,...args);}finally{metrics.queries++;metrics.sqlMs+=performance.now()-at;if(/^COMMIT|^ROLLBACK/.test(sql))finish();}};
  db.close=async function(){try{return await close.call(this);}finally{finish();if(!closed){closed=true;metrics.closes++;}}};return db;
 });
}
for(const profile of profiles)for(const copies of [1,10])test(copies+'x physical intake: '+profile.name+' with concurrent record editing',{timeout:900000},async t=>{
 const count=profile.files*copies,total=profile.bytes*copies,directory=await mkdtemp(path.join(os.tmpdir(),'observanda-intake-growth-'));
 const f=await encryptedFixture(directory,sampleNotebook()),m=new ResearchMaterials(f.workspace),book=(await f.workspace.read()).book,recordId=book.entries[0].id;
 const baselineConnections=databaseCapacity().active,metrics={opens:0,closes:0,openMs:0,queries:0,sqlMs:0,writerCount:0,writerMs:0,maximumWriterMs:0},foreground=[];
 let finishedJob,failedJob;const completion=new Promise((resolve,reject)=>{finishedJob=resolve;failedJob=reject;});completion.catch(()=>{});
 const jobs=workspaceJobs(f.workspace,undefined,{observe:job=>{if(job.state==='completed')finishedJob(job);else if(job.state==='failed')failedJob(Error('Intake failed: '+job.error));}});
 t.after(async()=>{await jobs.worker.stop();clearVault(f.vault);assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-intake-growth-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const before=await storageSize(f.workspace);measureConnections(t,f.workspace,metrics);
 let peakHeap=0,peakRSS=0,peakConnections=baselineConnections,commitMs=0,commitQueries=0,commitSqlMs=0,authoring=null,stopAuthoring=false,phase='manifest',authoringError=null;
 const sample=()=>{const usage=process.memoryUsage();peakHeap=Math.max(peakHeap,usage.heapUsed);peakRSS=Math.max(peakRSS,usage.rss);peakConnections=Math.max(peakConnections,databaseCapacity().active);};
 const sampler=setInterval(sample,25);sampler.unref();sample();const start=performance.now();
 try{
  const batch=await m.intakes.start({recordId,title:'Synthetic field acquisitions',count,bytes:total});
  for(let offset=0;offset<count;offset+=64){const items=[];for(let i=offset;i<Math.min(count,offset+64);i++)items.push(await descriptor(i,profile));await m.intakes.append({id:batch.id,offset,items});}
  const registered=performance.now();process.stdout.write(JSON.stringify({profile:profile.name,copies,phase:'manifest',ms:Math.round(registered-start)})+'\n');assert.ok(registered-start<120000,'manifest budget');
  const values=new RecordValues(f.workspace),target={workspaceId:book.id,recordId:book.entries[1].id,field:'title'};
  phase='upload';
  authoring=(async()=>{let index=0;while(!stopAuthoring){
   const at=performance.now(),during=phase,value='Concurrent observation '+(++index);
   await writerRequest(async()=>{const base=await values.read(target);await values.save({...target,expectedRevision:base.revision,value:{value}});});
   const saved=await values.read(target);assert.equal(saved.value.value,value);foreground.push({phase:during,ms:performance.now()-at});
   await delay(1000,undefined,{signal:t.signal});
  }})().catch(error=>{authoringError=error;});
  let frames=[];
  const flush=async()=>{
   if(!frames.length)return;const pending=frames;frames=[];
   async function* source(){for(const frame of pending){yield Buffer.from(JSON.stringify({id:frame.id,index:frame.index,size:frame.bytes.length})+'\n');yield frame.bytes;}}
   const result=await writerRequest(()=>appendMaterialUploadBatch(f.workspace,source(),{signal:t.signal}));
   assert.equal(result.sessions.length,pending.length);
   for(const [i,session] of result.sessions.entries())assert.equal(session.id,pending[i].id);
  };
  for(let offset=0;offset<count;offset+=50){
   const page=await m.intakes.page({id:batch.id,offset,limit:50});
   for(const [n,file] of page.items.entries()){
    const i=offset+n,bytes=bytesFor(i);assert.equal(file.reused,false);
    for(let chunk=0;chunk<profile.chunks(i);chunk++){
     frames.push({id:file.id,index:chunk,bytes});if(frames.length===UPLOAD_BATCH_FRAMES)await flush();
    }
   }
  }
  await flush();
  const uploaded=performance.now();process.stdout.write(JSON.stringify({profile:profile.name,copies,phase:'upload',ms:Math.round(uploaded-registered),connections:metrics})+'\n');assert.ok(uploaded-registered<240000,'upload budget');
  assert.equal((await m.list({recordId})).items.length,0,'No partially attached originals');
  const uploadedStorage=await storageSize(f.workspace),commit=EvidenceIntake.prototype.commit;
  t.mock.method(EvidenceIntake.prototype,'commit',async function(...args){const at=performance.now();
   try{return await this.workspace.catalogue(async store=>{const run=store.db.run;store.db.run=async function(sql,...args){const at=performance.now();commitQueries++;try{return await run.call(this,sql,...args);}finally{commitSqlMs+=performance.now()-at;}};try{return await commit.apply(this,args);}finally{store.db.run=run;}});}
   finally{commitMs=performance.now()-at;}
  });
  phase='finalize';await writerRequest(()=>m.intakes.enqueue(batch.id,jobs.queue));
  const prepare=jobs.queue.definitions['evidence.batch'].prepare;let preparing=0,maximumPreparing=0;
  jobs.queue.definitions['evidence.batch'].prepare=async(...args)=>{maximumPreparing=Math.max(maximumPreparing,++preparing);try{return await prepare(...args);}finally{preparing--;}};
  jobs.worker.start();jobs.worker.start();
  await completion;await jobs.worker.stop();const finished=performance.now();
  stopAuthoring=true;await authoring;if(authoringError)throw authoringError;
  assert.equal(maximumPreparing,1,'repeated starts retain one active intake worker');assert.equal(jobs.worker.active,null);assert.equal(jobs.worker.controller,null);assert.equal(jobs.worker.running,null);
  const job=await jobs.queue.read(batch.id);assert.equal(job.state,'completed',JSON.stringify(job));
  assert.ok(finished-uploaded<240000,'verification and attachment budget');assert.ok(commitMs<30000,'complete-set metadata transaction budget: '+Math.round(commitMs));
  const doc=await m.read(job.result);assert.equal(doc.content.inputsIndex.count,count);assert.ok(JSON.stringify(doc).length<2500);
  let ordinal=0,retainedBytes=0;
  await m.readSnapshot(async()=>{for await(const ref of m.references(doc.content)){
   const item=await m.read(ref),bytes=bytesFor(ordinal),hash=createHash('sha256');for(let j=0;j<profile.chunks(ordinal);j++)hash.update(bytes);
   assert.equal(item.content.sha256,hash.digest('hex'));assert.equal(item.content.name,(await descriptor(ordinal,profile)).name);assert.equal(item.content.size,profile.chunks(ordinal)*EVIDENCE_CHUNK);retainedBytes+=item.content.size;ordinal++;
  }});
  assert.equal(ordinal,count);assert.equal(retainedBytes,total);
  const after=await storageSize(f.workspace);sample();const foregroundStats=Object.fromEntries(['upload','finalize'].map(stage=>{const samples=foreground.filter(item=>item.phase===stage).map(item=>item.ms).sort((a,b)=>a-b);assert.ok(samples.length>0,'foreground saves during '+stage);return [stage,{saves:samples.length,p95Ms:Math.round(samples[Math.floor((samples.length-1)*.95)]),maximumMs:Math.round(samples.at(-1))}];}));
  t.diagnostic(JSON.stringify({platform:process.platform,node:process.version,cpu:os.cpus()[0].model,memoryGiB:Math.round(os.totalmem()/1024**3),profile:profile.name,copies,count,totalBytes:total,manifestMs:Math.round(registered-start),uploadMs:Math.round(uploaded-registered),verifyAttachMs:Math.round(finished-uploaded),commitMs:Math.round(commitMs),commitQueries,commitSqlMs:Math.round(commitSqlMs),sampledHeapMiB:Math.round(peakHeap/MiB),sampledRSSMiB:Math.round(peakRSS/MiB),peakConnections,connections:metrics,foreground:foregroundStats,storage:{before,uploaded:uploadedStorage,after}}));
  assert.ok(peakHeap<256*MiB,'bounded JavaScript heap');assert.ok(metrics.maximumWriterMs<5000,'writer held less than five seconds');
  for(const samples of Object.values(foregroundStats))assert.ok(samples.maximumMs<5000,'foreground save including admission under five seconds');
  assert.equal(metrics.opens,metrics.closes,'all workload connections closed');assert.equal(databaseCapacity().active,baselineConnections);
 }finally{stopAuthoring=true;await jobs.worker.stop();await authoring;clearInterval(sampler);t.diagnostic(JSON.stringify({profile:profile.name,copies,lastPhase:phase,connections:metrics,foregroundSaves:foreground.length,foregroundMaximumMs:Math.round(Math.max(0,...foreground.map(item=>item.ms)))}));}
});
