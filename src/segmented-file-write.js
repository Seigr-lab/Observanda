import path from 'node:path';
import {open,unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {AppError} from './errors.js';
import {atomicReplace} from './atomic-replace.js';
import {temporaryStreamName} from './storage-temporary.js';
import {createSegmentedHeader,readSegmentedHeader,sealSegment,SEGMENTED_BLOCK_BYTES} from './segmented-file-format.js';
import {writeFilePart} from './segmented-file-io.js';
import {operationAdvance,operationWork} from './operation-progress.js';

// Use the existing chunk format when an authenticated source already declares
// the final digest. Unknown-length/hash streams retain their safe envelope path.
export async function writeSegmentedContent(workspace,file,source,{expected,maxBytes=0,reserveBytes=0,signal,beforeCommit,space}){
 await workspace.requireStorageKey();const vault=workspace.vault,ownerKey=vault?.key;if(!vault?.id||!ownerKey)throw new AppError('ACCESS_LOCKED');
 const key=Buffer.from(ownerKey),directory=path.dirname(file),temp=path.join(directory,temporaryStreamName()),buffer=Buffer.allocUnsafe(SEGMENTED_BLOCK_BYTES);let handle,moved=false;
 try{
  const raw=createSegmentedHeader(expected.size,expected.sha256,key,workspace.fileAAD(file)),header=readSegmentedHeader(raw,key,workspace.fileAAD(file));
  if(maxBytes&&header.size>maxBytes)throw new AppError('MEDIA_LIMIT');
  signal?.throwIfAborted();await space(directory,raw.length,reserveBytes);handle=await open(temp,'wx',0o600);await writeFilePart(handle,raw,0);
  let position=raw.length,size=0,buffered=0,index=0;const hash=createHash('sha256');
  const flush=async()=>{const output=sealSegment(buffer.subarray(0,buffered),index++,header,key,workspace.fileAAD(file));await space(directory,output.length,reserveBytes);await writeFilePart(handle,output,position);position+=output.length;buffered=0;};
  for await(const value of source){
   const bytes=Buffer.isBuffer(value)?value:Buffer.from(value);
   for(let offset=0;offset<bytes.length;){
    signal?.throwIfAborted();const length=Math.min(bytes.length-offset,buffer.length-buffered);size+=length;
    if(size>header.size)throw new AppError('MEDIA_INVALID');
    const chunk=bytes.subarray(offset,offset+length);hash.update(chunk);chunk.copy(buffer,buffered);buffered+=length;offset+=length;
    if(buffered===buffer.length)await flush();operationAdvance(length);operationWork({bytes:length});
   }
  }
  if(size!==header.size||hash.digest('hex')!==header.sha256)throw new AppError('MEDIA_INVALID');if(buffered)await flush();
  const saved={size,sha256:header.sha256};signal?.throwIfAborted();await beforeCommit?.(Object.freeze({...saved}));signal?.throwIfAborted();
  const checkKey=()=>{if(workspace.vault!==vault||workspace.vault.key!==ownerKey||!key.equals(ownerKey))throw new AppError('ACCESS_LOCKED');};checkKey();
  await handle.sync();await handle.close();handle=null;signal?.throwIfAborted();checkKey();await atomicReplace(temp,file);moved=true;return saved;
 }catch(error){if(['ENOSPC','EDQUOT'].includes(error.code))throw new AppError('STORAGE_FULL');throw error;}
 finally{key.fill(0);buffer.fill(0);await handle?.close();if(!moved)await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
