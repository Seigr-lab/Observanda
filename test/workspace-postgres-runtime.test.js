import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,rename,readFile,writeFile,unlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {startManagedPostgres,stopManagedPostgres} from '../src/postgres-runtime.js';
import {WorkspacePostgres} from '../src/workspace-postgres.js';
import {workspaceDatabaseLease} from '../src/workspace-database-lease.js';
import {seal,unseal,clearVault} from '../src/encryption.js';
import {NativeResourceBudget,databaseMemoryReservation,nativeResources} from '../src/native-resource-budget.js';

const environment=()=>{const env={...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN??''};delete env.OBSERVANDA_DATABASE_URL;return env;};
async function query(env,sql){const client=new Client({connectionString:env.OBSERVANDA_DATABASE_URL});await client.connect();try{return (await client.query(sql)).rows;}finally{await client.end();}}
async function fixture(t){
 const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-workspace-database-')),active=new Set(),vaults=[];
 t.after(async()=>{for(const service of active)await service.close();for(const vault of vaults)clearVault(vault);await rm(parent,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 async function create(name){const root=path.join(parent,name),vault={id:randomUUID(),key:randomBytes(32)},ownerId=randomUUID();vaults.push(vault);await mkdir(path.join(root,'.observanda'),{recursive:true});return {root,vault,ownerId};}
 async function start(workspace,options={}){const env=environment(),service=await startManagedPostgres({directory:path.join(workspace.root,'.observanda','postgresql'),env,workspace,...options});active.add(service);return {env,close:async()=>{await service.close();active.delete(service);}};}
 return {parent,create,start};
}

test('real independent clusters respect shared admission and release capacity after confirmed shutdown',async t=>{
 const f=await fixture(t),a=await f.create('first'),b=await f.create('second'),bytes=databaseMemoryReservation(64),budget=new NativeResourceBudget({runtimeLimit:1,memoryBytes:bytes*2,reserveBytes:1,available:()=>bytes*4});
 const first=await f.start(a,{budget});assert.equal(budget.stats().managedRuntimes,1);
 await query(first.env,'CREATE TABLE retained(value integer)');await query(first.env,'INSERT INTO retained VALUES (23)');
 await assert.rejects(f.start(b,{budget}),{code:'WORKLOAD_BUSY'});
 await assert.rejects(readFile(path.join(b.root,'.observanda/postgresql/data/PG_VERSION')),{code:'ENOENT'});
 assert.deepEqual(await query(first.env,'SELECT value FROM retained'),[{value:23}]);
 await first.close();assert.equal(budget.stats().reservedBytes,0);
 const second=await f.start(b,{budget});await second.close();const reopened=await f.start(a,{budget});
 assert.deepEqual(await query(reopened.env,'SELECT value FROM retained'),[{value:23}]);await reopened.close();assert.equal(budget.stats().managedRuntimes,0);
});

test('workspace databases own separate files, credentials and lifecycle',async t=>{
 const f=await fixture(t),a=await f.create('a'),b=await f.create('b'),first=await f.start(a),second=await f.start(b);
 assert.notEqual(first.env.OBSERVANDA_DATABASE_URL,second.env.OBSERVANDA_DATABASE_URL);
 for(const item of [first,second])await query(item.env,'CREATE TABLE public.probe(value text)');
 await query(first.env,"INSERT INTO public.probe VALUES ('first workspace')");await query(second.env,"INSERT INTO public.probe VALUES ('second workspace')");
 for(const [item,workspace] of [[first,a],[second,b]]){
  const data=path.join(workspace.root,'.observanda','postgresql','data'),pid=await readFile(path.join(data,'postmaster.pid'),'utf8');assert.equal(path.resolve(pid.split('\n')[1].trim()),data);
  const state=await readFile(path.join(workspace.root,'.observanda','postgresql','service.observanda'));assert.equal(state.includes(Buffer.from('appPassword')),false);
 }
 await first.close();assert.deepEqual(await query(second.env,'SELECT value FROM public.probe'),[{value:'second workspace'}]);
 const moved=path.join(f.parent,'another disk location');await rename(a.root,moved);a.root=moved;a.ownerId=randomUUID();
 const reopened=await f.start(a);assert.deepEqual(await query(reopened.env,'SELECT value FROM public.probe'),[{value:'first workspace'}]);
 assert.deepEqual(await query(second.env,'SELECT value FROM public.probe'),[{value:'second workspace'}]);
});

test('portable runtime requires the workspace key and refuses ownership left by another installation',async t=>{
 const f=await fixture(t),workspace=await f.create('protected'),service=await f.start(workspace);await query(service.env,'CREATE TABLE retained(value integer)');await query(service.env,'INSERT INTO retained VALUES (37)');await service.close();
 const file=path.join(workspace.root,'.observanda','postgresql','service.observanda'),bytes=await readFile(file),aad='Observanda/workspace-postgresql/v1/'+workspace.vault.id;
 await assert.rejects(f.start({...workspace,vault:{...workspace.vault,key:randomBytes(32)}}),{code:'ENCRYPTION_DAMAGED'});assert.deepEqual(await readFile(file),bytes);
 const config=JSON.parse(unseal(bytes,workspace.vault.key,aad));config.running=true;config.ownerId=randomUUID();await writeFile(file,seal(Buffer.from(JSON.stringify(config)),workspace.vault.key,aad));
 await assert.rejects(f.start(workspace),{code:'DATABASE_WORKSPACE_RUNNING'});
 await writeFile(file,bytes);const reopened=await f.start(workspace);assert.deepEqual(await query(reopened.env,'SELECT value FROM retained'),[{value:37}]);
});

test('workspace mode cannot target another workspace or an arbitrary database directory',async t=>{
 const f=await fixture(t),workspace=await f.create('selected'),other=await f.create('unrelated');
 await assert.rejects(startManagedPostgres({directory:path.join(other.root,'.observanda','postgresql'),env:environment(),workspace}),{code:'DATABASE_LOCATION'});
});

test('the workspace lifecycle owner retains separate connection targets without changing process configuration',async t=>{
 const manager=new WorkspacePostgres({ownerId:randomUUID(),env:environment()});t.after(()=>manager.close());const f=await fixture(t),a=await f.create('managed a'),b=await f.create('managed b'),prior=process.env.OBSERVANDA_DATABASE_URL;
 const [envA,envB,again]=await Promise.all([manager.open(a.root,a.vault,{create:true}),manager.open(b.root,b.vault,{create:true}),manager.open(a.root,a.vault,{create:true})]);assert.equal(again,envA);
 assert.equal(process.env.OBSERVANDA_DATABASE_URL,prior);assert.notEqual(envA.OBSERVANDA_DATABASE_URL,envB.OBSERVANDA_DATABASE_URL);
 await query(envA,'CREATE TABLE first_only(id integer)');assert.equal((await query(envB,"SELECT to_regclass('public.first_only') AS present"))[0].present,null);
 await assert.rejects(manager.open(a.root,{...a.vault,key:randomBytes(32)}),{code:'ACCESS_DENIED'});
 await manager.closeWorkspace(a.root);assert.equal((await query(envB,'SELECT 37 AS value'))[0].value,37);
 await manager.close();await assert.rejects(manager.open(a.root,a.vault),{code:'DATABASE_CANCELLED'});
});

test('workspace ownership is a filesystem lease released after closing its owner',async t=>{
 const f=await fixture(t),workspace=await f.create('shared folder'),directory=path.join(workspace.root,'.observanda','postgresql');await mkdir(directory);
 const lease=await workspaceDatabaseLease(directory);t.after(()=>lease.close());
 await assert.rejects(workspaceDatabaseLease(directory),{code:'DATABASE_RUNNING'});await lease.close();
 const next=await workspaceDatabaseLease(directory);await next.close();
});

test('cancelled workspace database initialization resumes with its workspace key',async t=>{
 const f=await fixture(t),workspace=await f.create('interrupted'),controller=new AbortController();
 const before=nativeResources.stats().reservedBytes;
 await assert.rejects(startManagedPostgres({directory:path.join(workspace.root,'.observanda','postgresql'),env:environment(),workspace,signal:controller.signal,onProgress:p=>{if(p.stage==='initialize')controller.abort();}}),{code:'DATABASE_CANCELLED'});
 assert.equal(nativeResources.stats().reservedBytes,before);
 const resumed=await f.start(workspace);assert.equal((await query(resumed.env,'SELECT 1 AS intact'))[0].intact,1);
});


test('lifecycle cancellation can stop a database interrupted before initialization completes',async t=>{
 const f=await fixture(t),workspace=await f.create('unfinished initialization'),controller=new AbortController(),directory=path.join(workspace.root,'.observanda/postgresql');
 await assert.rejects(startManagedPostgres({directory,env:environment(),workspace,signal:controller.signal,onProgress:p=>{if(p.stage==='initialize')controller.abort();}}),{code:'DATABASE_CANCELLED'});
 const deleteId=randomUUID(),marker=path.join(workspace.root,'.observanda/delete-workspace.json');await writeFile(marker,JSON.stringify({version:1,id:deleteId,source:workspace.root}));
 const stopped=await stopManagedPostgres({directory,env:environment(),workspace:{...workspace,deleteId}});assert.equal(stopped.stopped,true);await stopped.close();
 const state=JSON.parse(unseal(await readFile(path.join(directory,'service.observanda')),workspace.vault.key,'Observanda/workspace-postgresql/v1/'+workspace.vault.id));assert.equal(state.phase,'initializing');assert.equal(state.running,false);await assert.rejects(readFile(path.join(directory,'data/postmaster.pid')),{code:'ENOENT'});
 await unlink(marker);const resumed=await f.start(workspace);assert.equal((await query(resumed.env,'SELECT 1 AS intact'))[0].intact,1);
});


test('shutdown during workspace admission cannot start a runtime after close returns',async t=>{
 const manager=new WorkspacePostgres({ownerId:randomUUID(),env:environment()});t.after(()=>manager.close());
 const f=await fixture(t),workspace=await f.create('closing admission');
 // open yields at realpath before it owns an entry. close must exclude that
 // admitted filesystem work as well as entries already starting PostgreSQL.
 const opening=manager.open(workspace.root,workspace.vault,{create:true}),refused=assert.rejects(opening,{code:'DATABASE_CANCELLED'});
 await manager.close();await refused;assert.equal(manager.instances.size,0);
 await assert.rejects(readFile(path.join(workspace.root,'.observanda/postgresql/service.observanda')),{code:'ENOENT'});
 await assert.rejects(manager.open(workspace.root,workspace.vault,{create:true}),{code:'DATABASE_CANCELLED'});
});
