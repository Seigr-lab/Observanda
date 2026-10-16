import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withScratch} from '../src/scratch-work.js';
import {scratchDatabase} from '../src/postgres.js';

for(const count of [4096,16384])test('verification queue seeks past '+count+' completed items',async t=>{
 const observer=await scratchDatabase(),prototype=Object.getPrototypeOf(observer),run=prototype.run;
 let takes=0,plan;
 const spy=t.mock.method(prototype,'run',async function(sql,...values){
  if(sql.startsWith('SELECT key,payload')&&sql.includes('ORDER BY ordinal')&&++takes===count){
   const explained=await run.call(this,'EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+sql,...values);
   plan=explained.rows[0]['QUERY PLAN'][0].Plan;
  }
  return run.call(this,sql,...values);
 });
 try{
  await withScratch(async work=>{
   for(let start=0;start<count;start+=32)await work.putMany(Array.from({length:32},(_,offset)=>[String(start+offset),{index:start+offset}]));
   for(let index=0;index<count;index++)assert.deepEqual(await work.take(),{index});
   assert.equal(await work.take(),undefined);
   assert.equal(await work.add('0',{duplicate:true}),false,'Visited evidence must remain deduplicated');
  });
  assert.ok(plan,'The actual dequeue query must be measured');
  const blocks=(plan['Local Hit Blocks']??0)+(plan['Local Read Blocks']??0);
  t.diagnostic(JSON.stringify({completedPrefix:count-1,blocks}));
  assert.ok(blocks<64,'One remaining item must use a bounded index lookup; inspected '+blocks+' local database blocks');
 }finally{spy.mock.restore();await observer.close();}
});


test('reviving consumed work preserves original order across single, batched and grouped updates',async()=>{
 await withScratch(async work=>{
  await work.putMany(Array.from({length:5},(_,index)=>[String(index),index]));
  for(let index=0;index<3;index++)assert.equal(await work.take(),index);
  await work.putMany([['1','one again'],['2','two again'],['new','new']]);
  assert.equal(await work.take(),'one again');assert.equal(await work.take(),'two again');assert.equal(await work.take(),3);
  await work.put('0','zero again');assert.equal(await work.take(),'zero again');
  await work.putGrouped('group','id','grouped');
  assert.equal(await work.take(),4);assert.equal(await work.take(),'new');assert.equal(await work.take(),'grouped');assert.equal(await work.take(),undefined);
  await work.putGrouped('group','id','grouped again');assert.equal(await work.take(),'grouped again');
  assert.equal(await work.add('1','duplicate'),false);assert.equal(await work.take(),undefined);
  await work.remove('0');assert.equal(await work.add('0','new identity position'),true);assert.equal(await work.take(),'new identity position');
  await work.clear();await work.put('fresh','after reset');assert.equal(await work.take(),'after reset');assert.equal(await work.take(),undefined);
 });
});

test('queue positions remain exact beyond JavaScript safe integers',async t=>{
 const observer=await scratchDatabase(),prototype=Object.getPrototypeOf(observer),run=prototype.run;
 const spy=t.mock.method(prototype,'run',async function(sql,...values){
  const result=await run.call(this,sql,...values),created=/^CREATE TEMP TABLE (obs_work_[a-f0-9]+) /.exec(sql);
  if(created)await run.call(this,"SELECT setval(pg_get_serial_sequence($1,'ordinal'),$2::bigint,false)",'pg_temp.'+created[1],'9007199254740995');
  return result;
 });
 try{await withScratch(async work=>{
  await work.putMany([['a','first'],['b','second'],['c','third']]);
  assert.equal(await work.take(),'first');assert.equal(await work.take(),'second');
  await work.put('a','first again');assert.equal(await work.take(),'first again');assert.equal(await work.take(),'third');assert.equal(await work.take(),undefined);
 });}finally{spy.mock.restore();await observer.close();}
});
