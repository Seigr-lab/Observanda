import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {intakeFixture} from './fixtures/local-intake.js';
import {workloadPriority} from '../src/workload-priority.js';

test('job checkpoints reuse bounded background connections without borrowing the preparation snapshot',async t=>{
 const {ws,queue,worker,record}=await intakeFixture(t),open=ws.openCatalogue.bind(ws);let opened=0,closed=0,preparing=false;
 const phases=[];
 ws.openCatalogue=async options=>{const db=await open(options),close=db.close.bind(db);opened++;if(preparing)phases.push(workloadPriority());db.close=async()=>{try{return await close();}finally{closed++;}};return db;};
 await ws.withLock(()=>ws.catalogue(store=>store.putObject('checkpoint-connection-fixture',{value:0})));
 queue.definitions['test.connections']={authorize:async()=>{},prepare:async(_job,{write})=>{
  preparing=true;
  try{return await ws.withCatalogueConnections(()=>ws.catalogue(async snapshot=>{
   assert.deepEqual(await snapshot.object('checkpoint-connection-fixture'),{value:0});
   for(let i=1;i<=40;i++)await write(()=>ws.catalogue(async current=>{
    assert.deepEqual(await current.object('checkpoint-connection-fixture'),{value:i-1});await current.putObject('checkpoint-connection-fixture',{value:i});
   }));
   assert.deepEqual(await snapshot.object('checkpoint-connection-fixture'),{value:0},'Preparation keeps its original immutable snapshot');
   return {complete:true};
  }));}finally{preparing=false;}
 },commit:async(_job,prepared)=>prepared};
 const job=await queue.enqueue({id:randomUUID(),type:'test.connections',scope:record.id,input:{}});
 await worker.runOnce();assert.equal((await queue.read(job.id)).state,'completed');
 assert.deepEqual(await ws.catalogue(store=>store.object('checkpoint-connection-fixture')),{value:40});
 assert.ok(phases.length<=3,'Repeated checkpoint connection opens: '+phases.length);assert.ok(phases.length>=2);assert.ok(phases.every(value=>value==='background'));
 assert.equal(opened,closed,'Settled jobs release every admitted control connection');
});

test('short checkpoints retain their durable lease without rewriting queue indexes and still fence replacement',async t=>{
 const {ws,queue,record}=await intakeFixture(t);let clock=Date.now(),writes=0;
 queue.leaseMs=9000;queue.now=async()=>clock;
 queue.definitions['test.renewal']={authorize:async()=>{},prepare:async()=>({}),commit:async()=>({})};
 const queued=await queue.enqueue({id:randomUUID(),type:'test.renewal',scope:record.id,input:{}}),job=await queue.claim(),write=queue.write.bind(queue);
 assert.equal(job.id,queued.id);queue.write=async value=>{writes++;return write(value);};
 await ws.withCatalogueConnections(async()=>{
  for(let value=1;value<=40;value++)await queue.checkpoint(job.id,job.lease.token,()=>ws.catalogue(store=>store.putObject('checkpoint-renewal-fixture',{value})));
  assert.equal(writes,0,'Durable evidence writes do not renew a freshly held lease');
  assert.equal((await queue.held(job.id,job.lease.token)).job.lease.until,job.lease.until);
  assert.deepEqual(await ws.catalogue(store=>store.object('checkpoint-renewal-fixture')),{value:40});
  clock+=queue.leaseMs/3;
  await queue.checkpoint(job.id,job.lease.token,async()=>{});
  assert.equal(writes,1);assert.equal((await queue.read(job.id)).lease.until,clock+queue.leaseMs);
  await assert.rejects(queue.checkpoint(job.id,job.lease.token,async()=>{
   const changed=await queue.read(job.id);changed.lease.token=randomUUID();await queue.write(changed);
   await ws.catalogue(store=>store.putObject('checkpoint-renewal-fixture',{value:99}));
  }),{code:'JOB_LEASE'});
  assert.equal((await queue.held(job.id,job.lease.token)).job.lease.token,job.lease.token);
  assert.deepEqual(await ws.catalogue(store=>store.object('checkpoint-renewal-fixture')),{value:40},'Rejected replacement rolls back its evidence');
 });
});
