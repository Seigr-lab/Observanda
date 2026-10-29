import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withScratch,withScratchSession} from '../src/scratch-work.js';
import {withMaterialTraversal} from '../src/material-traversal.js';
import {scratchDatabase,databaseCapacity} from '../src/postgres.js';
import {randomUUID} from 'node:crypto';
import {scratchOrder} from '../src/scratch-order.js';

test('batched scratch insertion reports exact new keys without overwriting existing or consumed values',async()=>{
 await withScratch(async work=>{
  assert.deepEqual(await work.addMany([]),new Set());
  assert.deepEqual(await work.addMany([['a',{kept:true}],['b',null]]),new Set(['a','b']));
  assert.deepEqual(await work.addMany([['a',{kept:false}],['c',3]]),new Set(['c']));
  assert.deepEqual(await work.get('a'),{kept:true});assert.equal(work.size,3);
  await work.take();assert.deepEqual(await work.addMany([['a',4]]),new Set());assert.equal(work.size,3);
  await assert.rejects(work.addMany([['d',1],['d',2]]),{code:'INVALID'});
  await assert.rejects(work.addMany(Array.from({length:33},(_,i)=>[String(i),null])),{code:'INVALID'});
  assert.equal(work.size,3);
 });
});

test('bounded scratch batches preserve overwritten identities, consumed entries and missing keys',async()=>{
 await withScratch(async work=>{
  const rows=Array.from({length:32},(_,i)=>['key '+i,{id:i,private:'source '+i}]);
  await work.putMany(rows);assert.equal(work.size,32);assert.deepEqual(await work.getMany(rows.map(([id])=>id)),new Map(rows));
  await work.take();await work.putMany([['key 0',{updated:true}],['new',{new:true}]]);assert.equal(work.size,33);
  assert.deepEqual(await work.getMany(['key 0','new','missing']),new Map([['key 0',{updated:true}],['new',{new:true}]]));
  await assert.rejects(work.putMany([...rows,['overflow',{}]]),{code:'INVALID'});
  await assert.rejects(work.getMany(['new','new']),{code:'INVALID'});assert.equal(work.size,33);
  await work.removeMany(['key 0','new','missing']);assert.equal(work.size,31);assert.equal((await work.getMany(['key 0','new'])).size,0);
  await assert.rejects(work.removeMany(['key 1','key 1']),{code:'INVALID'});assert.equal(work.size,31);
 });
});

test('scratch updates retain identity and revive consumed values; encrypted sort orders shared timestamps without retaining the input',async()=>{
 await withScratch(async work=>{
  assert.equal(await work.get('unknown'),undefined);
  await work.put('one',{value:1});await work.put('one',{value:2});assert.equal(work.size,1);
  assert.deepEqual(await work.get('one'),{value:2});assert.deepEqual(await work.take(),{value:2});assert.equal(await work.get('one'),undefined);
  await work.put('one',{value:3});assert.equal(work.size,1);assert.deepEqual(await work.take(),{value:3});
  await work.clear();const sorted=scratchOrder(work,'events:');
  for(let i=649;i>=0;i--)await sorted.put(String(i).padStart(4,'0'),{i});
  await sorted.put('0003',{i:3,replaced:true});let count=0;
  for await(const value of sorted.items()){assert.equal(value.i,count++);if(value.i===3)assert.equal(value.replaced,true);}
  assert.equal(count,650);
 });
});

test('opaque grouping keeps interleaved bitmap blocks contiguous and retains exact values',async()=>{
 await withScratch(async work=>{
  for(let i=0;i<130;i++)await work.putGrouped('private group '+i%5,'private item '+i,{group:i%5,i});
  await work.putGrouped('private group 0','private item 0',{group:0,i:0,replaced:true});
  const seen=new Set(),finished=new Set();let current,count=0;
  for await(const value of work.items()){
   if(value.group!==current){if(current!==undefined)finished.add(current);assert.ok(!finished.has(value.group));current=value.group;}
   assert.ok(!seen.has(value.i));seen.add(value.i);assert.equal(value.group,value.i%5);if(value.i===0)assert.equal(value.replaced,true);count++;
  }
  assert.equal(count,130);assert.equal(work.size,130);
 });
});

test('scratch work deduplicates exactly, consumes FIFO and retains only opaque keys and encrypted pending values',async()=>{
 const db=await scratchDatabase(),prototype=Object.getPrototypeOf(db),run=prototype.run,initial=databaseCapacity().active;let observed=0;
 prototype.run=async function(sql,...args){
  if(sql.startsWith('INSERT INTO pg_temp.obs_work_')){
   assert.match(args[0],/^[a-f0-9]{64}$/);assert.ok(Buffer.isBuffer(args[1]));
   assert.ok(!args[1].includes(Buffer.from('private-body')));observed++;
  }
  return run.call(this,sql,...args);
 };
 try{await withScratch(async work=>{
  for(let i=0;i<650;i++)assert.equal(await work.add('identity '+i,{i,text:'private-body'}),true);
  assert.equal(work.size,650);assert.equal(await work.add('identity 0',{changed:true}),false);
  for(let i=0;i<650;i++)assert.deepEqual(await work.take(),{i,text:'private-body'});
  assert.equal(await work.take(),undefined);assert.equal(work.size,650);
  assert.equal(await work.add('identity 0'),false);
  assert.equal(await work.remove('identity 0'),true);assert.equal(await work.remove('identity 0'),false);assert.equal(work.size,649);
  await work.clear();assert.equal(work.size,0);assert.equal(await work.add('identity 0',{fresh:true}),true);assert.deepEqual(await work.take(),{fresh:true});
 });assert.ok(observed>=652);assert.equal(databaseCapacity().active,initial);
 }finally{prototype.run=run;await db.close();}
});

test('scratch cancellation and SQL failure close the connection and retain the original error',async()=>{
 const initial=databaseCapacity().active,controller=new AbortController();
 await assert.rejects(withScratch(async work=>{await work.add('one');controller.abort();await work.take();},{signal:controller.signal}),{name:'AbortError'});
 assert.equal(databaseCapacity().active,initial);
 const db=await scratchDatabase(),prototype=Object.getPrototypeOf(db),run=prototype.run;
 prototype.run=async function(sql,...args){if(sql.startsWith('INSERT INTO pg_temp.obs_work_'))return run.call(this,'SELECT 1/0');return run.call(this,sql,...args);};
 try{await assert.rejects(withScratch(work=>work.add('one')),{code:'22012'});}finally{prototype.run=run;await db.close();}
 assert.equal(databaseCapacity().active,initial);
});

test('audit scratch sessions reuse empty storage, isolate nested work and expire every handle',async t=>{
 const observer=await scratchDatabase(),prototype=Object.getPrototypeOf(observer),run=prototype.run,initial=databaseCapacity().active;let created=0,expired;
 const spy=t.mock.method(prototype,'run',function(sql,...values){if(sql.startsWith('CREATE TEMP TABLE obs_work_'))created++;return run.call(this,sql,...values);});
 try{
  await withScratchSession(async()=>{
   for(let i=0;i<20;i++)await withScratch(async work=>{
    assert.equal(await work.has('shared key'),false);assert.equal(work.size,0);
    await work.put('shared key',{i});assert.deepEqual(await work.get('shared key'),{i});
    if(expired)await assert.rejects(expired.remove('shared key'),{code:'INVALID'});expired=work;
    await withScratchSession(()=>withScratch(async nested=>{
     assert.equal(await nested.has('shared key'),false);await nested.put('shared key',{nested:true});
     assert.deepEqual(await work.get('shared key'),{i});
    }));
   });
   assert.equal(created,2);assert.equal(databaseCapacity().active,initial+1);
   await withScratch(a=>withScratch(b=>withScratch(async c=>{
    await a.put('same',{a:true});await b.put('same',{b:true});await c.put('same',{c:true});
    assert.deepEqual(await a.get('same'),{a:true});assert.deepEqual(await b.get('same'),{b:true});assert.deepEqual(await c.get('same'),{c:true});
   })));
   assert.equal(databaseCapacity().active,initial+1,'Idle temporary tables share one operation connection');
  });
  assert.equal(databaseCapacity().active,initial);await assert.rejects(expired.clear(),{code:'INVALID'});
  await assert.rejects(Array.fromAsync(expired.items()),{code:'INVALID'});
 }finally{spy.mock.restore();await observer.close();}
});

test('failed or cancelled pooled scratch work is closed rather than reused and session errors release idle storage',async t=>{
 const observer=await scratchDatabase(),prototype=Object.getPrototypeOf(observer),run=prototype.run,initial=databaseCapacity().active;let fail=false;
 const spy=t.mock.method(prototype,'run',function(sql,...values){if(fail&&sql.startsWith('INSERT INTO pg_temp.obs_work_')){fail=false;return run.call(this,'SELECT 1/0');}return run.call(this,sql,...values);});
 try{
  await assert.rejects(withScratchSession(async()=>{
   await withScratch(work=>work.add('initial'));
   fail=true;await assert.rejects(withScratch(work=>work.add('failure')),{code:'22012'});assert.equal(databaseCapacity().active,initial);
   const controller=new AbortController();
   await assert.rejects(withScratch(async work=>{await work.add('cancel');controller.abort();await work.take();},{signal:controller.signal}),{name:'AbortError'});
   assert.equal(databaseCapacity().active,initial);
   await withScratch(async work=>{assert.equal(await work.has('initial'),false);await work.add('fresh');});
   throw Error('Original audit failure');
  }),/Original audit failure/);
  assert.equal(databaseCapacity().active,initial);
 }finally{spy.mock.restore();await observer.close();}
});

test('deep, shared and cyclic material dependencies use constant in-process traversal state',async()=>{
 const ids=Array.from({length:6500},()=>randomUUID()),ref=i=>({kind:'collection',id:ids[i],revision:'a'.repeat(64)});let count=0;
 await withMaterialTraversal(async walk=>{
  await walk.walk([ref(0),ref(0)],async(value,enqueue)=>{
   const i=ids.indexOf(value.id);assert.equal(i,count++);if(i+1<ids.length)await enqueue(ref(i+1));if(i)await enqueue(ref(i-1));
  });
  assert.equal(count,ids.length);assert.equal(walk.size,ids.length);
  await walk.walk([ref(1)],()=>{throw Error('Repeated dependency');});
  await walk.reset();assert.equal(walk.size,0);
  await walk.walk([ref(0)],async()=>{count++;});assert.equal(walk.size,1);assert.equal(count,6501);
 });
});


test('untouched pooled scratch work creates no database tables or sequences',async t=>{
 const observer=await scratchDatabase(),prototype=Object.getPrototypeOf(observer),run=prototype.run;let created=0,resets=0;
 const spy=t.mock.method(prototype,'run',function(sql,...values){if(sql.startsWith('CREATE TEMP TABLE obs_work_'))created++;if(sql.startsWith('TRUNCATE pg_temp.obs_work_'))resets++;return run.call(this,sql,...values);});
 try{
  await withScratchSession(async()=>{
   for(let i=0;i<3;i++)await withScratch(async work=>{
    assert.equal(work.size,0);assert.equal(await work.has('missing'),false);assert.equal(await work.get('missing'),undefined);
    assert.equal(await work.take(),undefined);assert.deepEqual(await Array.fromAsync(work.items()),[]);
    assert.equal(await work.remove('missing'),false);await work.removeMany(['missing']);await work.putMany([]);
    await assert.rejects(work.putMany([['duplicate',{}],['duplicate',{}]]),{code:'INVALID'});
    await withScratchSession(()=>withScratch(async nested=>{assert.equal(await nested.take(),undefined);await nested.putMany([]);}));
   });
   assert.equal(created,0);assert.equal(resets,0);
   await withScratch(work=>work.add('written',{value:1}));assert.equal(resets,1);
   await withScratch(async work=>{assert.equal(work.size,0);assert.equal(await work.has('written'),false);});assert.equal(resets,1);
  });
 }finally{spy.mock.restore();await observer.close();}
});

test('pooled scratch writes reset consumed identities and sequences after removal or explicit clear',async t=>{
 const observer=await scratchDatabase(),prototype=Object.getPrototypeOf(observer),run=prototype.run;let resets=0,firstOrdinal;
 const spy=t.mock.method(prototype,'run',async function(sql,...values){
  if(sql.startsWith('TRUNCATE pg_temp.obs_work_'))resets++;
  const result=await run.call(this,sql,...values);
  if(sql.startsWith('INSERT INTO pg_temp.obs_work_'))firstOrdinal=(await run.call(this,'SELECT ordinal FROM '+sql.split(' ')[2]+' ORDER BY ordinal LIMIT 1')).rows[0]?.ordinal;
  return result;
 });
 const cases=[
  [async work=>{await work.add('one');assert.equal(await work.add('one'),false);await work.remove('one');assert.equal(work.size,0);},0],
  [async work=>{await work.put('one',{});await work.remove('one');assert.equal(work.size,0);},0],
  [async work=>{await work.putGrouped('group','one',{});await work.clear();assert.equal(work.size,0);},1],
  [async work=>{await work.putMany([['one',{}],['two',{}]]);await work.removeMany(['one','two']);assert.equal(work.size,0);},0],
  [async work=>{await work.add('one',{value:1});assert.deepEqual(await work.take(),{value:1});assert.equal(work.size,1);},0],
  [async work=>{await work.add('one');await work.clear();assert.equal(work.size,0);},1]
 ];
 try{
  await withScratchSession(async()=>{
   for(const [write,explicit]of cases){
    const before=resets;await withScratch(write);assert.equal(resets,before+explicit+1);
    await withScratch(async work=>{
     assert.equal(work.size,0);assert.equal(await work.has('one'),false);assert.equal(await work.take(),undefined);
     await work.add('fresh');assert.equal(String(firstOrdinal),'1','Every reused table restarts its insertion sequence');
    });
   }
  });
 }finally{spy.mock.restore();await observer.close();}
});

test('pooled scratch resets after queued insertions and caught insertion failures',async t=>{
 const observer=await scratchDatabase(),prototype=Object.getPrototypeOf(observer),run=prototype.run;let delayed,fail=false,firstOrdinal,resets=0;
 const spy=t.mock.method(prototype,'run',async function(sql,...values){
  if(sql.startsWith('TRUNCATE pg_temp.obs_work_'))resets++;
  if(sql.startsWith('INSERT INTO pg_temp.obs_work_')){
   if(delayed){const waiting=delayed;delayed=null;await waiting;}
   if(fail){fail=false;return run.call(this,sql,null,...values.slice(1));}
  }
  const result=await run.call(this,sql,...values);
  if(sql.startsWith('INSERT INTO pg_temp.obs_work_'))firstOrdinal=(await run.call(this,'SELECT ordinal FROM '+sql.split(' ')[2]+' ORDER BY ordinal LIMIT 1')).rows[0]?.ordinal;
  return result;
 });
 try{
  await withScratchSession(async()=>{
   let release,pending;delayed=new Promise(resolve=>release=resolve);
   await withScratch(work=>{pending=work.add('queued');setImmediate(release);});await pending;assert.equal(resets,1);
   await withScratch(async work=>{assert.equal(await work.has('queued'),false);await work.add('fresh');assert.equal(String(firstOrdinal),'1');});
   fail=true;await withScratch(async work=>{await assert.rejects(work.add('failed'),{code:'23502'});assert.equal(work.size,0);});assert.equal(resets,3);
   await withScratch(async work=>{await work.add('fresh');assert.equal(String(firstOrdinal),'1');});
  });
 }finally{spy.mock.restore();await observer.close();}
});
