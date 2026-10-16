// Build an authenticated immutable tree without retaining every input or tree
// node in memory. The transaction owns an encrypted temporary mutable tree;
// only the final reachable nodes enter the permanent catalogue.
import {randomUUID} from 'node:crypto';
import {ObjectIndex} from './object-index.js';
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
export async function buildIndex(store,destination,entries,combine){
 const name='index_build_'+randomUUID().replaceAll('-',''),table='pg_temp.'+name;
 try{await store.db.run('CREATE TEMP TABLE '+name+' (id TEXT PRIMARY KEY,payload BYTEA NOT NULL) ON COMMIT DROP');}
 catch(error){if(error.code==='42501')throw new AppError('DATABASE_PERMISSION');throw error;}
 const key=id=>name+':'+id;
 const scratch=new ObjectIndex(store,{cacheReads:true,cacheSize:4096,nodeStorage:{read:async ref=>{
  const row=await store.db.get('SELECT payload FROM '+table+' WHERE id=$1',ref.key);
  return store.decode('state',key(ref.key),row?.payload);
 }}});
 let root=null,batch=0,failed=false;
 const flush=async()=>{
  let values=[],removed=[],bytes=0;
  const write=async()=>{
   if(values.length){const tuples=Array.from({length:values.length/2},(_,i)=>'($'+(i*2+1)+',$'+(i*2+2)+')');await store.db.run('INSERT INTO '+table+' VALUES '+tuples.join(',')+' ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',...values);}
   if(removed.length)await store.db.run('DELETE FROM '+table+' WHERE id=ANY($1::text[])',removed);
   values=[];removed=[];bytes=0;
  };
  for(const [slot,node] of scratch.writes){
   const id=slot.slice(scratch.namespace.length),payload=node===null?null:store.encode('state',key(id),node);
   if(bytes+(payload?.length??0)>256*1024)await write();
   if(payload===null)removed.push(id);else{values.push(id,payload);bytes+=payload.length;}
   if(values.length/2+removed.length===32)await write();
  }
  await write();
  // Keep only the current version of each mutable key in the byte-bounded LRU.
  // The next input batch can reuse the checked branches it just persisted.
  for(const [slot,node] of scratch.writes)if(node)scratch.cacheNode({key:slot.slice(scratch.namespace.length),hash:digest(serialize(node))},node);
  scratch.pending.clear();scratch.pendingBytes=0;scratch.writes.clear();batch=0;
 };
 try{
  for await(const {id,revision} of entries){
   const previous=await scratch.find({root},id);
   root=await scratch.change(root,id,previous?combine(previous.revision,revision,id):revision);
   if(++batch===128)await flush();
  }
  await flush();
  // Completed branches form a bounded forest until their parent is built.
  // Flush every reachable branch together; flushing only the latest root would
  // discard pending siblings. The final tree contains no abandoned roots.
  const frontier=new Map();
  const persist=async()=>{await destination.flushRoots([...frontier.values()]);frontier.clear();};
  const retain=async(ref,lower=null,upper=null)=>{
   if(!ref)return null;const node=await scratch.node(ref,lower,upper);
   const left=await retain(node.left,lower,node.id),right=await retain(node.right,node.id,upper);
   const next=destination.make(node.id,node.revision,left,right);
   if(left)frontier.delete(left.hash);if(right)frontier.delete(right.hash);frontier.set(next.hash,next);
   if(destination.pending.size>=128)await persist();return next;
  };
  const result=await retain(root);await persist();return result;
 }catch(error){failed=true;throw error;}
 finally{
  // A failed SQL statement may already have aborted this transaction. Its
  // rollback removes the temp table; preserve the original failure reason.
  try{await store.db.run('DROP TABLE IF EXISTS '+table);}catch(error){if(!failed)throw error;}
 }
}
