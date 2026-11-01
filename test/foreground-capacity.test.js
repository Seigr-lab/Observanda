import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseAdmission} from '../src/database-admission.js';
import {NativeResourceBudget} from '../src/native-resource-budget.js';
import {NativeMediaAdmission} from '../src/native-media-admission.js';
import {withWorkloadPriority,workloadPriority} from '../src/workload-priority.js';
import {JobWorker} from '../src/jobs.js';

test('background database load leaves an interactive slot and cannot block it at the queue head',async()=>{
 const gate=new DatabaseAdmission({limit:3,globalLimit:8,foregroundReserve:1,globalForegroundReserve:2}),background=[];
 for(let i=0;i<2;i++)background.push(await gate.acquire('owner',{priority:'background'}));
 let started=false;const pending=gate.acquire('owner',{priority:'background'}).then(ticket=>{started=true;return ticket;});
 const interactive=await gate.acquire('owner');assert.equal(started,false);assert.equal(gate.stats().admitted,3);interactive.release();
 const another=await gate.acquire('owner');assert.equal(started,false);background.pop().release();const admitted=await pending;assert.equal(started,true);
 admitted.release();another.release();background.pop().release();assert.equal(gate.stats().background,0);assert.equal(gate.stats().owners,0);
});

test('eligible background work gets a bounded turn during a stream of interactive database requests',async()=>{
 const gate=new DatabaseAdmission({limit:1,globalLimit:8,foregroundReserve:0}),held=await gate.acquire('owner'),order=[];
 const take=(label,priority)=>gate.acquire('owner',{priority}).then(ticket=>{order.push(label);ticket.release();});
 const queued=[take('background','background'),...Array.from({length:6},(_,i)=>take('foreground-'+i,'foreground'))];held.release();await Promise.all(queued);
 assert.deepEqual(order,['foreground-0','foreground-1','foreground-2','foreground-3','background','foreground-4','foreground-5']);assert.equal(gate.stats().queued,0);
});

test('global runtime and memory reserves survive uncertain background exits',()=>{
 const budget=new NativeResourceBudget({memoryBytes:1000,runtimeLimit:4,reserveBytes:1,interactiveMemoryBytes:250,interactiveRuntimes:1,available:()=>10000}),held=[];
 for(let i=0;i<3;i++)held.push(budget.reserve('database',100,{key:'runtime-'+i,priority:'background'}));
 assert.throws(()=>budget.reserve('database',1,{priority:'background'}),{code:'WORKLOAD_BUSY'});const interactive=budget.reserve('database',100);interactive.release();
 const media=budget.reserve('media',450,{priority:'background'});assert.throws(()=>budget.reserve('buffer',1,{priority:'background'}),{code:'WORKLOAD_BUSY'});const buffer=budget.reserve('buffer',250);
 held[0].uncertainExit();assert.equal(budget.stats().backgroundRuntimes,3);const recovered=budget.reserve('database',100,{key:'runtime-0'});recovered.confirmed();recovered.release();held[1].release();held[2].release();media.release();buffer.release();assert.equal(budget.stats().reservedBytes,0);assert.equal(budget.stats().backgroundBytes,0);
});

test('queued media retains its workload class and leaves interactive conversion capacity',async()=>{
 const budget=new NativeResourceBudget({memoryBytes:1000,runtimeLimit:4,reserveBytes:1,available:()=>10000}),gate=new NativeMediaAdmission({active:2,foregroundSlots:1,queued:3,memoryBytes:1000,reserveBytes:1,available:()=>10000,budget});
 const first=await withWorkloadPriority('background',()=>gate.acquire(100));let started=false;
 const pending=withWorkloadPriority('background',()=>gate.acquire(100)).then(release=>{started=true;return release;});
 const interactive=await gate.acquire(100);assert.equal(started,false);assert.equal(gate.stats().background,1);interactive();assert.equal(started,false);
 first();const second=await pending;assert.equal(gate.stats().background,1);assert.equal(budget.stats().backgroundBytes,100);second();assert.equal(budget.stats().reservedBytes,0);assert.equal(workloadPriority(),'foreground');
});

test('job preparation uses background capacity while lease and checkpoint writes stay interactive',async()=>{
 const seen=[],job={id:'job',lease:{token:'lease'}},heartbeat=Promise.withResolvers();
 const mark=phase=>seen.push([phase,workloadPriority()]);
 const queue={leaseMs:300,claim:async()=>job,held:async()=>({job}),
  checkpoint:async(_id,_token,operation)=>{mark('checkpoint');return operation();},
  pulse:async(_id,_token,progress)=>{mark(progress?'progress':'heartbeat');if(!progress)heartbeat.resolve();},
  complete:async(_id,_token,prepared,{beforeCommit})=>{mark('complete');assert.equal(prepared,'ready');await beforeCommit();},
  release:async(_id,_token,{error})=>{throw error;},
  definition:()=>({prepare:async(_job,{write,progress})=>{mark('prepare');await write(async()=>mark('write'));mark('after-write');await progress({stage:'preparing',done:1,total:2});await heartbeat.promise;mark('after-heartbeat');return 'ready';}})
 };
 const worker=new JobWorker(queue);worker.enabled=true;
 // JobProgress intentionally unrefs its timer; retain the test until the first heartbeat.
 const timeout=setTimeout(()=>heartbeat.reject(new Error('HEARTBEAT_TIMEOUT')),2000);
 try{await worker.runOnce();}finally{clearTimeout(timeout);await worker.stop();}
 for(const phase of ['prepare','after-write','after-heartbeat'])assert.ok(seen.some(([name,priority])=>name===phase&&priority==='background'),phase);
 for(const phase of ['checkpoint','write','progress','heartbeat','complete'])assert.ok(seen.some(([name,priority])=>name===phase&&priority==='foreground'),phase);
 assert.equal(workloadPriority(),'foreground');
});
