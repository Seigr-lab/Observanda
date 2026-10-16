// Independently authenticated chunks in one encrypted file. Header identity,
// final pathname, declared digest, byte length and chunk ordinal are all bound
// by AES-GCM. A new nonce is generated for every newly written chunk.
import {createCipheriv,createDecipheriv,createHash,randomBytes,hkdfSync} from 'node:crypto';
import {AppError} from './errors.js';
export const SEGMENTED_ENVELOPE=Buffer.from('OBSENC02');
export const SEGMENTED_HEADER_BYTES=96;
export const SEGMENTED_BLOCK_BYTES=1024*1024;
export const SEGMENTED_CHUNK_OVERHEAD=28;
const damaged=()=>{throw new AppError('ENCRYPTION_DAMAGED');};
const aadFor=(aad,prefix,index)=>Buffer.from(JSON.stringify(['Observanda/segmented-file/v1',aad,prefix.toString('hex'),index]));
const encrypt=(bytes,key,aad)=>{const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce,{authTagLength:16});cipher.setAAD(aad);const body=Buffer.concat([cipher.update(bytes),cipher.final()]);return Buffer.concat([nonce,cipher.getAuthTag(),body]);};
const decrypt=(bytes,key,aad)=>{try{const cipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12),{authTagLength:16});cipher.setAAD(aad);cipher.setAuthTag(bytes.subarray(12,28));return Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]);}catch{damaged();}};
const headerAAD=aad=>Buffer.from(JSON.stringify(['Observanda/segmented-file/v1',aad,'header']));
export function createSegmentedHeader(size,sha256,key,aad){
 if(!key)throw new AppError('ACCESS_LOCKED');
 if(!Number.isSafeInteger(size)||size<0||typeof sha256!=='string'||! /^[a-f0-9]{64}$/.test(sha256))throw new AppError('INVALID');
 const value=Buffer.alloc(60);randomBytes(16).copy(value);value.writeBigUInt64BE(BigInt(size),16);Buffer.from(sha256,'hex').copy(value,24);value.writeUInt32BE(SEGMENTED_BLOCK_BYTES,56);
 return Buffer.concat([SEGMENTED_ENVELOPE,encrypt(value,key,headerAAD(aad))]);
}
export function readSegmentedHeader(bytes,key,aad){
 if(!key)throw new AppError('ACCESS_LOCKED');
 if(bytes.length!==SEGMENTED_HEADER_BYTES||!bytes.subarray(0,8).equals(SEGMENTED_ENVELOPE))damaged();
 const value=decrypt(bytes.subarray(8),key,headerAAD(aad));
 if(value.length!==60||value.readBigUInt64BE(16)>BigInt(Number.MAX_SAFE_INTEGER)||value.readUInt32BE(56)!==SEGMENTED_BLOCK_BYTES)damaged();
 const size=Number(value.readBigUInt64BE(16)),count=Math.ceil(size/SEGMENTED_BLOCK_BYTES),storedSize=SEGMENTED_HEADER_BYTES+size+count*SEGMENTED_CHUNK_OVERHEAD;
 if(!Number.isSafeInteger(storedSize))damaged();return {bytes:Buffer.from(bytes),prefix:Buffer.from(bytes),salt:Buffer.from(value.subarray(0,16)),size,sha256:value.subarray(24,56).toString('hex'),count,storedSize};
}
export function segmentedChunkSize(header,index){if(!Number.isSafeInteger(index)||index<0||index>=header.count)damaged();return Math.min(SEGMENTED_BLOCK_BYTES,header.size-index*SEGMENTED_BLOCK_BYTES);}
// Each stream/chunk has a derived key, so a very large original does not
// accumulate all random nonces under the workspace's long-lived storage key.
const chunkKey=(header,key,aad,index)=>Buffer.from(hkdfSync('sha256',key,header.salt,Buffer.from(JSON.stringify(['Observanda/segmented-file-key/v1',aad,index])),32));
export function sealSegment(bytes,index,header,key,aad){if(bytes.length!==segmentedChunkSize(header,index))throw new AppError('INVALID');const derived=chunkKey(header,key,aad,index);try{return encrypt(bytes,derived,aadFor(aad,header.prefix,index));}finally{derived.fill(0);}}
export function openSegment(bytes,index,header,key,aad){if(bytes.length!==segmentedChunkSize(header,index)+SEGMENTED_CHUNK_OVERHEAD)damaged();const derived=chunkKey(header,key,aad,index);try{return decrypt(bytes,derived,aadFor(aad,header.prefix,index));}finally{derived.fill(0);}}
export function unsealSegmentedFile(bytes,key,aad){
 const header=readSegmentedHeader(bytes.subarray(0,SEGMENTED_HEADER_BYTES),key,aad);if(bytes.length!==header.storedSize)damaged();const parts=[],hash=createHash('sha256');let offset=SEGMENTED_HEADER_BYTES;
 for(let index=0;index<header.count;index++){const length=segmentedChunkSize(header,index)+SEGMENTED_CHUNK_OVERHEAD,part=openSegment(bytes.subarray(offset,offset+length),index,header,key,aad);parts.push(part);hash.update(part);offset+=length;}
 if(hash.digest('hex')!==header.sha256)damaged();return Buffer.concat(parts,header.size);
}
