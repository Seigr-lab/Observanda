import {createHash} from 'node:crypto';
import {SEGMENTED_HEADER_BYTES,SEGMENTED_BLOCK_BYTES,SEGMENTED_CHUNK_OVERHEAD,readSegmentedHeader,segmentedChunkSize,openSegment} from './segmented-file-format.js';
import {AppError} from './errors.js';
export async function readFilePart(handle,size,position){const bytes=Buffer.allocUnsafe(size);let offset=0;while(offset<size){const result=await handle.read(bytes,offset,size-offset,position+offset);if(!result.bytesRead)throw new AppError('ENCRYPTION_DAMAGED');offset+=result.bytesRead;}return bytes;}
export async function writeFilePart(handle,bytes,position){let offset=0;while(offset<bytes.length){const result=await handle.write(bytes,offset,bytes.length-offset,position+offset);if(!result.bytesWritten)throw new AppError('IO');offset+=result.bytesWritten;}}
export async function segmentedFileHeader(handle,key,aad,{size,sha256,signal,check=()=>{},onRead=()=>{}}={}){
 signal?.throwIfAborted();await check();const bytes=await readFilePart(handle,SEGMENTED_HEADER_BYTES,0);onRead(bytes.length);await check();signal?.throwIfAborted();
 const header=readSegmentedHeader(bytes,key,aad),stat=await handle.stat({bigint:true});
 if(stat.size!==BigInt(header.storedSize))throw new AppError('ENCRYPTION_DAMAGED');
 if(header.size!==size||header.sha256!==sha256)throw new AppError('MEDIA_INVALID');
 await check();return header;
}
// Partial reads authenticate the descriptor and every selected chunk before
// releasing that chunk. Complete artifact verification remains a separate
// operation: corruption in an unrequested chunk is not checked by a seek.
export async function* readSegmentedRange(handle,key,aad,start,end,options={}){
 const {signal,check=()=>{},onRead=()=>{}}=options,header=await segmentedFileHeader(handle,key,aad,options);
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end>=header.size)throw new AppError('INVALID');
 for(let index=Math.floor(start/SEGMENTED_BLOCK_BYTES);index<=Math.floor(end/SEGMENTED_BLOCK_BYTES);index++){
  signal?.throwIfAborted();await check();const position=SEGMENTED_HEADER_BYTES+index*(SEGMENTED_BLOCK_BYTES+SEGMENTED_CHUNK_OVERHEAD),length=segmentedChunkSize(header,index)+SEGMENTED_CHUNK_OVERHEAD;
  const stored=await readFilePart(handle,length,position);onRead(stored.length);await check();signal?.throwIfAborted();
  const bytes=openSegment(stored,index,header,key,aad),offset=index*SEGMENTED_BLOCK_BYTES;
  yield bytes.subarray(Math.max(0,start-offset),Math.min(bytes.length,end-offset+1));
 }
 await check();signal?.throwIfAborted();
}
export async function* readSegmentedFile(handle,key,aad,{signal}={}){
 const header=readSegmentedHeader(await readFilePart(handle,SEGMENTED_HEADER_BYTES,0),key,aad),stat=await handle.stat({bigint:true});if(stat.size!==BigInt(header.storedSize))throw new AppError('ENCRYPTION_DAMAGED');const hash=createHash('sha256');let position=SEGMENTED_HEADER_BYTES;
 for(let index=0;index<header.count;index++){signal?.throwIfAborted();const length=segmentedChunkSize(header,index)+SEGMENTED_CHUNK_OVERHEAD,bytes=openSegment(await readFilePart(handle,length,position),index,header,key,aad);hash.update(bytes);position+=length;yield bytes;}
 if(hash.digest('hex')!==header.sha256)throw new AppError('ENCRYPTION_DAMAGED');
}
