import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ObjectIndex} from '../src/object-index.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {CatalogueReadCache} from '../src/catalogue-read-cache.js';
import {catalogueContext} from '../src/catalogue-context.js';
import {withMetadataBatch,metadataBatchIndex} from '../src/metadata-batch.js';
import {digest,serialize} from '../src/storage-format.js';

const hash=value=>digest(serialize(value));
function fixture(options){
 const state=new Map(),objects=new Map(),workspace={root:'synthetic-head-reader',vault:{id:'synthetic-vault',key:Buffer.alloc(32,7)}},cache=new CatalogueReadCache(options);
 let headReads=0,headDecodes=0,emptyChecks=0;
 const db={
  async get(sql,id){
   if(sql.startsWith('SELECT 1 FROM ')){
    emptyChecks++;const values=sql.includes('FROM objects')?objects:state;
    return [...values.keys()].some(key=>id===undefined||key.startsWith(id))?{found:1}:undefined;
   }
   let values;
   if(sql==="SELECT payload FROM state WHERE slot='objects'"){values=state;id='objects';headReads++;}
   else if(sql==='SELECT payload FROM state WHERE slot=$1')values=state;
   else{assert.equal(sql,'SELECT payload FROM objects WHERE id=$1');values=objects;}
   return values.has(id)?{payload:Buffer.from(values.get(id))}:undefined;
  },
  async run(sql,...values){
   if(sql==="INSERT INTO state VALUES ('objects',$1) ON CONFLICT(slot) DO UPDATE SET payload=excluded.payload"){state.set('objects',Buffer.from(values[0]));return;}
   assert.match(sql,/^INSERT INTO state VALUES /);
   for(let i=0;i<values.length;i+=2)state.set(values[i],Buffer.from(values[i+1]));
  }
 };
 const store=new ResearchCatalogue(workspace,db,{readCache:cache}),decode=store.decode;
 store.decode=function(table,id,bytes){if(table==='state'&&id==='objects')headDecodes++;return decode.call(this,table,id,bytes);};
 const value={text:'Retained metadata'},writer=new ObjectIndex(store),root=writer.make('sample',hash(value));
 for(const [slot,node] of writer.writes)state.set(slot,store.encode('state',slot,node));
 objects.set('sample',store.encode('object','sample',value));
 const setHead=value=>state.set('objects',store.encode('state','objects',value));setHead({formatVersion:2,root});
 return {state,objects,workspace,cache,store,root,value,setHead,get headReads(){return headReads;},get headDecodes(){return headDecodes;},get emptyChecks(){return emptyChecks;}};
}

test('repeated authenticated object reads share one decoded head and return independent roots',async t=>{
 const f=fixture();
 for(let i=0;i<50;i++)assert.deepEqual(await f.store.object('sample'),f.value);
 assert.equal(f.headReads,1);assert.equal(f.headDecodes,1);
 const first=await new ObjectIndex(f.store).head();first.root.count=99;first.root.hash='0'.repeat(64);
 assert.deepEqual(await new ObjectIndex(f.store).head(),{formatVersion:2,root:f.root});
 assert.ok(f.cache.nodes.size<=f.cache.maxRows);assert.ok(f.cache.nodeBytes<=f.cache.maxBytes);
 t.diagnostic(JSON.stringify({objectReads:50,headQueries:f.headReads,headDecodes:f.headDecodes}));
});

test('head receipts cannot be forged and never bypass authenticated branch references',async()=>{
 const f=fixture(),reader=new ObjectIndex(f.store);await reader.head();
 f.cache.keepNode('objects',Object.freeze({formatVersion:2,root:Object.freeze({...f.root,count:99})}),256);
 assert.deepEqual(await reader.head(),{formatVersion:2,root:f.root});assert.equal(f.headDecodes,2);
 const head=await reader.head();head.root.count++;
 await assert.rejects(reader.find(head,'sample'),{code:'CATALOGUE_DAMAGED'});
});

test('head replacement, ciphertext eviction and a new snapshot expose corruption or absence',async()=>{
 for(const boundary of ['replace','evict','snapshot','missing']){
  const f=fixture({maxRows:1}),reader=new ObjectIndex(f.store);await reader.head();
  if(boundary==='missing')f.state.delete('objects');else f.state.set('objects',Buffer.from('damaged head'));
  if(boundary==='replace')f.cache.replace('objects',f.state.get('objects'));
  else if(boundary==='snapshot'){f.cache.clear();assert.equal(f.cache.nodes.size,0);f.store.readCache=new CatalogueReadCache();}
  else await f.cache.row('other',async()=>({payload:Buffer.from('other')}));
  await assert.rejects(new ObjectIndex(f.store).head(),{code:boundary==='missing'?'CATALOGUE_DAMAGED':'ENCRYPTION_DAMAGED'},boundary);
 }
});

test('cached heads remain bound to the current encryption key and authenticated vault identity',async()=>{
 const f=fixture(),reader=new ObjectIndex(f.store),original=Buffer.from(f.workspace.vault.key);await reader.head();
 f.workspace.vault.key[0]^=1;await assert.rejects(reader.head(),{code:'ENCRYPTION_DAMAGED'});
 f.workspace.vault.key=Buffer.from(original);assert.deepEqual((await reader.head()).root,f.root);
 f.workspace.vault.id='different-vault';await assert.rejects(reader.head(),{code:'ENCRYPTION_DAMAGED'});f.workspace.vault.id='synthetic-vault';
 f.workspace.vault.key=null;await assert.rejects(reader.head(),{code:'ACCESS_LOCKED'});
 f.workspace.vault.key=Buffer.from(original);assert.deepEqual((await reader.head()).root,f.root);original.fill(0);
});

test('writer scopes and metadata batches keep their existing head lifecycle',async()=>{
 const f=fixture();await new ObjectIndex(f.store).head();const before=f.headDecodes;
 await catalogueContext.run({db:f.store.db},async()=>{await new ObjectIndex(f.store).head();await new ObjectIndex(f.store).head();});
 assert.equal(f.headDecodes,before+2);
 f.cache.clear();
 await withMetadataBatch(f.store,async()=>{
  assert.deepEqual((await metadataBatchIndex(f.store).head()).root,f.root);
  assert.equal(f.cache.node('objects'),null,'The writer batch does not publish a reader head receipt');
 });
});

test('index mutation invalidates the old reader head before subsequent object reads',async()=>{
 const f=fixture(),index=new ObjectIndex(f.store),head=await index.head(),value={text:'Updated metadata'};
 await index.update(head,'sample',hash(value));f.objects.set('sample',f.store.encode('object','sample',value));
 assert.equal(f.cache.nodes.size,0);assert.equal(f.cache.rows.size,0);
 assert.deepEqual(await f.store.object('sample'),value);assert.equal(f.headDecodes,2);
});

test('uncacheable, empty, legacy and malformed heads preserve their admission checks',async()=>{
 for(const large of [false,true]){
  const f=fixture(large?undefined:{maxBytes:128});
  if(large)f.setHead({formatVersion:2,root:f.root,unused:'x'.repeat(300*1024)});
  await new ObjectIndex(f.store).head();await new ObjectIndex(f.store).head();
  assert.equal(f.headDecodes,2);assert.equal(f.cache.node('objects'),null);assert.ok(f.cache.nodeBytes<=f.cache.maxBytes);
 }
 const legacy=fixture();legacy.setHead({entries:[{id:'sample',revision:hash(legacy.value)}]});
 const first=await new ObjectIndex(legacy.store).head();first.legacy[0].id='changed';
 assert.equal((await new ObjectIndex(legacy.store).head()).legacy[0].id,'sample');assert.equal(legacy.headDecodes,2);assert.equal(legacy.cache.node('objects'),null);
 for(const malformed of [{formatVersion:3,root:legacy.root},{formatVersion:2,root:{...legacy.root,extra:true}},{entries:[{id:'sample',revision:hash(legacy.value)},{id:'sample',revision:hash(legacy.value)}]}]){
  legacy.setHead(malformed);legacy.cache.clear();await assert.rejects(new ObjectIndex(legacy.store).head(),{code:'CATALOGUE_DAMAGED'});
 }
 const empty=fixture();empty.objects.clear();empty.state.clear();empty.setHead({formatVersion:2,root:null});
 await new ObjectIndex(empty.store).head();await new ObjectIndex(empty.store).head();assert.equal(empty.emptyChecks,4);assert.equal(empty.cache.node('objects'),null);
 empty.objects.set('stray',Buffer.from('stray'));await assert.rejects(new ObjectIndex(empty.store).head(),{code:'CATALOGUE_DAMAGED'});
});
