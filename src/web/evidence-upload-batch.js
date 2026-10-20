import {FILE_CHUNK} from './evidence-fingerprint.js';
import {researchId} from './research-reference.js';
export const UPLOAD_BATCH_FRAMES=8;
export const UPLOAD_HEADER_BYTES=192;
export function evidenceUploadBody(frames){
 if(!Array.isArray(frames)||!frames.length||frames.length>UPLOAD_BATCH_FRAMES)throw Error('Invalid upload batch.');
 const parts=[];
 for(const {id,index,blob} of frames){
  if(!researchId(id)||!Number.isSafeInteger(index)||index<0||!(blob instanceof Blob)||blob.size<1||blob.size>FILE_CHUNK)throw Error('Invalid upload frame.');
  const header=JSON.stringify({id,index,size:blob.size})+'\n';if(new TextEncoder().encode(header).length>UPLOAD_HEADER_BYTES)throw Error('Invalid upload frame.');
  parts.push(header,blob);
 }
 return new Blob(parts,{type:'application/octet-stream'});
}
// File slices stay lazy and bounded. A window may cross file boundaries, so
// many small originals share the same request admission as a large capture.
export async function uploadEvidenceChunks(chunks,{route=value=>value,context,signal,check=()=>{},uploaded=()=>{},fetcher=fetch}={}){
 let pending=[];
 const send=async()=>{
  if(!pending.length)return;signal?.throwIfAborted();check();
  const response=await fetcher(route('/api/research/materials/chunks'),{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Observanda-Workspace':context,'X-Observanda-Wait':'1'},body:evidenceUploadBody(pending),signal});
  if(!response.ok)throw await response.json();const result=await response.json();signal?.throwIfAborted();check();
  if(!Array.isArray(result.sessions)||result.sessions.length!==pending.length||result.sessions.some((session,i)=>session?.id!==pending[i].id||session.receivedChunks!==pending[i].index+1))throw Error('Invalid upload receipt.');
  for(let i=0;i<pending.length;i++)await uploaded(pending[i],result.sessions[i]);pending=[];
 };
 for await(const chunk of chunks){signal?.throwIfAborted();check();pending.push(chunk);if(pending.length===UPLOAD_BATCH_FRAMES)await send();}
 await send();
}
