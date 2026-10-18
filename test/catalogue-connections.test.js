import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {writeFile,unlink} from 'node:fs/promises';
import {intakeFixture} from './fixtures/local-intake.js';
import {catalogueConnection,createCatalogueConnections} from '../src/catalogue-connections.js';
import {DELETE_MARKER} from '../src/workspace-delete-state.js';
import {MOVE_SOURCE} from '../src/workspace-move-state.js';
import {RENAME_MARKER} from '../src/workspace-rename-state.js';

const gate=()=>Promise.withResolvers();
test('scoped catalogue connections retain transaction isolation, rollback and owner fences',{timeout:60000},async t=>{
 const {ws}=await intakeFixture(t),open=ws.openCatalogue.bind(ws);let opened=0,closed=0;
 ws.openCatalogue=async options=>{const db=await open(options),close=db.close.bind(db);opened++;db.close=async()=>{try{return await close();}finally{closed++;}};return db;};
 const read=()=>ws.catalogue(store=>store.object('connection-test'));
 const write=value=>ws.withLock(()=>ws.catalogue(store=>store.putObject('connection-test',{value})));
 await read();await read();assert.equal(opened,2);assert.equal(closed,2);
 await ws.withCatalogueConnections(async()=>{
  await write(1);assert.deepEqual(await read(),{value:1});
  const pinned=gate(),changed=gate();
  // Start both callers outside the reader's context. One connection cannot
  // serialize the writer behind a reader which is waiting for that writer.
  const reader=ws.catalogue(async store=>{assert.deepEqual(await store.object('connection-test'),{value:1});pinned.resolve();await changed.promise;assert.deepEqual(await store.object('connection-test'),{value:1});});
  await pinned.promise;await write(2);changed.resolve();await reader;
  assert.deepEqual(await read(),{value:2});
  assert.deepEqual(await Promise.all([read(),read(),read()]),[{value:2},{value:2},{value:2}]);
  assert.equal(opened,4,'one read and one write connection for successful transactions');
  await assert.rejects(ws.withLock(()=>ws.catalogue(async store=>{await store.putObject('connection-test',{value:99});throw Error('abort write');})),/abort write/);
  assert.deepEqual(await read(),{value:2});await write(3);assert.deepEqual(await read(),{value:3});assert.equal(opened,5);
  const root=ws.root,key=ws.vault.key;
  try{
   ws.projectId=randomUUID();await assert.rejects(read(),{code:'DATABASE_LOCATION'});delete ws.projectId;
   ws.root=path.join(root,'other');await assert.rejects(ws.withCatalogueConnections(read),{code:'DATABASE_LOCATION'});ws.root=root;
   ws.vault.key=Buffer.alloc(key.length);await assert.rejects(read(),{code:'ACCESS_DENIED'});ws.vault.key=key;
   const marker=path.join(root,DELETE_MARKER);await writeFile(marker,JSON.stringify({version:1,id:randomUUID(),source:root}));
   try{await assert.rejects(read(),{code:'STORAGE_DELETING'});}finally{await unlink(marker);}
  }finally{delete ws.projectId;ws.root=root;ws.vault.key=key;}
  assert.deepEqual(await read(),{value:3});
 });
 assert.equal(opened,closed);assert.deepEqual(await read(),{value:3});assert.equal(opened,6);assert.equal(closed,6);
 await assert.rejects(ws.withCatalogueConnections(async()=>{await read();await write(4);throw Error('abort operation');}),/abort operation/);
 assert.equal(opened,closed);assert.deepEqual(await read(),{value:4},'completed writes survive a later operation failure');
 // An inherited async context used after its operation ends must open afresh.
 const later=gate();let late;
 await ws.withCatalogueConnections(async()=>{await read();late=later.promise.then(read);});
 const before=opened;later.resolve();assert.deepEqual(await late,{value:4});assert.equal(opened,before+1);assert.equal(opened,closed);
 // Closing waits for an accepted operation, even when its caller did not await it.
 const entered=gate(),release=gate();let work,finished=false;
 const scope=ws.withCatalogueConnections(async()=>{work=catalogueConnection(ws,'read',{},async db=>{entered.resolve();await release.promise;return (await db.get('SELECT 1 AS value')).value;});await entered.promise;}).then(()=>{finished=true;});
 await entered.promise;await new Promise(resolve=>setImmediate(resolve));assert.equal(finished,false);assert.equal(opened,closed+1);
 release.resolve();assert.equal(await work,1);await scope;assert.equal(opened,closed);
});

// A lifecycle transition can begin after initial admission, while the writer is
// waiting. Both newly opened and reused connections must check after locking.
test('writers refuse lifecycle transitions that start during lock acquisition',{timeout:60000},async t=>{
 const {ws}=await intakeFixture(t),open=ws.openCatalogue.bind(ws);let transition,ran=false;
 ws.openCatalogue=async options=>{const db=await open(options),lock=db.lock.bind(db);db.lock=async()=>{const result=await lock();if(transition)await writeFile(path.join(ws.root,transition.file),JSON.stringify(transition.value));return result;};return db;};
 const destination=path.join(path.dirname(ws.root),'Moved owner'),id=randomUUID(),cases=[
  {file:DELETE_MARKER,value:{version:1,id,source:ws.root},code:'STORAGE_DELETING'},
  {file:MOVE_SOURCE,value:{id,destination},code:'STORAGE_MOVED'},
  {file:RENAME_MARKER,value:{version:1,id,source:ws.root,destination},code:'STORAGE_RENAMING'}
 ];
 const write=value=>ws.withLock(()=>{ran=true;return ws.catalogue(store=>store.putObject('lifecycle-write',{value}));});
 const check=async()=>{
  transition=null;await write(1);
  for(const item of cases){
   transition=item;ran=false;
   try{await assert.rejects(write(99),{code:item.code});assert.equal(ran,false,'Writer callback entered after a lifecycle transition');}
   finally{transition=null;await unlink(path.join(ws.root,item.file));}
   assert.deepEqual(await ws.catalogue(store=>store.object('lifecycle-write')),{value:1});
   await write(1);
  }
 };
 await check();await ws.withCatalogueConnections(check);
});

test('explicit catalogue owners reuse fresh snapshots, invalidate failures and drain accepted work',{timeout:60000},async t=>{
 const {ws}=await intakeFixture(t),open=ws.openCatalogue.bind(ws),connections=[];
 ws.openCatalogue=async options=>{
  const db=await open(options),close=db.close.bind(db),entry={db,closed:false};connections.push(entry);
  db.close=async()=>{try{return await close();}finally{entry.closed=true;}};return db;
 };
 const write=value=>ws.withLock(()=>ws.catalogue(store=>store.putObject('explicit-owner-test',{value})));
 const read=()=>ws.catalogue(async store=>({db:store.db,cache:store.readCache,value:await store.object('explicit-owner-test')}));
 const owner=createCatalogueConnections(ws),originalKey=Buffer.from(ws.vault.key);t.after(()=>owner.close());
 await write(1);
 const first=await owner.run(read);await write(2);const second=await owner.run(read);
 assert.equal(first.db,second.db);assert.notEqual(first.cache,second.cache);
 assert.deepEqual(first.value,{value:1});assert.deepEqual(second.value,{value:2});
 assert.equal(connections.filter(item=>!item.closed).length,1);
 // Self-close must refuse before starting a drain; a normal external close is
 // still possible after this callback completes.
 await owner.run(async()=>{await assert.rejects(owner.close(),{code:'LOCKED'});assert.deepEqual((await read()).value,{value:2});});
 await assert.rejects(owner.run(()=>ws.catalogue(async store=>{assert.equal(store.db,first.db);throw Error('selected read failed');})),/selected read failed/);
 assert.equal(connections.find(item=>item.db===first.db).closed,true);
 const recovered=await owner.run(read);assert.notEqual(recovered.db,first.db);assert.deepEqual(recovered.value,{value:2});
 const later=gate();let late;
 await owner.run(async()=>{late=later.promise.then(read);});
 // Closing must include an admitted callback still awaiting its access check,
 // before that callback even enters the database queue.
 const entered=gate(),release=gate();let finished=false;
 const accepted=owner.run(async()=>{entered.resolve();await release.promise;return read();});
 await entered.promise;const closing=owner.close().then(()=>{finished=true;});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(finished,false);
 await assert.rejects(owner.run(read),{code:'ACCESS_LOCKED'});
 release.resolve();assert.deepEqual((await accepted).value,{value:2});await closing;
 assert.ok(connections.every(item=>item.closed));assert.deepEqual(ws.vault.key,originalKey);
 const count=connections.length;later.resolve();await assert.rejects(late,{code:'ACCESS_LOCKED'});assert.equal(connections.length,count);
 await assert.rejects(owner.run(read),{code:'ACCESS_LOCKED'});await owner.close();
});
