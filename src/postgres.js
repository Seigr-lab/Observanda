import {catalogueArchiveTables as tables} from './postgres-archive-tables.js';
import {readCatalogueStamp} from './catalogue-stamp.js';
import {dropProjectDomainSchemas} from './project-domain-schema.js';
import {databaseRequestSignal} from './database-request-context.js';
import {DatabaseAdmission} from './database-admission.js';
import {checkServerIdentity} from 'node:tls';
import {retainRuntimeEnvironment} from './database-runtime-environment.js';
import {operationStage,operationAdvance} from './operation-progress.js';
import path from 'node:path';
import {readFile,open,unlink,realpath} from 'node:fs/promises';
import {writeCatalogueArchive,readCatalogueArchive,readCatalogueStream} from './postgres-archive.js';
import {PassThrough} from 'node:stream';
import {randomUUID,createHash} from 'node:crypto';
import {Client} from 'pg';
import {setTimeout as delay} from 'node:timers/promises';
import {AppError} from './errors.js';
import {assertCatalogueOwner,assertCatalogueEnvironment} from './project-catalogue-owner.js';
import {assertRegular,serialize} from './storage.js';
import {atomicReplace} from './atomic-replace.js';
import {catalogueIndexesSQL,ensureCatalogueIndexes} from './postgres-indexes.js';
import {catalogueFormat} from './catalogue-format.js';
import {CATALOGUE_FILE,CATALOGUE_ARCHIVE,CATALOGUE_ACTIVATION,catalogueBinding,catalogueActivation,beginCatalogueActivation,publishCatalogueBinding,finishCatalogueActivation} from './postgres-activation.js';
import {databaseScope,databaseProvider,acquireWorkspaceDatabaseEnvironment,scratchDatabaseEnvironment} from './workspace-database-context.js';

export {CATALOGUE_FILE,CATALOGUE_ARCHIVE} from './postgres-activation.js';

const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const schemaFor=id=>{if(!uuid(id))throw new AppError('CATALOGUE_DAMAGED');return 'obs_'+id.replaceAll('-','');};
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};


export async function databaseConfiguration(env=process.env){
 if(!env.OBSERVANDA_DATABASE_URL)throw new AppError('DATABASE_CONFIG');
 let url;
 try{url=new URL(env.OBSERVANDA_DATABASE_URL);}catch{throw new AppError('DATABASE_CONFIG');}
 if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname||url.search||url.hash||!url.pathname.slice(1)||!url.username||!url.password||url.port==='0')throw new AppError('DATABASE_CONFIG');
 const host=url.hostname.replace(/^\[|\]$/g,''),local=['127.0.0.1','::1','localhost'].includes(host);
 let ssl=false;
 if(env.OBSERVANDA_DATABASE_TLS==='verify-full'){
  ssl={rejectUnauthorized:true,checkServerIdentity:(_,certificate)=>checkServerIdentity(host,certificate)};
  if(env.OBSERVANDA_DATABASE_CA){try{ssl.ca=await readFile(env.OBSERVANDA_DATABASE_CA,'utf8');}catch{throw new AppError('DATABASE_TLS');}}
 }else if(!local||env.OBSERVANDA_DATABASE_TLS||env.OBSERVANDA_DATABASE_CA)throw new AppError('DATABASE_TLS');
 try{return {host,port:Number(url.port||5432),database:decodeURIComponent(url.pathname.slice(1)),user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),ssl,
  application_name:'Observanda',options:'-c search_path=pg_catalog',client_encoding:'UTF8',connectionTimeoutMillis:5000,statement_timeout:30000};}
 catch{throw new AppError('DATABASE_CONFIG');}
}
let connections=0;
const admission=new DatabaseAdmission();
export function databaseCapacity(){return {active:connections,...admission.stats()};}
async function connect(env=process.env,{signal=databaseRequestSignal(),reservation}={}){
 signal?.throwIfAborted();const releaseRuntime=retainRuntimeEnvironment(env);let ticket,releaseSlot,client,released=false,counted=false;
 const release=()=>{if(released)return;released=true;if(counted)connections--;releaseSlot?.();releaseRuntime();};
 try{
  const configuration=await databaseConfiguration(env);signal?.throwIfAborted();
  const host=['localhost','127.0.0.1','::1'].includes(configuration.host)?'loopback':configuration.host.toLowerCase();
  const endpoint=createHash('sha256').update(host+'\0'+configuration.port).digest('hex');
  if(reservation)releaseSlot=reservation.auxiliary();
  else{ticket=await admission.acquire(endpoint,{signal});releaseSlot=()=>ticket.release();}
  signal?.throwIfAborted();
  try{client=new Client(configuration);}catch{throw new AppError('DATABASE_CONFIG');}
  connections++;counted=true;client.reservation=ticket;
  const end=client.end.bind(client);client.end=async()=>{try{return await end();}finally{release();}};
  client.on('error',()=>{});
  try{await client.connect();signal?.throwIfAborted();return client;}
  catch(error){await client.end().catch(()=>{});if(signal?.aborted)throw signal.reason;throw new AppError('DATABASE_UNAVAILABLE');}
 }catch(error){release();throw error;}
}
export async function requireDatabase(env){
 env??=databaseProvider()?await scratchDatabaseEnvironment():process.env;
 const client=await connect(env);
 try{if(!(await client.query("SELECT has_database_privilege(current_user,current_database(),'CREATE') AND has_database_privilege(current_user,current_database(),'TEMPORARY') AS allowed")).rows[0].allowed)throw new AppError('DATABASE_PERMISSION');}
 finally{await client.end();}
}
export async function databaseStatus(env){
 try{await requireDatabase(env);return {engine:'PostgreSQL',ready:true};}
 catch(error){return {engine:'PostgreSQL',ready:false,code:error instanceof AppError?error.code:'DATABASE_UNAVAILABLE'};}
}

export async function hasCatalogue(root){
 return !!(await assertRegular(path.join(root,CATALOGUE_FILE),{missing:true})||await assertRegular(path.join(root,CATALOGUE_ARCHIVE),{missing:true}));
}
class CatalogueConnection{
 constructor(client,id,{temporary=false,env=process.env}={}){this.client=client;this.id=id;this.schema=schemaFor(id);this.temporary=temporary;this.env=env;}
 scope(operation){return databaseScope(this.env,operation,this);}
 async run(sql,...values){return this.client.query(sql,values);}
 async get(sql,...values){return (await this.run(sql,...values)).rows[0];}
 async all(sql,...values){return (await this.run(sql,...values)).rows;}
 // The caller owns the transaction. Cursors never outlive it or retain a whole
 // result in the Node process; unique names also allow nested verification.
 async *rows(sql,values=[],{batchSize=16,signal}={}){
  if(!Number.isSafeInteger(batchSize)||batchSize<1||batchSize>32)throw new AppError('INVALID');
  signal?.throwIfAborted();
  const cursor='obs_rows_'+randomUUID().replaceAll('-','');let failure;
  await this.run('DECLARE '+cursor+' NO SCROLL CURSOR FOR '+sql,...values);
  try{
   while(true){
    signal?.throwIfAborted();
    const batch=await this.all('FETCH FORWARD '+batchSize+' FROM '+cursor);
    if(!batch.length)break;
    for(const row of batch){signal?.throwIfAborted();yield row;}
   }
  }catch(error){failure=error;throw error;}
  finally{
   // The consumer can abort the transaction between yields. Its original SQL
   // error must survive iterator.return(); rollback closes that cursor instead.
   try{await this.run('CLOSE '+cursor);}catch(error){if(!failure&&error.code!=='25P02')throw error;}
  }
 }
 async close(){
  try{
   await this.run('ROLLBACK');
   if(this.temporary){await dropProjectDomainSchemas(this);await this.run('DROP SCHEMA "'+this.schema+'" CASCADE');}
  }finally{await this.client.end();}
 }
 async lock(){
  if(!(await this.get('SELECT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended($1,0)) AS locked',this.id)).locked)throw new AppError('LOCKED');
 }
}
// Ephemeral work sets use their own connection and transaction. This also
// permits bounded traversal while the source remains in a read-only snapshot.
export async function scratchDatabase({parent,signal}={}){const env=parent?.env??await scratchDatabaseEnvironment();return new CatalogueConnection(await connect(env,{signal,reservation:parent?.client.reservation}),randomUUID(),{env});}
async function createSchema(db){
 // Archive activation verifies all imported revisions before publishing its
 // binding. A fixed snapshot permits bounded reuse within that complete audit.
 await db.run('BEGIN ISOLATION LEVEL REPEATABLE READ');
 await db.run('CREATE SCHEMA "'+db.schema+'"');
 await db.run('REVOKE ALL ON SCHEMA "'+db.schema+'" FROM PUBLIC');
 await db.run('SET search_path TO "'+db.schema+'", pg_catalog');
 await db.run(`
  CREATE TABLE catalogue_format(version integer PRIMARY KEY CHECK(version=3));
  INSERT INTO catalogue_format VALUES (3);
  CREATE TABLE scope_keys(scope_id uuid NOT NULL, generation integer NOT NULL CHECK(generation>0), payload bytea NOT NULL, PRIMARY KEY(scope_id,generation));
  CREATE TABLE records(id uuid NOT NULL, revision text NOT NULL CHECK(revision ~ '^[a-f0-9]{64}$'), scope_id uuid NOT NULL, generation integer NOT NULL, payload bytea NOT NULL,
    PRIMARY KEY(id,revision),FOREIGN KEY(scope_id,generation) REFERENCES scope_keys(scope_id,generation));
  CREATE TABLE snapshots(id text PRIMARY KEY CHECK(id ~ '^[a-f0-9]{64}$'), ordinal integer NOT NULL UNIQUE CHECK(ordinal>=0), payload bytea NOT NULL);
  CREATE TABLE state(slot text PRIMARY KEY,payload bytea NOT NULL);
  CREATE TABLE module_entities(id uuid PRIMARY KEY,revision integer NOT NULL CHECK(revision>0),payload bytea NOT NULL);
  CREATE TABLE module_events(command_id uuid PRIMARY KEY,ordinal integer NOT NULL UNIQUE CHECK(ordinal>0),payload bytea NOT NULL);
  CREATE TABLE objects(id text PRIMARY KEY,payload bytea NOT NULL);
 `);
 await db.run(catalogueIndexesSQL);
 await db.run('REVOKE ALL ON ALL TABLES IN SCHEMA "'+db.schema+'" FROM PUBLIC');
}
async function importArchive(root,db){
 const file=path.join(root,CATALOGUE_ARCHIVE);await assertRegular(file);return readCatalogueArchive(file,db,tables);
}
export async function openCatalogue(root,{create=false,detached=false,validate,restore,vault,deleteId,projectId,labBookId,env:explicitEnv,signal}={}){
 if(restore!==undefined&&(typeof restore!=='function'||create||detached))throw new AppError('INVALID');
 await (await import('./workspace-delete-state.js')).assertNotDeleting(root,deleteId);
 await assertRegular(path.join(root,'.observanda'),{directory:true});
 let existing=await catalogueBinding(root),activation=await catalogueActivation(root);
 assertCatalogueOwner(existing,projectId,labBookId);
 let archived=!!await assertRegular(path.join(root,CATALOGUE_ARCHIVE),{missing:true});
 if(create&&existing)throw new AppError('EXISTS');
 if(detached&&!existing&&!create&&!archived)fail();
 if(detached&&activation)throw new AppError('LOCKED');
 const lease=explicitEnv?{env:explicitEnv,release:()=>{}}:await acquireWorkspaceDatabaseEnvironment(root,{create,detached,vault,projectId,labBookId});
 const env=lease.env;let client;
 try{await assertCatalogueEnvironment(root,projectId,env,labBookId);client=await connect(env,{signal});}finally{lease.release();}
 let db,created=false,published=false,restoreLock;
 try{
  // Serialize first activation across processes; recheck the binding under this lock.
  if(!detached&&(!existing||activation||archived)){
   restoreLock='Observanda/activate/'+await realpath(root);
   // A killed importing client may exit before PostgreSQL releases its session
   // lock. Wait briefly for cleanup; never steal an active importer's lock.
   const deadline=Date.now()+2000;
   while(!(await client.query('SELECT pg_catalog.pg_try_advisory_lock(pg_catalog.hashtextextended($1,0)) AS locked',[restoreLock])).rows[0].locked){
    if(Date.now()>=deadline)throw new AppError('LOCKED');
    await delay(50);
   }
   existing=await catalogueBinding(root);activation=await catalogueActivation(root);
   assertCatalogueOwner(existing,projectId,labBookId);
   archived=!!await assertRegular(path.join(root,CATALOGUE_ARCHIVE),{missing:true});
   if(create&&existing)throw new AppError('EXISTS');
  }
  if(activation&&(create||existing&&activation.id!==existing.id||!existing&&!archived&&!restore))fail();
  db=new CatalogueConnection(client,existing?.id??activation?.id??randomUUID(),{temporary:detached&&!existing,env});
  const committed=existing||activation?await db.get('SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname=$1',db.schema):null;
  if(existing&&!committed)throw new AppError('CATALOGUE_UNAVAILABLE');
  if(committed){
   await db.run('SET search_path TO "'+db.schema+'", pg_catalog');
   await catalogueFormat(db);
   await ensureCatalogueIndexes(db);
   if(activation||(archived&&!detached)||restore){
    await db.run('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    if(!await db.get("SELECT 1 FROM state WHERE slot='head'"))fail();
    if(validate)await db.scope(()=>validate(db));
    await db.run('COMMIT');
   }
  }else{
   if(!create&&!archived&&!restore)fail();
   if(!create&&!detached&&!activation){await beginCatalogueActivation(root,db.id);activation={id:db.id};}
   await createSchema(db);created=true;
   if(!create){if(restore)await restore(db);else await importArchive(root,db);if(validate)await db.scope(()=>validate(db));}
   await db.run('COMMIT');
  }
  if(!detached){
   if(!existing){await publishCatalogueBinding(root,db.id,{workspace:!!env.OBSERVANDA_WORKSPACE_DATABASE_ROOT,projectId,labBookId});published=true;}
   if(!create&&(activation||archived))await finishCatalogueActivation(root);
  }
  return db;
 }catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  if(created&&!published){await dropProjectDomainSchemas(db).catch(()=>{});await client.query('DROP SCHEMA IF EXISTS "'+db.schema+'" CASCADE').catch(()=>{});}
  await client.end().catch(()=>{});
  if(error instanceof AppError)throw error;
  throw new AppError('CATALOGUE_DAMAGED');
 }finally{
  if(restoreLock)await client.query('SELECT pg_catalog.pg_advisory_unlock(pg_catalog.hashtextextended($1,0))',[restoreLock]).catch(()=>{});
 }
}
export async function catalogueStamp(root){
 return operationStage('database-inventory',{unit:'rows'},async()=>{
 const db=await openCatalogue(root,{detached:true});
 try{
  await db.run('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const stamp=await readCatalogueStamp(db);await db.run('COMMIT');return stamp;
 }finally{await db.close();}
 });
}
export async function backupCatalogue(root,destination,{connection}={}){
 const db=connection??await openCatalogue(root,{detached:true});
 const file=path.join(destination,CATALOGUE_ARCHIVE),temporary=file+'.'+randomUUID()+'.tmp',checksum=createHash('sha256');let handle;
 try{
  await assertRegular(path.join(destination,'.observanda'),{directory:true});
  await assertRegular(file,{missing:true});
  await db.run('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  handle=await open(temporary,'wx',0o600);
  await writeCatalogueArchive(db,{writeFile:async value=>{await handle.writeFile(value);checksum.update(value);}},tables);
  await handle.sync();await handle.close();handle=null;
  await db.run('COMMIT');await atomicReplace(temporary,file);return checksum.digest('hex');
 }finally{
  await handle?.close();await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});
  if(!connection)await db.close();
 }
}

// Direct conversion retains the existing archive validation contract, but the
// transport is bounded memory with backpressure, never another on-disk copy.
export async function transferCatalogue(source,target){
 const stream=new PassThrough({highWaterMark:256*1024}),digest=createHash('sha256');
 stream.on('error',()=>{});
 await source.run('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 try{
  const receive=readCatalogueStream(stream,target,tables).catch(error=>{stream.destroy(error);throw error;});
  const send=writeCatalogueArchive(source,{writeFile:async value=>{
   await new Promise((resolve,reject)=>stream.write(value,error=>error?reject(error):resolve()));digest.update(value);
  }},tables,{observe:false}).then(()=>{stream.end();return digest.digest('hex');}).catch(error=>{stream.destroy(error);throw error;});
  const [written,read]=await Promise.allSettled([send,receive]);
  if(written.status==='rejected')throw written.reason;if(read.status==='rejected')throw read.reason;
  await source.run('COMMIT');return written.value;
 }catch(error){await source.run('ROLLBACK').catch(()=>{});throw error;}finally{stream.destroy();}
}

// Called with the source writer held. Only an unadopted, identified conversion
// target can be discarded when its source changed during an interruption.
export async function resetCataloguePreparation(root,stagingRoot,id,env){
 if(stagingRoot!==path.join(root,'.observanda','database-transition')||(await catalogueBinding(root))?.id===id)throw new AppError('CONFLICT');
 const binding=await catalogueBinding(stagingRoot),activation=await catalogueActivation(stagingRoot);
 if(!binding&&!activation||[binding,activation].some(value=>value&&value.id!==id))throw new AppError('CONFLICT');
 const schema=schemaFor(id),client=await connect(env);
 try{
  await client.query('BEGIN');
  if(!(await client.query('SELECT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended($1,0)) AS locked',[id])).rows[0].locked)throw new AppError('LOCKED');
  await client.query('DROP SCHEMA IF EXISTS "'+schema+'" CASCADE');await client.query('COMMIT');
  for(const relative of [CATALOGUE_FILE,CATALOGUE_ACTIVATION]){const file=path.join(stagingRoot,relative);if(await assertRegular(file,{missing:true}))await unlink(file);}
 }finally{await client.query('ROLLBACK').catch(()=>{});await client.end();}
}

export async function catalogueArchiveDigest(db,{transaction=false}={}){
 const digest=createHash('sha256');
 if(!transaction)await db.run('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 try{
  await writeCatalogueArchive(db,{writeFile:async value=>{digest.update(value);}},tables,{stage:'compare-database',tableStage:'compare-database-table'});
  if(!transaction)await db.run('COMMIT');return digest.digest('hex');
 }catch(error){if(!transaction)await db.run('ROLLBACK').catch(()=>{});throw error;}
}

// Keep the accepted snapshot proof within the destination writer transaction.
// Recovery hashes it once, then refreshes only that proven, unpublished owner.
export async function prepareTransferredCatalogue(target,expected){
 if(!Array.isArray(expected)||!expected.length||expected.some(value=>!/^[a-f0-9]{64}$/.test(value)))throw new AppError('INVALID');
 const transaction=(await target.get('SELECT pg_catalog.txid_current()::text AS id')).id,digest=await catalogueArchiveDigest(target,{transaction:true});
 if(!expected.includes(digest))throw new AppError('CONFLICT');let used=false;
 return {digest,async replace(source,validate){
  if(used||typeof validate!=='function'||(await target.get('SELECT pg_catalog.txid_current()::text AS id')).id!==transaction)throw new AppError('CONFLICT');used=true;
  await dropProjectDomainSchemas(target);
  await target.run('TRUNCATE '+Object.keys(tables).map(name=>'"'+name+'"').join(','));
  const copied=await transferCatalogue(source,target);await target.scope(()=>validate(target));return copied;
 }};
}
