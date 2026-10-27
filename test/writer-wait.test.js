import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {requestWriterWait,waitForWriter,queuedWriter} from '../src/writer-wait.js';
import {JobWorker} from '../src/jobs.js';

function connection(){
 const req={waitForWriter:true,checkWriter:async()=>{},socket:{timeout:60000,destroyed:false,setTimeout(){}}},res=new EventEmitter();res.setTimeout=()=>{};res.writableEnded=false;
 return {req,res};
}
test('a disconnect during lock acquisition is checked before the mutation is admitted',async()=>{
 const {req,res}=connection();let mutated=false,acquired=false;
 await assert.rejects(requestWriterWait(req,res,async()=>{
  await queuedWriter('disconnected',async()=>{await waitForWriter(async()=>{acquired=true;res.emit('close');});mutated=true;});
 }),{code:'WRITE_CANCELLED'});
 assert.ok(acquired);assert.equal(mutated,false);
});

test('cancelled queue positions are removed before opening a database connection',async()=>{
 const first=connection(),second=connection(),third=connection();let release,entered;const gate=new Promise(resolve=>release=resolve),ready=new Promise(resolve=>entered=resolve),order=[];
 const active=requestWriterWait(first.req,first.res,()=>queuedWriter('queue',async()=>{order.push('first');entered();await gate;}));await ready;
 const cancelled=requestWriterWait(second.req,second.res,()=>queuedWriter('queue',async()=>order.push('cancelled'))),rejected=assert.rejects(cancelled,{code:'WRITE_CANCELLED'});
 const last=requestWriterWait(third.req,third.res,()=>queuedWriter('queue',async()=>order.push('third')));
 second.res.emit('close');await rejected;release();await Promise.all([active,last]);assert.deepEqual(order,['first','third']);
});

test('background jobs own their retry lifetime independently of the initiating HTTP request',async()=>{
 const {req,res}=connection();let checks=0,attempts=0;req.checkWriter=async()=>checks++;
 const worker=new JobWorker({claim:()=>waitForWriter(async()=>{attempts++;throw Object.assign(Error('busy'),{code:'LOCKED'});})});
 await requestWriterWait(req,res,async()=>{worker.enabled=true;worker.tick();worker.enabled=false;await worker.running;});
 assert.equal(checks,0);assert.equal(attempts,1);
});

test('foreground lock waits expire before entering the mutation and do not time out admitted work',async()=>{
 const {req,res}=connection();let mutated=false;
 await assert.rejects(requestWriterWait(req,res,async()=>{await waitForWriter(async()=>{throw Object.assign(Error(),{code:'LOCKED'});});mutated=true;},{waitMs:20}),{code:'WORKLOAD_BUSY'});assert.equal(mutated,false);
 await requestWriterWait(req,res,async()=>{await waitForWriter(async()=>{});await new Promise(resolve=>setTimeout(resolve,30));mutated=true;},{waitMs:20});assert.equal(mutated,true);
});
