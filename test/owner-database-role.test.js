import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {startManagedPostgres} from '../src/postgres-runtime.js';
import {unseal,clearVault} from '../src/encryption.js';
import {ownerRoleName,ownerRoleCredentials,ensureOwnerRole,verifyOwnerLogin} from '../src/owner-database-role.js';
import {workDirectory} from '../scripts/work-directory.js';

const environment=()=>{const env={...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN??''};delete env.OBSERVANDA_DATABASE_URL;return env;};
async function using(options,operation){const client=new Client(options);client.on('error',()=>{});await client.connect();try{return await operation(client);}finally{await client.end();}}
// A workspace cluster inside the repository's git-ignored test/run/work.
async function cluster(t){
 const parent=await mkdtemp(path.join(await workDirectory('test-work'),'observanda-owner-role-')),root=path.join(parent,'workspace'),vault={id:randomUUID(),key:randomBytes(32)};
 await mkdir(path.join(root,'.observanda'),{recursive:true});
 const env=environment(),service=await startManagedPostgres({directory:path.join(root,'.observanda','postgresql'),env,workspace:{root,vault,ownerId:randomUUID()}});
 t.after(async()=>{try{await service.close();}finally{await clearVault(vault);await rm(parent,{recursive:true,force:true,maxRetries:10,retryDelay:100});}});
 const bytes=unseal(await readFile(path.join(root,'.observanda','postgresql','service.observanda')),vault.key,'Observanda/workspace-postgresql/v1/'+vault.id);let config;try{config=JSON.parse(bytes.toString());}finally{bytes.fill(0);}
 const admin=operation=>using({host:'127.0.0.1',port:config.port,user:'observanda_admin',password:config.adminPassword,database:'observanda'},operation);
 const ownerUrl=({role,password})=>{const url=new URL(env.OBSERVANDA_DATABASE_URL);url.username=role;url.password=password;return url.toString();};
 return {env,service,admin,ownerUrl};
}

test('owner roles are derived from the owner key, created once with no wider rights and never reset',async t=>{
 const c=await cluster(t),ownerId=randomUUID(),vault={id:randomUUID(),key:randomBytes(32)},credentials=ownerRoleCredentials(ownerId,vault);
 t.after(()=>clearVault(vault));
 assert.equal(credentials.role,ownerRoleName(ownerId));assert.match(credentials.role,/^obo_[a-f0-9]{32}$/);assert.match(credentials.password,/^[a-f0-9]{64}$/);
 assert.deepEqual(ownerRoleCredentials(ownerId,vault),credentials);
 for(const other of [ownerRoleCredentials(randomUUID(),vault),ownerRoleCredentials(ownerId,{...vault,key:randomBytes(32)}),ownerRoleCredentials(ownerId,{...vault,id:randomUUID()})])assert.notEqual(other.password,credentials.password);
 assert.throws(()=>ownerRoleCredentials('../outside',vault),{code:'INVALID'});assert.throws(()=>ownerRoleCredentials(ownerId,{id:vault.id}),{code:'ACCESS_LOCKED'});
 // The running service creates the role; the login verifies the derived password.
 await c.service.ownerRole(credentials.role,credentials.password);await verifyOwnerLogin(c.ownerUrl(credentials));
 assert.deepEqual(await c.admin(async client=>(await client.query('SELECT rolsuper,rolcreaterole,rolcreatedb,rolinherit,rolreplication,rolbypassrls,rolcanlogin FROM pg_roles WHERE rolname=$1',[credentials.role])).rows),[{rolsuper:false,rolcreaterole:false,rolcreatedb:false,rolinherit:false,rolreplication:false,rolbypassrls:false,rolcanlogin:true}]);
 // Another key never replaces the password of an existing role.
 const wrong={role:credentials.role,password:randomBytes(32).toString('hex')};
 assert.deepEqual(await c.admin(client=>ensureOwnerRole(client,wrong)),{created:false});
 await assert.rejects(verifyOwnerLogin(c.ownerUrl(wrong)),{code:'ACCESS_DENIED'});await verifyOwnerLogin(c.ownerUrl(credentials));
 // The owner can create its own schemas, read the cluster identity, and nothing of the application role.
 await using({connectionString:c.ownerUrl(credentials)},async client=>{
  await client.query('CREATE SCHEMA owner_private');await client.query('CREATE TABLE owner_private.rows(id integer)');
  assert.equal((await client.query('SELECT count(*)::int AS count FROM obs_cluster.identity')).rows[0].count,1);
  await assert.rejects(client.query('CREATE ROLE escalated'),{code:'42501'});await assert.rejects(client.query('CREATE DATABASE escalated'),{code:'42501'});
 });
 await using({connectionString:c.env.OBSERVANDA_DATABASE_URL},client=>assert.rejects(client.query('SELECT * FROM owner_private.rows'),{code:'42501'}));
 // A role with wider rights or memberships is refused, not adopted.
 const widened=ownerRoleCredentials(randomUUID(),vault),member=ownerRoleCredentials(randomUUID(),vault);
 await c.admin(client=>client.query('CREATE ROLE '+widened.role+" LOGIN CREATEDB PASSWORD '"+widened.password+"'"));
 await c.admin(async client=>{await client.query('CREATE ROLE '+member.role+" LOGIN NOINHERIT PASSWORD '"+member.password+"'");await client.query('GRANT observanda TO '+member.role);});
 for(const value of [widened,member])await assert.rejects(c.service.ownerRole(value.role,value.password),{code:'DATABASE_RUNTIME'});
 for(const value of [{role:'observanda',password:credentials.password},{role:credentials.role,password:'short'}])await assert.rejects(c.admin(client=>ensureOwnerRole(client,value)),{code:'DATABASE_RUNTIME'});
 // After the service closes it no longer administers roles.
 await c.service.close();await assert.rejects(c.service.ownerRole(credentials.role,credentials.password),{code:'DATABASE_CANCELLED'});
});

test('removing an owner catalogue drops only that owner\'s schemas, then its role once it owns nothing',async t=>{
 const c=await cluster(t),vault={id:randomUUID(),key:randomBytes(32)},a=ownerRoleCredentials(randomUUID(),vault),b=ownerRoleCredentials(randomUUID(),vault),first=randomUUID(),second=randomUUID(),hex=id=>id.replaceAll('-','');
 t.after(()=>clearVault(vault));
 for(const value of [a,b])await c.service.ownerRole(value.role,value.password);
 await using({connectionString:c.ownerUrl(a)},async client=>{for(const name of ['obs_'+hex(first),'obm_'+hex(first)+'_calculator','obs_'+hex(second)])await client.query('CREATE SCHEMA "'+name+'"');});
 const schemas=()=>c.admin(async client=>(await client.query("SELECT nspname FROM pg_namespace WHERE nspname LIKE 'ob_\_%' AND nspname<>'obs_cluster' ORDER BY nspname")).rows.map(row=>row.nspname));
 const roles=()=>c.admin(async client=>(await client.query('SELECT rolname FROM pg_roles WHERE rolname=ANY($1) ORDER BY rolname',[[a.role,b.role]])).rows.map(row=>row.rolname));
 // Another owner's role never removes these schemas.
 await assert.rejects(c.service.dropOwnerCatalogue(b.role,first),{code:'DATABASE_LOCATION'});assert.equal((await schemas()).length,3);
 // One catalogue goes; the role stays while it still owns another one.
 assert.deepEqual(await c.service.dropOwnerCatalogue(a.role,first),{roleDropped:false});assert.deepEqual(await schemas(),['obs_'+hex(second)]);assert.deepEqual(await roles(),[a.role,b.role].sort());
 assert.deepEqual(await c.service.dropOwnerCatalogue(a.role,second),{roleDropped:true});assert.deepEqual(await schemas(),[]);assert.deepEqual(await roles(),[b.role]);
 // A repeated removal is harmless, and the role can be created again for a new activation.
 assert.deepEqual(await c.service.dropOwnerCatalogue(a.role,second),{roleDropped:false});
 await c.service.ownerRole(a.role,a.password);await verifyOwnerLogin(c.ownerUrl(a));
});
