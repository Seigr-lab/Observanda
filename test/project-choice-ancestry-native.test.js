import '../src/storage.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {createNotebook} from '../src/model.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider,scopedDatabaseEnvironment,databaseScope} from '../src/workspace-database-context.js';
import {runtimeStorageDirectory} from '../src/database-runtime-environment.js';
import {withProjectChoiceWork} from '../src/project-choice-work.js';
import {projectChoiceAncestry} from '../src/project-choice-ancestry.js';
import {scratchDatabase} from '../src/postgres.js';
import {diskCapacity} from '../src/disk-capacity.js';
import {clearVault} from '../src/encryption.js';

test('managed ancestry scratch admits its actual volume, encrypts summaries and closes after success or failure',{timeout:180000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-ancestry-')),runtime=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(runtime);let f;
 t.after(async()=>{await clearVault(f?.vault);await runtime.close();detach();assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-ancestry-'));await rm(directory,{recursive:true,force:true});});
 f=await encryptedFixture(path.join(directory,'workspace'),createNotebook('Ancestry'));
 await f.workspace.catalogue(async()=>{
  const environment=scopedDatabaseEnvironment(),physical=runtimeStorageDirectory(environment);assert.ok(physical);assert.notEqual(physical,f.workspace.root);
  const observer=await scratchDatabase(),prototype=Object.getPrototypeOf(observer),run=prototype.run,tables=new Set();let writes=0;
  t.mock.method(prototype,'run',async function(sql,...values){const match=/CREATE TEMP TABLE (obs_work_[a-f0-9]+)/.exec(sql);if(match)tables.add(match[1]);if(sql.startsWith('INSERT INTO pg_temp.obs_work_')){writes++;for(const value of values)if(Buffer.isBuffer(value))assert.equal(value.includes(Buffer.from('Private ancestry marker')),false);}return run.call(this,sql,...values);});
  try{
   for(const count of [1000,4000]){
    let reads=0,relationBytes=0;writes=0;const before=performance.now();await withProjectChoiceWork(f.workspace,async work=>{
     assert.ok(work);const view={get:async id=>{reads++;const i=Number(id);return {state:'active',entry:{projectId:id,parentId:i+1===count?null:String(i+1),summary:{title:i+1===count?'Private ancestry marker':'Child '+i}}};}},inspect=projectChoiceAncestry(view,work,{query:'Private ancestry marker'});
     for(let i=0;i<count;i++)assert.equal((await inspect(String(i))).matched,true);
     relationBytes=Number((await observer.get('SELECT COALESCE(sum(pg_catalog.pg_total_relation_size(oid)),0)::text AS bytes FROM pg_catalog.pg_class WHERE relname=ANY($1::text[])',[...tables])).bytes);assert.ok(relationBytes>0);assert.ok(relationBytes<96*1024+count*2*1024);
    });assert.equal(reads,count);assert.equal(writes,count*2);assert.equal(diskCapacity.stats().active,0);t.diagnostic(JSON.stringify({depth:count,parentReads:reads,memoWrites:writes,relationBytes,elapsedMs:Math.round(performance.now()-before)}));
   }
   await assert.rejects(withProjectChoiceWork(f.workspace,async work=>{await work.put('private',{title:'Private ancestry marker'});throw Object.assign(new Error('cancelled'),{code:'ACCESS_LOCKED'});}),{code:'ACCESS_LOCKED'});assert.equal(diskCapacity.stats().active,0);
   assert.equal(Number((await observer.get('SELECT count(*) AS count FROM pg_catalog.pg_class WHERE relname=ANY($1::text[])',[...tables])).count),0);
   const probe=diskCapacity.probe,priorWrites=writes;t.mock.method(diskCapacity,'probe',async directory=>({...await probe(directory),available:0n}));await assert.rejects(withProjectChoiceWork(f.workspace,()=>assert.fail('No scratch work may begin without disk admission')),{code:'STORAGE_FULL'});assert.equal(writes,priorWrites);assert.equal(diskCapacity.stats().active,0);t.mock.method(diskCapacity,'probe',probe);
   // A copied URL without the private managed capability cannot claim a local
   // server volume. Exact bounded-memory ancestry is selected instead.
   await databaseScope({...environment},()=>withProjectChoiceWork(f.workspace,work=>assert.equal(work,null)));
  }finally{t.mock.restoreAll();await observer.close();}
 });
});
