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
