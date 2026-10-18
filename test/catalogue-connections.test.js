import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {writeFile,unlink} from 'node:fs/promises';
import {intakeFixture} from './fixtures/local-intake.js';
import {catalogueConnection} from '../src/catalogue-connections.js';
import {DELETE_MARKER} from '../src/workspace-delete-state.js';

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
