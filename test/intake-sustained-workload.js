import assert from 'node:assert/strict';
import {mkdtemp,rm,opendir,lstat} from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {createHash} from 'node:crypto';
import {PerformanceObserver} from 'node:perf_hooks';
import {getHeapSpaceStatistics} from 'node:v8';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {ResearchMaterials,EVIDENCE_CHUNK} from '../src/research-materials.js';
import {appendMaterialUploadBatch} from '../src/material-upload-batch.js';
import {UPLOAD_BATCH_FRAMES} from '../src/web/evidence-upload-batch.js';
import {RecordValues} from '../src/record-values.js';
import {workspaceJobs} from '../src/workspace-jobs.js';
import {databaseCapacity} from '../src/postgres.js';
import {withDatabaseRequest} from '../src/database-request-context.js';
import {requestWriterWait} from '../src/writer-wait.js';
import {clearVault} from '../src/encryption.js';
import {digest} from '../src/storage-format.js';
import {fileFingerprint} from '../src/web/evidence-fingerprint.js';
import {sampleWorkloadCpu} from './workload-cpu-sample.js';

const MiB=1024**2,PRODUCER_MS=60000,DRAIN_MS=120000,VERIFY_MS=30000,CLEANUP_MS=15000,MAX_UNFINISHED=4;
// Engineering qualification profiles, not predicted user/instrument rates.
// A paced source offers descriptors independently of admission. At most four
// intake batches may be uploading, queued or running; waiting arrivals hold
// only a sequence number/time, never accumulated original bytes.
const profiles=[
 {name:'steady small originals',intervalMs:2000,files:1,fileBytes:256*1024},
 {name:'larger burst arrivals',intervalMs:10000,files:4,fileBytes:4*MiB}
];
function chunkFor(file,chunk,size){const bytes=Buffer.alloc(size,0x63);bytes.writeUInt32LE(file,0);bytes.writeUInt32LE(chunk,4);return bytes;}
async function original(file,size){
 const hash=createHash('sha256'),chunks=[];
 for(let chunk=0,offset=0;offset<size;chunk++,offset+=EVIDENCE_CHUNK){const bytes=chunkFor(file,chunk,Math.min(EVIDENCE_CHUNK,size-offset));hash.update(bytes);chunks.push({size:bytes.length,sha256:digest(bytes)});}
 return {name:'engineering-capture-'+String(file).padStart(5,'0')+'.raw',size,sha256:hash.digest('hex'),fingerprint:await fileFingerprint(size,chunks,digest)};
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
async function writerRequest(signal,operation){
 signal?.throwIfAborted();
 const req={waitForWriter:true,checkWriter:async()=>signal?.throwIfAborted(),socket:{timeout:60000,destroyed:false,setTimeout(){}}},res=new EventEmitter();res.setTimeout=()=>{};res.writableEnded=false;
 const abort=()=>res.emit('close');signal?.addEventListener('abort',abort,{once:true});
 try{return await withDatabaseRequest(signal,()=>requestWriterWait(req,res,operation));}
 finally{signal?.removeEventListener('abort',abort);}
}
function measureConnections(t,workspace,metrics){
 const open=workspace.openCatalogue;
 // A mock's call history retains resolved connections and distorts heap use.
 const measured=async function(...args){
  const db=await open.apply(this,args),lock=db.lock,run=db.run,close=db.close;let held=null,closed=false;metrics.opens++;
  const finish=()=>{if(held!==null){metrics.maximumWriterMs=Math.max(metrics.maximumWriterMs,performance.now()-held);metrics.writerCount++;held=null;}};
  db.lock=async function(...args){const value=await lock.apply(this,args);held=performance.now();return value;};
  db.run=async function(sql,...args){try{return await run.call(this,sql,...args);}finally{if(/^COMMIT|^ROLLBACK/.test(sql))finish();}};
  db.close=async function(){try{return await close.call(this);}finally{finish();if(!closed){closed=true;metrics.closes++;}}};return db;
 };
 workspace.openCatalogue=measured;t.after(()=>{workspace.openCatalogue=open;});
}
const statistics=values=>{const sorted=[...values].sort((a,b)=>a-b);return {count:sorted.length,meanMs:Math.round(sorted.reduce((sum,n)=>sum+n,0)/(sorted.length||1)),p95Ms:Math.round(sorted[Math.floor((sorted.length-1)*.95)]??0),maximumMs:Math.round(sorted.at(-1)??0)};};
async function boundedCleanup(pending){
 let timer;
 try{return await Promise.race([pending,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Intake cleanup did not settle; disposable fixture retained')),CLEANUP_MS);})]);}
 finally{clearTimeout(timer);}
}
function observeMemory(context){
 if(process.env.OBSERVANDA_INTAKE_MEMORY_DIAGNOSTICS!=='1')return null;
 // Observe normal collection without requesting GC or retaining call/results.
 // GC entries arrive asynchronously: delivery heap is not post-GC live size.
 const began=performance.now(),phases={},checkpoints=[],collections={},recentCollections=[];let peak=null,result;
 const measure=(usage=process.memoryUsage())=>{
  const current=context(),elapsedMs=Math.round(performance.now()-began),phase=phases[current.phase]??={samples:0,minimumHeapBytes:usage.heapUsed,maximumHeapBytes:0};
  phase.samples++;phase.minimumHeapBytes=Math.min(phase.minimumHeapBytes,usage.heapUsed);phase.maximumHeapBytes=Math.max(phase.maximumHeapBytes,usage.heapUsed);phase.lastHeapBytes=usage.heapUsed;
  if(!peak||usage.heapUsed>peak.heapUsed)peak={...current,elapsedMs,...usage,spaces:getHeapSpaceStatistics().map(space=>({name:space.space_name,usedBytes:space.space_used_size,sizeBytes:space.space_size}))};
  return {...current,elapsedMs,...usage};
 };
 const collect=entries=>{
  if(!entries.length)return;
  const delivery=measure();
  for(const entry of entries){
   const kind=String(entry.detail?.kind??'unknown'),summary=collections[kind]??={count:0,durationMs:0,maximumDurationMs:0};
   summary.count++;summary.durationMs+=entry.duration;summary.maximumDurationMs=Math.max(summary.maximumDurationMs,entry.duration);
   recentCollections.push({kind,flags:entry.detail?.flags??null,startMs:Math.round(entry.startTime-began),durationMs:entry.duration,deliveryElapsedMs:delivery.elapsedMs,phaseAtDelivery:delivery.phase,heapBytesAtDelivery:delivery.heapUsed,heapTotalBytesAtDelivery:delivery.heapTotal});
   if(recentCollections.length>12)recentCollections.shift();
  }
 };
 const observer=new PerformanceObserver(list=>collect(list.getEntries()));observer.observe({entryTypes:['gc']});
 return {sample:measure,checkpoint(label){assert.ok(checkpoints.length<8);checkpoints.push({label,...measure()});},stop(){
  if(result)return result;collect(observer.takeRecords());observer.disconnect();const last=measure();
  return result={clock:'milliseconds since diagnostic start',gcHeap:'sampled at observer delivery, not immediate post-GC live size',checkpoints,phases,peak,last,collections,recentCollections};
 }};
}
async function observeAllocations(){
 if(process.env.OBSERVANDA_INTAKE_ALLOCATION_DIAGNOSTICS!=='1')return null;
 const {Session}=await import('node:inspector/promises'),session=new Session(),began=performance.now(),crossed=new Set(),thresholdBytes=240*MiB,samplingInterval=256*1024;
 const moduleRoot=new URL('../',import.meta.url).href,localRoot=fileURLToPath(new URL('../',import.meta.url)).replaceAll('\\','/');
 let pending=Promise.resolve(),failure,closing=false;
 const request=async(method,params)=>{
  let timer;
  try{return await Promise.race([session.post(method,params),new Promise((_,reject)=>{timer=setTimeout(()=>{session.disconnect();reject(Error('Allocation diagnostic inspector request timed out'));},5000);})]);}
  finally{clearTimeout(timer);}
 };
 const location=frame=>{
  const raw=String(frame.url??'').replaceAll('\\','/');let file=raw.startsWith(moduleRoot)?raw.slice(moduleRoot.length):raw.startsWith(localRoot)?raw.slice(localRoot.length):raw;
  if(!/^(?:src\/|test\/|node_modules\/|node:)[a-zA-Z0-9_./@%:+-]{1,180}$/.test(file)||file.split('/').includes('..'))file='(external or native)';
  const name=/^[a-zA-Z0-9_$ .<>()-]{1,100}$/.test(frame.functionName??'')?frame.functionName:'(anonymous)';
  return {function:name,file,line:Math.max(0,(frame.lineNumber??-1)+1),column:Math.max(0,(frame.columnNumber??-1)+1)};
 };
 const summarize=(profile,capture)=>{
  const top=[];let totalEstimatedBytes=0,nodes=0;
  const visit=(node,parents)=>{
   nodes++;const bytes=node.selfSize??0;totalEstimatedBytes+=bytes;
   const frame=location(node.callFrame),stack=[frame,...parents];
   if(bytes>0&&(top.length<20||bytes>top.at(-1).estimatedBytes)){top.push({estimatedBytes:bytes,stack});top.sort((a,b)=>b.estimatedBytes-a.estimatedBytes);if(top.length>20)top.pop();}
   for(const child of node.children??[])visit(child,stack.slice(0,3));
  };
  visit(profile.head,[]);
  process.stdout.write(JSON.stringify({allocationDiagnostics:{purpose:'statistical allocation attribution; not qualification',coverage:'cumulative since test-module initialization, spanning both intake cases; earlier module-import allocations are absent',collectedObjects:'minor and major collection inclusion requested',samplingInterval,thresholdBytes,elapsedMs:Math.round(performance.now()-began),...capture,totalEstimatedBytes,nodes,top}})+'\n');
 };
 session.connect();
 try{await request('HeapProfiler.startSampling',{samplingInterval,includeObjectsCollectedByMinorGC:true,includeObjectsCollectedByMajorGC:true});}
 catch(error){session.disconnect();throw error;}
 // One session spans both cases so the second case can attribute allocations
 // made by the first. Only summaries survive each inspector response.
 return {sample(capture,usage){
  if(closing||usage.heapUsed<thresholdBytes||crossed.has(capture.profile))return;
  crossed.add(capture.profile);const detail={capture:'first threshold crossing',...capture,observedMs:Math.round(performance.now()-began),heapUsed:usage.heapUsed,heapTotal:usage.heapTotal};
  pending=pending.then(async()=>{const {profile}=await request('HeapProfiler.getSamplingProfile');summarize(profile,detail);}).catch(error=>{failure??=error;});
 },async drain(){await pending;if(failure)throw failure;},async stop(){
  closing=true;
  try{await pending;const {profile}=await request('HeapProfiler.stopSampling');summarize(profile,{capture:'session stop'});if(failure)throw failure;}
  finally{session.disconnect();}
 }};
}

const cancellation=new AbortController();
const cancel=()=>cancellation.abort(Error('Sustained intake driver cancelled'));
process.on('message',message=>{if(message?.type==='cancel')cancel();});
process.once('disconnect',cancel);
const allocations=await observeAllocations();

async function runProfile(profile,t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-intake-sustained-')),control=new AbortController(),foregroundControl=new AbortController(),cpu=sampleWorkloadCpu();
 let fixture,jobs,workload,finalCleanup,stopOnAbort,sampler,runSignal,failure,drainDeadline,verificationDeadline,cleaning=false,phase='setup';
 const tasks=[],batches=[],completed=new Map(),states=new Map(),foreground=[],admissionLag=[],enqueueLag=[],offeredAt=[];
 const metrics={opens:0,closes:0,writerCount:0,maximumWriterMs:0},peak={heap:0,rss:0,connections:0,unfinished:0,waitingArrivals:0,queuedJobs:0};
 const counts={offered:0,started:0,enqueued:0},totalBatches=PRODUCER_MS/profile.intervalMs,totalFiles=totalBatches*profile.files,totalBytes=totalFiles*profile.fileBytes;
 const memory=observeMemory(()=>({phase,opens:metrics.opens,offered:counts.offered,completed:completed.size}));memory?.checkpoint('before fixture');
 allocations?.sample({profile:profile.name,phase,opens:metrics.opens},process.memoryUsage());
 const failed=error=>{failure??=error;if(!control.signal.aborted)control.abort(error);};
 const stop=()=>{if(jobs){stopOnAbort=jobs.worker.stop();stopOnAbort.catch(()=>{});}};
 t.after(async()=>{
  try{
  // node:test timeout does not stop an async body. Cancel and drain every owned
  // producer/request/worker before erasing keys or removing its disposable tree.
  clearTimeout(drainDeadline);clearTimeout(verificationDeadline);control.abort();foregroundControl.abort();stop();
  await boundedCleanup(workload?.catch(()=>{}));
  // A timeout only ends the wait, not its cleanup coroutine. Settle that exact
  // operation before clearing keys/removing files, or retain the fixture.
  await boundedCleanup(finalCleanup?.catch(()=>{}));
  await boundedCleanup((async()=>{await Promise.allSettled(tasks);await stopOnAbort;await jobs?.worker.stop();await jobs?.queue.pendingWrite;})());
  clearInterval(sampler);runSignal?.removeEventListener('abort',stop);
  t.diagnostic(JSON.stringify({profile:profile.name,cpuObserved:cpu.stop(),offeredBatches:counts.offered,enqueuedBatches:counts.enqueued,completedJobs:completed.size,connections:metrics}));
  if(fixture)clearVault(fixture.vault);
  assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-intake-sustained-'));
  await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }finally{if(memory)t.diagnostic(JSON.stringify({profile:profile.name,memoryDiagnostics:memory.stop()}));await allocations?.drain();}
 });
 workload=(async()=>{
  fixture=await encryptedFixture(directory,sampleNotebook());
  memory?.checkpoint('fixture created');
  const {workspace}=fixture,materials=new ResearchMaterials(workspace),book=(await workspace.read()).book,recordId=book.entries[0].id,baseline=databaseCapacity();
  memory?.checkpoint('workspace read');
  jobs=workspaceJobs(workspace,undefined,{observe:job=>{
   if(job.type!=='evidence.batch')return;
   states.set(job.id,job.state);
   if(job.state==='completed'){
    if(completed.has(job.id))failed(Error('Duplicate completed-job publication: '+job.id));
    else completed.set(job.id,{result:job.result,at:performance.now()});
   }else if(!cleaning&&['failed','cancelled'].includes(job.state))failed(Error('Intake '+job.state+': '+job.error));
  }});
  const before=await storageSize(workspace);measureConnections(t,workspace,metrics);
  const began=performance.now();phase='acquisition';memory?.checkpoint('acquisition starts');runSignal=AbortSignal.any([t.signal,control.signal]);runSignal.addEventListener('abort',stop,{once:true});runSignal.throwIfAborted();
  drainDeadline=setTimeout(()=>failed(Error('Intake did not drain within the declared acquisition and drain budget')),PRODUCER_MS+DRAIN_MS);
  const sample=()=>{const usage=process.memoryUsage();memory?.sample(usage);allocations?.sample({profile:profile.name,phase,opens:metrics.opens},usage);if(usage.heapUsed>peak.heap){peak.heap=usage.heapUsed;peak.heapAt={phase,elapsedMs:Math.round(performance.now()-began),opens:metrics.opens,heapTotalMiB:Math.ceil(usage.heapTotal/MiB)};}peak.rss=Math.max(peak.rss,usage.rss);peak.connections=Math.max(peak.connections,databaseCapacity().active);peak.unfinished=Math.max(peak.unfinished,counts.started-completed.size);peak.waitingArrivals=Math.max(peak.waitingArrivals,counts.offered-counts.started);peak.queuedJobs=Math.max(peak.queuedJobs,[...states.values()].filter(state=>state==='queued').length);};
  sampler=setInterval(sample,25);sampler.unref();sample();
  const until=async condition=>{while(!condition()){runSignal.throwIfAborted();await delay(50,undefined,{signal:runSignal});}runSignal.throwIfAborted();};
  const at=async elapsed=>{runSignal.throwIfAborted();const remaining=began+elapsed-performance.now();if(remaining>0)await delay(remaining,undefined,{signal:runSignal});runSignal.throwIfAborted();};
  const launch=operation=>{const task=operation().catch(error=>{failed(error);throw error;});task.catch(()=>{});tasks.push(task);return task;};
  let preparing=0,maximumPreparing=0,offeredAtEnd=0,stopAuthoring=false,pauseEvidence;
  const prepare=jobs.queue.definitions['evidence.batch'].prepare;
  jobs.queue.definitions['evidence.batch'].prepare=async(...args)=>{maximumPreparing=Math.max(maximumPreparing,++preparing);try{return await prepare(...args);}finally{preparing--;}};
  jobs.worker.start();
  try{
   const producer=launch(async()=>{
    for(let index=0;index<totalBatches;index++){
     await at(index*profile.intervalMs);offeredAt.push(performance.now());counts.offered++;sample();
     if(index*profile.intervalMs%10000===0)process.stdout.write('Engineering intake '+JSON.stringify({profile:profile.name,elapsedMs:Math.round(performance.now()-began),offered:counts.offered,enqueued:counts.enqueued,completed:completed.size})+'\n');
    }
    await at(PRODUCER_MS);offeredAtEnd=completed.size;phase='drain';memory?.checkpoint('arrivals ended');
   });
   const admission=launch(async()=>{
    for(let index=0;index<totalBatches;index++){
     await until(()=>counts.offered>index&&counts.started-completed.size<MAX_UNFINISHED);
     counts.started++;admissionLag.push(performance.now()-offeredAt[index]);sample();
     const descriptors=[];for(let n=0;n<profile.files;n++){const {sha256,...descriptor}=await original(index*profile.files+n,profile.fileBytes);void sha256;descriptors.push(descriptor);}
     const batch=await writerRequest(runSignal,()=>materials.intakes.start({recordId,title:'Engineering arrival '+index,count:profile.files,bytes:profile.files*profile.fileBytes})),entry={id:batch.id,index,files:[]};batches.push(entry);
     await writerRequest(runSignal,()=>materials.intakes.append({id:batch.id,offset:0,items:descriptors}));
     entry.files=(await materials.intakes.page({id:batch.id,limit:50})).items;assert.equal(entry.files.length,profile.files);
     // Only a bounded upload request is materialized. Originals are generated
     // chunk by chunk, even when several larger files arrive together.
     let frames=[];
     const flush=async()=>{
      if(!frames.length)return;const pending=frames;frames=[];
      async function* source(){for(const frame of pending){runSignal.throwIfAborted();yield Buffer.from(JSON.stringify({id:frame.id,index:frame.chunk,size:frame.size})+'\n');yield chunkFor(frame.file,frame.chunk,frame.size);}}
      const result=await writerRequest(runSignal,()=>appendMaterialUploadBatch(workspace,source(),{signal:runSignal}));
      assert.deepEqual(result.sessions.map(session=>session.id),pending.map(frame=>frame.id));
     };
     for(const [n,file] of entry.files.entries()){
      assert.equal(file.reused,false);
      for(let chunk=0,offset=0;offset<profile.fileBytes;chunk++,offset+=EVIDENCE_CHUNK){frames.push({id:file.id,file:index*profile.files+n,chunk,size:Math.min(EVIDENCE_CHUNK,profile.fileBytes-offset)});if(frames.length===UPLOAD_BATCH_FRAMES)await flush();}
     }
     await flush();
     for(const file of entry.files)assert.equal(await materials.current(file.id),null,'Uploaded originals remain hidden before batch publication');
     const queued=await writerRequest(runSignal,()=>materials.intakes.enqueue(batch.id,jobs.queue));assert.equal(queued.id,batch.id);
     counts.enqueued++;enqueueLag.push(performance.now()-offeredAt[index]);sample();jobs.worker.wake();
    }
   });
   const values=new RecordValues(workspace),target={workspaceId:book.id,recordId:book.entries[1].id,field:'title'},foregroundSignal=AbortSignal.any([runSignal,foregroundControl.signal]);
   const authoring=launch(async()=>{
    try{for(let index=0;!stopAuthoring;index++){
     foregroundSignal.throwIfAborted();const started=performance.now(),value='Sustained intake foreground '+index;
     await writerRequest(foregroundSignal,async()=>{const base=await values.read(target);await values.save({...target,expectedRevision:base.revision,value:{value}});});
     assert.equal((await values.read(target)).value.value,value);foreground.push({at:performance.now()-began,ms:performance.now()-started});
     await delay(1000,undefined,{signal:foregroundSignal});
    }}catch(error){if(!foregroundControl.signal.aborted||runSignal.aborted)throw error;}
   });
   const pauseRestart=launch(async()=>{
    await at(20000);await jobs.worker.stop();const pausedAt=performance.now()-began;
    await until(()=>counts.enqueued>completed.size);
    assert.equal(jobs.worker.running,null);assert.equal(jobs.worker.active,null);assert.equal(jobs.worker.controller,null);
    const queued=await jobs.queue.status();assert.ok(queued.active>0,'Pause retains admitted backlog');
    for(const batch of batches)if(states.get(batch.id)==='queued')for(const file of batch.files)assert.equal(await materials.current(file.id),null,'Paused incomplete batches expose no originals');
    await delay(6000,undefined,{signal:runSignal});
    pauseEvidence={pausedAtMs:Math.round(pausedAt),resumedAtMs:Math.round(performance.now()-began),queuedAtPause:queued.active,queuedAtResume:(await jobs.queue.status()).active};
    assert.ok(pauseEvidence.queuedAtResume>0);jobs.worker.start();jobs.worker.start();
   });
   await Promise.all([producer,admission,pauseRestart]);
   await until(()=>completed.size===totalBatches);
   await jobs.worker.stop();const drainedAt=performance.now(),drainMs=Math.max(0,drainedAt-began-PRODUCER_MS);clearTimeout(drainDeadline);
   phase='verification';memory?.checkpoint('intake drained');verificationDeadline=setTimeout(()=>failed(Error('Complete intake verification exceeded its separate 30-second budget')),VERIFY_MS);
   stopAuthoring=true;await authoring;if(failure)throw failure;
   assert.ok(drainMs<DRAIN_MS,'All offered work drains within the engineering two-minute drain budget');
   assert.equal(counts.offered,totalBatches);assert.equal(counts.enqueued,totalBatches);assert.equal(completed.size,totalBatches);assert.equal(maximumPreparing,1);assert.equal(preparing,0);
   assert.equal(jobs.worker.running,null);assert.equal(jobs.worker.controller,null);assert.equal(jobs.worker.active,null);assert.equal(jobs.worker.enabled,false);assert.deepEqual(await jobs.queue.status(),{active:0});
   const artifacts=new Set(),collections=new Set();let verifiedFiles=0,verifiedBytes=0;
   for(const batch of batches){
    runSignal.throwIfAborted();const job=await jobs.queue.read(batch.id);assert.equal(job.state,'completed');assert.equal(job.cancelRequested,false);assert.deepEqual(job.result,completed.get(batch.id).result);assert.equal(job.result.id,batch.id);assert.ok(!collections.has(job.result.id));collections.add(job.result.id);
    const doc=await materials.read(job.result);assert.equal(doc.recordId,recordId);assert.equal(doc.content.inputsIndex.count,profile.files);
    let ordinal=0;
    for await(const ref of materials.references(doc.content)){
     assert.equal(ref.id,batch.files[ordinal].id);assert.ok(!artifacts.has(ref.id));artifacts.add(ref.id);
     const expected=await original(batch.index*profile.files+ordinal,profile.fileBytes),{doc:artifact,content}=await materials.artifact(ref,{signal:runSignal});
     assert.equal(artifact.recordId,recordId);assert.equal(artifact.content.name,expected.name);assert.equal(artifact.content.size,expected.size);assert.equal(artifact.content.sha256,expected.sha256);
     const hash=createHash('sha256');let bytes=0;for await(const chunk of content.read(0,content.size-1,{signal:runSignal})){hash.update(chunk);bytes+=chunk.length;}
     assert.equal(bytes,expected.size);assert.equal(hash.digest('hex'),expected.sha256);verifiedBytes+=bytes;verifiedFiles++;ordinal++;
    }
    assert.equal(ordinal,profile.files);
    const replay=await writerRequest(runSignal,()=>materials.intakes.enqueue(batch.id,jobs.queue));assert.deepEqual(replay,job,'A completed enqueue replay creates no additional job or result');
   }
   phase='final inventory';
   for(const [kind,expected] of [['artifact',artifacts],['collection',collections]]){
    const listed=new Set();let cursor=null;
    do{const page=await materials.list({recordId,kind,cursor,limit:50});for(const item of page.items){assert.ok(!listed.has(item.id));listed.add(item.id);}cursor=page.next;}while(cursor);
    assert.deepEqual(listed,expected,'Visible '+kind+' identities contain neither partial nor duplicate output');
   }
   assert.equal(verifiedFiles,totalFiles);assert.equal(verifiedBytes,totalBytes);assert.deepEqual(await jobs.queue.status(),{active:0});assert.equal(completed.size,totalBatches);
   assert.deepEqual(await materials.imports(recordId),[],'No unfinished original upload remains');assert.deepEqual((await materials.intakes.list(recordId)).items,[],'No unfinished intake remains');
   const after=await storageSize(workspace);runSignal.throwIfAborted();sample();const foregroundStats=statistics(foreground.map(item=>item.ms));
   memory?.checkpoint('verification finished');
   t.diagnostic(JSON.stringify({profile:profile.name,heapPeak:{...peak.heapAt,usedMiB:Math.ceil(peak.heap/MiB)}}));
   t.diagnostic(JSON.stringify({profile:{...profile,qualification:'engineering, not universal user rate',producerMs:PRODUCER_MS,drainBudgetMs:DRAIN_MS,maxUnfinished:MAX_UNFINISHED},offered:{batches:counts.offered,files:totalFiles,bytes:totalBytes,filesPerSecond:totalFiles/(PRODUCER_MS/1000),firstMs:Math.round(offeredAt[0]-began),lastMs:Math.round(offeredAt.at(-1)-began),maximumProducerLagMs:Math.round(Math.max(...offeredAt.map((time,index)=>time-began-index*profile.intervalMs)))},admissionLag:statistics(admissionLag),enqueueLag:statistics(enqueueLag),peakBacklog:{waitingArrivals:peak.waitingArrivals,unfinished:peak.unfinished,queuedJobs:peak.queuedJobs},completedByProducerEnd:offeredAtEnd,throughput:{filesPerSecond:totalFiles/((drainedAt-began)/1000),MiBPerSecond:totalBytes/MiB/((drainedAt-began)/1000)},drainMs:Math.round(drainMs),pauseRestart:pauseEvidence,foreground:foregroundStats,sampledHeapMiB:Math.ceil(peak.heap/MiB),sampledRSSMiB:Math.ceil(peak.rss/MiB),peakConnections:peak.connections,connections:metrics,storage:{before,after,fileByteGrowth:after.bytes-before.bytes,databaseByteGrowth:after.databaseBytes-before.databaseBytes},verifiedFiles,verifiedBytes}));
   assert.ok(foreground.some(item=>item.at<20000));assert.ok(foreground.some(item=>item.at>=pauseEvidence.pausedAtMs&&item.at<pauseEvidence.resumedAtMs),'Foreground saves continue while intake is paused');assert.ok(foreground.some(item=>item.at>=pauseEvidence.resumedAtMs));
   assert.ok(peak.unfinished<=MAX_UNFINISHED);assert.ok(peak.heap<256*MiB,'Existing bounded heap budget');assert.ok(metrics.maximumWriterMs<5000,'Existing five-second writer budget');assert.ok(foreground.every(item=>item.ms<5000),'Existing five-second foreground budget including admission');assert.equal(metrics.opens,metrics.closes);assert.deepEqual(databaseCapacity(),baseline);
  }catch(error){throw failure??error;}finally{
   clearTimeout(drainDeadline);clearTimeout(verificationDeadline);cleaning=true;phase='cleanup';foregroundControl.abort();control.abort();
   const cleanupSignal=AbortSignal.timeout(CLEANUP_MS);
   finalCleanup=withDatabaseRequest(cleanupSignal,async()=>{
    await jobs.worker.stop();await Promise.allSettled(tasks);await jobs.queue.pendingWrite;
    // Failure leaves no running/queued work owned by a fixture about to vanish.
    for(const batch of batches){const job=await jobs.queue.read(batch.id);if(job&&['queued','running'].includes(job.state))await writerRequest(cleanupSignal,()=>jobs.queue.control(batch.id,'cancel'));}
    await jobs.queue.pendingWrite;assert.deepEqual(await jobs.queue.status(),{active:0});assert.equal(metrics.opens,metrics.closes);assert.deepEqual(databaseCapacity(),baseline);
   });
   await boundedCleanup(finalCleanup);
  }
 })();
 await workload;
}

const report=message=>new Promise(resolve=>{
 if(!process.connected){resolve();return;}
 process.send(message,error=>{if(error)cancel();resolve();});
});
const errorSummary=error=>({name:error?.name??'Error',code:error?.code??null,message:String(error?.message??error)});
const results=[];let resourceFailure=null;
try{
 for(const profile of profiles){
  if(cancellation.signal.aborted||resourceFailure){
   const result={type:'profile',profile:profile.name,status:'skipped',reason:resourceFailure?'Previous profile cleanup failed':'Driver cancelled'};results.push(result);await report(result);continue;
  }
  const controller=new AbortController(),cleanups=[],failures=[],began=performance.now();
  const timer=setTimeout(()=>controller.abort(Error('Sustained intake profile exceeded 240 seconds')),240000);
  const context={signal:AbortSignal.any([controller.signal,cancellation.signal]),after:cleanup=>cleanups.push(cleanup),diagnostic:value=>{void report({type:'diagnostic',profile:profile.name,value:String(value)});}};
  await report({type:'started',profile:profile.name});
  try{context.signal.throwIfAborted();await runProfile(profile,context);context.signal.throwIfAborted();}
  catch(error){failures.push({stage:'workload',...errorSummary(error)});}
  finally{
   clearTimeout(timer);
   // Preserve the existing ordered cleanup: drain owned work before removing
   // the fixture, then restore instrumentation. Any cleanup error is fatal.
   for(const cleanup of cleanups)try{await cleanup();}catch(error){const detail={stage:'cleanup',...errorSummary(error)};failures.push(detail);resourceFailure??=detail;}
  }
  const result={type:'profile',profile:profile.name,status:failures.length?'failed':'passed',elapsedMs:Math.round(performance.now()-began),failures};results.push(result);await report(result);
 }
}catch(error){resourceFailure??={stage:'driver',...errorSummary(error)};}
finally{
 try{await allocations?.stop();}catch(error){resourceFailure??={stage:'allocation diagnostic',...errorSummary(error)};}
 const failed=resourceFailure!==null||results.length!==profiles.length||results.some(result=>result.status!=='passed');
 await report({type:'finished',status:failed?'failed':'passed',profiles:results.length,resourceFailure});
 process.exitCode=failed?1:0;
 process.removeListener('disconnect',cancel);if(process.connected)process.disconnect();
}
