import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NativeMediaAdmission} from '../src/native-media-admission.js';
import {defaultMediaPolicy,effectiveMediaPolicy} from '../src/media-policy.js';

test('media defaults and older zero policies retain finite limits and explicit larger choices',()=>{
 const defaults=defaultMediaPolicy();assert.ok(Object.values(defaults).every(value=>Number.isSafeInteger(value)&&value>0));
 const older=Object.fromEntries(Object.keys(defaults).map(key=>[key,0]));assert.deepEqual(effectiveMediaPolicy(older),defaults);
 assert.equal(effectiveMediaPolicy({...older,maxUploadBytes:2*defaults.maxUploadBytes}).maxUploadBytes,2*defaults.maxUploadBytes);
 assert.throws(()=>effectiveMediaPolicy({...older,maxImagePixels:Infinity}),{code:'INVALID'});
});
test('native media admission shares process and memory budgets, retains a host reserve and removes cancelled work',async()=>{
 let free=1000;const pool=new NativeMediaAdmission({active:2,queued:1,memoryBytes:400,reserveBytes:100,available:()=>free,waitMs:30}),a=await pool.acquire(200),b=await pool.acquire(200),abort=new AbortController();
 const waiting=pool.acquire(100,{signal:abort.signal}),cancelled=assert.rejects(waiting,{name:'AbortError'});assert.throws(()=>pool.acquire(100),{code:'WORKLOAD_BUSY'});abort.abort();await cancelled;
 assert.equal(pool.stats().active,2);assert.equal(pool.stats().reservedBytes,400);a();b();assert.equal(pool.stats().reservedBytes,0);
 free=200;assert.throws(()=>pool.acquire(200),{code:'WORKLOAD_BUSY'});assert.throws(()=>pool.acquire(401),{code:'MEDIA_RESOURCE_LIMIT'});
 free=1000;const c=await pool.acquire(400);await assert.rejects(pool.acquire(100),{code:'WORKLOAD_BUSY'});c();assert.equal(pool.stats().queued,0);
});
