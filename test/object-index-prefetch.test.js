import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ObjectIndex} from '../src/object-index.js';
import {withMetadataBatch,metadataBatchIndex} from '../src/metadata-batch.js';
import {digest,serialize} from '../src/storage-format.js';

const key=n=>'metadata:.observanda/prefetch-fixture/'+String(n).padStart(5,'0')+'.json';
const revision=value=>digest(serialize(value));
function fixture(count=2047){
 const state=new Map(),objects=new Map(),reads={points:[],batches:[]};let onBatch=null,failWrite=false;
 const store={workspace:{root:'synthetic-index-prefetch'},encode:(_table,_id,value)=>Buffer.from(serialize(value)),decode:(_table,_id,payload)=>JSON.parse(payload.toString()),db:{
  async get(sql,id){
   if(sql==="SELECT payload FROM state WHERE slot='objects'")id='objects';
   else assert.equal(sql,'SELECT payload FROM state WHERE slot=$1');
   reads.points.push(id);const payload=state.get(id);return payload?{payload:Buffer.from(payload)}:undefined;
  },
  async all(sql,slots){
   assert.equal(sql,'SELECT slot,payload FROM state WHERE slot=ANY($1::text[]) AND octet_length(payload)<=8192');assert.ok(slots.length<=32);
   reads.batches.push([...slots]);onBatch?.();return slots.slice().reverse().filter(slot=>state.has(slot)&&state.get(slot).length<=8192).map(slot=>({slot,payload:Buffer.from(state.get(slot))}));
  },
  async run(sql,...values){
   if(failWrite&&sql.startsWith('INSERT INTO state'))throw Error('Interrupted index write');
   if(sql==="INSERT INTO state VALUES ('objects',$1) ON CONFLICT(slot) DO UPDATE SET payload=excluded.payload"){state.set('objects',values[0]);return;}
   const table=sql.startsWith('INSERT INTO state')?state:sql.startsWith('INSERT INTO objects')?objects:null;assert.ok(table,sql);
   for(let i=0;i<values.length;i+=2){if(table.has(values[i])&&!sql.includes('ON CONFLICT'))throw Object.assign(Error('Duplicate object'),{code:'23505'});table.set(values[i],Buffer.from(values[i+1]));}
  }
 }};
 const seed=new ObjectIndex(store),build=(start,end)=>{if(start===end)return null;const at=Math.floor((start+end)/2),id=key(at*2),value={original:at};objects.set(id,store.encode('object',id,value));return seed.make(id,revision(value),build(start,at),build(at+1,end));},root=build(0,count);
 for(const [slot,node] of seed.writes)state.set(slot,store.encode('state',slot,node));state.set('objects',store.encode('state','objects',{formatVersion:2,root}));
 const snapshot=()=>({state:new Map(state),objects:new Map(objects)});
 const restore=before=>{state.clear();objects.clear();for(const item of before.state)state.set(...item);for(const item of before.objects)objects.set(...item);};
 const transaction=async operation=>{const before=snapshot();try{return await operation();}catch(error){restore(before);throw error;}};
 return {store,state,objects,root,reads,snapshot,transaction,onBatch:fn=>{onBatch=fn;},failWrite:value=>{failWrite=value;}};
}
async function edit(f,ids,{prefetch=false,signal,after=()=>{}}={}){
 return f.transaction(()=>withMetadataBatch(f.store,async()=>{
  const index=metadataBatchIndex(f.store);
  for(const id of ids){signal?.throwIfAborted();const head=await index.head(),prior=await index.find(head,id),value={edited:id};await index.update(head,id,revision(value));await index.stageObject(id,f.store.encode('object',id,value),{create:!prior});}
  await after(index);
 },{prefetchIds:prefetch?ids:[],signal}));
}

test('pending-key prefetch reduces cold branch round trips and preserves exact sequential writes',async()=>{
 const ordinary=fixture(),prefetched=fixture(),ids=Array.from({length:32},(_,i)=>key(i*126+1));
 await edit(ordinary,ids);await edit(prefetched,ids,{prefetch:true});
 assert.deepEqual(prefetched.snapshot(),ordinary.snapshot());
 assert.ok(prefetched.reads.points.length+prefetched.reads.batches.length<ordinary.reads.points.length/3,JSON.stringify({ordinary:ordinary.reads.points.length,prefetched:prefetched.reads.points.length,batches:prefetched.reads.batches.length}));
 assert.ok(prefetched.reads.batches.length<=prefetched.root.height);assert.ok(prefetched.reads.batches.every(slots=>slots.length<=32));
 const index=new ObjectIndex(prefetched.store),head=await index.head();for(const id of ids)assert.equal((await index.find(head,id)).revision,revision({edited:id}));
});

test('prefetch authenticates hashes, references, branch bounds and cached height/count receipts',async()=>{
 for(const corrupt of ['hash','missing','height','count','shape']){
  const f=fixture(31),index=new ObjectIndex(f.store,{cacheReads:true}),head=await index.head(),slot=index.slot(head.root);
  if(corrupt==='hash'){const node=JSON.parse(f.state.get(slot));node.revision='0'.repeat(64);f.state.set(slot,Buffer.from(serialize(node)));}
  if(corrupt==='missing')f.state.delete(slot);
  if(corrupt==='height')head.root={...head.root,height:head.root.height+1};
  if(corrupt==='count')head.root={...head.root,count:head.root.count+1};
  if(corrupt==='shape')head.root={...head.root,extra:true};
  await assert.rejects(index.prefetchKeys(head,[key(0)]),{code:'CATALOGUE_DAMAGED'});if(corrupt==='shape')assert.equal(f.reads.batches.length,0);
 }
 const f=fixture(0),writer=new ObjectIndex(f.store),left=writer.make('z','1'.repeat(64)),root=writer.make('m','1'.repeat(64),left);
 for(const [slot,node] of writer.writes)f.state.set(slot,Buffer.from(serialize(node)));
 await assert.rejects(new ObjectIndex(f.store,{cacheReads:true}).prefetchKeys({root},['a']),{code:'CATALOGUE_DAMAGED'});
 const good=fixture(31),index=new ObjectIndex(good.store,{cacheReads:true});await index.prefetchKeys({root:good.root},[key(0)]);
 await assert.rejects(index.prefetchKeys({root:{...good.root,count:good.root.count+1}},[key(0)]),{code:'CATALOGUE_DAMAGED'});
});

test('prefetch reads only selected paths, uses pending branches and falls back for oversized nodes',async()=>{
 const f=fixture(31),index=new ObjectIndex(f.store,{cacheReads:true}),head=await index.head(),right=JSON.parse(f.state.get(index.slot(head.root))).right;
 f.state.set(index.slot(right),Buffer.from('corrupted unrelated branch'));await index.prefetchKeys(head,[key(0)]);assert.equal((await index.find(head,key(0))).id,key(0));
 assert.ok(f.reads.batches.every(slots=>!slots.includes(index.slot(right))));
 const pending=fixture(31);await pending.transaction(()=>withMetadataBatch(pending.store,async()=>{
  const batch=metadataBatchIndex(pending.store),before=await batch.head();await batch.update(before,key(1),revision({new:true}));await batch.stageObject(key(1),Buffer.from(serialize({new:true})),{create:true});
  await batch.prefetchKeys(await batch.head(),[key(1),key(2)]);assert.equal((await batch.find(await batch.head(),key(1))).revision,revision({new:true}));
 }));
 const large=fixture(0),writer=new ObjectIndex(large.store),id='x'.repeat(9000),root=writer.make(id,'2'.repeat(64));for(const [slot,node] of writer.writes)large.state.set(slot,Buffer.from(serialize(node)));
 const reader=new ObjectIndex(large.store,{cacheReads:true});await reader.prefetchKeys({root},[id]);assert.equal((await reader.find({root},id)).id,id);assert.equal(large.reads.points.length,1);
});

test('prefetched transaction receipts cannot conceal later corruption, cancellation or rollback',async()=>{
 const f=fixture(127),ids=[key(1),key(63),key(127)];let old;
 await edit(f,ids,{prefetch:true,after:index=>{old=index;}});assert.equal(old.cache.size,0);assert.equal(old.pending.size,0);
 const head=JSON.parse(f.state.get('objects')),slot='object-index:'+head.root.key,original=f.state.get(slot);f.state.set(slot,Buffer.from('corrupt after commit'));
 await assert.rejects(edit(f,ids,{prefetch:true}));f.state.set(slot,original);
 for(const duringRead of [false,true]){
  const controller=new AbortController(),before=f.snapshot();let reached=false;
  if(duringRead)f.onBatch(()=>controller.abort());else controller.abort();
  await assert.rejects(edit(f,ids,{prefetch:true,signal:controller.signal,after:()=>{reached=true;}}),{name:'AbortError'});
  assert.equal(reached,false);assert.deepEqual(f.snapshot(),before);f.onBatch(null);
 }
 const before=f.snapshot();f.failWrite(true);await assert.rejects(edit(f,[key(3),key(65)],{prefetch:true}),/Interrupted index write/);assert.deepEqual(f.snapshot(),before);
 f.failWrite(false);await edit(f,[key(3),key(65)],{prefetch:true});assert.ok(f.objects.has(key(3)));
});

test('prefetch keeps read-cache bounds and rejects larger key groups without SQL',async()=>{
 const f=fixture(127),index=new ObjectIndex(f.store,{cacheReads:true,cacheSize:2}),head=await index.head(),ids=[key(0),key(64),key(126),key(252)];
 await index.prefetchKeys(head,ids);assert.ok(index.cache.size<=2);for(const id of ids)assert.equal((await index.find(head,id)).id,id);
 const before=f.reads.batches.length;await assert.rejects(index.prefetchKeys(head,Array.from({length:33},(_,i)=>key(i))),{code:'INVALID'});assert.equal(f.reads.batches.length,before);
});
