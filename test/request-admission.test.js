import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {RequestAdmission,requestLane} from '../src/request-admission.js';
import {jsonBody} from '../src/request-body.js';
import {WriterAdmission} from '../src/writer-admission.js';

test('request saturation bounds queues and retained bytes while reserving control capacity',async()=>{
 const pool=new RequestAdmission({active:1,queued:1,controlActive:1,controlQueued:0,bytes:128,controlBytes:16}),a=await pool.acquire('work');a.retain(128);
 assert.throws(()=>a.retain(129),{code:'WORKLOAD_BUSY'});
 const waiting=pool.acquire('work');assert.throws(()=>pool.acquire('work'),{code:'WORKLOAD_BUSY'});
 const control=await pool.acquire('control');control.retain(16);assert.throws(()=>pool.acquire('control'),{code:'WORKLOAD_BUSY'});
 a.release();a.release();const next=await waiting;next.retain(128);assert.equal(pool.stats().work.active,1);assert.equal(pool.stats().control.retainedBytes,16);
 next.release();control.release();assert.equal(pool.stats().work.retainedBytes,0);assert.equal(pool.stats().control.active,0);
 assert.equal(requestLane('POST','/api/publication-jobs/cancel'),'control');assert.equal(requestLane('POST','/api/publication-jobs/start'),'work');assert.equal(requestLane('POST','/api/untrusted/cancel'),'work');
 assert.equal(requestLane('POST','/api/session'),'bootstrap');
 assert.equal(requestLane('POST','/api/projects/00000000-0000-4000-8000-000000000001/lab-books/00000000-0000-4000-8000-000000000002/research/materials/cancel-job'),'control');
});
test('admission expiry, disconnect and shutdown remove waiting requests without cancelling admitted work',async()=>{
 const pool=new RequestAdmission({active:1,queued:2,waitMs:20}),a=await pool.acquire('work'),abort=new AbortController();
 const cancelled=pool.acquire('work',{signal:abort.signal}),check=assert.rejects(cancelled,{name:'AbortError'});abort.abort();await check;
 await assert.rejects(pool.acquire('work'),{code:'WORKLOAD_BUSY'});assert.equal(pool.stats().work.queued,0);
 const stopped=pool.acquire('work'),stopping=assert.rejects(stopped,{code:'SERVER_CLOSING'});pool.close();await stopping;assert.equal(pool.stats().work.active,1);a.retain(12);a.release();assert.equal(pool.stats().work.active,0);
 assert.throws(()=>pool.acquire('work'),{code:'SERVER_CLOSING'});
});
test('JSON intake accounts for declared and chunked input before parsing and bounds stalled reception',async()=>{
 const pool=new RequestAdmission({bytes:32}),ticket=await pool.acquire('work');
 const request=(headers={})=>Object.assign(new PassThrough(),{headers:{'content-type':'application/json',...headers}});
 const declared=request({'content-length':'33'});assert.throws(()=>jsonBody(declared,{limit:100,retain:ticket.retain}),{code:'WORKLOAD_BUSY'});assert.equal(pool.stats().work.retainedBytes,0);
 const chunked=request(),reading=jsonBody(chunked,{limit:100,retain:ticket.retain});chunked.write('{"a":"');chunked.write('x'.repeat(30));await assert.rejects(reading,{code:'WORKLOAD_BUSY'});assert.equal(chunked.isPaused(),true);assert.equal(chunked.listenerCount('data'),0);ticket.release();
 const stalled=request();await assert.rejects(jsonBody(stalled,{limit:100,idleMs:15,totalMs:30}),{code:'REQUEST_TIMEOUT'});assert.equal(stalled.listenerCount('data'),0);
 const valid=request(),parsed=jsonBody(valid,{limit:100});valid.end('{"text":"ok"}');assert.deepEqual(await parsed,{text:'ok'});
});
test('writer queues enforce both aggregate and per-owner waiting limits and release expired tickets',async()=>{
 const pool=new WriterAdmission({perOwner:1,maxQueued:2,waitMs:40}),a=await pool.acquire('a'),b=await pool.acquire('b'),c=await pool.acquire('c');
 const aw=pool.acquire('a'),bw=pool.acquire('b'),ab=assert.rejects(aw,{code:'WORKLOAD_BUSY'}),bb=assert.rejects(bw,{code:'WORKLOAD_BUSY'});
 assert.throws(()=>pool.acquire('a'),{code:'WORKLOAD_BUSY'});assert.throws(()=>pool.acquire('c'),{code:'WORKLOAD_BUSY'});await Promise.all([ab,bb]);assert.equal(pool.stats().queued,0);
 const next=pool.acquire('a');a();const release=await next;release();b();c();assert.equal(pool.stats().activeOwners,0);
});
