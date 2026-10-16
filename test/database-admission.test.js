import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {DatabaseAdmission} from '../src/database-admission.js';

test('database admission is FIFO within an endpoint and independent across endpoints',async()=>{
 const gate=new DatabaseAdmission({limit:1}),first=await gate.acquire('a'),order=[];
 const second=gate.acquire('a').then(value=>{order.push(2);return value;}),third=gate.acquire('a').then(value=>{order.push(3);return value;});
 const sibling=await gate.acquire('b');assert.deepEqual(order,[]);assert.equal(gate.stats().owners,2);sibling.release();
 first.release();const held=await second;assert.deepEqual(order,[2]);held.release();(await third).release();assert.deepEqual(order,[2,3]);assert.equal(gate.stats().owners,0);
});
test('an admitted operation retains reserved auxiliary capacity while new requests wait',async()=>{
 const gate=new DatabaseAdmission({limit:1}),first=await gate.acquire('a');let started=false;
 const queued=gate.acquire('a').then(value=>{started=true;return value;});const release=first.auxiliary();
 assert.throws(()=>first.auxiliary(),{code:'DATABASE_BUSY'});first.release();await delay(5);assert.equal(started,false);release();release();(await queued).release();assert.equal(gate.stats().admitted,0);
});
test('cancelled and expired admission leave no queue entry or reserved capacity',async()=>{
 const gate=new DatabaseAdmission({limit:1,maxQueued:2,waitMs:30}),first=await gate.acquire('a'),controller=new AbortController();
 const pending=gate.acquire('a',{signal:controller.signal}),cancelled=assert.rejects(pending,{name:'AbortError'});controller.abort();await cancelled;
 await assert.rejects(gate.acquire('a'),{code:'DATABASE_BUSY'});assert.equal(gate.stats().queued,0);
 first.release();assert.equal(gate.stats().owners,0);assert.throws(()=>gate.acquire('a',{signal:controller.signal}),{name:'AbortError'});assert.equal(gate.stats().owners,0);
});
test('queue length is bounded and double releases cannot over-admit work',async()=>{
 const gate=new DatabaseAdmission({limit:1,maxQueued:1}),first=await gate.acquire('a'),pending=gate.acquire('a');
 assert.throws(()=>gate.acquire('a'),{code:'DATABASE_BUSY'});first.release();first.release();const second=await pending;assert.equal(gate.stats().admitted,1);second.release();assert.equal(gate.stats().owners,0);
});
