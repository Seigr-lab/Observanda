import {databaseQuery,databaseConnectionEnded,DATABASE_STATEMENT_TIMEOUT_MS} from './database-query.js';
import {catalogueArchiveTables as tables} from './postgres-archive-tables.js';
import {readCatalogueStamp} from './catalogue-stamp.js';
import {dropProjectDomainSchemas} from './project-domain-schema.js';
import {databaseRequestSignal,withDatabaseRequest} from './database-request-context.js';
import {DatabaseAdmission} from './database-admission.js';
import {idleConnections,idleConnectionKey,idleConnectionScope} from './database-idle-connections.js';
import {checkServerIdentity} from 'node:tls';
import {retainRuntimeEnvironment,runtimeStorageDirectory} from './database-runtime-environment.js';
import {databaseClusterIdentity} from './database-cluster-identity.js';
import {operationStage,operationAdvance} from './operation-progress.js';
import {diagnosticMeasurement} from './operational-diagnostics.js';
import {diskCapacity} from './disk-capacity.js';
import path from 'node:path';
import {readFile,unlink,realpath} from 'node:fs/promises';
import {withNativeContentFile} from './native-content-file.js';
import {nativeDestination} from './native-destination.js';
import {writeFilePart} from './segmented-file-io.js';
import {writeCatalogueArchive,readCatalogueArchive,readCatalogueStream} from './postgres-archive.js';
import {PassThrough} from 'node:stream';
import {randomUUID,createHash} from 'node:crypto';
import {Client} from 'pg';
import {setTimeout as delay} from 'node:timers/promises';
import {AppError} from './errors.js';
import {assertCatalogueOwner,assertCatalogueEnvironment} from './project-catalogue-owner.js';
import {assertRegular,serialize} from './storage.js';
import {catalogueIndexesSQL,ensureCatalogueIndexes} from './postgres-indexes.js';
import {catalogueFormat} from './catalogue-format.js';
import {CATALOGUE_FILE,CATALOGUE_ARCHIVE,CATALOGUE_ACTIVATION,catalogueBinding,catalogueActivation,beginCatalogueActivation,publishCatalogueBinding,finishCatalogueActivation} from './postgres-activation.js';
import {databaseScope,databaseProvider,acquireWorkspaceDatabaseEnvironment,scratchDatabaseEnvironment} from './workspace-database-context.js';

export {CATALOGUE_FILE,CATALOGUE_ARCHIVE} from './postgres-activation.js';

const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const schemaFor=id=>{if(!uuid(id))throw new AppError('CATALOGUE_DAMAGED');return 'obs_'+id.replaceAll('-','');};
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};


export async function databaseConfiguration(env=process.env,{signal}={}){
 if(!env.OBSERVANDA_DATABASE_URL)throw new AppError('DATABASE_CONFIG');
 let url;
 try{url=new URL(env.OBSERVANDA_DATABASE_URL);}catch{throw new AppError('DATABASE_CONFIG');}
 if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname||url.search||url.hash||!url.pathname.slice(1)||!url.username||!url.password||url.port==='0')throw new AppError('DATABASE_CONFIG');
 const host=url.hostname.replace(/^\[|\]$/g,''),local=['127.0.0.1','::1','localhost'].includes(host);
 let ssl=false;
 if(env.OBSERVANDA_DATABASE_TLS==='verify-full'){
  ssl={rejectUnauthorized:true,checkServerIdentity:(_,certificate)=>checkServerIdentity(host,certificate)};
  if(env.OBSERVANDA_DATABASE_CA){try{ssl.ca=await readFile(env.OBSERVANDA_DATABASE_CA,{encoding:'utf8',signal});}catch{throw new AppError('DATABASE_TLS');}}
 }else if(!local||env.OBSERVANDA_DATABASE_TLS||env.OBSERVANDA_DATABASE_CA)throw new AppError('DATABASE_TLS');
 try{return {host,port:Number(url.port||5432),database:decodeURIComponent(url.pathname.slice(1)),user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),ssl,
  application_name:'Observanda',options:'-c search_path=pg_catalog',client_encoding:'UTF8',connectionTimeoutMillis:5000,statement_timeout:DATABASE_STATEMENT_TIMEOUT_MS};}
 catch{throw new AppError('DATABASE_CONFIG');}
}
let connections=0;
const admission=new DatabaseAdmission();
export function databaseCapacity(){return {active:connections,idle:idleConnections.size,...admission.stats()};}
// A reusable connection returns to the idle pool (database-idle-connections.js)
// through client.release(); client.end() always closes it.
async function connect(env=process.env,{signal=databaseRequestSignal(),reservation,reusable=false}={}){
 signal?.throwIfAborted();const releaseRuntime=retainRuntimeEnvironment(env);let ticket,releaseSlot,client,released=false,counted=false;
 const release=()=>{if(released)return;released=true;if(counted)connections--;releaseSlot?.();releaseRuntime();};
 try{
  const configuration=await databaseConfiguration(env);signal?.throwIfAborted();
  const host=['localhost','127.0.0.1','::1'].includes(configuration.host)?'loopback':configuration.host.toLowerCase();
  // One workspace cluster serves the workspace and each of its projects and
  // lab books under their own roles. Admission keeps one queue per role, as
  // when every owner had its own server, so a saturated owner never starves
  // its siblings; the global limit bounds what reaches the shared server.
  const endpoint=createHash('sha256').update(host+'\0'+configuration.port+'\0'+configuration.user).digest('hex');
  const admissionMeasured=diagnosticMeasurement('database-admission');
  try{if(reservation)releaseSlot=reservation.auxiliary();
  else{ticket=await admission.acquire(endpoint,{signal});releaseSlot=()=>ticket.release();}}
  finally{admissionMeasured();}
  signal?.throwIfAborted();
  const url=env.OBSERVANDA_DATABASE_URL,storage=runtimeStorageDirectory(env),key=reusable?idleConnectionKey(configuration,env,storage):null;
  const checkout=value=>{
   connections++;counted=true;value.reservation=ticket;
   value.end=async()=>{try{return await value.closeConnection();}finally{release();}};
   // Only a session without a transaction is reset and parked; anything that
   // fails here, or an owner that retired its credentials, closes instead.
   let returned=false;
   value.release=async()=>{
    if(returned)return;returned=true;
    if(!key||databaseConnectionEnded(value)||env.OBSERVANDA_DATABASE_URL!==url||runtimeStorageDirectory(env)!==storage)return value.end();
    try{await databaseQuery(value,'DISCARD ALL',[],{signal:null});}catch{return value.end();}
    if(databaseConnectionEnded(value))return value.end();
    const physical=value.closeConnection;value.end=physical;value.release=physical;value.reservation=undefined;release();
    if(!idleConnections.park(key,value,idleConnectionScope(configuration),physical))await physical().catch(()=>{});
   };
   return value;
  };
  const reused=key?idleConnections.take(key,value=>!databaseConnectionEnded(value)):null;
  if(reused){client=checkout(reused);return client;}
  // Parked connections give way before a new one could exceed the server's budget.
  while(idleConnections.size&&connections+idleConnections.size>=admission.globalLimit*2)idleConnections.evictOldest();
  try{client=new Client(configuration);}catch{throw new AppError('DATABASE_CONFIG');}
  client.closeConnection=client.end.bind(client);checkout(client);
  client.on('error',()=>{});
  const connectionMeasured=diagnosticMeasurement('database-connect');
  try{await client.connect();signal?.throwIfAborted();return client;}
  catch(error){await client.end().catch(()=>{});if(signal?.aborted)throw signal.reason;throw new AppError('DATABASE_UNAVAILABLE');}
  finally{connectionMeasured();}
 }catch(error){release();throw error;}
}
export async function requireDatabase(env){
 env??=databaseProvider()?await scratchDatabaseEnvironment():process.env;
 const client=await connect(env);
 try{if(!(await databaseQuery(client,"SELECT has_database_privilege(current_user,current_database(),'CREATE') AND has_database_privilege(current_user,current_database(),'TEMPORARY') AS allowed")).rows[0].allowed)throw new AppError('DATABASE_PERMISSION');}
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
 // A rolled-back, non-temporary connection returns to the idle pool on close.
 constructor(client,id,{temporary=false,env=process.env}={}){this.client=client;this.id=id;this.schema=schemaFor(id);this.temporary=temporary;this.env=env;this.reusable=true;}
 scope(operation){return databaseScope(this.env,operation,this);}
 async run(sql,...values){return databaseQuery(this.client,sql,values);}
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
    const fetched=diagnosticMeasurement('database-cursor');let batch;
    try{batch=await this.all('FETCH FORWARD '+batchSize+' FROM '+cursor);}finally{fetched();}
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
  // Cleanup owns its deadline; cancellation of the request must not prevent
  // rollback or leave a successfully imported temporary catalogue behind.
  return withDatabaseRequest(null,async()=>{
   if(this.client===null)return;
   let cleanup=this,replacement,reset=false;
   try{
    if(databaseConnectionEnded(this.client)){
     // Release the dead connection's admission slot before borrowing another.
     await this.client.end();
     if(!this.temporary)return;
     replacement=await connect(this.env,{signal:null});
     cleanup=new CatalogueConnection(replacement,this.id,{env:this.env});
    }
    await cleanup.run('ROLLBACK');
    if(this.temporary){await dropProjectDomainSchemas(cleanup);await cleanup.run('DROP SCHEMA IF EXISTS "'+this.schema+'" CASCADE');}
    else reset=this.reusable;
   }finally{try{await replacement?.end();}finally{
    // A parked client may serve another operation at once: this closed
    // connection keeps no reference that could still reach it.
    if(reset&&this.client.release){const client=this.client;this.client=null;await client.release();}else await this.client.end();
   }}
  });
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
 if(signal===undefined)signal=databaseRequestSignal();signal?.throwIfAborted();
 if(restore!==undefined&&(typeof restore!=='function'||create||detached))throw new AppError('INVALID');
 await (await import('./workspace-delete-state.js')).assertNotDeleting(root,deleteId);
 await assertRegular(path.join(root,'.observanda'),{directory:true});
 let existing=await catalogueBinding(root),activation=await catalogueActivation(root);
 assertCatalogueOwner(existing,projectId,labBookId);
 let archived=!!await assertRegular(path.join(root,CATALOGUE_ARCHIVE),{missing:true});
 if(create&&existing)throw new AppError('EXISTS');
 if(detached&&!existing&&!create&&!archived)fail();
 if(detached&&activation)throw new AppError('LOCKED');
 const lease=explicitEnv?{env:explicitEnv,release:()=>{}}:await acquireWorkspaceDatabaseEnvironment(root,{create,detached,vault,projectId,labBookId,signal});
 const env=lease.env;let client;
 try{await assertCatalogueEnvironment(root,projectId,env,labBookId);client=await connect(env,{signal,reusable:true});}finally{lease.release();}
 let db,created=false,published=false,restoreLock;
 try{
  // Serialize first activation across processes; recheck the binding under this lock.
  if(!detached&&(!existing||activation||archived)){
   restoreLock='Observanda/activate/'+await realpath(root);
   // A killed importing client may exit before PostgreSQL releases its session
   // lock. Wait briefly for cleanup; never steal an active importer's lock.
   const deadline=Date.now()+2000;
   while(!(await databaseQuery(client,'SELECT pg_catalog.pg_try_advisory_lock(pg_catalog.hashtextextended($1,0)) AS locked',[restoreLock])).rows[0].locked){
    if(Date.now()>=deadline)throw new AppError('LOCKED');
    await delay(50);
   }
   existing=await catalogueBinding(root);activation=await catalogueActivation(root);
   assertCatalogueOwner(existing,projectId,labBookId);
   archived=!!await assertRegular(path.join(root,CATALOGUE_ARCHIVE),{missing:true});
   if(create&&existing)throw new AppError('EXISTS');
  }
  if(activation&&(create||existing&&activation.id!==existing.id||!existing&&!archived&&!restore))fail();
  // A binding names the cluster that holds its schema. Another cluster, such
  // as a different workspace's, never serves it; a new binding names this one.
  const cluster=existing||!detached?await databaseClusterIdentity(client,{managed:!!runtimeStorageDirectory(env)}):null;
  if(existing&&existing.cluster!==cluster)throw new AppError('CATALOGUE_UNAVAILABLE');
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
   if(!existing){await publishCatalogueBinding(root,db.id,{cluster,installation:projectId===undefined&&labBookId===undefined&&!env.OBSERVANDA_WORKSPACE_DATABASE_ROOT,projectId,labBookId});published=true;}
   if(!create&&(activation||archived))await finishCatalogueActivation(root);
  }
  return db;
 }catch(error){
  // The activation lock is released below on this same client: never park it.
  if(db){if(created&&!published)db.temporary=true;db.reusable=false;await db.close().catch(()=>{});}
  else await client.end().catch(()=>{});
  const requestSignal=signal??databaseRequestSignal();
  if(error instanceof AppError||requestSignal?.aborted&&error===requestSignal.reason)throw error;
  throw new AppError('CATALOGUE_DAMAGED');
 }finally{
  if(restoreLock)await databaseQuery(client,'SELECT pg_catalog.pg_advisory_unlock(pg_catalog.hashtextextended($1,0))',[restoreLock]).catch(()=>{});
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
export async function backupCatalogue(root,destination,{connection,capacity=diskCapacity}={}){
 const db=connection??await openCatalogue(root,{detached:true}),file=path.join(destination,CATALOGUE_ARCHIVE);let failed=false;
 try{return await withNativeContentFile({root:destination},file,async(parent,name)=>{
  const temporary=name+'.'+randomUUID()+'.tmp',checksum=createHash('sha256');let handle,reservation,identity,position=0,writeFailed=false;
  try{
   await parent.stat(name,{missing:true});
   reservation=await capacity.reserve(path.dirname(file),0,{growthBytes:4*1024*1024,refreshBytes:4*1024*1024,signal:databaseRequestSignal()});
   await db.run('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   handle=await parent.file(temporary,{mode:'exclusive'});identity=handle.identity;
   await writeCatalogueArchive(db,{writeFile:async value=>{const bytes=Buffer.from(value,'utf8');await reservation.write(bytes.length,()=>writeFilePart(handle,bytes,position));position+=bytes.length;checksum.update(bytes);}},tables);
   await handle.sync();await handle.close();handle=null;
   await db.run('COMMIT');await parent.rename(temporary,parent,name,{identity,replace:true});return checksum.digest('hex');
  }catch(error){writeFailed=true;throw error;}finally{
   try{await handle?.close();if(identity)await parent.remove(temporary,{identity}).catch(error=>{if(error.code!=='ENOENT')throw error;});}catch(error){if(!writeFailed)throw error;}
   finally{reservation?.release();}
  }
 });}catch(error){failed=true;await withDatabaseRequest(null,()=>db.run('ROLLBACK')).catch(()=>{});throw error;}
 finally{if(!connection)await db.close().catch(error=>{if(!failed)throw error;});}
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
  await databaseQuery(client,'BEGIN');
  if(!(await databaseQuery(client,'SELECT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended($1,0)) AS locked',[id])).rows[0].locked)throw new AppError('LOCKED');
  await databaseQuery(client,'DROP SCHEMA IF EXISTS "'+schema+'" CASCADE');await databaseQuery(client,'COMMIT');
  for(const relative of [CATALOGUE_FILE,CATALOGUE_ACTIVATION]){const file=path.join(stagingRoot,relative),admitted=nativeDestination(file);if(admitted?.directory)await admitted.remove(file,{missing:true});else if(await assertRegular(file,{missing:true}))await unlink(file);}
 }finally{await databaseQuery(client,'ROLLBACK').catch(()=>{});await client.end();}
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
