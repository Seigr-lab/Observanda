// Immutable chunk receipts and a fixed-size upload checkpoint. The session
// commits its new root with the accepted byte count; readers pin that root.
import {AppError} from './errors.js';
import {digest} from './storage-format.js';
import {FILE_CHUNK,validFingerprint,fingerprintStep,emptyFingerprintChain} from './web/evidence-fingerprint.js';
const fail=()=>{throw new AppError('MATERIAL_MISSING');};
export class MaterialUploadChunks{
 constructor(sequences){this.sequences=sequences;}
 initial(){return {chunksIndex:{format:1,kind:'upload-chunks',root:null,count:0,chunkSize:64},receivedBytes:0,chunkChain:emptyFingerprintChain};}
 count(session){return Array.isArray(session.chunks)?session.chunks.length:this.validate(session).chunksIndex.count;}
 bytes(session){return Math.min(session.size,this.count(session)*FILE_CHUNK);}
 validate(session){
  if(!Number.isSafeInteger(session.size)||session.size<0||session.chunkSize!==FILE_CHUNK)fail();
  if(Array.isArray(session.chunks)){
   if(session.chunks.length>Math.ceil(session.size/FILE_CHUNK))fail();
   for(let i=0;i<session.chunks.length;i++)this.receipt(session,session.chunks[i],i);
  }else{
   this.sequences.validate(session.chunksIndex);
   if(session.chunksIndex.kind!=='upload-chunks'||session.chunksIndex.count>Math.ceil(session.size/FILE_CHUNK)||
    session.receivedBytes!==Math.min(session.size,session.chunksIndex.count*FILE_CHUNK)||!validFingerprint(session.chunkChain)||
    !session.chunksIndex.count&&session.chunkChain!==emptyFingerprintChain)fail();
  }
  return session;
 }
 receipt(session,chunk,index){
  if(!chunk||Object.keys(chunk).sort().join()!=='sha256,size'||chunk.size!==Math.min(FILE_CHUNK,session.size-index*FILE_CHUNK)||chunk.size<=0||!validFingerprint(chunk.sha256))fail();
  return chunk;
 }
 async *entries(session,{signal}={}){
  this.validate(session);let index=0,chain=emptyFingerprintChain;
  const source=Array.isArray(session.chunks)?session.chunks:this.sequences.items(session.chunksIndex);
  for await(const chunk of source){
   signal?.throwIfAborted();this.receipt(session,chunk,index);
   chain=await fingerprintStep(chain,index++,chunk,digest);yield chunk;
  }
  if(index!==this.count(session)||!Array.isArray(session.chunks)&&chain!==session.chunkChain)fail();
 }
 async chain(session){
  this.validate(session);if(!Array.isArray(session.chunks))return session.chunkChain;
  let chain=emptyFingerprintChain,index=0;for(const chunk of session.chunks)chain=await fingerprintStep(chain,index++,chunk,digest);return chain;
 }
 async append(session,chunk){
  this.validate(session);const count=this.count(session);this.receipt(session,chunk,count);
  let index=session.chunksIndex,chain=await this.chain(session);
  if(Array.isArray(session.chunks)){
   const builder=this.sequences.builder('upload-chunks',fn=>fn());
   for(const receipt of session.chunks)await builder.append(receipt);
   index=await builder.finish();delete session.chunks;
  }
  session.chunksIndex=await this.sequences.append(index,[chunk]);
  session.receivedBytes=Math.min(session.size,(count+1)*FILE_CHUNK);
  session.chunkChain=await fingerprintStep(chain,count,chunk,digest);
 }
 async summary(session){
  this.validate(session);
  const {id,recordId,name,size,chunkSize,createdAt,completed,batchId,reuse}=session;
  return {id,recordId,name,size,chunkSize,createdAt,completed,receivedBytes:this.bytes(session),receivedChunks:this.count(session),receivedChain:await this.chain(session),
   ...(batchId?{batchId,reuse}: {})};
 }
}
