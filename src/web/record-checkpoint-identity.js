import {sha256} from './vendor/sha256.js';
import {jsonChunks,yieldJSONWork} from './json-chunks.js';
const hex=bytes=>Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
export async function recordCheckpointIdentity(changes,{signal}={}){
 const hash=sha256.create();let bytes=0,start=performance.now();
 try{
  for(const part of jsonChunks(changes,{signal})){
   hash.update(part);bytes+=part.length;if(!Number.isSafeInteger(bytes))throw Object.assign(Error('Invalid checkpoint size.'),{code:'INVALID'});
   start=await yieldJSONWork(start,signal);
  }
  return {bytes,sha256:hex(hash.digest())};
 }finally{hash.destroy();}
}
// The direct compatibility endpoint admits its pretty-printed stored envelope.
// Stop as soon as it exceeds that request budget; total draft size is uncapped.
export async function directRecordCheckpoint(command,maximum,{signal}={}){
 const compact=command.changes?.length===1&&Object.hasOwn(command.changes[0],'baseRevision');
 if(!compact)return true;
 let bytes=0,start=performance.now();
 for(const part of jsonChunks({formatVersion:2,...command,updatedAt:'2000-01-01T00:00:00.000Z'},{pretty:true,signal})){
  bytes+=part.length;if(bytes>maximum)return false;start=await yieldJSONWork(start,signal);
 }
 return true;
}
