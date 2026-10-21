import {spawn} from 'node:child_process';
import {Client} from 'pg';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import path from 'node:path';import os from 'node:os';import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {TestDeviceStore} from './device-fixture.js';
import {createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {initializeProjectLocation} from '../src/project-storage.js';
import {databaseCapacity,scratchDatabase} from '../src/postgres.js';
import {withScratch,withScratchSession} from '../src/scratch-work.js';
import {withDatabaseRequest} from '../src/database-request-context.js';

async function waitFor(check){for(let i=0;i<200;i++){if(check())return;await delay(10);}assert.fail('Expected connection state');}
test('a saturated project admits nested verification and leaves sibling databases independent',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-project-admission-')),deviceStore=new TestDeviceStore({file:path.join(directory,'device.key')}),vaults=[],connections=[];
 const owner=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN},projectRuntime:{maxIdle:2}}),detach=installDatabaseProvider(owner);
 t.after(async()=>{await Promise.all(connections.map(db=>db.close()));await owner.close();detach();for(const vault of vaults)clearVault(vault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-project-admission-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const projects=[];
 for(const name of ['a','b']){const book=sampleNotebook(),access=await createWorkspaceAccess('','',deviceStore),vault=takeCreatedVault(access);vaults.push(vault);book.title=book.projects[0].title=name;projects.push(await initializeProjectLocation(path.join(directory,name),book.projects[0].id,book,access,vault));}
 const [a,b]=projects,head=(await a.outline()).etag,sibling=(await b.outline()).etag;
 for(let i=0;i<databaseCapacity().limit;i++)connections.push(await a.openCatalogue());
 const controller=new AbortController();const waiting=withDatabaseRequest(controller.signal,()=>a.outline()),cancelled=assert.rejects(waiting,{name:'AbortError'});await waitFor(()=>databaseCapacity().queued===1);
 assert.equal((await b.outline()).etag,sibling);assert.equal(databaseCapacity().queued,1);
 let arrived=0,release;const barrier=new Promise(resolve=>release=resolve);
 const inspections=connections.map((db,index)=>db.scope(()=>withScratchSession(()=>withScratch(async outer=>{
  await outer.put('same',{index});
  await Promise.all(Array.from({length:4},(_,n)=>withScratch(async inner=>{await inner.put('same',{index,n});assert.deepEqual(await inner.get('same'),{index,n});})));
  arrived++;if(arrived===connections.length)release();await barrier;assert.deepEqual(await outer.get('same'),{index});
  assert.equal(databaseCapacity().active,connections.length*2,'One auxiliary connection per admitted catalogue');
 }))));
 await Promise.all(inspections);assert.equal(databaseCapacity().active,connections.length);controller.abort();await cancelled;assert.equal(databaseCapacity().queued,0);
 let opened=false;const next=a.openCatalogue().then(db=>{opened=true;return db;});await waitFor(()=>databaseCapacity().queued===1);assert.equal(opened,false);await connections.pop().close();connections.push(await next);
 await Promise.all(connections.splice(0).map(db=>db.close()));assert.equal(databaseCapacity().active,0);assert.equal(databaseCapacity().admitted,0);assert.equal((await a.outline()).etag,head);
});

test('nested temporary work preserves cursor snapshots and survives another work set SQL failure',async t=>{
 const observer=await scratchDatabase(),prototype=Object.getPrototypeOf(observer),run=prototype.run;let fail=false;
 const spy=t.mock.method(prototype,'run',function(sql,...args){if(fail&&sql.startsWith('INSERT INTO pg_temp.obs_work_')){fail=false;return run.call(this,'SELECT 1/0');}return run.call(this,sql,...args);});
 try{await withScratchSession(()=>withScratch(async outer=>{
  for(let start=0;start<64;start+=32)await outer.putMany(Array.from({length:32},(_,n)=>[String(start+n),{value:start+n}]));
  const iterator=outer.items(),first=await iterator.next();assert.equal(first.done,false);
  await outer.clear();await outer.put('replacement',{value:999});
  fail=true;await assert.rejects(withScratch(inner=>inner.put('same',{private:'failure'})),{code:'22012'});
  assert.deepEqual(await outer.get('replacement'),{value:999});const rows=[first.value];for await(const value of iterator)rows.push(value);
  assert.equal(rows.length,64);assert.equal(new Set(rows.map(row=>row.value)).size,64);assert.ok(rows.every(row=>row.value<64));
  await withScratch(async inner=>{await inner.put('same',{fresh:true});assert.deepEqual(await inner.get('same'),{fresh:true});});
 }));}finally{spy.mock.restore();await observer.close();}
 assert.equal(databaseCapacity().active,0);assert.equal(databaseCapacity().admitted,0);
});


test('failed temporary table initialization removes its own table and preserves active work',async t=>{
 const observer=await scratchDatabase(),prototype=Object.getPrototypeOf(observer),run=prototype.run;let fail=false,connection;
 const spy=t.mock.method(prototype,'run',function(sql,...args){if(fail&&sql.startsWith('CREATE INDEX ON pg_temp.obs_work_')){fail=false;connection=this;return run.call(this,'SELECT 1/0');}return run.call(this,sql,...args);});
 try{await withScratch(async outer=>{
  await outer.put('retained',{value:17});fail=true;
  await assert.rejects(withScratch(()=>assert.fail('Incomplete temporary table must not be exposed')),{code:'22012'});
  assert.equal((await connection.get("SELECT count(*)::int AS n FROM pg_class WHERE relnamespace=pg_my_temp_schema() AND relkind='r'")).n,1);
  assert.deepEqual(await outer.get('retained'),{value:17});
 });}finally{spy.mock.restore();await observer.close();}
 assert.equal(databaseCapacity().active,0);
});

test('failed database connections release their reservation before the next operation',async t=>{
 const connect=Client.prototype.connect;let failed=false;
 const spy=t.mock.method(Client.prototype,'connect',function(...args){if(!failed){failed=true;throw Error('Synthetic connection failure');}return connect.apply(this,args);});
 try{await assert.rejects(scratchDatabase(),{code:'DATABASE_UNAVAILABLE'});assert.equal(databaseCapacity().active,0);assert.equal(databaseCapacity().admitted,0);
  const db=await scratchDatabase();try{assert.equal((await db.get('SELECT 17 AS value')).value,17);}finally{await db.close();}
 }finally{spy.mock.restore();}
 assert.equal(databaseCapacity().active,0);assert.equal(databaseCapacity().owners,0);
});


test('external process saturation refuses safely and recovers without leaked catalogue reservations',{timeout:60000},async t=>{
 // The runner owns this disposable server. A separate ordinary-role client
 // represents other processes sharing an external PostgreSQL endpoint.
 const observer=await scratchDatabase();let settings;
 try{settings=await observer.get("SELECT current_setting('max_connections')::int AS maximum,current_setting('superuser_reserved_connections')::int AS reserved,current_setting('reserved_connections',true)::int AS extra");}finally{await observer.close();}
 assert.ok(settings.maximum<=512,'This bounded qualification requires an isolated server with at most 512 slots');
 const script=`import {Client} from 'pg';
 const clients=[];let handling=false;
 process.on('message',async message=>{
  if(handling)return;handling=true;
  try{
   if(message.action==='fill'){
    let code=null;
    for(let index=0;index<=message.maximum;index++){
     const client=new Client({connectionString:message.url,connectionTimeoutMillis:5000,application_name:'Observanda isolated capacity test'});client.on('error',()=>{});
     try{await client.connect();clients.push(client);}catch(error){code=error.code;await client.end().catch(()=>{});break;}
    }
    process.send({phase:'full',count:clients.length,code});
   }else if(message.action==='release'){await clients.pop().end();process.send({phase:'released',count:clients.length});}
   else if(message.action==='close'){await Promise.all(clients.splice(0).map(client=>client.end()));process.send({phase:'closed'});process.disconnect();}
  }catch(error){process.send({phase:'failed',code:error.code??'unexpected'});}
  finally{handling=false;}
 });`;
 const child=spawn(process.execPath,['--input-type=module','-e',script],{cwd:process.cwd(),windowsHide:true,stdio:['ignore','ignore','pipe','ipc']}),exited=new Promise(resolve=>child.once('exit',resolve));let db;
 child.stderr.resume();
 const receive=phase=>new Promise((resolve,reject)=>{
  const finish=(error,value)=>{clearTimeout(timer);child.off('message',message);child.off('error',failed);child.off('exit',ended);error?reject(error):resolve(value);};
  const message=value=>value.phase===phase?finish(null,value):finish(Error('Unexpected isolated worker phase: '+value.phase)),failed=error=>finish(error),ended=()=>finish(Error('Isolated worker exited before '+phase));
  const timer=setTimeout(()=>finish(Error('Isolated worker timed out at '+phase)),15000);child.on('message',message);child.once('error',failed);child.once('exit',ended);
 });
 t.after(async()=>{await db?.close();if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}});
 const ready=receive('full');child.send({action:'fill',url:process.env.OBSERVANDA_DATABASE_URL,maximum:settings.maximum});const full=await ready;
 assert.equal(full.code,'53300');assert.equal(full.count,settings.maximum-settings.reserved-(settings.extra??0));
 await assert.rejects(scratchDatabase(),{code:'DATABASE_UNAVAILABLE'});assert.deepEqual(databaseCapacity(),{active:0,limit:12,owners:0,admitted:0,queued:0});
 const released=receive('released');child.send({action:'release'});assert.equal((await released).count,full.count-1);
 db=await scratchDatabase();assert.equal((await db.get('SELECT 37 AS value')).value,37);assert.equal(databaseCapacity().active,1);
 await db.close();db=null;
 const closed=receive('closed');child.send({action:'close'});await closed;assert.equal(await exited,0);
 assert.deepEqual(databaseCapacity(),{active:0,limit:12,owners:0,admitted:0,queued:0});
 t.diagnostic(JSON.stringify({serverSlots:settings.maximum,ordinarySlots:full.count,refusal:'53300',recovered:true}));
});
