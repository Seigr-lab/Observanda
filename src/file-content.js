import {scopedFileVerification} from './file-verification-context.js';
import {checkpointedFileCopy} from './checkpointed-file-copy.js';
import {SEGMENTED_ENVELOPE} from './segmented-file-format.js';
import {readSegmentedFile} from './segmented-file-io.js';
import {atomicReplace} from './atomic-replace.js';
import {temporaryStreamName} from './storage-temporary.js';
import {open,rename,unlink,statfs,lstat} from 'node:fs/promises';
import path from 'node:path';
import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {ENVELOPE,ENCRYPTION_OVERHEAD} from './encryption.js';
import {AppError} from './errors.js';
import {operationStage,operationAdvance,operationWork} from './operation-progress.js';

const BLOCK=1024*1024;
async function writeAll(handle,bytes,position){let done=0;while(done<bytes.length){const r=await handle.write(bytes,done,bytes.length-done,position+done);if(!r.bytesWritten)throw new AppError('IO');done+=r.bytesWritten;}}
export async function diskSpace(directory,bytes,reserve=0){const s=await statfs(directory,{bigint:true});if(s.bavail*s.bsize<BigInt(bytes)+BigInt(reserve))throw new AppError('STORAGE_FULL');}
function sameFile(a,b){return a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs&&a.ino===b.ino;}
async function* decoded(handle,workspace,file){
  let position=0,cipher;
  if(workspace.vault?.id){
    if(!workspace.vault.key)throw new AppError('ACCESS_LOCKED');
    const magic=Buffer.alloc(8);await handle.read(magic,0,8,0);if(magic.equals(SEGMENTED_ENVELOPE)){for await(const bytes of readSegmentedFile(handle,workspace.vault.key,workspace.fileAAD(file))){operationWork({bytes:bytes.length});yield bytes;}return;}
    const header=Buffer.alloc(ENCRYPTION_OVERHEAD);const r=await handle.read(header,0,header.length,0);
    if(r.bytesRead!==header.length||!header.subarray(0,8).equals(ENVELOPE))throw new AppError('ENCRYPTION_DAMAGED');
    cipher=createDecipheriv('aes-256-gcm',workspace.vault.key,header.subarray(8,20));cipher.setAAD(Buffer.from(workspace.fileAAD(file)));cipher.setAuthTag(header.subarray(20,36));position=header.length;
  }
  for(;;){const bytes=Buffer.allocUnsafe(BLOCK),r=await handle.read(bytes,0,BLOCK,position);if(!r.bytesRead)break;position+=r.bytesRead;operationWork({bytes:r.bytesRead});yield cipher?cipher.update(bytes.subarray(0,r.bytesRead)):bytes.subarray(0,r.bytesRead);}
  if(cipher){try{const last=cipher.final();if(last.length)yield last;}catch{throw new AppError('ENCRYPTION_DAMAGED');}}
}
export async function writeContent(workspace,file,source,{maxBytes=0,reserveBytes=0,signal}={}){
 return operationStage('encrypt-file',{unit:'bytes',item:path.basename(file)},async()=>{
  // Same OBSENC01 envelope as Workspace.writeFile; no format migration.
  await workspace.requireStorageKey();const directory=path.dirname(file),temp=path.join(directory,temporaryStreamName());
  const key=workspace.vault?.key?Buffer.from(workspace.vault.key):null,nonce=randomBytes(12),cipher=key?createCipheriv('aes-256-gcm',key,nonce):null;
  if(cipher)cipher.setAAD(Buffer.from(workspace.fileAAD(file)));
  let handle,size=0,position=cipher?ENCRYPTION_OVERHEAD:0;const hash=createHash('sha256');
  try{
    handle=await open(temp,'wx',0o600);if(cipher)await writeAll(handle,Buffer.concat([ENVELOPE,nonce,Buffer.alloc(16)]),0);
    for await(const value of source){const bytes=Buffer.isBuffer(value)?value:Buffer.from(value);for(let offset=0;offset<bytes.length;offset+=BLOCK){signal?.throwIfAborted();const chunk=bytes.subarray(offset,offset+BLOCK);size+=chunk.length;if(!Number.isSafeInteger(size)||maxBytes&&size>maxBytes)throw new AppError('MEDIA_LIMIT');await diskSpace(directory,chunk.length,reserveBytes);hash.update(chunk);const output=cipher?cipher.update(chunk):chunk;await writeAll(handle,output,position);position+=output.length;operationAdvance(chunk.length);operationWork({bytes:chunk.length});}}
    if(cipher){const last=cipher.final();if(last.length)await writeAll(handle,last,position);await writeAll(handle,cipher.getAuthTag(),20);}
    await handle.sync();await handle.close();handle=null;signal?.throwIfAborted();await atomicReplace(temp,file);return {size,sha256:hash.digest('hex')};
  }catch(error){if(['ENOSPC','EDQUOT'].includes(error.code))throw new AppError('STORAGE_FULL');throw error;}finally{key?.fill(0);await handle?.close();await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
 });
}
export class FileContent {
  constructor(workspace,file,size,sha256,header){this.workspace=workspace;this.file=file;this.size=size;this.sha256=sha256;this.header=header;}
  withSource(consume){return consume(this);}
  async *read(start=0,end=this.size-1,{signal}={}){
    await this.workspace.requireStorageKey();const handle=await open(this.file,'r');
    try{
      const before=await handle.stat({bigint:true});if(!before.isFile()||before.nlink>1n)throw new AppError('UNSAFE');
      // Authenticate the complete original envelope before releasing any plaintext.
      let size=0;const hash=createHash('sha256');for await(const chunk of decoded(handle,this.workspace,this.file)){signal?.throwIfAborted();size+=chunk.length;hash.update(chunk);}
      if(size!==this.size||hash.digest('hex')!==this.sha256||!sameFile(before,await handle.stat({bigint:true})))throw new AppError('MEDIA_INVALID');
      let position=0;for await(const chunk of decoded(handle,this.workspace,this.file)){
        signal?.throwIfAborted();
        if(!sameFile(before,await handle.stat({bigint:true})))throw new AppError('MEDIA_INVALID');
        const from=Math.max(0,start-position),to=Math.min(chunk.length,end-position+1);if(to>from)yield chunk.subarray(from,to);position+=chunk.length;
        if(position>end)break;
      }
    }finally{await handle.close();}
  }
  // Internal owner transfer: plaintext is consumed only by an encrypted
  // private temporary file. The destination becomes visible after the source
  // tag, declared digest, size and stable-file check have all succeeded.
  async copyTo(workspace,file,{signal,onProgress,reserveBytes=0,resume=false}={}){
    signal?.throwIfAborted();await this.workspace.requireStorageKey();await workspace.requireStorageKey();
    if(!workspace.vault?.key||!workspace.vault.id||!Number.isSafeInteger(this.size)||this.size<0||! /^[a-f0-9]{64}$/.test(this.sha256))throw new AppError('INVALID');
    if(await lstat(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;}))throw new AppError('EXISTS');
    if(resume)return checkpointedFileCopy(this,workspace,file,{decode:decoded,space:diskSpace,signal,onProgress,reserveBytes});
    const handle=await open(this.file,'r'),owner=this;
    try{
      const before=await handle.stat({bigint:true});if(!before.isFile()||before.nlink>1n)throw new AppError('UNSAFE');
      async function* checked(){
        let size=0;const hash=createHash('sha256');await onProgress?.(0,owner.size);
        for await(const chunk of decoded(handle,owner.workspace,owner.file)){
          signal?.throwIfAborted();size+=chunk.length;if(size>owner.size)throw new AppError('MEDIA_INVALID');hash.update(chunk);yield chunk;await onProgress?.(size,owner.size);
        }
        signal?.throwIfAborted();if(size!==owner.size||hash.digest('hex')!==owner.sha256||!sameFile(before,await handle.stat({bigint:true})))throw new AppError('MEDIA_INVALID');
      }
      return await writeContent(workspace,file,checked(),{signal,reserveBytes,maxBytes:this.size});
    }finally{await handle.close();}
  }
  stream(start=0,end=this.size-1){return Readable.from(this.read(start,end));}
  async verify({signal,onProgress}={}){
   return scopedFileVerification(this,()=>operationStage('verify-file',{total:this.size,unit:'bytes',item:path.basename(this.file)},async()=>{
    signal?.throwIfAborted();let size=0;const hash=createHash('sha256');await this.workspace.requireStorageKey();const handle=await open(this.file,'r');
    try{const stat=await handle.stat({bigint:true});if(!stat.isFile()||stat.nlink>1n)throw new AppError('UNSAFE');await onProgress?.(0,this.size);for await(const chunk of decoded(handle,this.workspace,this.file)){signal?.throwIfAborted();size+=chunk.length;hash.update(chunk);operationAdvance(chunk.length);await onProgress?.(size,this.size);}if(size!==this.size||hash.digest('hex')!==this.sha256||!sameFile(stat,await handle.stat({bigint:true})))throw new AppError('MEDIA_INVALID');}finally{await handle.close();}return this;
   }),{signal,onProgress});
  }
}
export const contentSize=value=>value instanceof FileContent?value.size:Buffer.byteLength(value);
export const contentHash=value=>value instanceof FileContent?value.sha256:createHash('sha256').update(value).digest('hex');
export const contentStream=value=>value instanceof FileContent?value.stream():Readable.from([Buffer.from(value)]);
export async function contentBuffer(value){if(!(value instanceof FileContent))return Buffer.from(value);const chunks=[];for await(const chunk of value.stream())chunks.push(chunk);return Buffer.concat(chunks);}
export async function writePublicFile(file,value,{mode=0o600}={}){const handle=await open(file,'wx',mode);try{let size=0;const hash=createHash('sha256');for await(const chunk of contentStream(value)){await diskSpace(path.dirname(file),chunk.length);await writeAll(handle,chunk,size);size+=chunk.length;hash.update(chunk);}if(size!==contentSize(value)||hash.digest('hex')!==contentHash(value))throw new AppError('STALE');await handle.sync();}finally{await handle.close();}}
export async function serveContent(req,res,content,type,{signal}={}){
  const size=contentSize(content);let start=0,end=size-1,status=200;
  res.setHeader('Content-Type',type);res.setHeader('Accept-Ranges','bytes');
  if(req.headers.range){const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);start=match?.[1]?Number(match[1]):Math.max(0,size-Number(match?.[2]));end=match?.[1]&&match[2]?Math.min(Number(match[2]),size-1):size-1;
    if(!match||!match[1]&&!match[2]||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=size){res.writeHead(416,{'Content-Range':`bytes */${size}`});res.end();return;}status=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${size}`);
  }
  if(!(content instanceof FileContent)){res.writeHead(status,{'Content-Length':Math.max(0,end-start+1)});res.end(req.method==='HEAD'?undefined:Buffer.from(content).subarray(start,end+1));return;}
  const controller=signal?null:new AbortController(),closed=()=>{if(!res.writableEnded)controller?.abort();};
  if(controller){res.once('close',closed);signal=controller.signal;}
  const iterator=content.read(start,end,{signal});
  try{
    // read() authenticates the whole file before its first yield. Keep that
    // same handle for streaming instead of verifying and reopening it again.
    const first=await iterator.next();signal.throwIfAborted();
    res.writeHead(status,{'Content-Length':Math.max(0,end-start+1)});if(req.method==='HEAD'){res.end();return;}
    async function* chunks(){if(!first.done)yield first.value;yield* iterator;}
    await pipeline(Readable.from(chunks()),res);
  }finally{if(controller)res.off('close',closed);await iterator.return();}
}

export async function describeContent(workspace,file,{signal}={}){
 await workspace.requireStorageKey();const handle=await open(file,'r');let size=0;const hash=createHash('sha256');
 try{const stat=await handle.stat();if(!stat.isFile()||stat.nlink>1)throw new AppError('UNSAFE');for await(const bytes of decoded(handle,workspace,file)){signal?.throwIfAborted();size+=bytes.length;hash.update(bytes);}}finally{await handle.close();}
 return new FileContent(workspace,file,size,hash.digest('hex'));
}
