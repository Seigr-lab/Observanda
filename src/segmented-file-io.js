import {createHash} from 'node:crypto';
import {SEGMENTED_HEADER_BYTES,SEGMENTED_CHUNK_OVERHEAD,readSegmentedHeader,segmentedChunkSize,openSegment} from './segmented-file-format.js';
import {AppError} from './errors.js';
export async function readFilePart(handle,size,position){const bytes=Buffer.allocUnsafe(size);let offset=0;while(offset<size){const result=await handle.read(bytes,offset,size-offset,position+offset);if(!result.bytesRead)throw new AppError('ENCRYPTION_DAMAGED');offset+=result.bytesRead;}return bytes;}
export async function writeFilePart(handle,bytes,position){let offset=0;while(offset<bytes.length){const result=await handle.write(bytes,offset,bytes.length-offset,position+offset);if(!result.bytesWritten)throw new AppError('IO');offset+=result.bytesWritten;}}
export async function* readSegmentedFile(handle,key,aad,{signal}={}){
 const header=readSegmentedHeader(await readFilePart(handle,SEGMENTED_HEADER_BYTES,0),key,aad),stat=await handle.stat({bigint:true});if(stat.size!==BigInt(header.storedSize))throw new AppError('ENCRYPTION_DAMAGED');const hash=createHash('sha256');let position=SEGMENTED_HEADER_BYTES;
 for(let index=0;index<header.count;index++){signal?.throwIfAborted();const length=segmentedChunkSize(header,index)+SEGMENTED_CHUNK_OVERHEAD,bytes=openSegment(await readFilePart(handle,length,position),index,header,key,aad);hash.update(bytes);position+=length;yield bytes;}
 if(hash.digest('hex')!==header.sha256)throw new AppError('ENCRYPTION_DAMAGED');
}
