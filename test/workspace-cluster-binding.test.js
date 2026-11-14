import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,rename,cp,readFile,writeFile,readdir,access} from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {startManagedPostgres} from '../src/postgres-runtime.js';
import {seal,unseal,clearVault} from '../src/encryption.js';
import {openCatalogue} from '../src/postgres.js';
import {databaseClusterIdentity} from '../src/database-cluster-identity.js';
import {catalogueBinding,publishCatalogueBinding,workspaceCatalogueBinding,validWorkspaceCatalogueBinding,CATALOGUE_FILE} from '../src/postgres-activation.js';
import {projectCatalogueBinding,validProjectCatalogueBinding} from '../src/project-catalogue-owner.js';
import {labBookCatalogueBinding,validLabBookCatalogueBinding} from '../src/lab-book-catalogue-owner.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {workDirectory} from '../scripts/work-directory.js';

const uuidPattern=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const environment=()=>{const env={...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN??''};delete env.OBSERVANDA_DATABASE_URL;return env;};
async function using(options,operation){const client=new Client(options);client.on('error',()=>{});await client.connect();try{return await operation(client);}finally{await client.end();}}
// Every folder lives in the repository's git-ignored test/run/work.
async function fixture(t){
 const parent=await mkdtemp(path.join(await workDirectory('test-work'),'observanda-cluster-binding-')),active=new Set(),vaults=[];
 t.after(async()=>{for(const service of active)await service.close();for(const vault of vaults)await clearVault(vault);await rm(parent,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const directory=owner=>path.join(owner.root,'.observanda','postgresql');
 const aad=owner=>'Observanda/workspace-postgresql/v1/'+owner.vault.id;
 return {parent,directory,
  async create(relative,vault={id:randomUUID(),key:randomBytes(32)}){const root=path.join(parent,relative);vaults.push(vault);await mkdir(path.join(root,'.observanda'),{recursive:true});return {root,vault,ownerId:randomUUID()};},
  async start(owner,options={}){const env=environment(),service=await startManagedPostgres({directory:directory(owner),env,workspace:owner,...options});active.add(service);return {env,service,close:async()=>{await service.close();active.delete(service);}};},
  async state(owner){const bytes=unseal(await readFile(path.join(directory(owner),'service.observanda')),owner.vault.key,aad(owner));try{return JSON.parse(bytes.toString());}finally{bytes.fill(0);}},
  async save(owner,config){const bytes=Buffer.from(JSON.stringify(config));try{await writeFile(path.join(directory(owner),'service.observanda'),seal(bytes,owner.vault.key,aad(owner)));}finally{bytes.fill(0);}},
  app:(env,operation)=>using({connectionString:env.OBSERVANDA_DATABASE_URL},operation),
  async admin(owner,operation){const config=await this.state(owner);return using({host:'127.0.0.1',port:config.port,user:'observanda_admin',password:config.adminPassword,database:'observanda',connectionTimeoutMillis:5000},operation);},
 };
}
const identityOf=(f,env)=>f.app(env,async client=>(await client.query('SELECT id::text AS id FROM obs_cluster.identity')).rows.map(row=>row.id));

test('a new cluster records one identity, matching its service state, that the application role can only read',async t=>{
 const f=await fixture(t),owner=await f.create('workspace'),started=await f.start(owner),{clusterId}=await f.state(owner);
 assert.match(clusterId,uuidPattern);assert.deepEqual(await identityOf(f,started.env),[clusterId]);
 assert.deepEqual(await f.app(started.env,async client=>(await client.query("SELECT pg_get_userbyid(n.nspowner) AS schema_owner,pg_get_userbyid(c.relowner) AS table_owner FROM pg_namespace n JOIN pg_class c ON c.relnamespace=n.oid AND c.relkind='r' WHERE n.nspname='obs_cluster'")).rows),[{schema_owner:'observanda_admin',table_owner:'observanda_admin'}]);
 for(const statement of ['UPDATE obs_cluster.identity SET id=gen_random_uuid()','DELETE FROM obs_cluster.identity','INSERT INTO obs_cluster.identity(singleton,format,id) VALUES (false,1,gen_random_uuid())','CREATE TABLE obs_cluster.replacement(id uuid)','DROP SCHEMA obs_cluster CASCADE','ALTER TABLE obs_cluster.identity RENAME TO retired'])
  await assert.rejects(f.app(started.env,client=>client.query(statement)),{code:'42501'},statement);
 await started.close();const reopened=await f.start(owner);
 assert.deepEqual(await identityOf(f,reopened.env),[clusterId]);assert.equal((await f.state(owner)).clusterId,clusterId);
});

test('an interrupted bootstrap resumes with the identity saved before initialization',async t=>{
 const f=await fixture(t),owner=await f.create('interrupted'),query=Client.prototype.query;let failures=0;
 const identity=client=>client.connectionParameters.user==='observanda_admin'&&client.connectionParameters.database==='observanda';
 const spy=t.mock.method(Client.prototype,'query',async function(sql,...args){
  const result=await query.call(this,sql,...args);
  if(identity(this)&&sql==='COMMIT'){failures++;throw Error('Injected failure after the identity committed');}
  return result;
 });
 try{await assert.rejects(f.start(owner),{code:'DATABASE_RUNTIME'});}finally{spy.mock.restore();}
 assert.equal(failures,1);const saved=await f.state(owner);assert.equal(saved.phase,'initializing');assert.match(saved.clusterId,uuidPattern);
 await assert.rejects(access(path.join(f.directory(owner),'data','postmaster.pid')),{code:'ENOENT'});
 const resumed=await f.start(owner);assert.equal((await f.state(owner)).phase,'ready');assert.deepEqual(await identityOf(f,resumed.env),[saved.clusterId]);
});

test('an older cluster without an identity is refused before a server starts, also when nested in an owner folder',async t=>{
 const f=await fixture(t),workspace=await f.create('workspace'),project=await f.create(path.join('workspace','Nested project'));
 for(const owner of [workspace,project]){
  await (await f.start(owner)).close();
  const config=await f.state(owner),file=path.join(f.directory(owner),'service.observanda');delete config.clusterId;await f.save(owner,config);const before=await readFile(file);
  await assert.rejects(f.start(owner),{code:'DATABASE_CLUSTER_RETIRED'});
  assert.deepEqual(await readFile(file),before);await assert.rejects(access(path.join(f.directory(owner),'data','postmaster.pid')),{code:'ENOENT'});
  await f.save(owner,{...config,clusterId:'../not-an-identity'});await assert.rejects(f.start(owner),{code:'DATABASE_RUNTIME'});
 }
});

test('a cluster keeps its identity when its stopped workspace folder is moved',async t=>{
 const f=await fixture(t),owner=await f.create('before move'),first=await f.start(owner),{clusterId}=await f.state(owner);
 await f.app(first.env,client=>client.query('CREATE TABLE public.retained(value integer)'));await f.app(first.env,client=>client.query('INSERT INTO public.retained VALUES (41)'));await first.close();
 const moved=path.join(f.parent,'after move');await rename(owner.root,moved);owner.root=moved;owner.ownerId=randomUUID();
 const reopened=await f.start(owner);assert.deepEqual(await identityOf(f,reopened.env),[clusterId]);
 assert.deepEqual(await f.app(reopened.env,async client=>(await client.query('SELECT value FROM public.retained')).rows),[{value:41}]);
});

// The Windows runtime guard binds its admission file to the original folder,
// so a byte copy there is not admitted as it stands (reported for the hand-copy slice).
test('a physical copy of a stopped workspace keeps the cluster identity',{skip:process.platform==='win32'&&'The Windows runtime guard does not admit a byte copy of its folder'},async t=>{
 const f=await fixture(t),owner=await f.create('original'),first=await f.start(owner),{clusterId}=await f.state(owner);await first.close();
 const copy={...owner,root:path.join(f.parent,'copy'),ownerId:randomUUID()};await cp(owner.root,copy.root,{recursive:true,errorOnExist:true,force:false});
 const copied=await f.start(copy);assert.deepEqual(await identityOf(f,copied.env),[clusterId]);await copied.close();
 const original=await f.start(owner);assert.deepEqual(await identityOf(f,original.env),[clusterId]);
});

test('catalogue bindings name their cluster and only that cluster serves them',async t=>{
 const f=await fixture(t),a=await f.create('a'),b=await f.create('b'),first=await f.start(a),second=await f.start(b);
 first.env.OBSERVANDA_WORKSPACE_DATABASE_ROOT=a.root;
 const db=await openCatalogue(a.root,{create:true,env:first.env});await db.close();
 const binding=await catalogueBinding(a.root),bytes=await readFile(path.join(a.root,CATALOGUE_FILE));
 assert.deepEqual(binding,{format:'observanda-postgresql',version:5,id:binding.id,placement:'workspace',cluster:(await f.state(a)).clusterId});
 const reopened=await openCatalogue(a.root,{env:first.env});await reopened.close();
 await assert.rejects(openCatalogue(a.root,{env:second.env}),{code:'CATALOGUE_UNAVAILABLE'});
 await assert.rejects(openCatalogue(a.root,{env:second.env,detached:true}),{code:'CATALOGUE_UNAVAILABLE'});
 assert.deepEqual(await readFile(path.join(a.root,CATALOGUE_FILE)),bytes);
 assert.equal((await f.app(second.env,client=>client.query("SELECT 1 FROM pg_namespace WHERE nspname=$1",['obs_'+binding.id.replaceAll('-','')]))).rowCount,0);
 // A managed cluster whose identity is missing never receives or serves a binding.
 await f.admin(b,client=>client.query('DROP SCHEMA obs_cluster CASCADE'));
 const other=await f.create('unbound');await assert.rejects(openCatalogue(other.root,{create:true,env:second.env}),{code:'DATABASE_CLUSTER_RETIRED'});
 assert.equal(await catalogueBinding(other.root),null);
});

test('a configured server without a managed bootstrap records its identity once for every client',async t=>{
 const f=await fixture(t),owner=await f.create('configured server'),started=await f.start(owner);
 await f.admin(owner,client=>client.query('DROP SCHEMA obs_cluster CASCADE'));
 const clients=await Promise.all([0,1,2].map(async()=>{const client=new Client({connectionString:started.env.OBSERVANDA_DATABASE_URL});client.on('error',()=>{});await client.connect();return client;}));
 try{
  await assert.rejects(databaseClusterIdentity(clients[0],{managed:true}),{code:'DATABASE_CLUSTER_RETIRED'});
  const ids=await Promise.all(clients.map(client=>databaseClusterIdentity(client,{managed:false})));
  assert.match(ids[0],uuidPattern);assert.deepEqual(new Set(ids),new Set([ids[0]]));
  assert.equal(await databaseClusterIdentity(clients[0],{managed:true}),ids[0]);
  assert.deepEqual((await clients[0].query("SELECT has_schema_privilege('public','obs_cluster','USAGE') AS public_usage")).rows,[{public_usage:false}]);
 }finally{for(const client of clients)await client.end();}
});

test('bindings of versions 5, 6 and 7 carry a cluster; older and unknown bindings are refused',async t=>{
 const f=await fixture(t),id=randomUUID(),cluster=randomUUID(),projectId=randomUUID(),labBookId=randomUUID();
 const workspace=workspaceCatalogueBinding(id,cluster),installation=workspaceCatalogueBinding(id,cluster,'installation'),project=projectCatalogueBinding(id,projectId,cluster),book=labBookCatalogueBinding(id,labBookId,cluster);
 assert.deepEqual(workspace,{format:'observanda-postgresql',version:5,id,placement:'workspace',cluster});assert.equal(installation.placement,'installation');
 assert.deepEqual(project,{format:'observanda-postgresql',version:6,id,placement:'project',projectId,cluster});
 assert.deepEqual(book,{format:'observanda-postgresql',version:7,id,placement:'lab-book',labBookId,cluster});
 assert.ok(validWorkspaceCatalogueBinding(workspace)&&validWorkspaceCatalogueBinding(installation)&&validProjectCatalogueBinding(project)&&validLabBookCatalogueBinding(book));
 for(const make of [()=>workspaceCatalogueBinding(id),()=>workspaceCatalogueBinding(id,cluster,'project'),()=>projectCatalogueBinding(id,projectId),()=>labBookCatalogueBinding(id,labBookId,'../cluster')])assert.throws(make,{code:'INVALID'});
 const root=path.join(f.parent,'bound');await mkdir(path.join(root,'.observanda'),{recursive:true});
 for(const [options,expected] of [[{cluster},workspace],[{cluster,installation:true},installation],[{cluster,projectId},project],[{cluster,labBookId},book]]){
  await publishCatalogueBinding(root,id,options);assert.deepEqual(await catalogueBinding(root),expected);
 }
 await assert.rejects(publishCatalogueBinding(root,id,{}),{code:'INVALID'});await assert.rejects(publishCatalogueBinding(root,id,{cluster,installation:true,projectId}),{code:'INVALID'});
 const write=value=>writeFile(path.join(root,CATALOGUE_FILE),JSON.stringify(value));
 const base={format:'observanda-postgresql',id};
 for(const retired of [{...base,version:1},{...base,version:2,placement:'workspace'},{...base,version:3,placement:'project',projectId},{...base,version:4,placement:'lab-book',labBookId}]){
  await write(retired);await assert.rejects(catalogueBinding(root),{code:'CATALOGUE_BINDING_RETIRED'});
 }
 await write({...workspace,version:8});await assert.rejects(catalogueBinding(root),{code:'CATALOGUE_NEWER'});
 for(const damaged of [(({cluster,...rest})=>rest)(workspace),{...workspace,cluster:'../outside'},{...workspace,extra:true},{...project,version:7},{...book,placement:'project'},{...workspace,format:'other'}]){
  await write(damaged);await assert.rejects(catalogueBinding(root),{code:'CATALOGUE_DAMAGED'});
 }
});

test('managed storage refuses an older binding without starting or modifying a database',async t=>{
 const f=await fixture(t),root=path.join(f.parent,'older'),owner=new WorkspaceDatabases({directory:path.join(f.parent,'runtime'),ownerId:randomUUID()});
 t.after(()=>owner.close());await mkdir(path.join(root,'.observanda'),{recursive:true});
 const id=randomUUID(),file=path.join(root,CATALOGUE_FILE);
 for(const [retired,options] of [[{format:'observanda-postgresql',id,placement:'workspace',version:2},{}],[{format:'observanda-postgresql',id,placement:'project',projectId:id,version:3},{projectId:id}],[{format:'observanda-postgresql',id,labBookId:id,placement:'lab-book',version:4},{labBookId:id}]]){
  await writeFile(file,JSON.stringify(retired));const bytes=await readFile(file);
  await assert.rejects(owner.environment(root,options),{code:'CATALOGUE_BINDING_RETIRED'});await assert.rejects(openCatalogue(root,options),{code:'CATALOGUE_BINDING_RETIRED'});
  assert.deepEqual(await readFile(file),bytes);
 }
 assert.equal(owner.instances.instances.size,0);assert.equal(owner.projects.stats().open,0);assert.equal(owner.labBooks.stats().open,0);
 assert.deepEqual(await readdir(path.join(root,'.observanda')),['research.observanda']);
});
