import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {comparisonFixture} from './analysis-comparison-fixture.js';
import {sampleWorkloadCpu} from './workload-cpu-sample.js';
import {requestWriterWait} from '../src/writer-wait.js';
import {withDatabaseRequest} from '../src/database-request-context.js';
import {withWorkspaceMetadataBatch} from '../src/metadata-batch.js';
import {ResearchRecords} from '../src/research.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {Workspace} from '../src/storage.js';
import {addressedComparisonInputs} from '../src/web/analysis-model.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';

// Synthetic engineering profile, not a promised acquisition rate. The harness
// offers ordinary retained-comparison requests to one processing lane; it does
// not model an application streaming API or create new source acquisitions.
const profile=Object.freeze({groups:16,rowsPerGroup:9,requests:12,arrivalIntervalMs:5000,arrivalWindowMs:60000,foregroundIntervalMs:5000,maxDrainMs:180000,foregroundTargetMs:5000,heapLimitBytes:512*1024*1024});
async function request(signal,operation){
 const req={waitForWriter:true,checkWriter:async()=>signal.throwIfAborted(),socket:{timeout:60000,destroyed:false,setTimeout(){}}},res=new EventEmitter();res.setTimeout=()=>{};res.writableEnded=false;
 const abort=()=>res.emit('close');signal.addEventListener('abort',abort,{once:true});
 try{signal.throwIfAborted();return await withDatabaseRequest(signal,()=>requestWriterWait(req,res,operation));}
 finally{signal.removeEventListener('abort',abort);}
}
async function storage(workspace){
 return workspace.catalogue(async store=>{
  const retained=await store.db.get('SELECT count(*) AS count,COALESCE(sum(octet_length(payload)),0) AS bytes FROM objects');
  const allocated=await store.db.get("SELECT coalesce(sum(pg_total_relation_size(c.oid)),0) AS bytes FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind IN ('r','m')",store.db.schema);
  return {objects:Number(retained.count),objectPayloadBytes:Number(retained.bytes),databaseAllocatedBytes:Number(allocated.bytes)};
 });
}
async function resultRows(materials,ref,view,total,signal){
 const items=[];let offset=0;
 do{
  signal.throwIfAborted();const page=await materials.comparisons.page({ref,view,offset,limit:50},{signal});
  assert.equal(page.offset,offset);assert.equal(page.total,total);assert.ok(page.items.length<=50);
  items.push(...page.items);assert.ok(items.length<=total,'No duplicated or excessive '+view+' rows');
  assert.equal(page.next,items.length===total?null:items.length);if(page.next!==null)assert.ok(page.next>offset,'Paged inspection must advance');offset=page.next;
 }while(offset!==null);
 assert.equal(items.length,total);return items;
}
async function inspectResult(f,item,expected,signal){
 const {ref,command}=item,doc=await f.m.read(ref),summary=doc.content.summary,groups=profile.groups,rows=groups*profile.rowsPerGroup;
 assert.equal(doc.id,ref.id);assert.equal(doc.recordId,f.recordId);assert.equal(doc.title,command.title);assert.equal((await f.m.current(ref.id)).revision,ref.revision);
 assert.deepEqual(doc.content.comparison,command.comparison);assert.deepEqual(doc.content.method,command.method);
 assert.equal(summary.algorithmVersion,'4');assert.equal(summary.rows,rows);assert.deepEqual(summary.sourceRows,[rows]);
 assert.deepEqual(summary.counts,{groups,distribution:groups*3,transitions:groups*3,observations:rows});
 assert.deepEqual(summary.raw,{correct:groups*6,mismatched:groups*3,unresolved:0,unavailable:0,excluded:0});
 const source=command.comparison.sources[0].dataset;
 const locator=(value,index)=>{assert.deepEqual(value.ref,source);assert.deepEqual(value.selector,{kind:'cell',page:expected[index].page,row:expected[index].row,column:0});};
 const retainedGroups=await resultRows(f.m,ref,'groups',groups,signal),keys=new Map();
 for(const [index,group] of retainedGroups.entries()){
  assert.equal(group.condition,'Group '+index);assert.equal(group.rows,9);assert.equal(group.assessed,9);assert.equal(group.successful,6);assert.equal(group.categories.correct,6);assert.equal(group.categories.mismatched,3);
  assert.equal(keys.has(group.key),false);keys.set(group.key,index);
 }
 const distribution=await resultRows(f.m,ref,'distribution',groups*3,signal),distinctValues=new Set();
 for(const item of distribution){
  const group=keys.get(item.group);assert.notEqual(group,undefined);const part=Number(BigInt(item.exact.numerator)-9007199254740993n);assert.ok([0,1,2].includes(part));
  assert.equal(item.exact.denominator,'1');assert.equal(item.value,String(9007199254740993n+BigInt(part)));assert.equal(item.count,3);assert.equal(item.category,part===1?'mismatched':'correct');
  const identity=group+':'+part;assert.equal(distinctValues.has(identity),false);distinctValues.add(identity);locator(item.locator,group*9+part);
 }
 const transitions=await resultRows(f.m,ref,'transitions',groups*3,signal),distinctTransitions=new Set(),pairs={'correct:mismatched':[0,1,3],'mismatched:correct':[1,2,3],'correct:correct':[2,3,2]};
 for(const item of transitions){
  const group=keys.get(item.group),pair=item.from+':'+item.to;assert.notEqual(group,undefined);assert.ok(Object.hasOwn(pairs,pair));assert.equal(item.source,0);assert.equal(item.count,pairs[pair][2]);
  const identity=group+':'+pair;assert.equal(distinctTransitions.has(identity),false);distinctTransitions.add(identity);locator(item.before,group*9+pairs[pair][0]);locator(item.after,group*9+pairs[pair][1]);
 }
 const observations=await resultRows(f.m,ref,'all',rows,signal),identities=new Set();
 for(const [index,item] of observations.entries()){
  const row=expected[index];assert.equal(item.source,0);assert.equal(item.id,row.id);assert.equal(item.page,row.page);assert.equal(item.row,row.row);assert.equal(item.condition,'Group '+Math.floor(index/9));
  assert.equal(item.value,String(9007199254740993n+BigInt(index%3)));assert.deepEqual(item.exact,{numerator:item.value,denominator:'1'});assert.equal(item.category,index%3===1?'mismatched':'correct');assert.equal(item.available,true);locator(item.locator,index);
  assert.equal(identities.has(item.id),false);identities.add(item.id);
 }
}

test('paced comparison requests preserve exact retained results and foreground edits through queue drain',{timeout:420000},async t=>{
 const controller=new AbortController(),signal=controller.signal,cleanups=[],owned=new Set(),foregroundStop=new AbortController();let firstFailure=null,lane=Promise.resolve(),foreground,stopForeground=false,sampler,cpu,deadline;
 const fail=error=>{firstFailure??=error;controller.abort(error);};
 const own=operation=>{
  const promise=Promise.resolve().then(()=>{signal.throwIfAborted();return withDatabaseRequest(signal,operation);}).then(value=>{signal.throwIfAborted();return value;});owned.add(promise);
  promise.then(()=>owned.delete(promise),error=>{owned.delete(promise);fail(error);});return promise;
 };
 const stop=()=>{stopForeground=true;foregroundStop.abort();};
 const drainOwned=async()=>{
  const until=performance.now()+30000;
  while(owned.size){let timer;try{await Promise.race([Promise.allSettled([...owned]),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Owned comparison work did not settle; disposable fixture retained')),Math.max(1,until-performance.now()));})]);}finally{clearTimeout(timer);}}
 };
 const cancelled=()=>fail(t.signal.reason??Error('Sustained comparison test cancelled'));t.signal.addEventListener('abort',cancelled,{once:true});
 // Capture the existing fixture cleanup so it cannot delete data while a
 // timed-out producer, comparison or foreground save still owns a connection.
 t.after(async()=>{clearTimeout(deadline);stop();controller.abort();clearInterval(sampler);cpu?.stop();t.signal.removeEventListener('abort',cancelled);await drainOwned();for(const cleanup of cleanups)await cleanup();});
 deadline=setTimeout(()=>fail(Error('Sustained comparison workload exceeded its bounded run time')),360000);
 const f=await own(()=>comparisonFixture({after:cleanup=>cleanups.push(cleanup)},{groups:profile.groups,rowsPerGroup:profile.rowsPerGroup,repeatValues:true}));
 const namespace=(await own(()=>f.workspace.outline())).metadata.id,base={...f.command,...addressedComparisonInputs(f.command,namespace)};Object.assign(base.comparison,{version:3,resourcePolicy:defaultDatasetResourcePolicy()});
 const sourceDoc=await own(()=>f.m.read(f.dataset)),expected=[];
 await own(()=>f.workspace.catalogue(async()=>{for(let page=0;page<f.m.datasetPageCount(sourceDoc);page++){const data=await f.m.retainedDatasetPage(sourceDoc,page);for(const [row,item] of data.rows.entries())expected.push({id:item.id,page,row});}}));
 assert.equal(expected.length,profile.groups*profile.rowsPerGroup);
 const before=await own(()=>storage(f.workspace)),recordId=f.book.entries.find(item=>item.id!==f.recordId).id,records=new ResearchRecords(f.workspace,{}),requests=[],foregroundSaves=[];
 let waiting=0,running=0,maxBacklog=0,maxRunning=0,completed=0,lastCompletedAt=0,peakHeapBytes=0,writerBatches=0,longestWriterMs=0;
 const sample=()=>{peakHeapBytes=Math.max(peakHeapBytes,process.memoryUsage().heapUsed);};sampler=setInterval(sample,100);sampler.unref();sample();cpu=sampleWorkloadCpu();const started=performance.now();
 const until=async target=>{signal.throwIfAborted();const remaining=started+target-performance.now();if(remaining>0)await delay(remaining,undefined,{signal});signal.throwIfAborted();};
 let drainDeadline;
 try{
  foreground=own(async()=>{
   let ordinal=0,next=0;
   while(!stopForeground){
    const at=performance.now(),title='Sustained foreground observation '+(++ordinal);
    await request(signal,async()=>{const selected=await f.workspace.catalogue(store=>store.recordSelection([recordId]));await records.save({workspaceId:namespace,changes:[{id:recordId,expectedRevision:selected.recordRevisions[recordId],record:{...selected.book.entries[0],title}}]},{receipt:true});});
    const saved=await f.workspace.catalogue(store=>store.recordSelection([recordId]));assert.equal(saved.book.entries[0].title,title);
    const elapsed=performance.now()-at;foregroundSaves.push({atMs:Math.round(at-started),ms:Math.round(elapsed),title});sample();assert.ok(elapsed<profile.foregroundTargetMs,'Foreground read/save/read including admission exceeded 5 seconds: '+Math.round(elapsed));
    next+=profile.foregroundIntervalMs;
    try{await delay(Math.max(1,started+next-performance.now()),undefined,{signal:AbortSignal.any([signal,foregroundStop.signal])});}catch(error){if(stopForeground&&!signal.aborted)break;throw error;}
   }
  });
  const producer=own(async()=>{
   for(let index=0;index<profile.requests;index++){
    await until(index*profile.arrivalIntervalMs);const item={ordinal:index,scheduledMs:index*profile.arrivalIntervalMs,offeredMs:performance.now()-started,command:{...structuredClone(base),id:randomUUID(),expectedRevision:null,title:'Sustained comparison '+(index+1)}};requests.push(item);waiting++;maxBacklog=Math.max(maxBacklog,waiting);assert.ok(waiting+running<=profile.requests);
    process.stdout.write(JSON.stringify({comparisonDriverLane:'offered',request:index+1,waiting,running,offerLagMs:Math.round(item.offeredMs-item.scheduledMs)})+'\n');
    const previous=lane;lane=own(async()=>{
     await previous;signal.throwIfAborted();waiting--;running++;maxRunning=Math.max(maxRunning,running);assert.equal(running,1);item.startedMs=performance.now()-started;
     try{item.ref=await request(signal,()=>f.m.comparisons.save(item.command,{signal,writePage:operation=>f.workspace.withLock(async()=>{signal.throwIfAborted();const at=performance.now();try{return await withWorkspaceMetadataBatch(f.workspace,operation,{signal});}finally{writerBatches++;longestWriterMs=Math.max(longestWriterMs,performance.now()-at);sample();}})}));item.completedMs=performance.now()-started;lastCompletedAt=item.completedMs;completed++;}
     finally{running--;}
     process.stdout.write(JSON.stringify({comparisonDriverLane:'completed',request:index+1,completed,waiting,admissionLagMs:Math.round(item.startedMs-item.offeredMs)})+'\n');
    });
   }
   await until(profile.arrivalWindowMs);
  });
  drainDeadline=setTimeout(()=>fail(Error('Comparison queue did not drain within the declared 180 seconds after arrivals')),profile.arrivalWindowMs+profile.maxDrainMs);
  await producer;await lane;clearTimeout(drainDeadline);stop();await foreground;if(firstFailure)throw firstFailure;
  const processingElapsedMs=performance.now()-started,cpuObserved=cpu.stop();sample();
  assert.equal(requests.length,profile.requests);assert.equal(completed,profile.requests);assert.equal(waiting,0);assert.equal(running,0);assert.equal(maxRunning,1);assert.equal(new Set(requests.map(item=>item.ref.id)).size,profile.requests);
  for(const start of [0,20000,40000])assert.ok(foregroundSaves.some(item=>item.atMs>=start&&item.atMs<start+20000),'Foreground edits continue throughout the arrival window');
  const verificationStarted=performance.now();
  await own(async()=>{for(const item of requests){signal.throwIfAborted();await inspectResult(f,item,expected,signal);sample();}});
  const after=await own(()=>storage(f.workspace));assert.ok(after.objects>before.objects);assert.ok(after.objectPayloadBytes>before.objectPayloadBytes);
  const unchanged=await own(()=>f.m.read(f.dataset));assert.deepEqual(unchanged,sourceDoc);
  await own(async()=>{
   const reopened=new ResearchMaterials(new Workspace(f.workspace.root,f.vault)),ref=requests[0].ref;
   assert.deepEqual(await reopened.read(ref),await f.m.read(ref));
   const tail=await reopened.comparisons.page({ref,view:'all',offset:expected.length-1,limit:1},{signal});
   assert.equal(tail.items.length,1);assert.equal(tail.next,null);assert.equal(tail.items[0].id,expected.at(-1).id);assert.equal(tail.items[0].locator.ref.revision,f.dataset.revision);
  });
  const saved=await own(()=>f.workspace.catalogue(store=>store.recordSelection([recordId])));assert.equal(saved.book.entries[0].title,foregroundSaves.at(-1).title);
  const drainMs=Math.max(0,lastCompletedAt-profile.arrivalWindowMs),completedInWindow=requests.filter(item=>item.completedMs<=profile.arrivalWindowMs).length;
  t.diagnostic(JSON.stringify({profile:'synthetic repeated exact comparisons',...profile,rowsPerRequest:expected.length,queueOwner:'bounded test-driver request lane',queueCapacity:profile.requests,offeredRequests:requests.length,offeredRequestsPerMinute:profile.requests*60000/profile.arrivalWindowMs,offeredRowsPerSecond:profile.requests*expected.length*1000/profile.arrivalWindowMs,completedInOfferWindow:completedInWindow,completed,achievedRequestsPerMinute:Math.round(completed*600000/processingElapsedMs)/10,processingElapsedMs:Math.round(processingElapsedMs),drainMs:Math.round(drainMs),maxBacklog,maxRunning,maxOfferLagMs:Math.round(Math.max(...requests.map(item=>item.offeredMs-item.scheduledMs))),maxAdmissionLagMs:Math.round(Math.max(...requests.map(item=>item.startedMs-item.offeredMs))),requests:requests.map(({ordinal,scheduledMs,offeredMs,startedMs,completedMs})=>({ordinal,scheduledMs,offeredMs:Math.round(offeredMs),startedMs:Math.round(startedMs),completedMs:Math.round(completedMs)})),foregroundSaves:foregroundSaves.map(({atMs,ms})=>({atMs,ms})),writerBatches,longestWriterMs:Math.round(longestWriterMs),verificationMs:Math.round(performance.now()-verificationStarted),storage:{before,after,objectDelta:after.objects-before.objects,objectPayloadByteDelta:after.objectPayloadBytes-before.objectPayloadBytes,databaseAllocatedByteDelta:after.databaseAllocatedBytes-before.databaseAllocatedBytes},sampledPeakHeapMiB:Math.ceil(peakHeapBytes/1048576),cpuObserved}));
  assert.ok(drainMs<=profile.maxDrainMs);assert.ok(longestWriterMs<5000,'Writer transaction exceeded the existing five-second bound');assert.ok(peakHeapBytes<profile.heapLimitBytes,'Sampled JavaScript heap exceeds the existing 512 MiB workload bound');
 }catch(error){fail(firstFailure??error);throw firstFailure;}
 finally{clearTimeout(drainDeadline);stop();if(firstFailure)controller.abort(firstFailure);await drainOwned();clearInterval(sampler);t.diagnostic(JSON.stringify({comparisonLoad:'settled',offered:requests.length,completed,waiting,running,foregroundSaves:foregroundSaves.length,cpuObserved:cpu.stop()}));}
});
