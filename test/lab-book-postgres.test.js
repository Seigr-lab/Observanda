import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readdir,readFile,realpath,rename,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {assertLabBookDatabaseStopped} from '../src/lab-book-postgres.js';
import {retainRuntimeEnvironment} from '../src/database-runtime-environment.js';
import {catalogueBinding} from '../src/postgres-activation.js';
import {openCatalogue} from '../src/postgres.js';
import {ownerRoleName} from '../src/owner-database-role.js';
import {seal,unseal,clearVault} from '../src/encryption.js';
import {labBookCatalogueBinding,validLabBookCatalogueBinding,assertLabBookCatalogueOwner,assertLabBookCatalogueEnvironment} from '../src/lab-book-catalogue-owner.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {workDirectory} from '../scripts/work-directory.js';

const environment=()=>{const env={...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN??''};delete env.OBSERVANDA_DATABASE_URL;return env;};
async function using(env,operation){const client=new Client({connectionString:env.OBSERVANDA_DATABASE_URL,statement_timeout:5000});client.on('error',()=>{});await client.connect();try{return await operation(client);}finally{await client.end();}}
const query=(env,sql,...values)=>using(env,async client=>(await client.query(sql,values)).rows);
const schemaOf=id=>'obs_'+id.replaceAll('-','');
// A workspace with one project; lab books live in the project folder. Every
// folder is inside the repository's git-ignored test/run/work.
async function fixture(t){
 const parent=await mkdtemp(path.join(await workDirectory('test-work'),'observanda-lab-book-owner-')),vaults=[];
 const owner=new WorkspaceDatabases({directory:path.join(parent,'application'),ownerId:randomUUID(),env:environment()}),detach=installDatabaseProvider(owner);
 let workspace;
 t.after(async()=>{try{await owner.close();}finally{detach();await clearVault(workspace?.vault);for(const vault of vaults)await clearVault(vault);await rm(parent,{recursive:true,force:true,maxRetries:10,retryDelay:100});}});
 workspace=await encryptedFixture(path.join(parent,'workspace folder'),sampleNotebook());
 const root=await realpath(workspace.workspace.root),workspaceEnv=await owner.instances.cached(root);
 async function owned(relative,kind,{create=true}={}){
  const folder=path.join(root,relative),id=randomUUID(),vault={id:randomUUID(),key:randomBytes(32)};vaults.push(vault);
  await mkdir(path.join(folder,'.observanda'),{recursive:true});
  const value={root:await realpath(folder),id,vault};
  if(create){const db=await openCatalogue(value.root,{create:true,vault,...(kind==='project'?{projectId:id}:{labBookId:id})});value.catalogue=db.id;await db.close();}
  return value;
 }
 const project=await owned('Field Project','project');
 return {parent,owner,root,workspaceEnv,project,book:(name,options)=>owned(path.join('Field Project',name),'lab-book',options)};
}

test('lab books keep their catalogues in the workspace cluster under roles that neither the project nor a sibling holds',async t=>{
 const f=await fixture(t),a=await f.book('Soil observations'),b=await f.book('Water observations'),workspaceBinding=await catalogueBinding(f.root);
 for(const book of [a,b]){
  assert.deepEqual(await catalogueBinding(book.root),{format:'observanda-postgresql',version:7,id:book.catalogue,placement:'lab-book',labBookId:book.id,cluster:workspaceBinding.cluster});
  assert.equal((await readdir(path.join(book.root,'.observanda'))).includes('postgresql'),false);
 }
 assert.equal((await readdir(path.join(f.project.root,'.observanda'))).includes('postgresql'),false);
 const [envA,envB,projectEnv]=await Promise.all([f.owner.labBooks.open(a.root,a.id,a.vault),f.owner.labBooks.open(b.root,b.id,b.vault),f.owner.projects.open(f.project.root,f.project.id,f.project.vault)]);
 const port=new URL(f.workspaceEnv.OBSERVANDA_DATABASE_URL).port;
 for(const [env,book] of [[envA,a],[envB,b]]){
  await assertLabBookCatalogueEnvironment(book.root,book.id,env);assert.equal(new URL(env.OBSERVANDA_DATABASE_URL).port,port);
  assert.deepEqual(await query(env,'SELECT current_user AS role,id::text AS cluster FROM obs_cluster.identity'),[{role:ownerRoleName(book.id),cluster:workspaceBinding.cluster}]);
 }
 // A lab book's rows are private to its own role: the containing project, a
 // sibling book and the workspace application role are all refused.
 for(const [env,schema] of [[envB,schemaOf(a.catalogue)],[projectEnv,schemaOf(a.catalogue)],[f.workspaceEnv,schemaOf(a.catalogue)],[envA,schemaOf(b.catalogue)],[envA,schemaOf(f.project.catalogue)]])
  await assert.rejects(query(env,`SELECT count(*) FROM "${schema}".records`),{code:'42501'},schema);
 const content=Buffer.from('An independently retained observation'),aad='test/lab-book/'+a.id,schema=schemaOf(a.catalogue);
 await query(envA,`CREATE TABLE "${schema}".retained(id integer PRIMARY KEY,payload bytea NOT NULL)`);await query(envA,`INSERT INTO "${schema}".retained VALUES ($1,$2)`,1,seal(content,a.vault.key,aad));
 // Moving the book inside the workspace keeps its binding and its schema.
 await f.owner.closeLabBook(a.root);assert.equal(envA.OBSERVANDA_DATABASE_URL,undefined);await assertLabBookDatabaseStopped(a.root,a.id,a.vault);
 const moved=path.join(f.project.root,'Renamed observations');await rename(a.root,moved);
 const env=await f.owner.labBooks.open(moved,a.id,a.vault);
 assert.deepEqual(unseal((await query(env,`SELECT payload FROM "${schema}".retained WHERE id=1`))[0].payload,a.vault.key,aad),content);assert.equal(env.OBSERVANDA_LAB_BOOK_DATABASE_ROOT,await realpath(moved));
 assert.equal((await readdir(path.join(moved,'.observanda'))).includes('postgresql'),false);
});

test('book identity cannot be substituted with sibling, project or other credentials',async t=>{
 const f=await fixture(t),a=await f.book('Protected Book'),sibling=await f.book('Sibling Book');
 const unbound=await f.book('Unbound',{create:false});await assert.rejects(f.owner.labBooks.open(unbound.root,unbound.id,unbound.vault),{code:'CATALOGUE_UNAVAILABLE'});
 const env=await f.owner.labBooks.open(a.root,a.id,a.vault);
 for(const [id,vault] of [[randomUUID(),a.vault],[a.id,{...a.vault,key:randomBytes(32)}],[a.id,{...a.vault,id:randomUUID()}],[sibling.id,sibling.vault]])await assert.rejects(f.owner.labBooks.open(a.root,id,vault),{code:'ACCESS_DENIED'});
 await f.owner.closeLabBook(a.root);assert.equal(env.OBSERVANDA_DATABASE_URL,undefined);
 for(const vault of [{...a.vault,key:randomBytes(32)},{...a.vault,id:randomUUID()}])await assert.rejects(f.owner.labBooks.open(a.root,a.id,vault),{code:'ACCESS_DENIED'});
 await assert.rejects(f.owner.labBooks.open(a.root,sibling.id,sibling.vault),{code:'DATABASE_LOCATION'});
 await assert.rejects(f.owner.projects.open(a.root,f.project.id,f.project.vault),{code:'DATABASE_LOCATION'});
 const reopened=await f.owner.labBooks.open(a.root,a.id,a.vault);assert.deepEqual(await query(reopened,'SELECT current_user AS role'),[{role:ownerRoleName(a.id)}]);
});

test('book shutdown waits for active leases; a nested earlier cluster is refused unchanged',async t=>{
 const f=await fixture(t),a=await f.book('Leased Book');
 const lease=await f.owner.labBooks.acquire(a.root,a.id,a.vault),release=retainRuntimeEnvironment(lease.env);lease.release();
 let closed=false;const closing=f.owner.closeLabBook(a.root).then(()=>{closed=true;});
 try{assert.equal((await query(lease.env,'SELECT 1 AS alive'))[0].alive,1);assert.equal(closed,false);}finally{release();}
 await closing;assert.equal(lease.env.OBSERVANDA_DATABASE_URL,undefined);await assertLabBookDatabaseStopped(a.root,a.id,a.vault);assert.equal(f.owner.labBooks.stats().open,0);
 const old=await f.book('Earlier format',{create:false}),nested=path.join(old.root,'.observanda','postgresql');await mkdir(nested);await writeFile(path.join(nested,'service.observanda'),'earlier cluster');
 await assert.rejects(f.owner.labBooks.open(old.root,old.id,old.vault,{create:true}),{code:'DATABASE_NESTED_CLUSTER'});
 await assert.rejects(openCatalogue(old.root,{create:true,labBookId:old.id,vault:old.vault}),{code:'DATABASE_NESTED_CLUSTER'});
 assert.equal(await readFile(path.join(nested,'service.observanda'),'utf8'),'earlier cluster');assert.equal(await catalogueBinding(old.root),null);
 assert.deepEqual(await query(f.workspaceEnv,'SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=$1',ownerRoleName(old.id)),[]);
});

test('book catalogue bindings reject ambiguous identities and foreign environments',async t=>{
 const f=await fixture(t),a=await f.book('Binding Book',{create:false}),id=randomUUID(),binding=labBookCatalogueBinding(id,a.id,randomUUID());
 assert.equal(validLabBookCatalogueBinding(binding),true);assertLabBookCatalogueOwner(binding,a.id);
 for(const changed of [{...binding,projectId:randomUUID()},{...binding,placement:'project'},{...binding,version:4},{...binding,version:6},{...binding,labBookId:randomUUID()},{...binding,cluster:'../outside'},(({cluster,...rest})=>rest)(binding)])await assert.rejects(async()=>assertLabBookCatalogueOwner(changed,a.id),{code:'DATABASE_LOCATION'});
 assert.throws(()=>labBookCatalogueBinding('../outside',a.id,randomUUID()),{code:'INVALID'});assert.throws(()=>labBookCatalogueBinding(id,a.id),{code:'INVALID'});
 const env={OBSERVANDA_LAB_BOOK_DATABASE_ROOT:await realpath(a.root),OBSERVANDA_LAB_BOOK_ID:a.id};await assertLabBookCatalogueEnvironment(a.root,a.id,env);
 for(const changed of [{...env,OBSERVANDA_LAB_BOOK_ID:randomUUID()},{...env,OBSERVANDA_LAB_BOOK_DATABASE_ROOT:f.parent},{...env,OBSERVANDA_PROJECT_ID:randomUUID()},{...env,OBSERVANDA_WORKSPACE_DATABASE_ROOT:await realpath(a.root)}])await assert.rejects(assertLabBookCatalogueEnvironment(a.root,a.id,changed),{code:'DATABASE_LOCATION'});
});
