// Network chunk sizes cannot control row count or allocation overhead. A raw
// manifest has at most ceil(expectedBytes / frameBytes) encrypted scratch rows;
// descriptors are parsed only after the complete expected digest authenticates.
import {ENCRYPTION_OVERHEAD} from './encryption.js';
import {setImmediate as yieldTurn} from 'node:timers/promises';
export const liveManifestFrameBytes=64*1024;
export async function spoolLiveManifest(chunks,work,expectedBytes,{signal,fail}={}){
 // Include base64 padding, JSON quotes and the authenticated-encryption envelope
 // in the retained payload budget. PostgreSQL tuple/index overhead is bounded
 // separately by the row count, not by attacker-selected network chunk sizes.
 const maxRows=Math.ceil(expectedBytes/liveManifestFrameBytes),maxPayload=4*Math.ceil(expectedBytes/3)+maxRows*(6+ENCRYPTION_OVERHEAD);
 if(!Number.isSafeInteger(expectedBytes)||expectedBytes<1||!Number.isSafeInteger(maxPayload))throw fail('size');
 const frame=Buffer.allocUnsafe(liveManifestFrameBytes);let used=0,total=0,count=0,payload=0,batch=[],turns=0;
 async function flush(){if(!batch.length)return;signal?.throwIfAborted();await work.putMany(batch);batch=[];signal?.throwIfAborted();}
 async function retain(){
  if(count>=maxRows)throw fail('size');const value=frame.subarray(0,used).toString('base64');payload+=Buffer.byteLength(JSON.stringify(value))+ENCRYPTION_OVERHEAD;if(payload>maxPayload)throw fail('size');
  batch.push(['manifest:'+count++,value]);used=0;if(batch.length===32)await flush();
 }
 try{
  for await(const value of chunks){
   signal?.throwIfAborted();const bytes=Buffer.isBuffer(value)?value:Buffer.from(value);total+=bytes.length;if(!Number.isSafeInteger(total)||total>expectedBytes)throw fail('size');
   for(let offset=0;offset<bytes.length;){const size=Math.min(frame.length-used,bytes.length-offset);bytes.copy(frame,used,offset,offset+size);used+=size;offset+=size;if(used===frame.length)await retain();}
   if(++turns===256){turns=0;await yieldTurn(undefined,{signal});}
  }
  if(total!==expectedBytes)throw fail('size');if(used)await retain();await flush();
  return {rows:count,payloadBytes:payload,async *chunks({signal:readSignal}={}){for(let index=0;index<count;index++){readSignal?.throwIfAborted();const name='manifest:'+index,value=await work.get(name);if(typeof value!=='string')throw fail('manifest');try{yield Buffer.from(value,'base64');}finally{await work.remove(name);}}}};
 }finally{frame.fill(0);}
}
