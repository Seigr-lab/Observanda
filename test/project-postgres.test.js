import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {retainRuntimeEnvironment} from '../src/database-runtime-environment.js';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,realpath,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {ProjectPostgres} from '../src/project-postgres.js';
import {runtimeCommand} from '../src/postgres-runtime.js';
import {WorkspacePostgres} from '../src/workspace-postgres.js';
import {seal,unseal,clearVault} from '../src/encryption.js';

const environment=()=>({...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN});
async function connect(env){const client=new Client({connectionString:env.OBSERVANDA_DATABASE_URL,statement_timeout:3000});await client.connect();return client;}
async function query(env,sql,...values){const client=await connect(env);try{return (await client.query(sql,values)).rows;}finally{await client.end();}}
async function fixture(t){
 const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-project-postgres-')),keys=[],owners=[];
 const manager=(Class=ProjectPostgres,options={})=>{const value=new Class({ownerId:randomUUID(),env:environment(),...options});owners.push(value);return value;};
 t.after(async()=>{
  for(const owner of owners)await owner.close();for(const key of keys)clearVault(key);
  const resolved=path.resolve(parent);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('observanda-project-postgres-'));
  await rm(resolved,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 });
 async function project(name){const root=path.join(parent,name),id=randomUUID(),vault={id:randomUUID(),key:randomBytes(32)};keys.push(vault);await mkdir(path.join(root,'.observanda'),{recursive:true});return {root,id,vault};}
 return {parent,manager,project};
}

test('projects have separate physical databases and writers; a stopped project moves independently',async t=>{
 const f=await fixture(t),owner=f.manager(),workspaceOwner=f.manager(WorkspacePostgres),a=await f.project('project-a'),b=await f.project('project-b'),workspace=await f.project('workspace');
 const originalEnvironment=process.env.OBSERVANDA_DATABASE_URL;
 const [envA,envB,workspaceEnv]=await Promise.all([owner.open(a.root,a.id,a.vault,{create:true}),owner.open(b.root,b.id,b.vault,{create:true}),workspaceOwner.open(workspace.root,workspace.vault,{create:true})]);
 assert.equal(process.env.OBSERVANDA_DATABASE_URL,originalEnvironment);
 assert.equal(new Set([envA.OBSERVANDA_DATABASE_URL,envB.OBSERVANDA_DATABASE_URL,workspaceEnv.OBSERVANDA_DATABASE_URL]).size,3);
 for(const [env,project] of [[envA,a],[envB,b]]){
  assert.equal(env.OBSERVANDA_WORKSPACE_DATABASE_ROOT,undefined);assert.equal(env.OBSERVANDA_PROJECT_ID,project.id);assert.equal(env.OBSERVANDA_PROJECT_DATABASE_ROOT,await realpath(project.root));
  const pid=(await readFile(path.join(project.root,'.observanda/postgresql/data/postmaster.pid'),'utf8')).split('\n');assert.equal(path.resolve(pid[1].trim()),path.join(project.root,'.observanda/postgresql/data'));
  await query(env,'CREATE TABLE retained(id integer PRIMARY KEY,payload bytea NOT NULL)');
 }
 const content=Buffer.from('A retained project revision with private content'),aad='test/project/'+a.id;
 await query(envA,'INSERT INTO retained VALUES ($1,$2)',1,seal(content,a.vault.key,aad));
 assert.deepEqual(await query(envB,'SELECT * FROM retained'),[]);
 const aWriter=await connect(envA),workspaceWriter=await connect(workspaceEnv),aOther=await connect(envA);
 try{
  await aWriter.query('BEGIN');await workspaceWriter.query('BEGIN');await aOther.query('BEGIN');
  await aWriter.query('SELECT pg_advisory_xact_lock(37)');await workspaceWriter.query('SELECT pg_advisory_xact_lock(37)');
  assert.equal((await aOther.query('SELECT pg_try_advisory_xact_lock(37) AS locked')).rows[0].locked,false);
  const bWriter=await connect(envB);
  try{await bWriter.query('BEGIN');assert.equal((await bWriter.query('SELECT pg_try_advisory_xact_lock(37) AS locked')).rows[0].locked,true);await bWriter.query('INSERT INTO retained VALUES ($1,$2)',[2,seal(Buffer.from('B saved during other writes'),b.vault.key,'test/project/'+b.id)]);await bWriter.query('COMMIT');}finally{await bWriter.end();}
 }finally{await aWriter.end();await workspaceWriter.end();await aOther.end();}
 assert.equal((await query(envB,'SELECT count(*)::int AS count FROM retained'))[0].count,1);
 assert.equal(await owner.open(a.root,a.id,a.vault),envA);
 // Reopen only the selected project under another installation owner. Neither
 // the workspace database nor the sibling's storage participates in the move.
 await owner.closeProject(a.root);assert.equal(envA.OBSERVANDA_DATABASE_URL,undefined);
 const restarted=await owner.open(a.root,a.id,a.vault);assert.notEqual(restarted,envA);assert.equal((await query(restarted,'SELECT count(*)::int AS count FROM retained'))[0].count,1);await owner.closeProject(a.root);assert.equal(restarted.OBSERVANDA_DATABASE_URL,undefined);
 const moved=path.join(f.parent,'another disk location');await rename(a.root,moved);a.root=moved;
 const destination=f.manager(),reopened=await destination.open(a.root,a.id,a.vault);
 const retained=(await query(reopened,'SELECT payload FROM retained WHERE id=$1',1))[0];assert.deepEqual(unseal(retained.payload,a.vault.key,aad),content);
 assert.equal((await query(envB,'SELECT count(*)::int AS count FROM retained'))[0].count,1);
 assert.equal((await query(workspaceEnv,'SELECT 1 AS alive'))[0].alive,1);
 const state=await readFile(path.join(a.root,'.observanda/postgresql/service.observanda'));assert.equal(state.includes(Buffer.from('appPassword')),false);assert.equal(state.includes(content),false);
});

test('project ownership rejects missing, mismatched and workspace credentials without replacing data',async t=>{
 const f=await fixture(t),owner=f.manager(),a=await f.project('protected'),missing=await f.project('missing');
 await assert.rejects(owner.open(missing.root,missing.id,missing.vault),{code:'CATALOGUE_UNAVAILABLE'});
 await assert.rejects(owner.open(a.root,'../outside',a.vault,{create:true}),{code:'INVALID'});
 const env=await owner.open(a.root,a.id,a.vault,{create:true});await query(env,'CREATE TABLE retained(value integer)');await query(env,'INSERT INTO retained VALUES (37)');
 for(const [id,key] of [[randomUUID(),a.vault],[a.id,{...a.vault,key:randomBytes(32)}],[a.id,{...a.vault,id:randomUUID()}]])await assert.rejects(owner.open(a.root,id,key),{code:'ACCESS_DENIED'});
 const another=f.manager();await assert.rejects(another.open(a.root,a.id,a.vault),{code:'DATABASE_RUNNING'});
 await owner.closeProject(a.root);const stateFile=path.join(a.root,'.observanda/postgresql/service.observanda'),before=await readFile(stateFile);
 for(const [id,key] of [[randomUUID(),a.vault],[a.id,{...a.vault,key:randomBytes(32)}],[a.id,{...a.vault,id:randomUUID()}]])await assert.rejects(another.open(a.root,id,key),{code:'ENCRYPTION_DAMAGED'});
 const workspaceOwner=f.manager(WorkspacePostgres);await assert.rejects(workspaceOwner.open(a.root,a.vault),{code:'ENCRYPTION_DAMAGED'});assert.deepEqual(await readFile(stateFile),before);
 const reopened=await another.open(a.root,a.id,a.vault);assert.deepEqual(await query(reopened,'SELECT value FROM retained'),[{value:37}]);
 await another.close();await assert.rejects(another.open(a.root,a.id,a.vault),{code:'DATABASE_CANCELLED'});
});

test('interrupted project initialization resumes with the same project identity',async t=>{
 const f=await fixture(t),a=await f.project('interrupted'),controller=new AbortController(),owner=f.manager(ProjectPostgres,{signal:controller.signal,onProgress:event=>{if(event.stage==='initialize')controller.abort();}});
 await assert.rejects(owner.open(a.root,a.id,a.vault,{create:true}),{code:'DATABASE_CANCELLED'});
 await owner.close();const next=f.manager(),env=await next.open(a.root,a.id,a.vault,{create:true});assert.equal((await query(env,'SELECT 1 AS alive'))[0].alive,1);
});


test('idle project services are evicted and reopened with saved data while active projects remain live',async t=>{
 const f=await fixture(t),owner=f.manager(ProjectPostgres,{maxIdle:1}),a=await f.project('leased-a'),b=await f.project('leased-b'),c=await f.project('leased-c');
 const first=await owner.acquire(a.root,a.id,a.vault,{create:true});await query(first.env,'CREATE TABLE retained(value integer)');await query(first.env,'INSERT INTO retained VALUES (37)');const active=retainRuntimeEnvironment(first.env);first.release();
 try{
  const second=await owner.acquire(b.root,b.id,b.vault,{create:true});second.release();const third=await owner.acquire(c.root,c.id,c.vault,{create:true});third.release();
  for(let i=0;second.env.OBSERVANDA_DATABASE_URL&&i<200;i++)await delay(50);
  assert.equal(second.env.OBSERVANDA_DATABASE_URL,undefined);assert.equal((await query(first.env,'SELECT value FROM retained'))[0].value,37);assert.equal(owner.stats().active,1);
  active();await owner.closeProject(a.root);const reopened=await owner.acquire(a.root,a.id,a.vault);try{assert.notEqual(reopened.env,first.env);assert.equal((await query(reopened.env,'SELECT value FROM retained'))[0].value,37);}finally{reopened.release();}
 }finally{active();}
});


test('a failed stop does not retain a rejected promise and the same installation recovers its owned project',async t=>{
 const f=await fixture(t),owner=f.manager(),a=await f.project('failed-stop'),env=await owner.open(a.root,a.id,a.vault,{create:true});await query(env,'CREATE TABLE retained(value integer)');await query(env,'INSERT INTO retained VALUES (73)');
 const data=path.join(a.root,'.observanda/postgresql/data');assert.ok(data.startsWith(f.parent+path.sep));const ctl=path.join(process.env.OBSERVANDA_TEST_POSTGRES_BIN,process.platform==='win32'?'pg_ctl.exe':'pg_ctl');await runtimeCommand(ctl,['-D',data,'-m','fast','-w','-t','15','stop']);
 await assert.rejects(owner.closeProject(a.root));assert.equal(env.OBSERVANDA_DATABASE_URL,undefined);assert.equal(owner.stats().open,0);
 const recovered=await owner.acquire(a.root,a.id,a.vault);try{assert.equal((await query(recovered.env,'SELECT value FROM retained'))[0].value,73);}finally{recovered.release();}
});


test('authenticated deletion recovery stops an orphan project runtime without restarting it',async t=>{
 const f=await fixture(t),ownerId=randomUUID(),owner=f.manager(ProjectPostgres,{ownerId}),project=await f.project('orphan'),deleteId=randomUUID();
 const {spawn}=await import('node:child_process'),{writeFile,unlink}=await import('node:fs/promises');
 const child=spawn(process.execPath,['--input-type=module','-e',`import {ProjectPostgres} from './src/project-postgres.js';let input='';for await(const bytes of process.stdin)input+=bytes;const p=JSON.parse(input),owner=new ProjectPostgres({ownerId:p.ownerId,env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}});const env=await owner.open(p.root,p.id,{id:p.vaultId,key:Buffer.from(p.key,'base64')},{create:true});process.stdout.write(JSON.stringify({url:env.OBSERVANDA_DATABASE_URL}));await new Promise(()=>{});`],{cwd:process.cwd(),windowsHide:true,stdio:['pipe','pipe','pipe']});
 const exited=new Promise(resolve=>child.once('exit',resolve));let errors='';child.stderr.on('data',bytes=>errors+=bytes);
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}});
 const env=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Checkpoint timeout: '+errors)),60000);child.once('error',reject);child.once('exit',()=>{clearTimeout(timer);reject(Error('Exited early: '+errors));});child.stdout.once('data',bytes=>{clearTimeout(timer);resolve({OBSERVANDA_DATABASE_URL:JSON.parse(bytes.toString()).url});});child.stdin.end(JSON.stringify({ownerId,root:project.root,id:project.id,vaultId:project.vault.id,key:project.vault.key.toString('base64')}));});
 await query(env,'CREATE TABLE preserved(id integer)');child.kill('SIGKILL');await exited;
 const marker=path.join(project.root,'.observanda/delete-workspace.json');await writeFile(marker,JSON.stringify({version:1,id:deleteId,source:project.root}));
 t.after(async()=>{await unlink(marker).catch(()=>{});await owner.open(project.root,project.id,project.vault).catch(()=>{});});
 await assert.rejects(owner.stopForDeletion(project.root,project.id,project.vault,randomUUID()),{code:'STORAGE_DELETING'});
 const foreign=f.manager(ProjectPostgres,{ownerId:randomUUID()});await assert.rejects(foreign.stopForDeletion(project.root,project.id,project.vault,deleteId),{code:'DATABASE_WORKSPACE_RUNNING'});
 assert.deepEqual(await query(env,'SELECT * FROM preserved'),[]);
 const bytes=await readFile(path.join(project.root,'.observanda/postgresql/data/postmaster.opts'));
 await owner.stopForDeletion(project.root,project.id,project.vault,deleteId);
 await assert.rejects(readFile(path.join(project.root,'.observanda/postgresql/data/postmaster.pid')),{code:'ENOENT'});
 assert.deepEqual(await readFile(path.join(project.root,'.observanda/postgresql/data/postmaster.opts')),bytes);
 await assert.rejects(owner.open(project.root,project.id,project.vault),{code:'STORAGE_DELETING'});
 await owner.stopForDeletion(project.root,project.id,project.vault,deleteId);
 await unlink(marker);const reopened=await owner.open(project.root,project.id,project.vault);assert.deepEqual(await query(reopened,'SELECT * FROM preserved'),[]);
});


test('invalid deletion credentials or marker cannot stop a live project',async t=>{
 const f=await fixture(t),owner=f.manager(),p=await f.project('live-delete'),env=await owner.open(p.root,p.id,p.vault,{create:true}),deleteId=randomUUID(),marker=path.join(p.root,'.observanda/delete-workspace.json');
 const {writeFile,unlink}=await import('node:fs/promises');
 await assert.rejects(owner.stopForDeletion(p.root,p.id,p.vault,deleteId),{code:'STORAGE_DELETE_STATE'});assert.equal((await query(env,'SELECT 1 AS alive'))[0].alive,1);
 await writeFile(marker,JSON.stringify({version:1,id:deleteId,source:p.root}));
 for(const [id,vault,receipt,code] of [[p.id,p.vault,randomUUID(),'STORAGE_DELETING'],[p.id,{...p.vault,key:randomBytes(32)},deleteId,'ACCESS_DENIED'],[randomUUID(),p.vault,deleteId,'ACCESS_DENIED']]){
  await assert.rejects(owner.stopForDeletion(p.root,id,vault,receipt),{code});assert.equal((await query(env,'SELECT 1 AS alive'))[0].alive,1);
 }
 await writeFile(marker,JSON.stringify({version:1,id:deleteId,source:f.parent}));await assert.rejects(owner.stopForDeletion(p.root,p.id,p.vault,deleteId),{code:'STORAGE_DELETE_STATE'});assert.equal((await query(env,'SELECT 1 AS alive'))[0].alive,1);
 await unlink(marker);
 const empty=await f.project('empty-delete');await writeFile(path.join(empty.root,'.observanda/delete-workspace.json'),JSON.stringify({version:1,id:deleteId,source:empty.root}));
 await assert.rejects(owner.stopForDeletion(empty.root,empty.id,empty.vault,deleteId));await assert.rejects(readFile(path.join(empty.root,'.observanda/postgresql/service.observanda')),{code:'ENOENT'});
});
