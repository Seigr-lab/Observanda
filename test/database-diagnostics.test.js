import test from 'node:test';
import assert from 'node:assert/strict';
import {scratchDatabase} from '../src/postgres.js';
import {OperationalDiagnostics,withDiagnostics,diagnostic} from '../src/operational-diagnostics.js';
import {intakeFixture} from './fixtures/local-intake.js';
import {catalogueConnection,createCatalogueConnections} from '../src/catalogue-connections.js';

test('native cursor diagnostics count actual batches and payloads and close interrupted cursors',async()=>{
 const sink=new OperationalDiagnostics();let db;
 try{
  await withDiagnostics(sink,async()=>{
   db=await scratchDatabase();await db.run('BEGIN');
   let count=0;
   for await(const row of db.rows("SELECT i,decode(repeat('ab',11),'hex') AS payload,repeat(chr(955),3) AS label FROM generate_series(1,35) i",[],{batchSize:16})){
    assert.equal(row.i,++count);assert.equal(row.payload.length,11);assert.equal(row.label,'\u03bb'.repeat(3));
   }
   assert.equal(count,35);diagnostic('request',{route:'records'});
  });
  const first=(await sink.snapshot()).entries[0];
  assert.equal(first.databaseConnections,1);assert.equal(first.databaseCursorBatches,4);
  assert.equal(first.databaseReturnedRows,35);assert.equal(first.databaseBufferBytes,385);assert.equal(first.databaseTextBytes,210);
  const controller=new AbortController(),reason=Error('synthetic cancellation');
  await assert.rejects(withDiagnostics(sink,async()=>{
   try{for await(const row of db.rows('SELECT i FROM generate_series(1,35) i',[],{batchSize:16,signal:controller.signal})){assert.equal(row.i,1);controller.abort(reason);}}
   finally{diagnostic('request',{route:'records'});}
  }),error=>error===reason);
  assert.equal((await db.get('SELECT count(*) AS n FROM pg_cursors')).n,'0');
  const second=(await sink.snapshot()).entries[1];assert.equal(second.databaseCursorBatches,1);assert.equal(second.databaseReturnedRows,16);
  assert.equal(second.databaseConnections,undefined);assert.doesNotMatch(JSON.stringify(await sink.snapshot()),/generate_series|synthetic cancellation|payload|label/);
 }finally{await db?.close();}
});

test('reused-connection diagnostics attribute queue wait to the waiting caller and keep fresh transactions',async t=>{
 const {ws}=await intakeFixture(t),owner=createCatalogueConnections(ws),sink=new OperationalDiagnostics(),entered=Promise.withResolvers(),release=Promise.withResolvers();
 let waiter;
 try{
  const holder=owner.run(()=>catalogueConnection(ws,'read',{},async db=>{
   await db.run('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');entered.resolve();await release.promise;await db.run('COMMIT');
  }));
  await entered.promise;
  waiter=withDiagnostics(sink,async()=>{
   const result=await owner.run(()=>ws.catalogue(store=>store.snapshot()));
   diagnostic('request',{route:'records'});return result;
  });
  // A deterministic gate establishes queueing; no assumption of an idle host.
  await new Promise(resolve=>setImmediate(resolve));assert.equal((await sink.snapshot()).entries.length,0);
  release.resolve();await holder;const result=await waiter;assert.ok(result.metadata.id);
  const first=(await sink.snapshot()).entries[0];assert.equal(first.databaseQueueEntries,1);assert.equal(first.databaseConnections,undefined);assert.ok(first.databaseQueueMs>=0);assert.ok(first.databaseQueries>0);
  await withDiagnostics(sink,async()=>{await owner.run(()=>ws.catalogue(store=>store.snapshot()));diagnostic('request',{route:'records'});});
  const second=(await sink.snapshot()).entries[1];assert.equal(second.databaseQueueEntries,1);assert.equal(second.databaseConnections,undefined);
 }finally{release.resolve();await waiter?.catch(()=>{});await owner.close();}
});
