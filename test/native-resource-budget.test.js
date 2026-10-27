import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NativeResourceBudget} from '../src/native-resource-budget.js';
import {NativeMediaAdmission} from '../src/native-media-admission.js';

test('owner count and memory remain bounded across fifty independent launch requests',()=>{
 const budget=new NativeResourceBudget({runtimeLimit:3,memoryBytes:1000,reserveBytes:100,available:()=>2000}),held=[];
 for(let index=0;index<50;index++){
  if(index<3)held.push(budget.reserve('database',200,{key:index}));else assert.throws(()=>budget.reserve('database',200,{key:index}),{code:'WORKLOAD_BUSY'});
 }
 assert.equal(budget.stats().managedRuntimes,3);assert.equal(budget.stats().reservedBytes,600);
 for(const ticket of held)ticket.release();
 for(let index=0;index<50;index++)budget.reserve('database',200,{key:index}).release();
 assert.equal(budget.stats().managedRuntimes,0);assert.equal(budget.stats().reservedBytes,0);
});

test('uncertain process exit retains capacity until authenticated lifecycle recovery confirms stop',()=>{
 const budget=new NativeResourceBudget({runtimeLimit:1,memoryBytes:1000,reserveBytes:100,available:()=>2000}),first=budget.reserve('database',200,{key:'owner'});
 first.uncertainExit();first.release();assert.equal(budget.stats().uncertainExits,1);
 assert.throws(()=>budget.reserve('database',200,{key:'other'}),{code:'WORKLOAD_BUSY'});
 const retry=budget.reserve('database',200,{key:'owner'});assert.equal(retry.uncertain,true);
 budget.stopped('owner');assert.equal(budget.stats().managedRuntimes,1,'A claimed lifecycle still owns its reservation');
 retry.uncertainExit();budget.stopped('owner');assert.equal(budget.stats().reservedBytes,0);
});

test('converters and database runtimes share memory while changes in other applications can refuse new work',async()=>{
 let free=2000;const budget=new NativeResourceBudget({runtimeLimit:2,memoryBytes:500,reserveBytes:100,available:()=>free});
 const media=new NativeMediaAdmission({active:2,memoryBytes:500,reserveBytes:100,available:()=>free,budget}),database=budget.reserve('database',300),conversion=await media.acquire(200);
 assert.equal(budget.stats().reservedBytes,500);assert.throws(()=>budget.reserve('database',100),{code:'WORKLOAD_BUSY'});
 const next=media.acquire(100);assert.equal(media.stats().queued,1);database.release();const done=await next;
 conversion();done();assert.equal(budget.stats().reservedBytes,0);
 free=150;assert.throws(()=>budget.reserve('database',100),{code:'WORKLOAD_BUSY'});assert.throws(()=>media.acquire(100),{code:'WORKLOAD_BUSY'});
});

test('capacity pressure requests idle eviction without waiting on active owners',()=>{
 const budget=new NativeResourceBudget({runtimeLimit:1,memoryBytes:1000,reserveBytes:100,available:()=>2000});let evictions=0;
 const detach=budget.onPressure(()=>evictions++),ticket=budget.reserve('database',200);
 assert.throws(()=>budget.reserve('database',200),{code:'WORKLOAD_BUSY'});assert.equal(evictions,1);assert.equal(budget.stats().managedRuntimes,1);
 detach();assert.throws(()=>budget.reserve('database',200),{code:'WORKLOAD_BUSY'});assert.equal(evictions,1);ticket.release();
});
