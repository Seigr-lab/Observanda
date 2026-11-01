import {operationStage,operationAdvance,operationWork} from './operation-progress.js';
import {withNativeContentFile} from './native-content-file.js';
// One private encrypted partial file becomes the destination by rename. Its
// complete authenticated chunks are the recovery record; no second body spool
// or per-byte database writes are needed. Legacy source authentication still
// requires reading its entire envelope on each attempt.
import path from 'node:path';
import {createHash,createHmac} from 'node:crypto';
import {SEGMENTED_HEADER_BYTES,SEGMENTED_BLOCK_BYTES,SEGMENTED_CHUNK_OVERHEAD,createSegmentedHeader,readSegmentedHeader,segmentedChunkSize,sealSegment,openSegment} from './segmented-file-format.js';
import {readFilePart,writeFilePart} from './segmented-file-io.js';
import {withWriterLease,writerLeaseHeld} from './writer-lease.js';
import {AppError} from './errors.js';
import {diskCapacity} from './disk-capacity.js';
import {withStagingCapacity} from './staging-reservations.js';
const stable=(a,b)=>['dev','ino','size','mtimeNs','ctimeNs'].every(key=>a[key]===b[key]);
const regular=stat=>{if(!stat.isFile()||stat.nlink!==1n)throw new AppError('UNSAFE');return stat;};
export function checkpointedFileName(content,target,file){
 if(!target.vault?.key)throw new AppError('ACCESS_LOCKED');
 const hash=createHmac('sha256',target.vault.key).update(JSON.stringify([target.vault.id,target.fileAAD(file),content.size,content.sha256])).digest('hex');
 return path.join(path.dirname(file),'.stream-'+[hash.slice(0,8),hash.slice(8,12),hash.slice(12,16),hash.slice(16,20),hash.slice(20,32)].join('-'));
}
export function checkpointedFileCopy(content,target,file,options={}){return withStagingCapacity(target,admission=>withNativeContentFile(content.workspace,content.file,(input,sourceName)=>withNativeContentFile(target,file,(output,name)=>copyAnchored(content,target,file,{...options,admission},input,sourceName,output,name),{create:true})),{signal:options.signal});}
async function copyAnchored(content,target,file,{decode,signal,onProgress,check=async()=>{},reserveBytes=0,admission},input,sourceName,output,name){
 const temp=checkpointedFileName(content,target,file),leaseFile=target.projectId?path.join(target.root,'.observanda','project-transfer.lock'):temp+'.lock';
 // The migration already owns this selected destination. Reuse that live
 // lease instead of launching a filesystem-lock helper for every large file.
 const exclusive=operation=>writerLeaseHeld(leaseFile)?operation():withWriterLease(leaseFile,operation);
 return operationStage('encrypt-file',{total:content.size,unit:'bytes',item:path.basename(file)},()=>exclusive(async()=>{
  signal?.throwIfAborted();if(await output.stat(name,{missing:true}))throw new AppError('EXISTS');
  const vault=target.vault,ownerKey=vault.key,key=Buffer.from(ownerKey),sourceVault=content.workspace.vault,sourceKey=sourceVault?.key,sourceKeyCopy=sourceKey?Buffer.from(sourceKey):null,aad=target.fileAAD(file),temporary=path.basename(temp);let source,handle,reservation,partialIdentity,discard=false;
  const checkKeys=()=>{if(target.vault!==vault||vault.key!==ownerKey||!key.equals(ownerKey)||content.workspace.vault!==sourceVault||sourceVault?.key!==sourceKey||sourceKeyCopy&&!sourceKeyCopy.equals(sourceKey))throw new AppError('ACCESS_LOCKED');};
  try{
   checkKeys();source=await input.file(sourceName);const sourceStat=regular(await source.stat({bigint:true}));
   let header;handle=await output.file(temporary,{mode:'update',missing:true});
   if(handle){partialIdentity=handle.identity;header=readSegmentedHeader(await readFilePart(handle,SEGMENTED_HEADER_BYTES,0),key,aad);if(header.size!==content.size||header.sha256!==content.sha256)throw new AppError('MEDIA_INVALID');}
   else{const bytes=createSegmentedHeader(content.size,content.sha256,key,aad);header=readSegmentedHeader(bytes,key,aad);reservation=await diskCapacity.reserve(path.dirname(file),header.storedSize,{reserveBytes,signal,refreshBytes:8*SEGMENTED_BLOCK_BYTES,admission});handle=await output.file(temporary,{mode:'exclusive'});partialIdentity=handle.identity;await reservation.write(bytes.length,()=>writeFilePart(handle,bytes,0));await handle.sync();}
   const stored=await handle.stat({bigint:true});if(stored.size>BigInt(header.storedSize))throw new AppError('ENCRYPTION_DAMAGED');
   let position=SEGMENTED_HEADER_BYTES,accepted=0,index=0;const retainedHash=createHash('sha256');
   while(index<header.count){signal?.throwIfAborted();await check();checkKeys();const length=segmentedChunkSize(header,index)+SEGMENTED_CHUNK_OVERHEAD;if(BigInt(position+length)>stored.size)break;const bytes=openSegment(await readFilePart(handle,length,position),index,header,key,aad);retainedHash.update(bytes);operationWork({bytes:bytes.length});accepted+=bytes.length;position+=length;index++;bytes.fill(0);}
   // Only a torn final chunk may be discarded. Complete chunks must authenticate.
   if(stored.size!==BigInt(position)){await handle.truncate(position);await handle.sync();}
   reservation??=await diskCapacity.reserve(path.dirname(file),header.storedSize-position,{reserveBytes,signal,refreshBytes:8*SEGMENTED_BLOCK_BYTES,admission});
   const resumedBytes=accepted,retainedDigest=retainedHash.digest('hex');let prefixChecked=resumedBytes===0;operationAdvance(accepted);await onProgress?.(accepted,content.size);
   let read=0,pending=Buffer.alloc(0),unsynced=0;const sourceHash=createHash('sha256');
   async function append(bytes){signal?.throwIfAborted();checkKeys();const sealed=sealSegment(bytes,index,header,key,aad);await reservation.write(sealed.length,()=>writeFilePart(handle,sealed,position));operationAdvance(bytes.length);operationWork({bytes:bytes.length});position+=sealed.length;accepted+=bytes.length;index++;unsynced+=bytes.length;if(unsynced>=8*SEGMENTED_BLOCK_BYTES){await handle.sync();unsynced=0;}await onProgress?.(accepted,content.size);}
   for await(const bytes of decode(source,content.workspace,content.file)){
    signal?.throwIfAborted();await check();checkKeys();const start=read;read+=bytes.length;if(read>content.size)throw new AppError('MEDIA_INVALID');
    if(!prefixChecked){const count=Math.min(bytes.length,resumedBytes-start);sourceHash.update(bytes.subarray(0,count));if(start+count===resumedBytes){if(sourceHash.copy().digest('hex')!==retainedDigest)throw new AppError('MEDIA_INVALID');prefixChecked=true;}sourceHash.update(bytes.subarray(count));}else sourceHash.update(bytes);
    if(read<=resumedBytes)continue;const suffix=bytes.subarray(Math.max(0,resumedBytes-start));pending=pending.length?Buffer.concat([pending,suffix]):suffix;
    while(pending.length>=SEGMENTED_BLOCK_BYTES){await append(pending.subarray(0,SEGMENTED_BLOCK_BYTES));pending=pending.subarray(SEGMENTED_BLOCK_BYTES);}
   }
   if(pending.length)await append(pending);
   signal?.throwIfAborted();await check();checkKeys();if(read!==content.size||accepted!==content.size||!prefixChecked||sourceHash.digest('hex')!==content.sha256||!stable(sourceStat,await source.stat({bigint:true}))||(await input.stat(sourceName)).identity!==source.identity)throw new AppError('MEDIA_INVALID');
   await handle.sync();await handle.close();handle=null;
   signal?.throwIfAborted();await check();checkKeys();try{await output.rename(temporary,output,name,{identity:partialIdentity});}catch(error){if(error.code==='EEXIST')throw new AppError('EXISTS');throw error;}return {size:content.size,sha256:content.sha256};
  }catch(error){discard=['ENCRYPTION_DAMAGED','MEDIA_INVALID'].includes(error.code);if(['ENOSPC','EDQUOT'].includes(error.code))throw new AppError('STORAGE_FULL');throw error;}
  finally{key.fill(0);sourceKeyCopy?.fill(0);try{await handle?.close();await source?.close();if(discard&&partialIdentity)await output.remove(temporary,{identity:partialIdentity}).catch(error=>{if(error.code!=='ENOENT')throw error;});}finally{reservation?.release();}}
 }));
}
