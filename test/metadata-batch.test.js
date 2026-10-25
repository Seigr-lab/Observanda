import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {withMetadataBatch,withWorkspaceMetadataBatch,metadataBatchIndex} from '../src/metadata-batch.js';
import {CatalogueReadCache} from '../src/catalogue-read-cache.js';
async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-metadata-transaction-')),f=await encryptedFixture(directory,sampleNotebook());
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});return f.workspace;
}

test('reader prefetch authenticates selected payloads within one snapshot and expires before the next read',async t=>{
 const ws=await fixture(t),file=i=>'.observanda/read-prefetch/'+String(i).padStart(4,'0')+'.json',ids=Array.from({length:32},(_,i)=>'metadata:'+file(i*8));
 await ws.withLock(()=>withWorkspaceMetadataBatch(ws,async()=>{for(let i=0;i<256;i++)await ws.writeMetadata(file(i),JSON.stringify({value:i}));}));
 const inspect=prefetch=>ws.catalogue(async store=>{
  const counts={points:0,batches:0,objects:0},get=store.db.get,all=store.db.all;
  store.db.get=async function(sql,...args){if(sql==='SELECT payload FROM objects WHERE id=$1')counts.objects++;if(sql==='SELECT payload FROM state WHERE slot=$1'&&args[0].startsWith('object-index:'))counts.points++;return get.call(this,sql,...args);};
  store.db.all=async function(sql,...args){if(sql.includes('ANY($1::text[])')){assert.ok(args[0].length<=32);counts.batches++;}return all.call(this,sql,...args);};
  try{if(prefetch)await store.prefetchObjects(ids);for(let i=0;i<ids.length;i++)assert.deepEqual(await store.object(ids[i]),{text:JSON.stringify({value:i*8})});return counts;}
  finally{store.db.get=get;store.db.all=all;}
 });
 const ordinary=await inspect(false),prefetched=await inspect(true);assert.equal(prefetched.objects,0);assert.ok(prefetched.points+prefetched.batches<ordinary.points/2,JSON.stringify({ordinary,prefetched}));
 await ws.withLock(()=>ws.writeMetadata(file(0),'new revision'));await ws.catalogue(async store=>{await store.prefetchObjects([ids[0]]);assert.deepEqual(await store.object(ids[0]),{text:'new revision'});});
 const db=await ws.openCatalogue();try{
  const row=await db.get('SELECT payload FROM objects WHERE id=$1',ids[0]);await db.run('UPDATE objects SET payload=$2 WHERE id=$1',ids[0],Buffer.from('corrupt after prior snapshot'));
  try{await assert.rejects(ws.catalogue(async store=>{await store.prefetchObjects([ids[0]]);return store.object(ids[0]);}),{code:'ENCRYPTION_DAMAGED'});}finally{await db.run('UPDATE objects SET payload=$2 WHERE id=$1',ids[0],row.payload);}
  const stray='metadata:'+file(999);await ws.catalogue(async store=>db.run('INSERT INTO objects VALUES ($1,$2)',stray,store.encode('object',stray,{text:'unindexed'})));
  try{await assert.rejects(ws.catalogue(async store=>{await store.prefetchObjects([stray]);return store.object(stray);}),{code:'CATALOGUE_DAMAGED'});}finally{await db.run('DELETE FROM objects WHERE id=$1',stray);}
 }finally{await db.close();}
 await ws.catalogue(async store=>{const absent='metadata:'+file(998);await store.prefetchObjects([absent]);assert.equal(await store.object(absent),null);await assert.rejects(store.prefetchObjects([...ids,absent]),{code:'INVALID'});});
 t.diagnostic(JSON.stringify({ordinary,prefetched}));
});

test('pending metadata key prefetch retains native authentication, cancellation and transaction rollback',async t=>{
 const ws=await fixture(t),file=i=>'.observanda/prefetch-fixture/'+String(i).padStart(4,'0')+'.json',ids=Array.from({length:32},(_,i)=>'metadata:'+file(i*8));
 await ws.withLock(()=>withWorkspaceMetadataBatch(ws,async()=>{for(let i=0;i<256;i++)await ws.writeMetadata(file(i),JSON.stringify({value:i}));}));
 const snapshot=()=>ws.catalogue(async store=>({state:await store.db.all("SELECT slot,payload FROM state WHERE slot='objects' OR starts_with(slot,'object-index:') ORDER BY slot"),objects:await store.db.all('SELECT id,payload FROM objects ORDER BY id')}));
 const mutate=async(prefetch,value,{controller,failWrite=false,selectedIds=ids}={})=>{
  const counts={points:0,batches:0,objectPoints:0,objectBatches:0};await ws.withLock(()=>ws.catalogue(async store=>{
   const get=store.db.get,all=store.db.all,run=store.db.run;
   store.db.get=async function(sql,...args){if(sql==='SELECT payload FROM state WHERE slot=$1'&&args[0].startsWith('object-index:'))counts.points++;if(sql==='SELECT payload FROM objects WHERE id=$1'&&selectedIds.includes(args[0]))counts.objectPoints++;return get.call(this,sql,...args);};
   store.db.all=async function(sql,...args){const selected=sql==='SELECT slot,payload FROM state WHERE slot=ANY($1::text[]) AND octet_length(payload)<=8192',objects=sql==='SELECT id,CASE WHEN octet_length(payload)<=8192 THEN payload ELSE NULL END AS payload FROM objects WHERE id=ANY($1::text[])';if(selected||objects){if(objects)counts.objectBatches++;else counts.batches++;assert.ok(args[0].length<=32);}const result=await all.call(this,sql,...args);if(objects)controller?.abort();return result;};
   store.db.run=async function(sql,...args){if(failWrite&&sql.startsWith('INSERT INTO state'))throw Error('Interrupted prefetched index');return run.call(this,sql,...args);};
   try{await withWorkspaceMetadataBatch(ws,async()=>{for(const id of selectedIds){await ws.readMetadata(id.slice(9),32768);await ws.writeMetadata(id.slice(9),JSON.stringify({value}));}},{prefetchIds:prefetch?selectedIds:[],signal:controller?.signal});}
   finally{store.db.get=get;store.db.all=all;store.db.run=run;}
  }));return counts;
 };
 const ordinary=await mutate(false,'ordinary'),prefetched=await mutate(true,'prefetched');
 assert.ok(prefetched.batches>0);assert.ok(prefetched.points+prefetched.batches<ordinary.points/2,JSON.stringify({ordinary,prefetched}));
 assert.equal(ordinary.objectPoints,32);assert.equal(prefetched.objectPoints,0);assert.equal(prefetched.objectBatches,1);
 for(const id of ids)assert.deepEqual(JSON.parse(await ws.readMetadata(id.slice(9),1024)),{value:'prefetched'});
 const before=await snapshot();await assert.rejects(mutate(true,'cancelled',{controller:new AbortController()}),{name:'AbortError'});assert.deepEqual(await snapshot(),before);
 await assert.rejects(mutate(true,'rolled back',{failWrite:true}),/Interrupted prefetched index/);assert.deepEqual(await snapshot(),before);
 const newIds=Array.from({length:32},(_,i)=>'metadata:'+file(300+i)),created=await mutate(true,'created',{selectedIds:newIds});assert.equal(created.objectPoints,0);assert.equal(created.objectBatches,1);
 await ws.withLock(()=>ws.writeMetadata(file(0),JSON.stringify({large:'x'.repeat(9000)})));
 const oversized=await mutate(true,'oversized fallback');assert.equal(oversized.objectPoints,1);
 const db=await ws.openCatalogue();
 try{
  const original=await db.get('SELECT payload FROM objects WHERE id=$1',ids[0]);await db.run('UPDATE objects SET payload=$2 WHERE id=$1',ids[0],Buffer.from('corrupted prefetched object'));
  try{await assert.rejects(mutate(true,'must not repair object'),error=>['CATALOGUE_DAMAGED','ENCRYPTION_DAMAGED'].includes(error.code));}
  finally{await db.run('UPDATE objects SET payload=$2 WHERE id=$1',ids[0],original.payload);}
  const stray='metadata:'+file(400);
  for(const size of [20,9000]){
   const payload=await ws.catalogue(store=>store.encode('object',stray,{text:'x'.repeat(size)}));await db.run('INSERT INTO objects VALUES ($1,$2)',stray,payload);
   try{
    await assert.rejects(mutate(true,'must not hide stray',{selectedIds:[stray]}),{code:'CATALOGUE_DAMAGED'});
    await assert.rejects(ws.withLock(()=>withWorkspaceMetadataBatch(ws,()=>ws.writeMetadata(stray.slice(9),'replacement'),{prefetchIds:[stray]})),{code:'CATALOGUE_DAMAGED'});
    assert.deepEqual((await db.get('SELECT payload FROM objects WHERE id=$1',stray)).payload,payload);
   }finally{await db.run('DELETE FROM objects WHERE id=$1',stray);}
  }
  const head=await ws.catalogue(async store=>store.objectIndex().head()),slot='object-index:'+head.root.key,row=await db.get('SELECT payload FROM state WHERE slot=$1',slot);
  await db.run('UPDATE state SET payload=$2 WHERE slot=$1',slot,Buffer.from('corrupted prefetched branch'));
  try{await assert.rejects(mutate(true,'must not repair'),error=>['CATALOGUE_DAMAGED','ENCRYPTION_DAMAGED'].includes(error.code));}
  finally{await db.run('UPDATE state SET payload=$2 WHERE slot=$1',slot,row.payload);}
 }finally{await db.close();}
 await mutate(true,'retry');for(const id of ids)assert.deepEqual(JSON.parse(await ws.readMetadata(id.slice(9),1024)),{value:'retry'});
 t.diagnostic(JSON.stringify({ordinary,prefetched,created,oversized}));
});

test('an explicit catalogue mutation invalidates shared metadata heads and decrypted branches',async t=>{
 const ws=await fixture(t);
 await ws.withLock(()=>ws.catalogue(async store=>{
  const cache=store.readCache=new CatalogueReadCache();
  try{
   await store.putObject('metadata:.observanda/cache-write.json',{text:'one'});
   assert.deepEqual(await store.object('metadata:.observanda/cache-write.json'),{text:'one'});assert.ok(cache.nodes.size);
   await store.putObject('metadata:.observanda/cache-write.json',{text:'two'});
   assert.deepEqual(await store.object('metadata:.observanda/cache-write.json'),{text:'two'});
   await store.deleteObject('metadata:.observanda/cache-write.json');assert.equal(await store.object('metadata:.observanda/cache-write.json'),null);
  }finally{cache.clear();store.readCache=null;}
 }));
});
test('metadata batch reads its staged branches, flushes bounded edits and rolls back payloads and roots together',async t=>{
 const ws=await fixture(t);let writes=0,peakPending=0,peakObjectBytes=0;
 await ws.withLock(()=>ws.catalogue(store=>withMetadataBatch(store,async()=>{
  const run=store.db.run;
  store.db.run=async function(sql,...args){if(sql.startsWith('INSERT INTO state'))writes++;return run.call(this,sql,...args);};
  try{
   for(let i=0;i<256;i++){
    await ws.writeMetadata('.observanda/synthetic/'+i+'.json',JSON.stringify({value:i}));
    assert.equal(JSON.parse(await ws.readMetadata('.observanda/synthetic/'+i+'.json',1024)).value,i);
    peakPending=Math.max(peakPending,store.objectIndex().pending.size);
    assert.ok(store.objectIndex().pendingBytes<4*1024*1024);
    peakObjectBytes=Math.max(peakObjectBytes,store.objectIndex().objectBytes);
    assert.ok(store.objectIndex().objects.size<=32);assert.ok(peakObjectBytes<=256*1024);
    assert.ok(store.objectIndex().cache.size<=16384);assert.ok(store.objectIndex().cacheBytes<=16*1024*1024);
    assert.equal(store.objectIndex().cachedVersions.size,store.objectIndex().cache.size);
    assert.ok(store.objectIndex().objectReads.rows.size<=128);assert.ok(store.objectIndex().objectReads.bytes<=256*1024);
    if(i%31===0){
     const page=await store.objectIdPage('metadata:.observanda/synthetic/',{limit:10});assert.equal(page.items.length,Math.min(i+1,10));
     assert.ok(await store.objectIdentity('metadata:.observanda/synthetic/'+i+'.json'));
    }
   }
   await withMetadataBatch(store,async()=>{assert.equal(JSON.parse(await ws.readMetadata('.observanda/synthetic/5.json',1024)).value,5);});
  }finally{store.db.run=run;}
 })));
 assert.ok(writes<1100);assert.ok(peakPending<8192);
 t.diagnostic(JSON.stringify({objects:256,indexWrites:writes,peakPending,peakObjectBytes}));
 await ws.catalogue(async store=>{let count=0;for await(const object of store.verifiedObjects()){void object;count++;}assert.ok(count>=256);});
 await assert.rejects(ws.withLock(()=>ws.catalogue(store=>withMetadataBatch(store,async()=>{
  for(let i=0;i<130;i++)await ws.writeMetadata('.observanda/synthetic/'+i+'.json',JSON.stringify({changed:i}));
  throw Object.assign(Error('Synthetic disk full'),{code:'ENOSPC'});
 }))),{code:'ENOSPC'});
 assert.deepEqual(JSON.parse(await ws.readMetadata('.observanda/synthetic/5.json',1024)),{value:5});
 await ws.withLock(()=>ws.catalogue(store=>withMetadataBatch(store,async()=>{
  await ws.removeMetadata('.observanda/synthetic/5.json');
  assert.equal(await ws.readMetadata('.observanda/synthetic/5.json',1024),null);
 })));
 assert.equal(await ws.readMetadata('.observanda/synthetic/5.json',1024),null);
 await ws.withLock(()=>ws.catalogue(store=>withMetadataBatch(store,async()=>{
  await ws.writeMetadata('.observanda/synthetic/5.json','restored');
  await ws.removeMetadata('.observanda/synthetic/5.json');
  await ws.writeMetadata('.observanda/synthetic/5.json','changed again');
  await store.objectIndex().save();
  assert.equal(await ws.readMetadata('.observanda/synthetic/5.json',1024),'changed again');
  await ws.removeMetadata('.observanda/synthetic/5.json');await store.objectIndex().save();
  assert.equal(await ws.readMetadata('.observanda/synthetic/5.json',1024),null);
  await ws.writeMetadata('.observanda/synthetic/5.json','changed again');
  await ws.writeMetadata('.observanda/synthetic/large.json','x'.repeat(300*1024));
  assert.ok(store.objectIndex().objectBytes<=256*1024);
  assert.equal(await ws.readMetadata('.observanda/synthetic/5.json',1024),'changed again');
  assert.equal((await ws.readMetadata('.observanda/synthetic/large.json',400*1024)).length,300*1024);
 })));
 assert.equal(await ws.readMetadata('.observanda/synthetic/5.json',1024),'changed again');
});

test('metadata creations cannot overwrite or erase a row missing from the authenticated index',async t=>{
 const ws=await fixture(t),id='metadata:.observanda/synthetic/stray.json';
 await ws.withLock(()=>ws.writeMetadata('.observanda/synthetic/existing.json','indexed'));
 await ws.withLock(()=>ws.catalogue(store=>store.db.run('INSERT INTO objects VALUES ($1,$2)',id,store.encode('object',id,{data:'stray'}))));
 for(const cancel of [false,true]){
  await assert.rejects(ws.withLock(()=>ws.catalogue(store=>withMetadataBatch(store,async()=>{
   await ws.writeMetadata('.observanda/synthetic/stray.json','replacement');
   if(cancel)await ws.removeMetadata('.observanda/synthetic/stray.json');
  }))),{code:'CATALOGUE_DAMAGED'});
  await ws.catalogue(async store=>{
   const row=await store.db.get('SELECT payload FROM objects WHERE id=$1',id);
   assert.deepEqual(store.decode('object',id,row.payload),{data:'stray'});
   assert.equal(await store.objectIndex().find(await store.objectIndex().head(),id),null);
  });
 }
 await ws.withLock(()=>ws.catalogue(store=>store.db.run('DELETE FROM objects WHERE id=$1',id)));
 await ws.withLock(()=>ws.catalogue(store=>withMetadataBatch(store,async()=>{
  await ws.writeMetadata('.observanda/synthetic/large-replacement.json','small');
  await ws.writeMetadata('.observanda/synthetic/large-replacement.json','x'.repeat(300*1024));
 })));
 assert.equal((await ws.readMetadata('.observanda/synthetic/large-replacement.json',400*1024)).length,300*1024);
});

test('read caches are bounded, transaction-owned and never hide changes or corruption in a later read',async t=>{
 const ws=await fixture(t);
 await ws.withLock(()=>ws.writeMetadata('.observanda/synthetic/value.json','first'));
 let reads=0;
 await ws.catalogue(async store=>{
  const run=store.db.run;store.db.run=async function(sql,...args){if(sql.startsWith('SELECT payload FROM state'))reads++;return run.call(this,sql,...args);};
  for(let i=0;i<50;i++)assert.equal(await ws.readMetadata('.observanda/synthetic/value.json',1024),'first');
  assert.ok(store.readCache.rows.size<=128);assert.ok(store.readCache.bytes<=256*1024);
  await ws.withLock(()=>ws.writeMetadata('.observanda/synthetic/value.json','second'));
  assert.equal(await ws.readMetadata('.observanda/synthetic/value.json',1024),'first');
 });
 assert.ok(reads<10);assert.equal(await ws.readMetadata('.observanda/synthetic/value.json',1024),'second');
 let oldCache;await ws.catalogue(async store=>{oldCache=store.readCache;await store.object('metadata:.observanda/synthetic/value.json');});
 assert.equal(oldCache.rows.size,0);assert.equal(oldCache.bytes,0);
 await ws.withLock(()=>ws.catalogue(async store=>{
  assert.equal(store.readCache,null);const index=store.objectIndex(),head=await index.head();
  await store.db.run('UPDATE state SET payload=$1 WHERE slot=$2',Buffer.from('damaged'),'object-index:'+head.root.key);
 }));
 await assert.rejects(ws.readMetadata('.observanda/synthetic/value.json',1024),{code:'ENCRYPTION_DAMAGED'});
 const cache=new CatalogueReadCache();
 for(let i=0;i<500;i++)await cache.row(String(i),async()=>({payload:Buffer.alloc(8192,i%256)}));
 assert.ok(cache.rows.size<=32);assert.ok(cache.bytes<=256*1024);cache.clear();assert.equal(cache.bytes,0);
});


test('batch cipher preparation expires with its transaction and follows vault replacement and clearing',async t=>{
 const ws=await fixture(t),value={evidence:'retained'},original=Buffer.from(ws.vault.key);let batch,preparedAtExit;
 await ws.withLock(()=>ws.catalogue(store=>withMetadataBatch(store,async()=>{
  batch=metadataBatchIndex(store);const prepared=batch.encryptionKey(ws.vault.key),bytes=store.encode('object','cipher-test',value);
  assert.equal(batch.encryptionKey(ws.vault.key),prepared);assert.deepEqual(store.decode('object','cipher-test',bytes),value);
  try{
   ws.vault.key[0]^=255;
   assert.notEqual(batch.encryptionKey(ws.vault.key),prepared);
   assert.throws(()=>store.decode('object','cipher-test',bytes),{code:'ENCRYPTION_DAMAGED'});
   ws.vault.key.fill(0);ws.vault.key=Buffer.from(original);
   assert.deepEqual(store.decode('object','cipher-test',bytes),value);
   clearVault(ws.vault);
   assert.throws(()=>store.encode('object','cipher-test',value),{code:'ACCESS_LOCKED'});
   assert.throws(()=>store.decode('object','cipher-test',bytes),{code:'ACCESS_LOCKED'});
   assert.throws(()=>batch.encryptionKey(ws.vault.key),{code:'ACCESS_LOCKED'});
  }finally{ws.vault.key=Buffer.from(original);}
  assert.deepEqual(store.decode('object','cipher-test',bytes),value);preparedAtExit=batch.encryptionKey(ws.vault.key);
 })));
 await ws.catalogue(store=>{assert.equal(metadataBatchIndex(store),null);});
 // A closed batch retains no prepared key even if a diagnostic holds the batch.
 const after=batch.encryptionKey(ws.vault.key);assert.notEqual(after,preparedAtExit);batch.clear();assert.notEqual(batch.encryptionKey(ws.vault.key),after);batch.clear();original.fill(0);
});
