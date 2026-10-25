// Preparation retains immutable metadata through the existing writer. Bounded
// staging joins small cell roots into one authorized transaction; no reference
// escapes until all children and the final roots have durably committed.
import {MaterialSequence} from './material-sequence.js';
import {withWorkspaceMetadataBatch} from './metadata-batch.js';
import {digest,serialize} from './storage-format.js';
import {AppError} from './errors.js';
const MAX_BYTES=256*1024,MAX_OBJECTS=32;
export async function withDatasetPreparationWrites(materials,{writePage,signal},operation){
 const pending=new Map(),cached=new Map();let bytes=0,cacheBytes=0;
 const write=writePage??(fn=>materials.workspace.withLock(fn));
 const touch=key=>{const entry=cached.get(key);if(entry){cached.delete(key);cached.set(key,entry);}return entry;};
 const cache=(key,value,size,staged=false)=>{if(size>MAX_BYTES)return;const prior=cached.get(key);if(prior){cacheBytes-=prior.size;cached.delete(key);}while(cached.size>=64||cacheBytes+size>MAX_BYTES){const old=cached.keys().next().value;cacheBytes-=cached.get(old).size;cached.delete(old);}cached.set(key,{value:structuredClone(value),size,staged});cacheBytes+=size;};
 const commit=entries=>write(()=>withWorkspaceMetadataBatch(materials.workspace,async()=>{
  for(const entry of entries){signal?.throwIfAborted();if(entry.kind)await materials.sequences.put(entry.kind,entry.value);else await materials.put(entry.file,entry.value);}
 }));
 const flush=async()=>{if(!pending.size)return;signal?.throwIfAborted();await commit(pending.values());pending.clear();bytes=0;};
 const stage=async(key,entry)=>{
  signal?.throwIfAborted();if(pending.has(key)||touch(key)?.staged)return;
  const size=Buffer.byteLength(serialize(entry.value));if(size>MAX_BYTES){await flush();await commit([entry]);return;}if(pending.size>=MAX_OBJECTS||bytes+size>MAX_BYTES)await flush();
  pending.set(key,{...entry,size});bytes+=size;cache(key,entry.value,size,true);if(bytes>=MAX_BYTES)await flush();
 };
 class PreparedSequences extends MaterialSequence{
  // The original sequence writer authenticates prior bytes during commit.
  // Avoid a separate read transaction for every newly generated node here.
  tree(){return super.tree({authenticateOnWrite:true});}
  async read(kind,id,limit=1048576){
   signal?.throwIfAborted();const key=kind+':'+id,entry=pending.get(key)??touch(key);
   if(entry){if(entry.size>limit)throw new AppError('LIMIT');return structuredClone(entry.value);}
   const value=await materials.sequences.read(kind,id,limit);signal?.throwIfAborted();
   // The ordinary reader authenticates the immutable identity before it enters
   // this bounded cache. Keep returned objects separate from retained values.
   if(value!==null)cache(key,value,Buffer.byteLength(serialize(value)));return value;
  }
  async put(kind,value){const id=digest(serialize(value));await stage(kind+':'+id,{kind,value});return id;}
 }
 const staged=Object.create(materials);staged.sequences=new PreparedSequences(materials.workspace);
 staged.put=async(file,value)=>{if(!file.includes('tables'))throw new AppError('INVALID');await stage('page:'+file,{file,value});};
 try{const result=await operation(staged);await flush();return result;}
 finally{pending.clear();cached.clear();bytes=0;cacheBytes=0;}
}
