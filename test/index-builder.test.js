import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {buildIndex} from '../src/index-builder.js';
import {ObjectIndex} from '../src/object-index.js';
import {safeError} from '../src/errors.js';
import {digest} from '../src/storage-format.js';
import {encrypted,clearVault} from '../src/encryption.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
const name=i=>'private-index-title-'+String(i).padStart(8,'0');
async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-index-build-'));
 const book=upgradeNotebook(sampleNotebook());book.entries=[];
 const result=await encryptedFixture(directory,book);
 t.after(async()=>{clearVault(result.vault);await rm(directory,{recursive:true,force:true});});return result.workspace;
}
test('index construction streams tenfold growth through encrypted scratch and retains only final nodes',async t=>{
 const ws=await fixture(t);
 t.diagnostic(JSON.stringify({platform:process.platform,node:process.version,cpu:os.cpus()[0].model,totalMemoryGiB:Math.round(os.totalmem()/1024**3)}));
 for(const count of [512,5120])await ws.withLock(()=>ws.catalogue(async store=>{
  const start=performance.now();let peak=0,temporaryWrites=0,permanentWrites=0,queries=0,peakHeap=process.memoryUsage().heapUsed;const make=ObjectIndex.prototype.make,run=store.db.run;
  ObjectIndex.prototype.make=function(...args){const result=make.apply(this,args);peak=Math.max(peak,this.pending.size);return result;};
  store.db.run=async function(sql,...values){
   queries++;peakHeap=Math.max(peakHeap,process.memoryUsage().heapUsed);
   if(sql.startsWith('INSERT INTO state'))permanentWrites++;
   if(sql.startsWith('INSERT INTO pg_temp.index_build_')){temporaryWrites++;assert.ok(values.length<=64);for(let i=0;i<values.length;i+=2){assert.match(values[i],/^[a-f0-9]{64}$/);assert.ok(encrypted(values[i+1]));assert.ok(!values[i+1].includes(Buffer.from('private-index-title-')));}}
   return run.call(this,sql,...values);
  };
  const destination=new ObjectIndex(store,{namespace:'qualification-index-'+count+':',immutable:true});
  async function* entries(){for(let at=0;at<count;at++){const i=at*7919%count;yield {id:name(i),revision:digest(String(i))};}}
  let root;try{root=await buildIndex(store,destination,entries(),()=>{throw Error('Duplicate input');});}
  finally{ObjectIndex.prototype.make=make;store.db.run=run;}
  const ms=performance.now()-start;assert.ok(ms<60000,'index construction budget: '+ms);assert.ok(peakHeap<256*1024*1024);assert.ok(queries<40*count+1000,'statement budget: '+queries);
  assert.equal(root.count,count);assert.ok(temporaryWrites>0&&temporaryWrites<count/2,'scratch writes stay batched');assert.ok(permanentWrites<=Math.ceil(count/32),'final nodes stay batched');assert.ok(peak<4096,'pending tree nodes: '+peak);
  let found=0;for await(const row of destination.entries({root})){assert.equal(row.id,name(found));assert.equal(row.revision,digest(String(found++)));}assert.equal(found,count);
  const actual=await store.db.get('SELECT count(*)::int AS count FROM state WHERE starts_with(slot,$1)',destination.namespace);assert.equal(actual.count,count);
  assert.equal((await store.db.get("SELECT count(*)::int AS count FROM pg_class WHERE relnamespace=pg_my_temp_schema() AND relname LIKE 'index_build_%'")).count,0);
  t.diagnostic(JSON.stringify({keys:count,ms:Math.round(ms),queries,temporaryWrites,permanentWrites,sampledHeapMiB:Math.round(peakHeap/1024**2),peakPendingNodes:peak,permanentNodes:actual.count}));
 }));
});
test('interrupted scratch writes roll back and preserve the original failure',async t=>{
 const ws=await fixture(t),before=(await ws.read()).etag;
 await assert.rejects(ws.withLock(()=>ws.catalogue(async store=>{
  const destination=new ObjectIndex(store,{namespace:'interrupted-index:',immutable:true}),run=store.db.run;let writes=0;
  store.db.run=async function(sql,...values){if(sql.startsWith('INSERT INTO pg_temp.index_build_')&&++writes===3)throw Object.assign(Error('Synthetic disk full'),{code:'ENOSPC'});return run.call(this,sql,...values);};
  async function* entries(){for(let i=0;i<500;i++)yield {id:name(i),revision:digest(String(i))};}
  try{await buildIndex(store,destination,entries(),()=>{throw Error('Duplicate input');});}finally{store.db.run=run;}
 })),{code:'ENOSPC'});
 assert.equal((await ws.read()).etag,before);
 assert.equal(await ws.catalogue(store=>store.db.get("SELECT 1 FROM state WHERE starts_with(slot,'interrupted-index:') LIMIT 1")),undefined);
});

test('a PostgreSQL statement failure remains visible and transaction rollback removes scratch data',async t=>{
 const ws=await fixture(t);
 await assert.rejects(ws.withLock(()=>ws.catalogue(async store=>{
  const destination=new ObjectIndex(store,{namespace:'failed-sql-index:',immutable:true}),run=store.db.run;
  store.db.run=async function(sql,...values){if(sql.startsWith('INSERT INTO pg_temp.index_build_'))return run.call(this,'SELECT 1/0');return run.call(this,sql,...values);};
  try{await buildIndex(store,destination,[{id:name(0),revision:digest('0')}],()=>{throw Error('Duplicate input');});}
  finally{store.db.run=run;}
 })),{code:'22012'});
 await ws.withLock(()=>ws.catalogue(async store=>{
  const index=new ObjectIndex(store,{namespace:'recovered-index:',immutable:true});
  const root=await buildIndex(store,index,[{id:name(0),revision:digest('0')}],()=>{throw Error('Duplicate input');});assert.equal(root.count,1);
 }));
});

test('denied scratch permission reports the database requirement without leaking database details',async()=>{
 const store={db:{run:async()=>{throw Object.assign(Error('private database name and role'),{code:'42501'});}}};
 try{await buildIndex(store,{},[],()=>{});assert.fail('Expected permission failure');}
 catch(error){assert.equal(error.code,'DATABASE_PERMISSION');const response=safeError(error);assert.match(response.message,/TEMPORARY/);assert.ok(!response.message.includes('private database'));}
});


test('flushing a forest retains shared descendants once and excludes abandoned nodes',async t=>{
 const ws=await fixture(t);
 await ws.withLock(()=>ws.catalogue(async store=>{
  const index=new ObjectIndex(store,{namespace:'forest-check:',immutable:true}),revision=digest('value');
  const child=index.make('a',revision),first=index.make('b',revision,child),second=index.make('c',revision,child);
  index.make('unused',revision);
  await index.flushRoots([first,second]);
  const reader=new ObjectIndex(store,{namespace:index.namespace,immutable:true});
  assert.deepEqual((await Array.fromAsync(reader.entries({root:first}))).map(row=>row.id),['a','b']);
  assert.deepEqual((await Array.fromAsync(reader.entries({root:second}))).map(row=>row.id),['a','c']);
  assert.equal((await store.db.get('SELECT count(*)::int AS count FROM state WHERE starts_with(slot,$1)',index.namespace)).count,3);
  assert.equal(index.pending.size,0);
 }));
});
