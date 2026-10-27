import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JobWorker} from '../src/jobs.js';
import {ProjectRuntimePool} from '../src/project-runtime-pool.js';

test('empty workers back off within a finite cross-process discovery interval',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let claims=0;
 const worker=new JobWorker({claim:async()=>{claims++;return null;}},{pollMs:1000,maxIdlePollMs:30000,random:()=>0.5});t.after(()=>worker.stop());worker.enabled=true;
 const intervals=[];
 for(let i=0;i<9;i++){worker.tick();await worker.running;intervals.push(worker.status().nextPollMs);clearTimeout(worker.timer);}
 assert.deepEqual(intervals,[1000,2000,4000,8000,16000,30000,30000,30000,30000]);assert.equal(claims,9);
 worker.wake();t.mock.timers.tick(0);await worker.running;assert.equal(claims,10);assert.equal(worker.nextPollMs,1000);
});
test('local wake during an in-flight empty claim is preserved without concurrent claimers',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let release,claims=0;
 const worker=new JobWorker({claim:()=>{claims++;return new Promise(resolve=>release=resolve);}});t.after(()=>worker.stop());worker.enabled=true;worker.tick();worker.wake();worker.tick();assert.equal(claims,1);
 release(null);await worker.running;assert.equal(worker.nextPollMs,0);t.mock.timers.tick(0);assert.equal(claims,2);release(null);await worker.running;
});
test('failed claims are observable, bounded and cannot be hot-looped by repeated wakes',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let claims=0,failed=true;const observations=[];
 const worker=new JobWorker({claim:async()=>{claims++;if(failed)throw {code:'DATABASE_UNAVAILABLE'};return null;}},{pollMs:10,maxIdlePollMs:40,maxErrorPollMs:80,random:()=>0.5,observe:(event,data)=>observations.push({event,...data})});t.after(()=>worker.stop());worker.enabled=true;
 for(let i=0;i<5;i++){worker.tick();await worker.running;clearTimeout(worker.timer);}assert.equal(worker.nextPollMs,80);assert.equal(observations.length,5);assert.equal(observations[0].error.code,'DATABASE_UNAVAILABLE');
 worker.timer=setTimeout(()=>worker.tick(),80);for(let i=0;i<100;i++)worker.wake();t.mock.timers.tick(79);assert.equal(claims,5);failed=false;t.mock.timers.tick(1);await worker.running;assert.equal(worker.claimFailures,0);assert.equal(claims,6);
 await worker.stop();t.mock.timers.tick(10000);assert.equal(claims,6);
});

test('inactive empty owners suspend normal polling but discover external work and resume immediately on local use',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let claims=0,inactive=true,external=false;
 const worker=new JobWorker({claim:async()=>{claims++;return null;}},{inactive:()=>inactive,random:()=>1});t.after(()=>worker.stop());worker.enabled=true;
 worker.tick();await worker.running;assert.equal(worker.status().suspended,true);assert.equal(worker.nextPollMs,300000);
 t.mock.timers.tick(299999);assert.equal(claims,1);
 // A notification is optional: a durable queue is checked again even when
 // another process cannot wake this application directly.
 worker.runOnce=async()=>{claims++;const worked=external;external=false;return worked;};external=true;t.mock.timers.tick(1);await worker.running;
 assert.equal(claims,2);assert.equal(worker.nextPollMs,0);assert.equal(external,false);
 clearTimeout(worker.timer);worker.tick();await worker.running;assert.equal(worker.nextPollMs,300000);
 inactive=false;worker.wake();t.mock.timers.tick(0);await worker.running;assert.equal(worker.status().suspended,false);assert.equal(worker.nextPollMs,1200);
 await worker.stop();t.mock.timers.tick(300000);assert.equal(claims,4);
});

test('fifty inactive owner workers let idle runtimes expire between bounded discovery checks',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let claims=0;
 const pool=new ProjectRuntimePool({close:async()=>{},idleMs:60000,maxIdle:2}),workers=[];
 t.after(async()=>{await Promise.all(workers.map(worker=>worker.stop()));await pool.closeAll();});
 for(let index=0;index<50;index++){
  const worker=new JobWorker({claim:async()=>{claims++;const lease=await pool.acquire(String(index),async()=>({}));lease.release();return null;}},{inactive:()=>true,random:()=>1});workers.push(worker);worker.enabled=true;worker.tick();await worker.running;
 }
 t.mock.timers.tick(60000);await Promise.resolve();await Promise.resolve();assert.equal(pool.stats().open,0);
 t.mock.timers.tick(239999);assert.equal(claims,50);assert.equal(pool.stats().open,0);
 t.mock.timers.tick(1);await Promise.all(workers.map(worker=>worker.running));assert.equal(claims,100);
 await Promise.all(workers.map(worker=>worker.stop()));await pool.closeAll();assert.equal(pool.stats().open,0);
});
