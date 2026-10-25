import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ObjectIndex} from '../src/object-index.js';
import {withMetadataBatch,withFlushedMetadataBatch,metadataBatchIndex} from '../src/metadata-batch.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {CatalogueReadCache} from '../src/catalogue-read-cache.js';
import {digest,serialize} from '../src/storage-format.js';

const key=n=>'metadata:.observanda/prefetch-fixture/'+String(n).padStart(5,'0')+'.json';
const revision=value=>digest(serialize(value));
function fixture(count=2047){
 const state=new Map(),objects=new Map(),reads={points:[],batches:[],objects:[],objectBatches:[]};let onBatch=null,onObjects=null,failWrite=false;
 const store={workspace:{root:'synthetic-index-prefetch'},encode:(_table,_id,value)=>Buffer.from(serialize(value)),decode:(_table,_id,payload)=>JSON.parse(payload.toString()),db:{
  async get(sql,id){
   if(sql==='SELECT payload FROM objects WHERE id=$1'){reads.objects.push(id);const payload=objects.get(id);return payload?{payload:Buffer.from(payload)}:undefined;}
   if(sql==="SELECT payload FROM state WHERE slot='objects'")id='objects';
   else assert.equal(sql,'SELECT payload FROM state WHERE slot=$1');
   reads.points.push(id);const payload=state.get(id);return payload?{payload:Buffer.from(payload)}:undefined;
  },
  async all(sql,slots){
   if(sql==='SELECT id,CASE WHEN octet_length(payload)<=8192 THEN payload ELSE NULL END AS payload FROM objects WHERE id=ANY($1::text[])'){
    assert.ok(slots.length<=32);reads.objectBatches.push([...slots]);onObjects?.();return slots.slice().reverse().filter(id=>objects.has(id)).map(id=>({id,payload:objects.get(id).length<=8192?Buffer.from(objects.get(id)):null}));
   }
   assert.equal(sql,'SELECT slot,payload FROM state WHERE slot=ANY($1::text[]) AND octet_length(payload)<=8192');assert.ok(slots.length<=32);
   reads.batches.push([...slots]);onBatch?.();return slots.slice().reverse().filter(slot=>state.has(slot)&&state.get(slot).length<=8192).map(slot=>({slot,payload:Buffer.from(state.get(slot))}));
  },
  async run(sql,...values){
   if(sql==='DELETE FROM objects WHERE id=ANY($1::text[])'){for(const id of values[0])objects.delete(id);return;}
   if(sql==='DELETE FROM state WHERE slot=ANY($1::text[])'){for(const id of values[0])state.delete(id);return;}
   if(failWrite&&sql.startsWith('INSERT INTO state'))throw Error('Interrupted index write');
   if(sql==="INSERT INTO state VALUES ('objects',$1) ON CONFLICT(slot) DO UPDATE SET payload=excluded.payload"){state.set('objects',values[0]);return;}
   const table=sql.startsWith('INSERT INTO state')?state:sql.startsWith('INSERT INTO objects')?objects:null;assert.ok(table,sql);
   for(let i=0;i<values.length;i+=2){if(table.has(values[i])&&!sql.includes('ON CONFLICT'))throw Object.assign(Error('Duplicate object'),{code:'23505'});table.set(values[i],Buffer.from(values[i+1]));}
  }
 }};
 for(const name of ['objectIndex','objectValue','object'])store[name]=ResearchCatalogue.prototype[name];
 const seed=new ObjectIndex(store),build=(start,end)=>{if(start===end)return null;const at=Math.floor((start+end)/2),id=key(at*2),value={original:at};objects.set(id,store.encode('object',id,value));return seed.make(id,revision(value),build(start,at),build(at+1,end));},root=build(0,count);
 for(const [slot,node] of seed.writes)state.set(slot,store.encode('state',slot,node));state.set('objects',store.encode('state','objects',{formatVersion:2,root}));
 const snapshot=()=>({state:new Map(state),objects:new Map(objects)});
 const restore=before=>{state.clear();objects.clear();for(const item of before.state)state.set(...item);for(const item of before.objects)objects.set(...item);};
 const transaction=async operation=>{const before=snapshot();try{return await operation();}catch(error){restore(before);throw error;}};
 return {store,state,objects,root,reads,snapshot,transaction,onBatch:fn=>{onBatch=fn;},onObjects:fn=>{onObjects=fn;},failWrite:value=>{failWrite=value;}};
}
async function edit(f,ids,{prefetch=false,signal,after=()=>{}}={}){
 return f.transaction(()=>withMetadataBatch(f.store,async()=>{
  const index=metadataBatchIndex(f.store);
  for(const id of ids){signal?.throwIfAborted();await f.store.object(id);const head=await index.head(),prior=await index.find(head,id),value={edited:id};await index.update(head,id,revision(value));await index.stageObject(id,f.store.encode('object',id,value),{create:!prior});}
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

test('fresh prefetch readers reuse snapshot nodes while rechecking references and bounds',async t=>{
 const f=fixture(31),cache=f.store.readCache=new CatalogueReadCache(),ids=[key(0),key(16),key(32),key(60)];
 const decode=f.store.decode;let decoded=0;
 f.store.decode=(table,id,payload)=>{if(id.startsWith('object-index:'))decoded++;return decode(table,id,payload);};
 const first=new ObjectIndex(f.store,{cacheReads:true}),head=await first.head();await first.prefetchKeys(head,ids);
 const expected=await Promise.all(ids.map(id=>first.find(head,id))),before={points:f.reads.points.length,batches:f.reads.batches.length,decoded};
 const next=new ObjectIndex(f.store,{cacheReads:true});await next.prefetchKeys(head,ids);
 assert.deepEqual(await Promise.all(ids.map(id=>next.find(head,id))),expected);
 assert.deepEqual({points:f.reads.points.length,batches:f.reads.batches.length,decoded},before,'A new reader must reuse authenticated nodes in its snapshot');
 for(const changed of [{height:head.root.height+1},{count:head.root.count+1},{hash:'0'.repeat(64)}])await assert.rejects(new ObjectIndex(f.store,{cacheReads:true}).prefetchKeys({root:{...head.root,...changed}},ids),{code:'CATALOGUE_DAMAGED'});
 const controller=new AbortController();controller.abort();await assert.rejects(new ObjectIndex(f.store,{cacheReads:true}).prefetchKeys(head,ids,{signal:controller.signal}),{name:'AbortError'});
 assert.ok(cache.nodes.size<=cache.maxRows);assert.ok(cache.nodeBytes<=cache.maxBytes);
 cache.clear();f.state.set(first.slot(head.root),Buffer.from(serialize({corrupt:true})));
 await assert.rejects(new ObjectIndex(f.store,{cacheReads:true}).prefetchKeys(head,ids),{code:'CATALOGUE_DAMAGED'});
 const unordered=fixture(0);unordered.store.readCache=new CatalogueReadCache();
 const writer=new ObjectIndex(unordered.store),left=writer.make('z','1'.repeat(64)),root=writer.make('m','1'.repeat(64),left);
 for(const [slot,node] of writer.writes)unordered.state.set(slot,Buffer.from(serialize(node)));
 const warm=new ObjectIndex(unordered.store,{cacheReads:true});await warm.node(root);await warm.node(left);
 await assert.rejects(new ObjectIndex(unordered.store,{cacheReads:true}).prefetchKeys({root},['a']),{code:'CATALOGUE_DAMAGED'});
 t.diagnostic(JSON.stringify({firstRead:before,repeatedRead:{points:0,batches:0,decoded:0}}));
});

test('cancellation during snapshot reuse stops a mixed frontier before its cold batch read',async()=>{
 const f=fixture(7);f.store.readCache=new CatalogueReadCache();
 const warm=new ObjectIndex(f.store,{cacheReads:true}),head=await warm.head(),root=await warm.node(head.root);await warm.node(root.right);
 const reader=new ObjectIndex(f.store,{cacheReads:true}),node=reader.node,controller=new AbortController();
 reader.node=async function(ref,...bounds){const value=await node.call(this,ref,...bounds);if(ref.hash===root.right.hash)controller.abort();return value;};
 const before={points:f.reads.points.length,batches:f.reads.batches.length};
 await assert.rejects(reader.prefetchKeys(head,[key(0),key(12)],{signal:controller.signal}),{name:'AbortError'});
 assert.deepEqual({points:f.reads.points.length,batches:f.reads.batches.length},before);
});

test('successive spread key windows retain useful shared paths within the same cache limits',async t=>{
 const measure=async reset=>{
  const f=fixture(2047),cache=f.store.readCache=new CatalogueReadCache(),decode=f.store.decode;let decoded=0;
  f.store.decode=(table,id,payload)=>{if(id.startsWith('object-index:'))decoded++;return decode(table,id,payload);};
  for(let window=0;window<6;window++){
   if(reset)cache.clear();const reader=new ObjectIndex(f.store,{cacheReads:true,cacheSize:2048}),head=await reader.head(),indices=Array.from({length:32},(_,i)=>i*63+window),ids=indices.map(i=>key(i*2));
   await reader.prefetchKeys(head,ids);
   for(let i=0;i<ids.length;i++){const value=await reader.find(head,ids[i]);assert.equal(value.id,ids[i]);assert.equal(value.revision,revision({original:indices[i]}));}
   assert.ok(cache.nodes.size<=128);assert.ok(cache.nodeBytes<=256*1024);
  }
  return {batches:f.reads.batches.length,decoded};
 };
 const cold=await measure(true),shared=await measure(false);t.diagnostic(JSON.stringify({cold,shared}));
 assert.ok(shared.batches<cold.batches*.9,'Successive windows must reuse shared branches');
 assert.ok(shared.decoded<cold.decoded*.9,'Reusing local nodes must preserve useful shared authentication');
});

test('object prefetch eliminates individual presence and absence reads without bypassing object authentication',async()=>{
 const f=fixture(63),ids=Array.from({length:32},(_,i)=>key(i));let owner;
 await withMetadataBatch(f.store,async()=>{
  owner=metadataBatchIndex(f.store);assert.equal(owner.missingObjects.size,16);
  for(let repeat=0;repeat<2;repeat++)for(let i=0;i<32;i++)assert.deepEqual(await f.store.object(ids[i]),i%2?null:{original:i/2});
  assert.equal(f.reads.objects.length,0);assert.equal(f.reads.objectBatches.length,1);assert.ok(owner.objectReads.bytes<=256*1024);
 },{prefetchIds:ids});
 assert.equal(owner.missingObjects.size,0);assert.equal(owner.objectReads.rows.size,0);
 f.objects.set(key(0),Buffer.from(serialize({altered:true})));
 await assert.rejects(withMetadataBatch(f.store,()=>f.store.object(key(0)),{prefetchIds:[key(0)]}),{code:'CATALOGUE_DAMAGED'});
 f.objects.delete(key(2));await assert.rejects(withMetadataBatch(f.store,()=>f.store.object(key(2)),{prefetchIds:[key(2)]}),{code:'CATALOGUE_DAMAGED'});
});

test('large existing object payloads fall back, while stray small and large objects still fail reads and creates',async()=>{
 const f=fixture(31),id=key(0),value={large:'x'.repeat(9000)};
 await f.transaction(()=>withMetadataBatch(f.store,async()=>{const index=metadataBatchIndex(f.store);await index.update(await index.head(),id,revision(value));await index.stageObject(id,Buffer.from(serialize(value)));}));
 await withMetadataBatch(f.store,async()=>{const index=metadataBatchIndex(f.store);assert.equal(index.missingObjects.has(id),false);assert.deepEqual(await f.store.object(id),value);},{prefetchIds:[id]});assert.deepEqual(f.reads.objects,[id]);
 for(const bytes of [20,9000]){
  const stray=key(1),payload=Buffer.from(serialize({stray:'x'.repeat(bytes)}));f.objects.set(stray,payload);const before=f.snapshot();
  await assert.rejects(withMetadataBatch(f.store,()=>f.store.object(stray),{prefetchIds:[stray]}),{code:'CATALOGUE_DAMAGED'});
  // putObject creates still use plain INSERT even without a preceding read.
  await assert.rejects(f.transaction(()=>withMetadataBatch(f.store,async()=>{const index=metadataBatchIndex(f.store),replacement={replacement:true};await index.update(await index.head(),stray,revision(replacement));await index.stageObject(stray,Buffer.from(serialize(replacement)),{create:true});},{prefetchIds:[stray]})),{code:'CATALOGUE_DAMAGED'});
  assert.deepEqual(f.snapshot(),before);f.objects.delete(stray);
 }
});

test('object prefetch preserves pending creates, updates and deletes through nested batches and flushes',async()=>{
 const f=fixture(31),created=key(1),changed=key(0),removed=key(2),first={created:true},second={changed:true};
 await f.transaction(()=>withMetadataBatch(f.store,async()=>{
  const index=metadataBatchIndex(f.store);
  for(const [id,value] of [[created,first],[changed,second],[removed,null]]){const head=await index.head(),prior=await index.find(head,id);await index.update(head,id,value===null?null:revision(value));await index.stageObject(id,value===null?null:Buffer.from(serialize(value)),{create:!prior});}
  assert.equal(index.missingObjects.has(created),false);
  const queries=f.reads.objectBatches.length;
  await withMetadataBatch(f.store,async()=>{assert.deepEqual(await f.store.object(created),first);assert.deepEqual(await f.store.object(changed),second);assert.equal(await f.store.object(removed),null);},{prefetchIds:[created,changed,removed]});
  assert.equal(f.reads.objectBatches.length,queries,'Pending values take precedence over stored payloads');
  await index.flushObjects();assert.deepEqual(await f.store.object(created),first);assert.deepEqual(await f.store.object(changed),second);assert.equal(await f.store.object(removed),null);
 },{prefetchIds:[created,changed,removed]}));
 assert.deepEqual(await f.store.object(created),first);assert.equal(await f.store.object(removed),null);
});

test('missing proofs are bounded and discarded at handoff, cancellation and failed writes',async()=>{
 const f=fixture(127),ids=Array.from({length:32},(_,i)=>key(i*2+1));let owner;
 await withMetadataBatch(f.store,async()=>{
  owner=metadataBatchIndex(f.store);assert.equal(owner.missingObjects.size,32);
  await owner.prefetchObjects([key(101)]);assert.equal(owner.missingObjects.size,32);assert.equal(owner.missingObjects.has(ids[0]),false);
  assert.equal(await f.store.object(ids[0]),null);assert.deepEqual(f.reads.objects,[ids[0]],'Evicted misses use the ordinary read');
  await withFlushedMetadataBatch(f.store,async()=>{assert.equal(owner.missingObjects.size,0);f.objects.set(ids[1],Buffer.from(serialize({stray:true})));});
  await assert.rejects(f.store.object(ids[1]),{code:'CATALOGUE_DAMAGED'});f.objects.delete(ids[1]);
 },{prefetchIds:ids});
 const controller=new AbortController(),before=f.snapshot();f.onObjects(()=>controller.abort());
 await assert.rejects(edit(f,ids,{prefetch:true,signal:controller.signal}),{name:'AbortError'});assert.deepEqual(f.snapshot(),before);f.onObjects(null);
 f.failWrite(true);await assert.rejects(edit(f,ids,{prefetch:true}),/Interrupted index write/);assert.deepEqual(f.snapshot(),before);f.failWrite(false);
 await edit(f,ids,{prefetch:true});for(const id of ids)assert.deepEqual(await f.store.object(id),{edited:id});
});
