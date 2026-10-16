import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,realpath,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {LabBookPostgres,assertLabBookDatabaseStopped} from '../src/lab-book-postgres.js';
import {ProjectPostgres} from '../src/project-postgres.js';
import {WorkspacePostgres} from '../src/workspace-postgres.js';
import {seal,unseal,clearVault} from '../src/encryption.js';
import {retainRuntimeEnvironment} from '../src/database-runtime-environment.js';
import {labBookCatalogueBinding,validLabBookCatalogueBinding,assertLabBookCatalogueOwner,assertLabBookCatalogueEnvironment} from '../src/lab-book-catalogue-owner.js';

async function connect(env){const client=new Client({connectionString:env.OBSERVANDA_DATABASE_URL,statement_timeout:3000});await client.connect();return client;}
async function query(env,sql,values=[]){const client=await connect(env);try{return (await client.query(sql,values)).rows;}finally{await client.end();}}
async function fixture(t){
 const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-lab-book-owner-')),owners=[],keys=[];
 const manager=(Class=LabBookPostgres,options={})=>{const owner=new Class({ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN},...options});owners.push(owner);return owner;};
 t.after(async()=>{
  for(const owner of owners)await owner.close();for(const key of keys)clearVault(key);
  const resolved=path.resolve(parent);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('observanda-lab-book-owner-'));
  await rm(resolved,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 });
 async function book(name){const root=path.join(parent,'Research Workspace 1','Field Project 1',name),id=randomUUID(),vault={id:randomUUID(),key:randomBytes(32)};keys.push(vault);await mkdir(path.join(root,'.observanda'),{recursive:true});return {root,id,vault};}
 return {parent,manager,book};
}

test('nested lab books have independent databases and writers and retain data after relocation',async t=>{
 const f=await fixture(t),owner=f.manager(),a=await f.book('Soil observations'),b=await f.book('Water observations'),originalUrl=process.env.OBSERVANDA_DATABASE_URL;
 const [envA,envB]=await Promise.all([owner.open(a.root,a.id,a.vault,{create:true}),owner.open(b.root,b.id,b.vault,{create:true})]);
 assert.equal(process.env.OBSERVANDA_DATABASE_URL,originalUrl);assert.notEqual(envA.OBSERVANDA_DATABASE_URL,envB.OBSERVANDA_DATABASE_URL);
 for(const [env,book] of [[envA,a],[envB,b]]){
  await assertLabBookCatalogueEnvironment(book.root,book.id,env);
  const pid=(await readFile(path.join(book.root,'.observanda/postgresql/data/postmaster.pid'),'utf8')).split('\n');assert.equal(path.resolve(pid[1].trim()),path.join(book.root,'.observanda/postgresql/data'));
  await query(env,'CREATE TABLE retained(id integer PRIMARY KEY,payload bytea NOT NULL)');
 }
 const content=Buffer.from('An independently retained observation'),aad='test/lab-book/'+a.id;
 await query(envA,'INSERT INTO retained VALUES ($1,$2)',[1,seal(content,a.vault.key,aad)]);
 assert.deepEqual(await query(envB,'SELECT * FROM retained'),[]);
 const aWriter=await connect(envA),aOther=await connect(envA),bWriter=await connect(envB);
 try{
  await aWriter.query('BEGIN');await aWriter.query('SELECT pg_advisory_xact_lock(37)');
  await aOther.query('BEGIN');assert.equal((await aOther.query('SELECT pg_try_advisory_xact_lock(37) AS locked')).rows[0].locked,false);
  await bWriter.query('BEGIN');assert.equal((await bWriter.query('SELECT pg_try_advisory_xact_lock(37) AS locked')).rows[0].locked,true);
  await bWriter.query('INSERT INTO retained VALUES ($1,$2)',[2,seal(Buffer.from('Sibling writes remain available'),b.vault.key,'test/lab-book/'+b.id)]);await bWriter.query('COMMIT');
 }finally{await aWriter.end();await aOther.end();await bWriter.end();}
 await owner.closeLabBook(a.root);assert.equal(envA.OBSERVANDA_DATABASE_URL,undefined);await assertLabBookDatabaseStopped(a.root,a.id,a.vault);
 const nextProject=path.join(f.parent,'Other Workspace','Other Project');await mkdir(nextProject,{recursive:true});const moved=path.join(nextProject,path.basename(a.root));await rename(a.root,moved);
 const next=f.manager(),env=await next.open(moved,a.id,a.vault),row=(await query(env,'SELECT payload FROM retained WHERE id=1'))[0];
 assert.deepEqual(unseal(row.payload,a.vault.key,aad),content);assert.equal(env.OBSERVANDA_LAB_BOOK_DATABASE_ROOT,await realpath(moved));
 assert.equal((await query(envB,'SELECT count(*)::int AS count FROM retained'))[0].count,1);
 await assert.rejects(readFile(path.join(a.root,'.observanda/postgresql/service.observanda')),{code:'ENOENT'});
});

test('book identity cannot be substituted with sibling, project or workspace credentials',async t=>{
 const f=await fixture(t),owner=f.manager(),a=await f.book('Protected Book');
 await assert.rejects(owner.open(a.root,a.id,a.vault),{code:'CATALOGUE_UNAVAILABLE'});
 const env=await owner.open(a.root,a.id,a.vault,{create:true});await query(env,'CREATE TABLE retained(value integer)');await query(env,'INSERT INTO retained VALUES (37)');
 for(const [id,vault] of [[randomUUID(),a.vault],[a.id,{...a.vault,key:randomBytes(32)}],[a.id,{...a.vault,id:randomUUID()}]])await assert.rejects(owner.open(a.root,id,vault),{code:'ACCESS_DENIED'});
 await owner.closeLabBook(a.root);const file=path.join(a.root,'.observanda/postgresql/service.observanda'),before=await readFile(file);
 const project=f.manager(ProjectPostgres),workspace=f.manager(WorkspacePostgres);
 await assert.rejects(project.open(a.root,a.id,a.vault),{code:'ENCRYPTION_DAMAGED'});
 await assert.rejects(workspace.open(a.root,a.vault),{code:'ENCRYPTION_DAMAGED'});
 await assert.rejects(owner.open(a.root,randomUUID(),a.vault),{code:'ENCRYPTION_DAMAGED'});assert.deepEqual(await readFile(file),before);
 const reopened=await owner.open(a.root,a.id,a.vault);assert.deepEqual(await query(reopened,'SELECT value FROM retained'),[{value:37}]);
});

test('book shutdown waits for active leases and interrupted initialization can resume',async t=>{
 const f=await fixture(t),a=await f.book('Resumed Book'),controller=new AbortController(),interrupted=f.manager(LabBookPostgres,{signal:controller.signal,onProgress:event=>{if(event.stage==='initialize')controller.abort();}});
 await assert.rejects(interrupted.open(a.root,a.id,a.vault,{create:true}),{code:'DATABASE_CANCELLED'});await interrupted.close();
 const owner=f.manager(),lease=await owner.acquire(a.root,a.id,a.vault,{create:true}),release=retainRuntimeEnvironment(lease.env);lease.release();
 let closed=false;const closing=owner.closeLabBook(a.root).then(()=>{closed=true;});
 try{assert.equal((await query(lease.env,'SELECT 1 AS alive'))[0].alive,1);assert.equal(closed,false);}finally{release();}
 await closing;assert.equal(lease.env.OBSERVANDA_DATABASE_URL,undefined);await assertLabBookDatabaseStopped(a.root,a.id,a.vault);assert.equal(owner.stats().open,0);
});

test('book catalogue bindings reject ambiguous identities and foreign environments',async t=>{
 const f=await fixture(t),a=await f.book('Binding Book'),id=randomUUID(),binding=labBookCatalogueBinding(id,a.id);
 assert.equal(validLabBookCatalogueBinding(binding),true);assertLabBookCatalogueOwner(binding,a.id);
 for(const changed of [{...binding,projectId:randomUUID()},{...binding,placement:'project'},{...binding,version:3},{...binding,labBookId:randomUUID()}])await assert.rejects(async()=>assertLabBookCatalogueOwner(changed,a.id),{code:'DATABASE_LOCATION'});
 assert.throws(()=>labBookCatalogueBinding('../outside',a.id),{code:'INVALID'});
 const env={OBSERVANDA_LAB_BOOK_DATABASE_ROOT:await realpath(a.root),OBSERVANDA_LAB_BOOK_ID:a.id};await assertLabBookCatalogueEnvironment(a.root,a.id,env);
 for(const changed of [{...env,OBSERVANDA_LAB_BOOK_ID:randomUUID()},{...env,OBSERVANDA_LAB_BOOK_DATABASE_ROOT:f.parent},{...env,OBSERVANDA_PROJECT_ID:randomUUID()},{...env,OBSERVANDA_WORKSPACE_DATABASE_ROOT:await realpath(a.root)}])await assert.rejects(assertLabBookCatalogueEnvironment(a.root,a.id,changed),{code:'DATABASE_LOCATION'});
});
