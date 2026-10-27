import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {mkdtemp,realpath,rm,readFile,access} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {Client} from 'pg';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {startScratchPostgres} from '../src/scratch-postgres.js';
import {installDatabaseProvider,databaseProvider} from '../src/workspace-database-context.js';
import {nativeResources} from '../src/native-resource-budget.js';

const environment=()=>{const env={...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN};delete env.OBSERVANDA_DATABASE_URL;return env;};
async function query(env,sql){const client=new Client({connectionString:env.OBSERVANDA_DATABASE_URL,connectionTimeoutMillis:1000});client.on('error',()=>{});await client.connect();try{return (await client.query(sql)).rows;}finally{await client.end();}}
async function eventually(check){const until=Date.now()+30000;for(;;){if(await check())return;if(Date.now()>until)assert.fail('Temporary database did not close');await pause(100);}}
const absent=async file=>{try{await access(file);return false;}catch(error){if(error.code==='ENOENT')return true;throw error;}};
async function directory(t){const parent=await realpath(os.tmpdir()),root=await mkdtemp(path.join(parent,'observanda-query-lifecycle-'));t.after(async()=>{assert.equal(path.dirname(root),parent);assert.ok(path.basename(root).startsWith('observanda-query-lifecycle-'));await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});return root;}

test('temporary database closes with its guardian and isolates a concurrent owner',{timeout:120000},async t=>{
 const before=nativeResources.stats().managedRuntimes;
 const runtimeDirectory=await directory(t),env=environment(),a=await startScratchPostgres({runtimeDirectory,env}),b=await startScratchPostgres({runtimeDirectory,env});
 t.after(()=>Promise.allSettled([a.service.close(),b.service.close()]));
 assert.notEqual(a.root,b.root);assert.notEqual(a.env.OBSERVANDA_DATABASE_URL,b.env.OBSERVANDA_DATABASE_URL);assert.equal(env.OBSERVANDA_DATABASE_URL,undefined);
 assert.equal(nativeResources.stats().managedRuntimes,before+2);
 await query(a.env,'CREATE TABLE transient(value integer)');await query(a.env,'INSERT INTO transient VALUES (37)');
 assert.deepEqual(await query(b.env,"SELECT to_regclass('public.transient') AS found"),[{found:null}]);
 await Promise.all([a.service.close(),a.service.close()]);assert.equal(await absent(a.root),true);assert.equal(a.env.OBSERVANDA_DATABASE_URL,undefined);
 assert.deepEqual(await query(b.env,'SELECT 42 AS retained'),[{retained:42}]);await b.service.close();assert.equal(await absent(b.root),true);
 assert.equal(nativeResources.stats().managedRuntimes,before);
});

test('force terminating the application stops its temporary PostgreSQL without another app launch',{timeout:120000},async t=>{
 const runtimeDirectory=await directory(t),child=fork(new URL('./fixtures/scratch-postgres-parent.js',import.meta.url),[],{windowsHide:true,execArgv:[],env:environment(),stdio:['ignore','ignore','pipe','ipc']});
 const exited=new Promise(resolve=>child.once('exit',resolve));let errors='';child.stderr.on('data',bytes=>errors+=bytes);let root;
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}if(root)await eventually(()=>absent(root));});
 const ready=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',()=>reject(Error('Owner exited early: '+errors)));child.once('message',resolve);});
 child.send({runtimeDirectory});const message=await ready;assert.equal(message.type,'ready');root=message.root;
 const pid=Number((await readFile(path.join(root,'data/postmaster.pid'),'utf8')).split('\n')[0]);assert.ok(pid>0);
 const client=new Client({connectionString:message.url,connectionTimeoutMillis:1000});client.on('error',()=>{});await client.connect();await client.query('BEGIN');await client.query('CREATE TABLE uncommitted(value integer)');
 child.kill('SIGKILL');await exited;await eventually(()=>absent(root));client.connection.stream.destroy();
});

test('shutdown drains temporary and project owners after workspace shutdown fails and rejects new starts',{timeout:120000},async t=>{
 const runtimeDirectory=await directory(t),owner=new WorkspaceDatabases({directory:runtimeDirectory,ownerId:randomUUID(),env:environment()});
 owner.detach=installDatabaseProvider(owner);t.after(()=>owner.close().catch(()=>{}));const env=await owner.scratch(),root=(await owner.scratchStart).root;assert.deepEqual(await query(env,'SELECT 7 AS value'),[{value:7}]);
 const failure=Error('Synthetic workspace shutdown failure'),closeWorkspaces=owner.instances.close.bind(owner.instances);owner.instances.close=async()=>{await closeWorkspaces();throw failure;};let projectClosed=false;
 const closeProjects=owner.projects.close.bind(owner.projects);owner.projects.close=async()=>{try{await closeProjects();}finally{projectClosed=true;}};
 const first=owner.close();assert.equal(owner.close(),first);await assert.rejects(first,error=>error===failure);
 assert.equal(projectClosed,true);assert.equal(databaseProvider(),null);assert.equal(await absent(root),true);assert.equal(env.OBSERVANDA_DATABASE_URL,undefined);
 for(const operation of [()=>owner.scratch(),()=>owner.environment(runtimeDirectory),()=>owner.acquireEnvironment(runtimeDirectory,{projectId:randomUUID()})])await assert.rejects(operation(),{code:'DATABASE_CANCELLED'});
});

test('cancelling temporary database startup cleans its exact directory',{timeout:120000},async t=>{
 const runtimeDirectory=await directory(t),controller=new AbortController();let observed=false;
 await assert.rejects(startScratchPostgres({runtimeDirectory,env:environment(),signal:controller.signal,onProgress:progress=>{if(progress.stage==='initialize'){observed=true;controller.abort();}}}),{code:'DATABASE_CANCELLED'});
 assert.equal(observed,true);
});


test('startup cancellation removes the guardian-created directory before it exits',{timeout:120000},async t=>{
 const runtimeDirectory=await directory(t),child=fork(new URL('../src/scratch-postgres-worker.js',import.meta.url),[],{windowsHide:true,detached:true,execArgv:[],env:environment(),stdio:['ignore','ignore','ignore','ipc']});
 let root,reported,cancelled=false;const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
 child.on('message',message=>{if(message.type==='created')root=message.root;if(message.type==='error')reported=message.code;if(message.type==='progress'&&message.progress.stage==='initialize'){cancelled=true;child.send({type:'close'},()=>{});}});
 child.send({type:'start',runtimeDirectory});assert.equal(await exited,1);assert.equal(cancelled,true);assert.equal(reported,'DATABASE_CANCELLED');assert.equal(typeof root,'string');assert.equal(await absent(root),true);
});

test('provider shutdown waits for a temporary startup already admitted and leaves no service',{timeout:120000},async t=>{
 const runtimeDirectory=await directory(t),owner=new WorkspaceDatabases({directory:runtimeDirectory,ownerId:randomUUID(),env:environment()});t.after(()=>owner.close());
 const starting=owner.scratch(),closing=owner.close();await closing;const env=await starting,root=(await owner.scratchStart).root;
 assert.equal(env.OBSERVANDA_DATABASE_URL,undefined);assert.equal(await absent(root),true);await assert.rejects(owner.scratch(),{code:'DATABASE_CANCELLED'});
});
