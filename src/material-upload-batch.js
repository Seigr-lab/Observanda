// A request owns at most eight upload frames and one reusable connection.
// Each complete frame keeps the existing independent durable chunk transaction.
import {ResearchMaterials} from './research-materials.js';
import {FILE_CHUNK} from './web/evidence-fingerprint.js';
import {UPLOAD_BATCH_FRAMES,UPLOAD_HEADER_BYTES} from './web/evidence-upload-batch.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
const invalid=()=>{throw new AppError('INVALID');};
async function* frames(source,{signal}={}){
 let header=Buffer.alloc(UPLOAD_HEADER_BYTES),headerBytes=0,frame=null,body=null,received=0,count=0;
 for await(const value of source){
  signal?.throwIfAborted();if(!Buffer.isBuffer(value)&&!(value instanceof Uint8Array))invalid();
  const bytes=Buffer.isBuffer(value)?value:Buffer.from(value.buffer,value.byteOffset,value.byteLength);let offset=0;
  while(offset<bytes.length){
   signal?.throwIfAborted();
   if(!frame){
    if(count===UPLOAD_BATCH_FRAMES)invalid();
    const newline=bytes.indexOf(10,offset),end=newline<0?bytes.length:newline,size=end-offset;
    if(headerBytes+size>UPLOAD_HEADER_BYTES)invalid();bytes.copy(header,headerBytes,offset,end);headerBytes+=size;offset=end;
    if(newline<0)continue;
    offset++;let value;try{value=JSON.parse(header.subarray(0,headerBytes).toString('utf8'));}catch{invalid();}
    if(!value||Object.keys(value).sort().join()!=='id,index,size'||!researchId(value.id)||!Number.isSafeInteger(value.index)||value.index<0||!Number.isSafeInteger(value.size)||value.size<1||value.size>FILE_CHUNK)invalid();
    frame=value;body=Buffer.allocUnsafe(frame.size);received=0;headerBytes=0;
   }
   const size=Math.min(frame.size-received,bytes.length-offset);bytes.copy(body,received,offset,offset+size);received+=size;offset+=size;
   if(received===frame.size){const accepted={...frame,body};frame=null;body=null;received=0;count++;yield accepted;}
  }
 }
 signal?.throwIfAborted();if(!count||frame||headerBytes)invalid();
}
export async function appendMaterialUploadBatch(workspace,source,{signal}={}){
 signal?.throwIfAborted();const materials=new ResearchMaterials(workspace);
 return workspace.withCatalogueConnections(async()=>{
  const sessions=[];
  for await(const frame of frames(source,{signal})){
   signal?.throwIfAborted();
   const session=await materials.appendImport(frame.id,frame.index,[frame.body],{signal});
   sessions.push(await materials.uploads.summary(session));
  }
  return {sessions};
 });
}
