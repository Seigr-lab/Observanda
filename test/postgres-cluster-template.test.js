import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,readFile,writeFile,stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {WorkspacePostgres} from '../src/workspace-postgres.js';
import {unseal,clearVault} from '../src/encryption.js';
import {clusterTemplateDirectory} from '../src/postgres-cluster-template.js';

// Every cluster in these tests is made by the product path that uses the
// installation's template: WorkspacePostgres with a runtime directory.
const environment=()=>{const env={...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN??''};delete env.OBSERVANDA_DATABASE_URL;return env;};
const MAJOR=17;
async function fixture(t){
 const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-cluster-template-')),runtimeDirectory=path.join(parent,'runtime'),vaults=[],progress=[];
 let owner=new WorkspacePostgres({ownerId:randomUUID(),runtimeDirectory,env:environment(),onProgress:({stage})=>progress.push(stage)});
 t.after(async()=>{await owner.close();for(const vault of vaults)await clearVault(vault);await rm(parent,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 async function workspace(name){const root=path.join(parent,name),vault={id:randomUUID(),key:randomBytes(32)};vaults.push(vault);await mkdir(path.join(root,'.observanda'),{recursive:true});return {root,vault};}
 const open=(w,options={})=>owner.open(w.root,w.vault,{create:true,...options});
 const state=async w=>JSON.parse(unseal(await readFile(path.join(w.root,'.observanda/postgresql/service.observanda')),w.vault.key,'Observanda/workspace-postgresql/v1/'+w.vault.id).toString());
 const template=clusterTemplateDirectory(runtimeDirectory,MAJOR),manifest=async()=>JSON.parse(await readFile(path.join(template,'template.observanda'),'utf8'));
 const restart=async()=>{await owner.close();owner=new WorkspacePostgres({ownerId:randomUUID(),runtimeDirectory,env:environment(),onProgress:({stage})=>progress.push(stage)});};
 return {parent,runtimeDirectory,workspace,open,state,template,manifest,progress,restart,owner:()=>owner};
}
async function rows(url,sql){
 const client=new Client({connectionString:url});client.on('error',()=>{});await client.connect();
 try{return (await client.query(sql)).rows;}finally{await client.end();}
}
const admin=(env,password)=>{const url=new URL(env.OBSERVANDA_DATABASE_URL);url.username='observanda_admin';url.password=password;return url.href;};

test('workspaces copied from one template have their own identities and passwords',{timeout:300000},async t=>{
 const f=await fixture(t),a=await f.workspace('first'),b=await f.workspace('second');
 const first=await f.open(a),built=await f.manifest(),second=await f.open(b),[sa,sb]=[await f.state(a),await f.state(b)];
 assert.equal((await f.manifest()).digest,built.digest,'The second cluster reuses the template');
 for(const value of [sa,sb]){assert.equal(value.phase,'ready');assert.equal(value.bootstrapPassword,undefined);assert.equal(value.templateCopy,undefined);}
 assert.notEqual(sa.clusterId,sb.clusterId);assert.notEqual(sa.adminPassword,sb.adminPassword);assert.notEqual(sa.appPassword,sb.appPassword);
 for(const value of [sa,sb])assert.ok(![value.adminPassword,value.appPassword].includes(built.adminPassword));
 for(const [env,value] of [[first,sa],[second,sb]]){
  assert.deepEqual(await rows(env.OBSERVANDA_DATABASE_URL,'SELECT id::text AS id FROM obs_cluster.identity'),[{id:value.clusterId}]);
  assert.deepEqual(await rows(admin(env,value.adminPassword),"SELECT current_user AS role"),[{role:'observanda_admin'}]);
  // The template's administrator password no longer opens a copied cluster.
  await assert.rejects(rows(admin(env,built.adminPassword),'SELECT 1'),{code:'28P01'});
  assert.deepEqual((await rows(admin(env,value.adminPassword),"SELECT rolname FROM pg_roles WHERE rolname !~ '^pg_' ORDER BY rolname")).map(row=>row.rolname),['observanda','observanda_admin']);
 }
 assert.equal(f.progress.filter(stage=>stage==='initialize').length,2);
});

test('creating a second cluster costs a copy, not another initdb',{timeout:300000},async t=>{
 const f=await fixture(t),a=await f.workspace('first'),b=await f.workspace('second');
 let started=performance.now();await f.open(a);const first=performance.now()-started;
 const control=await stat(path.join(f.template,'data','global','pg_control'));
 started=performance.now();await f.open(b);const second=performance.now()-started;
 assert.equal((await stat(path.join(f.template,'data','global','pg_control'))).mtimeMs,control.mtimeMs,'The template was reused unchanged');
 // The first cluster includes the one initdb that builds the template; a
 // regression to initdb per cluster makes the second as slow as the first.
 assert.ok(second<first*0.75,`second cluster took ${Math.round(second)} ms, first ${Math.round(first)} ms`);
});

test('a damaged or mismatched template is rebuilt, never used',{timeout:300000},async t=>{
 const f=await fixture(t),a=await f.workspace('first'),b=await f.workspace('second'),c=await f.workspace('third');
 await f.open(a);const original=await f.manifest();
 // A changed data file: the copy's digest no longer matches the manifest.
 const version=path.join(f.template,'data','PG_VERSION');await writeFile(version,(await readFile(version,'utf8'))+'\n');
 const env=await f.open(b),rebuilt=await f.manifest();
 assert.notEqual(rebuilt.adminPassword,original.adminPassword);assert.equal((await readFile(version,'utf8')).trim(),String(MAJOR));
 assert.deepEqual(await rows(env.OBSERVANDA_DATABASE_URL,'SELECT 1 AS ready'),[{ready:1}]);
 // A manifest naming another PostgreSQL version.
 await writeFile(path.join(f.template,'template.observanda'),JSON.stringify({...rebuilt,version:'postgres (PostgreSQL) '+MAJOR+'.0'}));
 await f.open(c);const replaced=await f.manifest();
 assert.notEqual(replaced.adminPassword,rebuilt.adminPassword);assert.notEqual(replaced.version,'postgres (PostgreSQL) '+MAJOR+'.0');
});

test('an interrupted copy is discarded and copied again',{timeout:300000},async t=>{
 const f=await fixture(t),w=await f.workspace('interrupted'),directory=path.join(w.root,'.observanda/postgresql');
 // A first attempt ends before copying; a killed copy then leaves part of
 // its staging folder inside the admitted runtime folder.
 const early=new AbortController(),first=new WorkspacePostgres({ownerId:randomUUID(),runtimeDirectory:f.runtimeDirectory,env:environment(),signal:early.signal,onProgress:({stage})=>{if(stage==='initialize')early.abort();}});
 try{await assert.rejects(first.open(w.root,w.vault,{create:true}));}finally{await first.close().catch(()=>{});}
 assert.equal((await f.state(w)).phase,'initializing');
 await mkdir(path.join(directory,'cluster-staging','base'),{recursive:true});await writeFile(path.join(directory,'cluster-staging','PG_VERSION'),'1');
 // The owner's lifetime ends after the copy is published, before the server starts.
 const lifetime=new AbortController(),owner=new WorkspacePostgres({ownerId:randomUUID(),runtimeDirectory:f.runtimeDirectory,env:environment(),signal:lifetime.signal,onProgress:({stage})=>{if(stage==='start')lifetime.abort();}});
 try{await assert.rejects(owner.open(w.root,w.vault,{create:true}));}finally{await owner.close().catch(()=>{});}
 const interrupted=await f.state(w);
 assert.equal(interrupted.phase,'initializing');assert.equal(interrupted.templateCopy,true);assert.match(interrupted.bootstrapPassword,/^[a-f0-9]{64}$/);
 assert.equal((await stat(path.join(directory,'data','PG_VERSION'))).isFile(),true);
 const env=await f.open(w),value=await f.state(w);
 assert.equal(value.phase,'ready');assert.equal(value.templateCopy,undefined);assert.equal(value.bootstrapPassword,undefined);assert.equal(value.clusterId,interrupted.clusterId);
 assert.deepEqual(await rows(env.OBSERVANDA_DATABASE_URL,'SELECT id::text AS id FROM obs_cluster.identity'),[{id:value.clusterId}]);
 await assert.rejects(stat(path.join(directory,'cluster-staging')),{code:'ENOENT'});
});

test('the runtime guard admits a copied cluster and verifies its whole tree',{timeout:300000,skip:process.platform!=='win32'},async t=>{
 const f=await fixture(t),w=await f.workspace('admitted'),directory=path.join(w.root,'.observanda/postgresql');
 await f.open(w);await f.restart();
 // Reopening runs the ordinary admission of the workspace runtime.
 assert.deepEqual(await rows((await f.open(w)).OBSERVANDA_DATABASE_URL,'SELECT 1 AS ready'),[{ready:1}]);await f.restart();
 // A full inspection checks the owner and access rules of every member.
 const {windowsMutationFiles}=await import('../src/windows-mutation-files.js'),{acquireWindowsPostgresRuntimeGuard}=await import('../src/windows-postgres-runtime-guard.js');
 const files=await windowsMutationFiles();let guard;
 try{
  const parent=await files.open(path.dirname(directory)),root=await files.open(directory),identities={parentIdentity:parent.identity,expectedIdentity:root.identity};await parent.close();await root.close();
  guard=await acquireWindowsPostgresRuntimeGuard({directory:path.join(f.parent,'inspector')});
  const result=await guard.inspectSource(directory,identities);
  assert.equal(result.subtreeVerified,true);assert.equal(result.identity,identities.expectedIdentity);
 }finally{await guard?.close();await files.close();}
});
