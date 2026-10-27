import path from 'node:path';
import {open,unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {AppError} from './errors.js';
import {atomicReplace} from './atomic-replace.js';
import {temporaryStreamName} from './storage-temporary.js';
import {createSegmentedHeader,readSegmentedHeader,sealSegment,openSegment,segmentedChunkSize,SEGMENTED_BLOCK_BYTES,SEGMENTED_HEADER_BYTES,SEGMENTED_CHUNK_OVERHEAD} from './segmented-file-format.js';
import {readFilePart,writeFilePart} from './segmented-file-io.js';
import {operationStage,operationAdvance,operationWork} from './operation-progress.js';
import {diskCapacity} from './disk-capacity.js';

// Unknown streams use an encrypted provisional header only inside the private
// temporary file. Once the digest is known, rewrite each bounded block under a
// fresh header/salt/key and nonce, then publish the existing OBSENC02 format.
// Never retag existing GCM ciphertext with a reused nonce or weaken its AAD.
const streamLimit=Math.floor((Number.MAX_SAFE_INTEGER-SEGMENTED_HEADER_BYTES)/(SEGMENTED_BLOCK_BYTES+SEGMENTED_CHUNK_OVERHEAD))*SEGMENTED_BLOCK_BYTES;
async function finalizeStream(handle,header,key,aad,saved,{reservation,signal,check}){
 return operationStage('finalize-encrypted-file',{total:saved.size,unit:'bytes'},async()=>{
  const raw=createSegmentedHeader(saved.size,saved.sha256,key,aad),final=readSegmentedHeader(raw,key,aad),staged={...header,size:saved.size,count:final.count},hash=createHash('sha256');
  for(let index=0;index<final.count;index++){
   signal?.throwIfAborted();check();const position=SEGMENTED_HEADER_BYTES+index*(SEGMENTED_BLOCK_BYTES+SEGMENTED_CHUNK_OVERHEAD);
   const stored=await readFilePart(handle,segmentedChunkSize(staged,index)+SEGMENTED_CHUNK_OVERHEAD,position);operationWork({bytes:stored.length});
   const clear=openSegment(stored,index,staged,key,aad);
   try{
    const bytes=clear.subarray(0,segmentedChunkSize(final,index));hash.update(bytes);const sealed=sealSegment(bytes,index,final,key,aad);
    await reservation.write(sealed.length,()=>writeFilePart(handle,sealed,position));operationAdvance(bytes.length);operationWork({bytes:sealed.length});
   }finally{clear.fill(0);}
  }
  if(hash.digest('hex')!==saved.sha256)throw new AppError('MEDIA_INVALID');
  signal?.throwIfAborted();check();await handle.truncate(final.storedSize);await writeFilePart(handle,raw,0);
 });
}
export async function writeSegmentedContent(workspace,file,source,{expected,maxBytes=0,reserveBytes=0,signal,beforeCommit}){
 await workspace.requireStorageKey();const vault=workspace.vault,ownerKey=vault?.key;if(!vault?.id||!ownerKey)throw new AppError('ACCESS_LOCKED');
 const key=Buffer.from(ownerKey),directory=path.dirname(file),temp=path.join(directory,temporaryStreamName()),buffer=Buffer.allocUnsafe(SEGMENTED_BLOCK_BYTES);let handle,reservation,moved=false;
 try{
  if(!Number.isSafeInteger(maxBytes)||maxBytes<0)throw new AppError('INVALID');
  const provisionalSize=Math.min(streamLimit,maxBytes?Math.ceil(maxBytes/SEGMENTED_BLOCK_BYTES)*SEGMENTED_BLOCK_BYTES:streamLimit);
  const aad=workspace.fileAAD(file),raw=createSegmentedHeader(expected?expected.size:provisionalSize,expected?expected.sha256:'0'.repeat(64),key,aad),header=readSegmentedHeader(raw,key,aad);
  if(expected&&maxBytes&&header.size>maxBytes)throw new AppError('MEDIA_LIMIT');
  const checkKey=()=>{if(workspace.vault!==vault||workspace.vault.key!==ownerKey||!key.equals(ownerKey))throw new AppError('ACCESS_LOCKED');};
  signal?.throwIfAborted();reservation=await diskCapacity.reserve(directory,expected?header.storedSize:raw.length,{reserveBytes,signal});handle=await open(temp,'wx+',0o600);await reservation.write(raw.length,()=>writeFilePart(handle,raw,0));
  let position=raw.length,size=0,buffered=0,index=0;const hash=createHash('sha256');
  const flush=async()=>{signal?.throwIfAborted();checkKey();const staged=expected?header:{...header,size,count:index+1},output=sealSegment(buffer.subarray(0,buffered),index++,staged,key,aad);await reservation.write(output.length,()=>writeFilePart(handle,output,position));position+=output.length;buffered=0;};
  for await(const value of source){
   const bytes=Buffer.isBuffer(value)?value:Buffer.from(value);
   for(let offset=0;offset<bytes.length;){
    signal?.throwIfAborted();const length=Math.min(bytes.length-offset,buffer.length-buffered);size+=length;
    if(maxBytes&&size>maxBytes)throw new AppError('MEDIA_LIMIT');if(size>header.size)throw new AppError('MEDIA_INVALID');
    const chunk=bytes.subarray(offset,offset+length);hash.update(chunk);chunk.copy(buffer,buffered);buffered+=length;offset+=length;
    if(buffered===buffer.length)await flush();operationAdvance(length);operationWork({bytes:length});
   }
  }
  const sha256=hash.digest('hex');if(expected&&(size!==header.size||sha256!==header.sha256))throw new AppError('MEDIA_INVALID');if(buffered)await flush();
  const saved={size,sha256};if(!expected)await finalizeStream(handle,header,key,aad,saved,{reservation,signal,check:checkKey});
  signal?.throwIfAborted();await beforeCommit?.(Object.freeze({...saved}));signal?.throwIfAborted();checkKey();
  await handle.sync();await handle.close();handle=null;signal?.throwIfAborted();checkKey();await atomicReplace(temp,file);moved=true;return saved;
 }catch(error){if(['ENOSPC','EDQUOT'].includes(error.code))throw new AppError('STORAGE_FULL');throw error;}
 finally{key.fill(0);buffer.fill(0);try{await handle?.close();if(!moved)await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}finally{reservation?.release();}}
}
