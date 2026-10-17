import {EncryptionKeyContext} from './encryption-key-context.js';
// Exact deduplication and pending traversal state without corpus-sized JS sets.
// Only opaque keys and encrypted values reach PostgreSQL's temporary storage;
// the random encryption key is destroyed and its temporary table is emptied or dropped.
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import {withScratchConnections,scratchConnectionOwner,scratchWorkConnection} from './scratch-connection.js';
import {seal,unseal} from './encryption.js';
import {AppError} from './errors.js';
const sessions=new AsyncLocalStorage();
async function createStorage(signal){
 const db=await scratchWorkConnection(signal),name='obs_work_'+randomUUID().replaceAll('-','');let created=false;
 try{
  try{await db.run('CREATE TEMP TABLE '+name+' (key TEXT PRIMARY KEY,ordinal BIGSERIAL,payload BYTEA,pending BOOLEAN NOT NULL DEFAULT true) ON COMMIT PRESERVE ROWS');}
  catch(error){if(error.code==='42501')throw new AppError('DATABASE_PERMISSION');throw error;}
  created=true;await db.run('CREATE INDEX ON pg_temp.'+name+' (ordinal) WHERE pending');
  let closed=false;return {db,name,async close(){if(closed)return;closed=true;try{await db.run('DROP TABLE pg_temp.'+name);}finally{await db.close();}}};
 }catch(error){if(created)await db.run('DROP TABLE pg_temp.'+name).catch(()=>{});await db.close().catch(()=>{});throw error;}
}
// Reuse at most two emptied temporary tables inside one awaited audit. Each
// checkout has a new encryption key; nested work always owns separate tables.
// No connection, key, row or successful-check receipt survives this session.
export function withScratchSession(operation){return withScratchConnections(()=>scratchSession(operation));}
async function scratchSession(operation){
 const owner=scratchConnectionOwner();if(sessions.getStore()?.active&&sessions.getStore().owner===owner)return operation();
 const session={active:true,idle:[],owner};let failure;
 try{return await sessions.run(session,operation);}
 catch(error){failure=error;throw error;}
 finally{
  session.active=false;
  const closed=await Promise.allSettled(session.idle.splice(0).map(storage=>storage.close()));
  const rejected=closed.find(result=>result.status==='rejected');if(rejected&&!failure)throw rejected.reason;
 }
}
export function withScratch(operation,options={}){return withScratchConnections(()=>scratchWork(operation,options));}
async function scratchWork(operation,{signal,keySalt}={}){
 signal?.throwIfAborted();
 const stored=sessions.getStore(),session=stored?.owner===scratchConnectionOwner()?stored:null,storage=session?.active&&session.idle.pop()||await createStorage(signal),{db,name}=storage,secret=randomBytes(32),keys=new EncryptionKeyContext(),cipherKey=()=>keys.get(secret),table='pg_temp.'+name;
 let size=0,active=true,completed=false,consumedThrough=0n,failure,insertAttempted=false;
 const check=()=>{if(!active)throw new AppError('INVALID');signal?.throwIfAborted();};
 const key=id=>createHash('sha256').update(keySalt??name).update('\0').update(id).digest('hex');
 // Consumed entries retain deduplication identities for this audit.
 // Seek after the last consumed ordinal instead of
 // repeatedly scanning that growing prefix. Upserts can revive an older row;
 // rewind to its original position to retain the existing FIFO contract.
 const revisit=ordinal=>{const before=BigInt(ordinal)-1n;if(before<consumedThrough)consumedThrough=before;};
 try{
  const work={
   get size(){return size;},
   async has(id){check();return !!await db.get('SELECT 1 FROM '+table+' WHERE key=$1',key(id));},
   async get(id){check();const idKey=key(id),row=await db.get('SELECT payload FROM '+table+' WHERE key=$1',idKey);return row?.payload?JSON.parse(unseal(row.payload,cipherKey(),name+idKey).toString('utf8')):undefined;},
   async getMany(ids){
    check();if(!Array.isArray(ids)||ids.length>32||new Set(ids).size!==ids.length)throw new AppError('INVALID');
    const keys=new Map(ids.map(id=>[key(id),id])),result=new Map();
    for(const row of await db.all('SELECT key,payload FROM '+table+' WHERE key=ANY($1::text[])',[...keys.keys()]))if(row.payload)result.set(keys.get(row.key),JSON.parse(unseal(row.payload,cipherKey(),name+row.key).toString('utf8')));
    return result;
   },
   async putMany(entries){
    check();if(!Array.isArray(entries)||entries.length>32||new Set(entries.map(([id])=>id)).size!==entries.length)throw new AppError('INVALID');
    if(!entries.length)return;const values=[];
    for(const [id,value] of entries){const idKey=key(id);values.push(idKey,seal(Buffer.from(JSON.stringify(value)),cipherKey(),name+idKey));}
    const tuples=entries.map((_,i)=>'($'+(i*2+1)+',$'+(i*2+2)+')');
    insertAttempted=true;const rows=await db.all('INSERT INTO '+table+' (key,payload) VALUES '+tuples.join(',')+' ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,pending=true RETURNING (xmax=0) AS created,ordinal',...values);
    size+=rows.filter(row=>row.created).length;for(const row of rows)revisit(row.ordinal);
   },
   async put(id,value){
    check();const idKey=key(id),payload=seal(Buffer.from(JSON.stringify(value)),cipherKey(),name+idKey);
    insertAttempted=true;const result=await db.get('INSERT INTO '+table+' (key,payload) VALUES ($1,$2) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,pending=true RETURNING (xmax=0) AS created,ordinal',idKey,payload);
    if(result.created)size++;revisit(result.ordinal);
   },
   async putGrouped(group,id,value){
    check();
    // Opaque prefixes make a group's rows contiguous without persisting sort
    // keys, identities or values in plaintext. Read through items(), not get().
    const idKey=key(group)+':'+key(id),payload=seal(Buffer.from(JSON.stringify(value)),cipherKey(),name+idKey);
    insertAttempted=true;const result=await db.get('INSERT INTO '+table+' (key,payload) VALUES ($1,$2) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,pending=true RETURNING (xmax=0) AS created,ordinal',idKey,payload);
    if(result.created)size++;revisit(result.ordinal);
   },
   async add(id,value=null){
    check();const idKey=key(id),payload=seal(Buffer.from(JSON.stringify(value)),cipherKey(),name+idKey);
    insertAttempted=true;const row=await db.get('INSERT INTO '+table+' (key,payload) VALUES ($1,$2) ON CONFLICT(key) DO NOTHING RETURNING key',idKey,payload);
    if(row)size++;return !!row;
   },
   async take(){
    check();
    const row=await db.get('SELECT key,payload,ordinal FROM '+table+' WHERE pending AND ordinal>$1::bigint ORDER BY ordinal LIMIT 1',consumedThrough.toString());
    if(!row)return undefined;
    const value=JSON.parse(unseal(row.payload,cipherKey(),name+row.key).toString('utf8'));
    await db.run('UPDATE '+table+' SET pending=false,payload=NULL WHERE key=$1',row.key);consumedThrough=BigInt(row.ordinal);
    return value;
   },
   async *items(){
    check();
    for await(const row of db.rows('SELECT key,payload FROM '+table+' WHERE pending ORDER BY key',[],{signal})){
     check();
     yield JSON.parse(unseal(row.payload,cipherKey(),name+row.key).toString('utf8'));
    }
   },
   async remove(id){check();const row=await db.get('DELETE FROM '+table+' WHERE key=$1 RETURNING key',key(id));if(row)size--;return !!row;},
   async removeMany(ids){
    check();if(!Array.isArray(ids)||ids.length>32||new Set(ids).size!==ids.length)throw new AppError('INVALID');
    if(!ids.length)return;const rows=await db.all('DELETE FROM '+table+' WHERE key=ANY($1::text[]) RETURNING key',ids.map(key));size-=rows.length;
   },
   async clear(){check();await db.run('TRUNCATE '+table+' RESTART IDENTITY');size=0;consumedThrough=0n;}
  };
  const result=await operation(work);completed=true;return result;
 }catch(error){failure=error;throw error;}finally{
  active=false;secret.fill(0);keys.clear();
  try{
  if(completed&&!signal?.aborted&&session?.active&&session.idle.length<2){
   try{
    // Even a failed or conflicting insert can advance BIGSERIAL; a queued
    // insertion may not have updated size yet. Only untouched storage is clean.
    if(insertAttempted)await db.run('TRUNCATE '+table+' RESTART IDENTITY');
    if(session.active&&session.idle.length<2)session.idle.push(storage);else await storage.close();
   }
   catch(error){await storage.close();throw error;}
  }else await storage.close();
  }catch(error){if(!failure)throw error;}
 }
}
