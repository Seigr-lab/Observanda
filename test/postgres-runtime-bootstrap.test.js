import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,realpath,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {startManagedPostgres,runtimeCommand} from '../src/postgres-runtime.js';
import {seal,unseal,clearVault} from '../src/encryption.js';

const renameDatabase='ALTER DATABASE postgres RENAME TO observanda';
const ownDatabase='ALTER DATABASE observanda OWNER TO observanda';
const revokeDatabase='REVOKE ALL ON DATABASE observanda FROM PUBLIC';
const catalogueSQL=`SELECT oid,datname,pg_get_userbyid(datdba) AS owner,datistemplate,datallowconn,encoding,datcollate,datctype,
 EXISTS(SELECT 1 FROM aclexplode(COALESCE(datacl,acldefault('d',datdba))) WHERE grantee=0) AS public_access
 FROM pg_database ORDER BY datname`;
const isBootstrap=client=>client.connectionParameters.user==='observanda_admin'&&client.connectionParameters.database==='template1';
async function usingClient(options,operation){
 const client=new Client(options);client.on('error',()=>{});
 try{await client.connect();return await operation(client);}finally{await client.end();}
}
async function fixture(t){
 const temporaryRoot=await realpath(os.tmpdir()),root=await mkdtemp(path.join(temporaryRoot,'observanda-bootstrap-'));
 const workspace={root,vault:{id:randomUUID(),key:randomBytes(32)},ownerId:randomUUID()},directory=path.join(root,'.observanda','postgresql');
 const stateFile=path.join(directory,'service.observanda'),aad='Observanda/workspace-postgresql/v1/'+workspace.vault.id;
 const env={...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN??process.env.OBSERVANDA_POSTGRES_BIN??''};delete env.OBSERVANDA_DATABASE_URL;
 let service;
 async function state(){const bytes=unseal(await readFile(stateFile),workspace.vault.key,aad);try{return JSON.parse(bytes.toString());}finally{bytes.fill(0);}}
 t.after(async()=>{
  try{
   await service?.close();
   const pid=await readFile(path.join(directory,'data','postmaster.pid'),'utf8').catch(error=>{if(error.code!=='ENOENT')throw error;});
   if(pid){
    assert.equal(path.resolve(pid.split('\n')[1].trim()),path.join(directory,'data'));
    const config=await state();await runtimeCommand(path.join(config.bin,process.platform==='win32'?'pg_ctl.exe':'pg_ctl'),['-D',path.join(directory,'data'),'-m','fast','-w','-t','60','stop']);
   }
   assert.equal(path.dirname(root),temporaryRoot);assert.ok(path.basename(root).startsWith('observanda-bootstrap-'));
   await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }finally{clearVault(workspace.vault);}
 });
 await mkdir(path.join(root,'.observanda'));
 return {env,directory,state,
  async start(){service=await startManagedPostgres({directory,env,workspace});return service;},
  async close(){await service.close();service=null;},
  async phase(phase){const config=await state();config.phase=phase;const bytes=Buffer.from(JSON.stringify(config));try{await writeFile(stateFile,seal(bytes,workspace.vault.key,aad));}finally{bytes.fill(0);}},
  app:operation=>usingClient({connectionString:env.OBSERVANDA_DATABASE_URL},operation),
  async admin(operation,database='template1'){const config=await state();return usingClient({host:'127.0.0.1',port:config.port,user:'observanda_admin',password:config.adminPassword,database,connectionTimeoutMillis:5000},operation);}
 };
}
async function assertApplication(f){
 await f.app(async client=>{
  assert.deepEqual((await client.query("SELECT current_database() AS database,current_user AS role")).rows,[{database:'observanda',role:'observanda'}]);
  assert.deepEqual((await client.query('SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolcanlogin FROM pg_roles WHERE rolname=current_user')).rows,
   [{rolsuper:false,rolcreatedb:false,rolcreaterole:false,rolreplication:false,rolbypassrls:false,rolcanlogin:true}]);
  assert.deepEqual((await client.query("SELECT current_setting('fsync') AS fsync,current_setting('full_page_writes') AS full_page_writes,current_setting('synchronous_commit') AS synchronous_commit,current_setting('data_checksums') AS data_checksums")).rows,
   [{fsync:'on',full_page_writes:'on',synchronous_commit:'on',data_checksums:'on'}]);
  assert.deepEqual((await client.query("SELECT has_database_privilege(current_user,current_database(),'CONNECT') AS connect,has_database_privilege(current_user,current_database(),'CREATE') AS create,has_database_privilege(current_user,current_database(),'TEMPORARY') AS temporary")).rows,
   [{connect:true,create:true,temporary:true}]);
 });
 const databases=await f.admin(async client=>(await client.query(catalogueSQL)).rows),application=databases.find(row=>row.datname==='observanda');
 assert.equal(application.owner,'observanda');assert.equal(application.public_access,false);assert.equal(application.datistemplate,false);assert.equal(application.datallowconn,true);
 return databases;
}

test('fresh managed bootstrap reuses only the built-in database and retains application privileges and durability',async t=>{
 const f=await fixture(t),query=Client.prototype.query;let initial,renames=0;
 const spy=t.mock.method(Client.prototype,'query',async function(sql,...args){
  if(isBootstrap(this)&&sql===renameDatabase){initial=(await query.call(this,catalogueSQL)).rows;renames++;}
  return query.call(this,sql,...args);
 });
 try{await f.start();}finally{spy.mock.restore();}
 assert.equal(renames,1);assert.deepEqual(initial.map(row=>row.datname),['postgres','template0','template1']);
 const databases=await assertApplication(f);assert.deepEqual(databases.map(row=>row.datname),['observanda','template0','template1']);
 const before=initial.find(row=>row.datname==='postgres'),after=databases.find(row=>row.datname==='observanda');
 assert.deepEqual(after,{...before,datname:'observanda',owner:'observanda',public_access:false});
 assert.deepEqual(databases.filter(row=>row.datistemplate),initial.filter(row=>row.datistemplate));
 await f.app(async client=>{await client.query('CREATE TABLE public.bootstrap_retained(value bytea)');await client.query("INSERT INTO public.bootstrap_retained VALUES(decode('00ff807f','hex'))");});
 await f.close();await f.start();assert.deepEqual(await f.admin(async client=>(await client.query(catalogueSQL)).rows),databases);
 assert.deepEqual(await f.app(async client=>(await client.query('SELECT value FROM public.bootstrap_retained')).rows),[{value:Buffer.from('00ff807f','hex')}]);
});

for(const [step,statement] of [['rename',renameDatabase],['ownership',ownDatabase],['permissions',revokeDatabase]]){
 test('managed bootstrap resumes after a committed '+step+' step without publishing an unfinished connection',async t=>{
  const f=await fixture(t),query=Client.prototype.query;let initial,interrupted,failures=0;
  const spy=t.mock.method(Client.prototype,'query',async function(sql,...args){
   if(isBootstrap(this)&&sql===renameDatabase)initial=(await query.call(this,catalogueSQL)).rows.find(row=>row.datname==='postgres');
   const result=await query.call(this,sql,...args);
   if(isBootstrap(this)&&sql===statement){interrupted=(await query.call(this,catalogueSQL)).rows;failures++;throw Error('Injected failure after committed bootstrap '+step);}
   return result;
  });
  try{await assert.rejects(f.start(),{code:'DATABASE_RUNTIME'});}finally{spy.mock.restore();}
  assert.equal(failures,1);assert.equal(f.env.OBSERVANDA_DATABASE_URL,undefined);
  const config=await f.state();assert.equal(config.phase,'initializing');assert.equal(config.running,false);
  await assert.rejects(readFile(path.join(f.directory,'data','postmaster.pid')),{code:'ENOENT'});
  assert.deepEqual(interrupted.map(row=>row.datname),['observanda','template0','template1']);
  const application=interrupted.find(row=>row.datname==='observanda');assert.equal(application.oid,initial.oid);
  assert.equal(application.owner,step==='rename'?'observanda_admin':'observanda');assert.equal(application.public_access,step!=='permissions');
  await f.start();const recovered=await assertApplication(f);
  assert.deepEqual(recovered,interrupted.map(row=>row.datname==='observanda'?{...row,owner:'observanda',public_access:false}:row));
  assert.equal((await f.state()).phase,'ready');
  await f.app(async client=>{await client.query('CREATE TABLE public.recovered(value integer)');await client.query('INSERT INTO public.recovered VALUES(37)');assert.deepEqual((await client.query('SELECT value FROM public.recovered')).rows,[{value:37}]);});
 });
}

async function legacyState(f,{application=true,phase='ready'}={}){
 await f.start();
 await f.admin(async client=>{
  await client.query('ALTER DATABASE observanda RENAME TO postgres');await client.query('ALTER DATABASE postgres OWNER TO observanda_admin');
  if(application){await client.query('CREATE DATABASE observanda OWNER observanda');await client.query(revokeDatabase);}
 });
 await f.admin(async client=>{await client.query('CREATE TABLE public.maintenance_retained(value bytea)');await client.query("INSERT INTO public.maintenance_retained VALUES(decode('00ff7f80','hex'))");},'postgres');
 if(application)await f.app(async client=>{await client.query('CREATE TABLE public.application_retained(value bytea)');await client.query("INSERT INTO public.application_retained VALUES(decode('80ff007f','hex'))");});
 const databases=await f.admin(async client=>(await client.query(catalogueSQL)).rows);await f.close();await f.phase(phase);return databases;
}
for(const phase of ['ready','initializing']){
 test('an existing '+phase+' managed application retains its database identity and legacy maintenance data',async t=>{
  const f=await fixture(t),before=await legacyState(f,{phase}),query=Client.prototype.query,statements=[];
  const spy=t.mock.method(Client.prototype,'query',function(sql,...args){if(isBootstrap(this))statements.push(sql);return query.call(this,sql,...args);});
  try{await f.start();}finally{spy.mock.restore();}
  assert.deepEqual(await assertApplication(f),before);
  assert.equal(statements.includes(renameDatabase),false);assert.equal(statements.some(sql=>sql.startsWith('CREATE DATABASE')),false);
  assert.equal(statements.includes(ownDatabase),phase==='initializing');assert.equal(statements.includes(revokeDatabase),phase==='initializing');
  assert.deepEqual(await f.app(async client=>(await client.query('SELECT value FROM public.application_retained')).rows),[{value:Buffer.from('80ff007f','hex')}]);
  assert.deepEqual(await f.admin(async client=>(await client.query('SELECT value FROM public.maintenance_retained')).rows,'postgres'),[{value:Buffer.from('00ff7f80','hex')}]);
  assert.equal((await f.state()).phase,'ready');
 });
}

test('an older interrupted bootstrap without an application database preserves its maintenance database',async t=>{
 const f=await fixture(t),before=await legacyState(f,{application:false,phase:'initializing'}),query=Client.prototype.query,statements=[];
 const spy=t.mock.method(Client.prototype,'query',function(sql,...args){if(isBootstrap(this))statements.push(sql);return query.call(this,sql,...args);});
 try{await f.start();}finally{spy.mock.restore();}
 const after=await assertApplication(f);assert.deepEqual(after.filter(row=>row.datname!=='observanda'),before);
 assert.deepEqual(after.map(row=>row.datname),['observanda','postgres','template0','template1']);
 assert.equal(statements.includes(renameDatabase),false);assert.equal(statements.filter(sql=>sql==='CREATE DATABASE observanda OWNER observanda').length,1);
 assert.deepEqual(await f.admin(async client=>(await client.query('SELECT value FROM public.maintenance_retained')).rows,'postgres'),[{value:Buffer.from('00ff7f80','hex')}]);
 await f.app(async client=>{await client.query('CREATE TABLE public.resumed(value integer)');await client.query('INSERT INTO public.resumed VALUES(73)');assert.deepEqual((await client.query('SELECT value FROM public.resumed')).rows,[{value:73}]);});
 assert.equal((await f.state()).phase,'ready');
});
