import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JobWorker} from '../src/jobs.js';

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
