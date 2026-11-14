import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readdir,readFile,realpath,rm,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {assertProjectDatabaseStopped} from '../src/project-postgres.js';
import {retainRuntimeEnvironment} from '../src/database-runtime-environment.js';
import {catalogueBinding,publishCatalogueBinding} from '../src/postgres-activation.js';
import {openCatalogue} from '../src/postgres.js';
import {ownerRoleName} from '../src/owner-database-role.js';
import {seal,unseal,clearVault} from '../src/encryption.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {workDirectory} from '../scripts/work-directory.js';

const environment=()=>{const env={...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN??''};delete env.OBSERVANDA_DATABASE_URL;return env;};
async function using(env,operation){const client=new Client({connectionString:env.OBSERVANDA_DATABASE_URL,statement_timeout:5000});client.on('error',()=>{});await client.connect();try{return await operation(client);}finally{await client.end();}}
const query=(env,sql,...values)=>using(env,async client=>(await client.query(sql,values)).rows);
const schemaOf=id=>'obs_'+id.replaceAll('-','');
// One workspace runtime per test, inside the repository's git-ignored test/run/work.
async function fixture(t,{projectRuntime={}}={}){
 const parent=await mkdtemp(path.join(await workDirectory('test-work'),'observanda-project-postgres-')),vaults=[];
 const owner=new WorkspaceDatabases({directory:path.join(parent,'application'),ownerId:randomUUID(),env:environment(),projectRuntime}),detach=installDatabaseProvider(owner);
 let workspace;
 t.after(async()=>{try{await owner.close();}finally{detach();await clearVault(workspace?.vault);for(const vault of vaults)await clearVault(vault);await rm(parent,{recursive:true,force:true,maxRetries:10,retryDelay:100});}});
 workspace=await encryptedFixture(path.join(parent,'workspace folder'),sampleNotebook());
 const root=await realpath(workspace.workspace.root),workspaceEnv=await owner.instances.cached(root);
 async function project(relative,{create=true}={}){
  const folder=path.join(root,relative),id=randomUUID(),vault={id:randomUUID(),key:randomBytes(32)};vaults.push(vault);
  await mkdir(path.join(folder,'.observanda'),{recursive:true});
  const value={root:await realpath(folder),id,vault};
  if(create){const db=await openCatalogue(value.root,{create:true,projectId:id,vault});value.catalogue=db.id;await db.close();}
  return value;
 }
 return {parent,owner,root,workspaceEnv,project};
}

test('projects keep their catalogues in the workspace cluster under their own roles and never create a nested cluster',async t=>{
 const f=await fixture(t),a=await f.project('Project A'),b=await f.project(path.join('Project A','Sub-project B'));
 const workspaceBinding=await catalogueBinding(f.root);assert.equal(workspaceBinding.placement,'workspace');
 for(const project of [a,b]){
  const binding=await catalogueBinding(project.root);
  assert.deepEqual(binding,{format:'observanda-postgresql',version:6,id:project.catalogue,placement:'project',projectId:project.id,cluster:workspaceBinding.cluster});
  // The project folder holds no PostgreSQL cluster of its own.
  assert.equal((await readdir(path.join(project.root,'.observanda'))).includes('postgresql'),false);
 }
 const [envA,envB]=await Promise.all([f.owner.projects.open(a.root,a.id,a.vault),f.owner.projects.open(b.root,b.id,b.vault)]);
 const workspaceUrl=new URL(f.workspaceEnv.OBSERVANDA_DATABASE_URL);
 for(const [env,project] of [[envA,a],[envB,b]]){
  const url=new URL(env.OBSERVANDA_DATABASE_URL);assert.equal(url.host,workspaceUrl.host);assert.equal(url.pathname,'/observanda');
  assert.equal(env.OBSERVANDA_PROJECT_ID,project.id);assert.equal(env.OBSERVANDA_PROJECT_DATABASE_ROOT,project.root);assert.equal(env.OBSERVANDA_WORKSPACE_DATABASE_ROOT,undefined);
  assert.deepEqual(await query(env,'SELECT current_user AS role,id::text AS cluster FROM obs_cluster.identity'),[{role:ownerRoleName(project.id),cluster:workspaceBinding.cluster}]);
  assert.deepEqual(await query(env,'SELECT pg_catalog.pg_get_userbyid(nspowner) AS owner FROM pg_catalog.pg_namespace WHERE nspname=$1',schemaOf(project.catalogue)),[{owner:ownerRoleName(project.id)}]);
 }
 // Each role reads its own schema only; the workspace application role reads neither.
 assert.equal((await query(envA,`SELECT count(*)::int AS count FROM "${schemaOf(a.catalogue)}".records`))[0].count>=0,true);
 for(const [env,schema] of [[envA,schemaOf(b.catalogue)],[envB,schemaOf(a.catalogue)],[f.workspaceEnv,schemaOf(a.catalogue)],[f.workspaceEnv,schemaOf(b.catalogue)]])
  await assert.rejects(query(env,`SELECT count(*) FROM "${schema}".records`),{code:'42501'},schema);
 for(const env of [envA,envB])await assert.rejects(query(env,`SELECT count(*) FROM "${schemaOf(workspaceBinding.id)}".records`),{code:'42501'});
 const roles=await query(f.workspaceEnv,'SELECT rolname,rolsuper,rolcreaterole,rolcreatedb,rolinherit,rolbypassrls FROM pg_catalog.pg_roles WHERE rolname=ANY($1) ORDER BY rolname',[ownerRoleName(a.id),ownerRoleName(b.id)].sort());
 assert.deepEqual(roles,[ownerRoleName(a.id),ownerRoleName(b.id)].sort().map(rolname=>({rolname,rolsuper:false,rolcreaterole:false,rolcreatedb:false,rolinherit:false,rolbypassrls:false})));
 // Encrypted payloads reopen from the same schema after the project closes.
 const content=Buffer.from('A retained project revision'),aad='test/project/'+a.id;
 await query(envA,`CREATE TABLE "${schemaOf(a.catalogue)}".retained(id integer PRIMARY KEY,payload bytea NOT NULL)`);
 await query(envA,`INSERT INTO "${schemaOf(a.catalogue)}".retained VALUES ($1,$2)`,1,seal(content,a.vault.key,aad));
 await f.owner.closeProject(a.root);assert.equal(envA.OBSERVANDA_DATABASE_URL,undefined);
 const reopened=await f.owner.projects.open(a.root,a.id,a.vault);assert.notEqual(reopened,envA);
 assert.deepEqual(unseal((await query(reopened,`SELECT payload FROM "${schemaOf(a.catalogue)}".retained WHERE id=1`))[0].payload,a.vault.key,aad),content);
 assert.equal((await query(f.workspaceEnv,'SELECT 1 AS alive'))[0].alive,1);
});

test('a project key, vault or identity of another owner cannot log in and changes nothing',async t=>{
 const f=await fixture(t),a=await f.project('Protected'),b=await f.project('Sibling');
 await assert.rejects(f.owner.projects.open(a.root,'../outside',a.vault),{code:'INVALID'});
 const env=await f.owner.projects.open(a.root,a.id,a.vault);
 const wrong=[[randomUUID(),a.vault],[a.id,{...a.vault,key:randomBytes(32)}],[a.id,{...a.vault,id:randomUUID()}],[b.id,b.vault]];
 // While the project is open, another identity is refused before any login.
 for(const [id,vault] of wrong)await assert.rejects(f.owner.projects.open(a.root,id,vault),{code:'ACCESS_DENIED'});
 // Once closed, the role login itself refuses keys and vaults that are not the project's.
 await f.owner.closeProject(a.root);assert.equal(env.OBSERVANDA_DATABASE_URL,undefined);
 for(const [id,vault] of wrong.slice(1,3))await assert.rejects(f.owner.projects.open(a.root,id,vault),{code:'ACCESS_DENIED'});
 await assert.rejects(f.owner.projects.open(a.root,b.id,b.vault),{code:'DATABASE_LOCATION'});
 const reopened=await f.owner.projects.open(a.root,a.id,a.vault);
 assert.deepEqual(await query(reopened,'SELECT current_user AS role'),[{role:ownerRoleName(a.id)}]);
});

test('a project opens only inside an open workspace and in the cluster its binding names',async t=>{
 const f=await fixture(t),a=await f.project('Bound');
 // A project folder outside every workspace has no database.
 const outside=path.join(f.parent,'outside'),id=randomUUID(),vault={id:randomUUID(),key:randomBytes(32)};await mkdir(path.join(outside,'.observanda'),{recursive:true});
 try{await assert.rejects(f.owner.projects.open(outside,id,vault,{create:true}),{code:'DATABASE_LOCATION'});}finally{await clearVault(vault);}
 // Another cluster's binding is never served by this workspace.
 const foreign=await f.project('Foreign',{create:false});await publishCatalogueBinding(foreign.root,randomUUID(),{cluster:randomUUID(),projectId:foreign.id});
 const bytes=await readFile(path.join(foreign.root,'.observanda/research.observanda'));
 await assert.rejects(f.owner.projects.open(foreign.root,foreign.id,foreign.vault),{code:'CATALOGUE_UNAVAILABLE'});
 assert.deepEqual(await readFile(path.join(foreign.root,'.observanda/research.observanda')),bytes);
 assert.deepEqual(await query(f.workspaceEnv,'SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=$1',ownerRoleName(foreign.id)),[]);
 // Closing the workspace drains and closes its projects; they never start a cluster.
 const env=await f.owner.projects.open(a.root,a.id,a.vault);
 await f.owner.closeWorkspace(f.root);assert.equal(env.OBSERVANDA_DATABASE_URL,undefined);assert.equal(f.owner.projects.stats().open,0);
 await assert.rejects(f.owner.projects.open(a.root,a.id,a.vault),{code:'ACCESS_LOCKED'});
 assert.equal((await readdir(path.join(a.root,'.observanda'))).includes('postgresql'),false);
});

test('a project folder holding an earlier per-project cluster is refused unchanged',async t=>{
 const f=await fixture(t),bound=await f.project('Converted later'),fresh=await f.project('Never converted',{create:false});
 for(const project of [bound,fresh]){
  const nested=path.join(project.root,'.observanda','postgresql');await mkdir(nested);await writeFile(path.join(nested,'service.observanda'),'earlier cluster');
  const before=await readdir(path.join(project.root,'.observanda'));
  await assert.rejects(f.owner.projects.open(project.root,project.id,project.vault,{create:true}),{code:'DATABASE_NESTED_CLUSTER'});
  await assert.rejects(openCatalogue(project.root,{projectId:project.id,vault:project.vault,create:project===fresh}),{code:'DATABASE_NESTED_CLUSTER'});
  await assert.rejects(assertProjectDatabaseStopped(project.root,project.id,project.vault),{code:'DATABASE_NESTED_CLUSTER'});
  assert.deepEqual(await readdir(path.join(project.root,'.observanda')),before);assert.equal(await readFile(path.join(nested,'service.observanda'),'utf8'),'earlier cluster');
 }
 assert.deepEqual(await query(f.workspaceEnv,'SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=$1',ownerRoleName(fresh.id)),[]);
});

test('idle projects release their environment and reopen with saved data while active projects stay live',async t=>{
 const f=await fixture(t,{projectRuntime:{maxIdle:1}}),a=await f.project('Leased A'),b=await f.project('Leased B'),c=await f.project('Leased C');
 const first=await f.owner.projects.acquire(a.root,a.id,a.vault),schema=schemaOf(a.catalogue);
 await query(first.env,`CREATE TABLE "${schema}".retained(value integer)`);await query(first.env,`INSERT INTO "${schema}".retained VALUES (37)`);
 const active=retainRuntimeEnvironment(first.env);first.release();
 try{
  const second=await f.owner.projects.acquire(b.root,b.id,b.vault);second.release();const third=await f.owner.projects.acquire(c.root,c.id,c.vault);third.release();
  for(let i=0;second.env.OBSERVANDA_DATABASE_URL&&i<200;i++)await delay(50);
  assert.equal(second.env.OBSERVANDA_DATABASE_URL,undefined);assert.equal((await query(first.env,`SELECT value FROM "${schema}".retained`))[0].value,37);assert.equal(f.owner.projects.stats().active,1);
  active();await f.owner.closeProject(a.root);
  const reopened=await f.owner.projects.acquire(a.root,a.id,a.vault);
  try{assert.notEqual(reopened.env,first.env);assert.equal((await query(reopened.env,`SELECT value FROM "${schema}".retained`))[0].value,37);}finally{reopened.release();}
 }finally{active();}
});

test('deletion freezes the marked project, drops its schemas and role, and leaves the workspace cluster running',async t=>{
 const f=await fixture(t),p=await f.project('Live delete'),sibling=await f.project('Sibling stays'),deleteId=randomUUID(),marker=path.join(p.root,'.observanda/delete-workspace.json');
 const env=await f.owner.projects.open(p.root,p.id,p.vault),siblingEnv=await f.owner.projects.open(sibling.root,sibling.id,sibling.vault),hex=p.catalogue.replaceAll('-','');
 await query(env,`CREATE SCHEMA "obm_${hex}_calculator"`);
 const owned=async catalogue=>(await query(f.workspaceEnv,'SELECT nspname FROM pg_catalog.pg_namespace WHERE nspname=$1 OR starts_with(nspname,$2) ORDER BY nspname','obs_'+catalogue.replaceAll('-',''),'obm_'+catalogue.replaceAll('-','')+'_')).map(row=>row.nspname);
 const role=async id=>(await query(f.workspaceEnv,'SELECT rolname FROM pg_catalog.pg_roles WHERE rolname=$1',ownerRoleName(id))).length;
 assert.deepEqual(await owned(p.catalogue),['obm_'+hex+'_calculator','obs_'+hex]);
 await assert.rejects(f.owner.stopProjectForDeletion(p.root,p.id,p.vault,deleteId),{code:'STORAGE_DELETE_STATE'});assert.equal((await query(env,'SELECT 1 AS alive'))[0].alive,1);
 await writeFile(marker,JSON.stringify({version:1,id:deleteId,source:p.root}));
 for(const [id,vault,receipt,code] of [[p.id,p.vault,randomUUID(),'STORAGE_DELETING'],[p.id,{...p.vault,key:randomBytes(32)},deleteId,'ACCESS_DENIED'],[randomUUID(),p.vault,deleteId,'ACCESS_DENIED']]){
  await assert.rejects(f.owner.stopProjectForDeletion(p.root,id,vault,receipt),{code});assert.equal((await query(env,'SELECT 1 AS alive'))[0].alive,1);
 }
 await assert.rejects(assertProjectDatabaseStopped(p.root,p.id,p.vault),{code:'DATABASE_WORKSPACE_RUNNING'});
 await f.owner.stopProjectForDeletion(p.root,p.id,p.vault,deleteId);
 assert.equal(env.OBSERVANDA_DATABASE_URL,undefined);await assertProjectDatabaseStopped(p.root,p.id,p.vault);
 // The deleted project's catalogue and role leave the cluster; its sibling's stay.
 assert.deepEqual(await owned(p.catalogue),[]);assert.equal(await role(p.id),0);
 assert.deepEqual(await owned(sibling.catalogue),['obs_'+sibling.catalogue.replaceAll('-','')]);assert.equal(await role(sibling.id),1);
 await assert.rejects(f.owner.projects.open(p.root,p.id,p.vault),{code:'STORAGE_DELETING'});
 assert.equal((await query(siblingEnv,'SELECT 1 AS alive'))[0].alive,1);assert.equal((await query(f.workspaceEnv,'SELECT 1 AS alive'))[0].alive,1);
 // A resumed deletion repeats the step without error and removes nothing else.
 await f.owner.stopProjectForDeletion(p.root,p.id,p.vault,deleteId);
 assert.deepEqual(await owned(p.catalogue),[]);assert.equal(await role(p.id),0);assert.equal(await role(sibling.id),1);
});
