import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import {scratchDatabase} from './postgres.js';
import {scopedDatabaseConnection} from './workspace-database-context.js';
import {AppError} from './errors.js';
const context=new AsyncLocalStorage(),owners=new WeakMap();

// Separate encrypted temporary tables share one connection for this operation.
// Autocommit isolates SQL failures between tables; a held cursor gives items()
// a fixed result even when another work set is updated between yielded rows.
class ScratchOwner{
 constructor(parent){this.parent=parent;this.entry=null;}
 async acquire(signal){
  signal?.throwIfAborted();let entry=this.entry;
  if(entry?.closing){await entry.closing.catch(()=>{});return this.acquire(signal);}
  if(!entry){entry={users:0,queue:Promise.resolve(),opening:scratchDatabase({parent:this.parent,signal})};this.entry=entry;}
  entry.users++;let db;
  const release=async()=>{if(--entry.users)return;entry.closing=(async()=>{try{await entry.queue;db??=await entry.opening;await db.close();}catch(error){if(db)throw error;}finally{if(this.entry===entry)this.entry=null;}})();await entry.closing;};
  try{db=await entry.opening;signal?.throwIfAborted();}catch(error){await release();throw error;}
  let active=true;
  const enqueue=operation=>{if(!active)return Promise.reject(new AppError('INVALID'));const result=entry.queue.then(()=>operation(db));entry.queue=result.catch(()=>{});return result;};
  const run=(sql,...values)=>enqueue(connection=>connection.run(sql,...values));
  return {
   run,async get(sql,...values){return (await run(sql,...values)).rows[0];},async all(sql,...values){return (await run(sql,...values)).rows;},
   async *rows(sql,values=[],{batchSize=16,signal}={}){
    if(!Number.isSafeInteger(batchSize)||batchSize<1||batchSize>32)throw new AppError('INVALID');signal?.throwIfAborted();
    const cursor='obs_scratch_'+randomUUID().replaceAll('-','');let failure;
    await enqueue(async connection=>{
     await connection.run('BEGIN');
     try{await connection.run('DECLARE '+cursor+' NO SCROLL CURSOR WITH HOLD FOR '+sql,...values);await connection.run('COMMIT');}
     catch(error){await connection.run('ROLLBACK').catch(()=>{});throw error;}
    });
    try{
     for(;;){signal?.throwIfAborted();const batch=(await run('FETCH FORWARD '+batchSize+' FROM '+cursor)).rows;if(!batch.length)break;for(const row of batch){signal?.throwIfAborted();yield row;}}
    }catch(error){failure=error;throw error;}
    finally{try{await run('CLOSE '+cursor);}catch(error){if(!failure)throw error;}}
   },
   async close(){if(!active)return;active=false;await release();}
  };
 }
}
export function withScratchConnections(operation){
 const parent=scopedDatabaseConnection(),current=context.getStore();
 if(current&&current.parent===parent)return operation();
 let owner=parent&&owners.get(parent);if(!owner){owner=new ScratchOwner(parent);if(parent)owners.set(parent,owner);}
 return context.run(owner,operation);
}
export const scratchConnectionOwner=()=>context.getStore();
export const scratchWorkConnection=signal=>{const owner=context.getStore();if(!owner)throw new AppError('INVALID');return owner.acquire(signal);};
