// A verifier must not publish regenerated query blocks into the workspace it
// audits. Its bounded cache spills to encrypted temporary storage instead.
import {withScratch} from './scratch-work.js';
import {digest,serialize} from './storage-format.js';
import {RecordValueTree} from './record-value-tree.js';
import {RecordDocument} from './record-document.js';

export async function withRecordProjectionScratch(document,consume,{signal}={}){
 return withScratch(async work=>{
  const cache=new Map(),pending=new Map();let bytes=0,pendingBytes=0;
  const flush=async()=>{if(pending.size){await work.putMany([...pending]);pending.clear();pendingBytes=0;}};
  const keep=(key,value)=>{
   if(cache.has(key))return;const size=Buffer.byteLength(serialize(value));
   while(cache.size>=32||bytes+size>256*1024){const first=cache.keys().next().value;if(first===undefined)break;bytes-=cache.get(first).size;cache.delete(first);}
   cache.set(key,{value:structuredClone(value),size});bytes+=size;
  };
  const storage={
   async put(kind,value){signal?.throwIfAborted();const encoded=serialize(value),revision=digest(encoded),key=kind+':'+revision;if(!cache.has(key)&&!pending.has(key)){pending.set(key,structuredClone(value));pendingBytes+=Buffer.byteLength(encoded);if(pending.size===32||pendingBytes>=256*1024)await flush();}keep(key,value);return revision;},
   async read(kind,revision){signal?.throwIfAborted();const key=kind+':'+revision;if(pending.has(key))return structuredClone(pending.get(key));if(cache.has(key))return structuredClone(cache.get(key).value);const value=await work.get(key)??await document.blocks.read(kind,revision);keep(key,value);return value;},
   tree(){return new RecordValueTree(this);}
  };
  return consume(new RecordDocument(storage,document.root));
 },{signal});
}
