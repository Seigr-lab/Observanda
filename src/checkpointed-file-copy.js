import {operationStage,operationAdvance,operationWork} from './operation-progress.js';
import {atomicWrite} from './storage.js';
// One private encrypted partial file becomes the destination by rename. Its
// complete authenticated chunks are the recovery record; no second body spool
// or per-byte database writes are needed. Legacy source authentication still
// requires reading its entire envelope on each attempt.
import path from 'node:path';
import {open,lstat,unlink} from 'node:fs/promises';
import {createHash,createHmac} from 'node:crypto';
import {SEGMENTED_HEADER_BYTES,SEGMENTED_BLOCK_BYTES,SEGMENTED_CHUNK_OVERHEAD,createSegmentedHeader,readSegmentedHeader,segmentedChunkSize,sealSegment,openSegment} from './segmented-file-format.js';
import {readFilePart,writeFilePart} from './segmented-file-io.js';
import {withWriterLease,writerLeaseHeld} from './writer-lease.js';
import {atomicReplace} from './atomic-replace.js';
import {AppError} from './errors.js';
const stable=(a,b)=>['dev','ino','size','mtimeNs','ctimeNs'].every(key=>a[key]===b[key]);
const regular=stat=>{if(!stat.isFile()||stat.nlink!==1n)throw new AppError('UNSAFE');return stat;};
export function checkpointedFileName(content,target,file){
 if(!target.vault?.key)throw new AppError('ACCESS_LOCKED');
 const hash=createHmac('sha256',target.vault.key).update(JSON.stringify([target.vault.id,target.fileAAD(file),content.size,content.sha256])).digest('hex');
 return path.join(path.dirname(file),'.stream-'+[hash.slice(0,8),hash.slice(8,12),hash.slice(12,16),hash.slice(16,20),hash.slice(20,32)].join('-'));
}
export async function checkpointedFileCopy(content,target,file,{decode,space,signal,onProgress,reserveBytes=0}={}){
 const relative=path.relative(target.root,path.dirname(file));if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw new AppError('UNSAFE');
 let directory=target.root;for(const part of ['',...relative.split(path.sep).filter(Boolean)]){if(part)directory=path.join(directory,part);const stat=await lstat(directory);if(!stat.isDirectory()||stat.isSymbolicLink())throw new AppError('UNSAFE');}
 const temp=checkpointedFileName(content,target,file),leaseFile=target.projectId?path.join(target.root,'.observanda','project-transfer.lock'):temp+'.lock';
 // The migration already owns this selected destination. Reuse that live
 // lease instead of launching a filesystem-lock helper for every large file.
 const exclusive=operation=>writerLeaseHeld(leaseFile)?operation():withWriterLease(leaseFile,operation);
 return operationStage('encrypt-file',{total:content.size,unit:'bytes',item:path.basename(file)},()=>exclusive(async()=>{
  signal?.throwIfAborted();if(await lstat(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;}))throw new AppError('EXISTS');
  const key=Buffer.from(target.vault.key),aad=target.fileAAD(file);let source,handle,partialIdentity,discard=false;
  try{
   const sourcePath=regular(await lstat(content.file,{bigint:true}));source=await open(content.file,'r');const sourceStat=regular(await source.stat({bigint:true}));if(!stable(sourcePath,sourceStat))throw new AppError('MEDIA_INVALID');
   let header;const prior=await lstat(temp,{bigint:true}).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
   if(prior){regular(prior);handle=await open(temp,'r+');partialIdentity=regular(await handle.stat({bigint:true}));if(!stable(prior,partialIdentity))throw new AppError('UNSAFE');header=readSegmentedHeader(await readFilePart(handle,SEGMENTED_HEADER_BYTES,0),key,aad);if(header.size!==content.size||header.sha256!==content.sha256)throw new AppError('MEDIA_INVALID');}
   else{const bytes=createSegmentedHeader(content.size,content.sha256,key,aad);await space(path.dirname(file),bytes.length,reserveBytes);await atomicWrite(temp,bytes);handle=await open(temp,'r+');partialIdentity=regular(await handle.stat({bigint:true}));header=readSegmentedHeader(bytes,key,aad);}
   const stored=await handle.stat({bigint:true});if(stored.size>BigInt(header.storedSize))throw new AppError('ENCRYPTION_DAMAGED');
   let position=SEGMENTED_HEADER_BYTES,accepted=0,index=0;const retainedHash=createHash('sha256');
   while(index<header.count){signal?.throwIfAborted();const length=segmentedChunkSize(header,index)+SEGMENTED_CHUNK_OVERHEAD;if(BigInt(position+length)>stored.size)break;const bytes=openSegment(await readFilePart(handle,length,position),index,header,key,aad);retainedHash.update(bytes);operationWork({bytes:bytes.length});accepted+=bytes.length;position+=length;index++;}
   // Only a torn final chunk may be discarded. Complete chunks must authenticate.
   if(stored.size!==BigInt(position)){await handle.truncate(position);await handle.sync();}
   const resumedBytes=accepted,retainedDigest=retainedHash.digest('hex');let prefixChecked=resumedBytes===0;operationAdvance(accepted);await onProgress?.(accepted,content.size);
   let read=0,pending=Buffer.alloc(0),unsynced=0,spaceUntil=accepted;const sourceHash=createHash('sha256');
   async function append(bytes){if(accepted>=spaceUntil){const batch=Math.min(8*SEGMENTED_BLOCK_BYTES,content.size-accepted);await space(path.dirname(file),batch+Math.ceil(batch/SEGMENTED_BLOCK_BYTES)*SEGMENTED_CHUNK_OVERHEAD,reserveBytes);spaceUntil=accepted+batch;}const sealed=sealSegment(bytes,index,header,key,aad);await writeFilePart(handle,sealed,position);operationAdvance(bytes.length);operationWork({bytes:bytes.length});position+=sealed.length;accepted+=bytes.length;index++;unsynced+=bytes.length;if(unsynced>=8*SEGMENTED_BLOCK_BYTES){await handle.sync();unsynced=0;}await onProgress?.(accepted,content.size);}
   for await(const bytes of decode(source,content.workspace,content.file)){
    signal?.throwIfAborted();const start=read;read+=bytes.length;if(read>content.size)throw new AppError('MEDIA_INVALID');
    if(!prefixChecked){const count=Math.min(bytes.length,resumedBytes-start);sourceHash.update(bytes.subarray(0,count));if(start+count===resumedBytes){if(sourceHash.copy().digest('hex')!==retainedDigest)throw new AppError('MEDIA_INVALID');prefixChecked=true;}sourceHash.update(bytes.subarray(count));}else sourceHash.update(bytes);
    if(read<=resumedBytes)continue;const suffix=bytes.subarray(Math.max(0,resumedBytes-start));pending=pending.length?Buffer.concat([pending,suffix]):suffix;
    while(pending.length>=SEGMENTED_BLOCK_BYTES){await append(pending.subarray(0,SEGMENTED_BLOCK_BYTES));pending=pending.subarray(SEGMENTED_BLOCK_BYTES);}
   }
   if(pending.length)await append(pending);
   signal?.throwIfAborted();if(read!==content.size||accepted!==content.size||!prefixChecked||sourceHash.digest('hex')!==content.sha256||!stable(sourceStat,await source.stat({bigint:true}))||!stable(sourceStat,regular(await lstat(content.file,{bigint:true}))))throw new AppError('MEDIA_INVALID');
   await handle.sync();await handle.close();handle=null;
   if(await lstat(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;}))throw new AppError('EXISTS');signal?.throwIfAborted();const ready=regular(await lstat(temp,{bigint:true}));if(ready.dev!==partialIdentity.dev||ready.ino!==partialIdentity.ino)throw new AppError('UNSAFE');await atomicReplace(temp,file);return {size:content.size,sha256:content.sha256};
  }catch(error){discard=['ENCRYPTION_DAMAGED','MEDIA_INVALID'].includes(error.code);if(['ENOSPC','EDQUOT'].includes(error.code))throw new AppError('STORAGE_FULL');throw error;}
  finally{key.fill(0);await handle?.close();await source?.close();if(discard&&partialIdentity){const current=await lstat(temp,{bigint:true}).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(current?.isFile()&&current.nlink===1n&&current.dev===partialIdentity.dev&&current.ino===partialIdentity.ino)await unlink(temp);}}
 }));
}
