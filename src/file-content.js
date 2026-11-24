import {contentBufferAdmission} from './content-buffer-admission.js';
import {checkpointedFileCopy} from './checkpointed-file-copy.js';
import {withNativeContentFile} from './native-content-file.js';
import {SEGMENTED_ENVELOPE,SEGMENTED_HEADER_BYTES,readSegmentedHeader} from './segmented-file-format.js';
import {readFilePart,readSegmentedFile,readSegmentedRange,segmentedFileHeader} from './segmented-file-io.js';
import {writeSegmentedContent} from './segmented-file-write.js';
import {open,lstat} from 'node:fs/promises';
import {diskCapacity} from './disk-capacity.js';
import {withStagingCapacity} from './staging-reservations.js';
import path from 'node:path';
import {createDecipheriv,createHash} from 'node:crypto';
import {Readable,PassThrough} from 'node:stream';
import {constants as bufferConstants} from 'node:buffer';
import {pipeline} from 'node:stream/promises';
import {setImmediate as yieldTurn} from 'node:timers/promises';
import {ENVELOPE,ENCRYPTION_OVERHEAD,refuseNewerEnvelope} from './encryption.js';
import {AppError} from './errors.js';
import {operationStage,operationAdvance,operationWork} from './operation-progress.js';

const BLOCK=1024*1024;
// Every workspace is encrypted. File content is never read or written without
// its key, whatever folder state the workspace check alone would admit.
async function requireContentKey(workspace){await workspace.requireStorageKey();if(!workspace.vault?.id||!Buffer.isBuffer(workspace.vault.key))throw new AppError('ACCESS_LOCKED');}
async function writeAll(handle,bytes,position){let done=0;while(done<bytes.length){const r=await handle.write(bytes,done,bytes.length-done,position+done);if(!r.bytesWritten)throw new AppError('IO');done+=r.bytesWritten;}}
export async function diskSpace(directory,bytes,reserve=0){return diskCapacity.check(directory,bytes,reserve);}
function sameFile(a,b){return a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs&&a.ino===b.ino&&a.dev===b.dev;}
function contentReadGuard(content,handle,before,vault,key,signal){const identity=createHash('sha256').update(key).digest('hex');return async()=>{
 signal?.throwIfAborted();const [opened,current]=await Promise.all([handle.stat({bigint:true}),lstat(content.file,{bigint:true})]);
 if(!current.isFile()||current.nlink>1n||!sameFile(before,opened)||!sameFile(before,current))throw new AppError('MEDIA_INVALID');
 if(content.workspace.vault!==vault||content.workspace.vault.key!==key||createHash('sha256').update(key).digest('hex')!==identity)throw new AppError('ACCESS_LOCKED');signal?.throwIfAborted();
};}
async function* decoded(handle,workspace,file){
  if(!workspace.vault?.id||!workspace.vault.key)throw new AppError('ACCESS_LOCKED');
  const magic=Buffer.alloc(8);await handle.read(magic,0,8,0);if(magic.equals(SEGMENTED_ENVELOPE)){for await(const bytes of readSegmentedFile(handle,workspace.vault.key,workspace.fileAAD(file))){operationWork({bytes:bytes.length});yield bytes;}return;}
  // Single-envelope files (as Workspace.writeFile stores them) authenticate at the end.
  const header=Buffer.alloc(ENCRYPTION_OVERHEAD);const r=await handle.read(header,0,header.length,0);
  if(r.bytesRead===header.length)refuseNewerEnvelope(header);
  if(r.bytesRead!==header.length||!header.subarray(0,8).equals(ENVELOPE))throw new AppError('ENCRYPTION_DAMAGED');
  const cipher=createDecipheriv('aes-256-gcm',workspace.vault.key,header.subarray(8,20));cipher.setAAD(Buffer.from(workspace.fileAAD(file)));cipher.setAuthTag(header.subarray(20,36));let position=header.length;
  for(;;){const bytes=Buffer.allocUnsafe(BLOCK),r=await handle.read(bytes,0,BLOCK,position);if(!r.bytesRead)break;position+=r.bytesRead;operationWork({bytes:r.bytesRead});yield cipher.update(bytes.subarray(0,r.bytesRead));}
  try{const last=cipher.final();if(last.length)yield last;}catch{throw new AppError('ENCRYPTION_DAMAGED');}
}
export async function writeContent(workspace,file,source,{maxBytes=0,reserveBytes=0,signal,beforeCommit,expected,exclusive=false,capacity}={}){
 return operationStage('encrypt-file',{unit:'bytes',item:path.basename(file)},async()=>{
  // Already-buffered input can declare its digest without any additional disk
  // pass. Yield between bounded hash batches so leases/cancellation still run.
  await requireContentKey(workspace);
  if(!expected&&Array.isArray(source)&&source.every(Buffer.isBuffer)){
   let size=0,batch=0;const hash=createHash('sha256');
   for(const bytes of source)for(let offset=0;offset<bytes.length;offset+=BLOCK){signal?.throwIfAborted();const chunk=bytes.subarray(offset,offset+BLOCK);size+=chunk.length;if(!Number.isSafeInteger(size)||maxBytes&&size>maxBytes)throw new AppError('MEDIA_LIMIT');hash.update(chunk);if(++batch===16){batch=0;await yieldTurn(undefined,{signal});}}
   expected={size,sha256:hash.digest('hex')};
  }
  const write=admission=>writeSegmentedContent(workspace,file,source,{maxBytes,reserveBytes,signal,beforeCommit,expected,exclusive,capacity,admission});return capacity?write():withStagingCapacity(workspace,write,{signal});
 });
}
export class FileContent {
  constructor(workspace,file,size,sha256,header){this.workspace=workspace;this.file=file;this.size=size;this.sha256=sha256;this.header=header;}
  withSource(consume){return consume(this);}
  // Authenticate the descriptor and each requested segment before yielding
  // that segment. Unlike read(), this does not verify unconsumed segments.
  // Legacy envelopes retain complete-before-first-byte authentication.
  async *readChunks(start=0,end=this.size-1,{signal}={}){
   if(this.read!==FileContent.prototype.read){yield* this.read(start,end,{signal});return;}
   if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start&&!(this.size===0&&start===0&&end===-1)||start>=this.size&&this.size!==0)throw new AppError('INVALID');
   end=Math.min(end,this.size-1);await requireContentKey(this.workspace);signal?.throwIfAborted();const vault=this.workspace.vault,key=vault.key;let segmented=false;
   if(this.size){const handle=await open(this.file,'r');try{
    const before=await handle.stat({bigint:true});if(!before.isFile()||before.nlink>1n)throw new AppError('UNSAFE');const check=contentReadGuard(this,handle,before,vault,key,signal);await check();
    const magic=Buffer.alloc(8);await handle.read(magic,0,8,0);operationWork({bytes:8});await check();segmented=magic.equals(SEGMENTED_ENVELOPE);
    if(segmented)yield* readSegmentedRange(handle,key,this.workspace.fileAAD(this.file),start,end,{size:this.size,sha256:this.sha256,signal,check,onRead:bytes=>operationWork({bytes})});
   }finally{await handle.close();}}
   if(!segmented)yield* this.read(start,end,{signal});
  }
  // Only private staged consumers may use this one-pass contract. They must
  // discard their result unless the iterator completes successfully. Legacy
  // envelope authentication and the whole-file digest finish at the end.
  async *readStaged({signal}={}){
   signal?.throwIfAborted();const output=new PassThrough({objectMode:true,highWaterMark:1});let failure;
   output.on('error',()=>{});
   const pending=withNativeContentFile(this.workspace,this.file,async(parent,name)=>{
    await requireContentKey(this.workspace);const vault=this.workspace.vault,key=vault.key,retained=Buffer.from(key),handle=await parent.file(name),owner=this;
    try{
     const before=await handle.stat({bigint:true});const check=()=>{signal?.throwIfAborted();if(owner.workspace.vault!==vault||vault.key!==key||!retained.equals(key))throw new AppError('ACCESS_LOCKED');};
     async function* chunks(){let size=0;const hash=createHash('sha256');check();for await(const bytes of decoded(handle,owner.workspace,owner.file)){check();size+=bytes.length;if(size>owner.size)throw new AppError('MEDIA_INVALID');hash.update(bytes);yield bytes;}
      check();if(size!==owner.size||hash.digest('hex')!==owner.sha256||!sameFile(before,await handle.stat({bigint:true}))||(await parent.stat(name)).identity!==handle.identity)throw new AppError('MEDIA_INVALID');}
     await pipeline(Readable.from(chunks()),output,...(signal?[{signal}]:[]));
    }finally{retained.fill(0);await handle.close();}
   }).catch(error=>{failure=error;output.destroy(error);});
   try{yield* output;await pending;if(failure)throw failure;}
   finally{output.destroy();await pending;}
  }
  async *read(start=0,end=this.size-1,{signal}={}){
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start&&!(this.size===0&&start===0&&end===-1)||start>=this.size&&this.size!==0)throw new AppError('INVALID');
    end=Math.min(end,this.size-1);
    await requireContentKey(this.workspace);const vault=this.workspace.vault,key=vault.key,handle=await open(this.file,'r');
    try{
      const before=await handle.stat({bigint:true});if(!before.isFile()||before.nlink>1n)throw new AppError('UNSAFE');
      const check=contentReadGuard(this,handle,before,vault,key,signal);await check();
      if(start>0||end<this.size-1){
       const magic=Buffer.alloc(8);await handle.read(magic,0,8,0);operationWork({bytes:8});await check();
       if(magic.equals(SEGMENTED_ENVELOPE)){yield* readSegmentedRange(handle,key,this.workspace.fileAAD(this.file),start,end,{size:this.size,sha256:this.sha256,signal,check,onRead:bytes=>operationWork({bytes})});return;}
      }
      // Authenticate the complete original envelope before releasing any plaintext.
      let size=0;const hash=createHash('sha256');for await(const chunk of decoded(handle,this.workspace,this.file)){signal?.throwIfAborted();size+=chunk.length;hash.update(chunk);}
      if(size!==this.size||hash.digest('hex')!==this.sha256||!sameFile(before,await handle.stat({bigint:true})))throw new AppError('MEDIA_INVALID');
      let position=0;for await(const chunk of decoded(handle,this.workspace,this.file)){
        signal?.throwIfAborted();
        await check();
        const from=Math.max(0,start-position),to=Math.min(chunk.length,end-position+1);if(to>from)yield chunk.subarray(from,to);position+=chunk.length;
        if(position>end)break;
      }
    }finally{await handle.close();}
  }
  async verifyMetadata({signal}={}){
   signal?.throwIfAborted();await requireContentKey(this.workspace);const vault=this.workspace.vault,key=vault.key,handle=await open(this.file,'r');let segmented=false;
   try{
    const before=await handle.stat({bigint:true});if(!before.isFile()||before.nlink>1n)throw new AppError('UNSAFE');const check=contentReadGuard(this,handle,before,vault,key,signal);await check();
    const magic=Buffer.alloc(8);await handle.read(magic,0,8,0);operationWork({bytes:8});await check();segmented=magic.equals(SEGMENTED_ENVELOPE);
    if(segmented)await segmentedFileHeader(handle,key,this.workspace.fileAAD(this.file),{size:this.size,sha256:this.sha256,signal,check,onRead:bytes=>operationWork({bytes})});
   }finally{await handle.close();}
   if(!segmented)await this.verify({signal,reportProgress:false});
  }
  // Internal owner transfer: plaintext is consumed only by an encrypted
  // private temporary file. The destination becomes visible after the source
  // tag, declared digest, size and stable-file check have all succeeded.
  async copyTo(workspace,file,{signal,onProgress,check=async()=>{},reserveBytes=0,resume=false}={}){
    signal?.throwIfAborted();await check();await requireContentKey(this.workspace);await requireContentKey(workspace);
    if(!Number.isSafeInteger(this.size)||this.size<0||! /^[a-f0-9]{64}$/.test(this.sha256))throw new AppError('INVALID');
    if(resume)return checkpointedFileCopy(this,workspace,file,{decode:decoded,signal,onProgress,check,reserveBytes});
    return withNativeContentFile(this.workspace,this.file,async(input,name)=>{
    const handle=await input.file(name),owner=this,vault=owner.workspace.vault,key=vault.key,keyCopy=Buffer.from(key);
    try{
      const before=await handle.stat({bigint:true});if(!before.isFile()||before.nlink>1n)throw new AppError('UNSAFE');
      async function* checked(){
        let size=0;const hash=createHash('sha256');await onProgress?.(0,owner.size);
        for await(const chunk of decoded(handle,owner.workspace,owner.file)){
          signal?.throwIfAborted();await check();if(owner.workspace.vault!==vault||vault.key!==key||!keyCopy.equals(key))throw new AppError('ACCESS_LOCKED');size+=chunk.length;if(size>owner.size)throw new AppError('MEDIA_INVALID');hash.update(chunk);yield chunk;await onProgress?.(size,owner.size);
        }
        signal?.throwIfAborted();await check();if(owner.workspace.vault!==vault||vault.key!==key||!keyCopy.equals(key))throw new AppError('ACCESS_LOCKED');if(size!==owner.size||hash.digest('hex')!==owner.sha256||!sameFile(before,await handle.stat({bigint:true}))||(await input.stat(name)).identity!==handle.identity)throw new AppError('MEDIA_INVALID');
      }
      return await writeContent(workspace,file,checked(),{signal,reserveBytes,exclusive:true,maxBytes:this.size,expected:{size:this.size,sha256:this.sha256}});
    }catch(error){if(error.code==='EEXIST')throw new AppError('EXISTS');throw error;}finally{keyCopy.fill(0);await handle.close();}
    });
  }
  stream(start=0,end=this.size-1,options={}){return Readable.from(this.read(start,end,options));}
  async verify({signal,onProgress,reportProgress=true}={}){
   const run=async()=>{
    signal?.throwIfAborted();let size=0;const hash=createHash('sha256');await requireContentKey(this.workspace);const handle=await open(this.file,'r');
    try{const stat=await handle.stat({bigint:true});if(!stat.isFile()||stat.nlink>1n)throw new AppError('UNSAFE');await onProgress?.(0,this.size);for await(const chunk of decoded(handle,this.workspace,this.file)){signal?.throwIfAborted();size+=chunk.length;hash.update(chunk);if(reportProgress)operationAdvance(chunk.length);await onProgress?.(size,this.size);}if(size!==this.size||hash.digest('hex')!==this.sha256||!sameFile(stat,await handle.stat({bigint:true})))throw new AppError('MEDIA_INVALID');}finally{await handle.close();}return this;
   };return reportProgress?operationStage('verify-file',{total:this.size,unit:'bytes',item:path.basename(this.file)},run):run();
  }
}
export const contentSize=value=>value instanceof FileContent?value.size:Buffer.byteLength(value);
export const contentHash=value=>value instanceof FileContent?value.sha256:createHash('sha256').update(value).digest('hex');
export const contentStream=value=>value instanceof FileContent?value.stream():Readable.from([Buffer.from(value)]);
// Explicitly separate from streams that promise complete verification before
// the first byte. Use only with an atomic encrypted/private staging consumer.
export const contentStagedStream=(value,options={})=>value instanceof FileContent?(value.readStaged===FileContent.prototype.readStaged&&(value.read!==FileContent.prototype.read||value.stream!==FileContent.prototype.stream)?value.stream(0,value.size-1,options):value.readStaged(options)):Readable.from([Buffer.from(value)]);
export async function withContentBuffer(value,options,consume){
 const {signal,maxBytes=0,additionalBytes=0,admission=contentBufferAdmission}=options??{};signal?.throwIfAborted();const size=contentSize(value);
 if(typeof consume!=='function'||!Number.isSafeInteger(maxBytes)||maxBytes<0||!Number.isSafeInteger(additionalBytes)||additionalBytes<0)throw new AppError('INVALID');
 if(!Number.isSafeInteger(size)||size<0)throw new AppError('MEDIA_INVALID');if(size>bufferConstants.MAX_LENGTH||maxBytes&&size>maxBytes)throw new AppError('MEDIA_LIMIT');
 const working=size+2*BLOCK+additionalBytes;if(!Number.isSafeInteger(working))throw new AppError('MEDIA_LIMIT');
 const release=await admission.acquire(working,{signal});try{const bytes=await readContentBuffer(value,{signal,maxBytes});signal?.throwIfAborted();return await consume(bytes);}finally{release();}
}
export const contentBuffer=(value,options)=>withContentBuffer(value,options,bytes=>bytes);
async function readContentBuffer(value,{signal,maxBytes=0}={}){
 signal?.throwIfAborted();if(!Number.isSafeInteger(maxBytes)||maxBytes<0)throw new AppError('INVALID');
 const size=contentSize(value);if(!Number.isSafeInteger(size)||size<0)throw new AppError('MEDIA_INVALID');
 if(size>bufferConstants.MAX_LENGTH||maxBytes&&size>maxBytes)throw new AppError('MEDIA_LIMIT');
 if(!(value instanceof FileContent))return Buffer.from(value);
 // Allocate the declared result once. Collecting chunks and concatenating
 // them retained approximately twice the original's size at completion.
 let result;
 const consume=async source=>{
  result=Buffer.allocUnsafe(size);let offset=0;
  for await(const chunk of source){signal?.throwIfAborted();if(chunk.length>size-offset)throw new AppError('MEDIA_INVALID');result.set(chunk,offset);offset+=chunk.length;}
  signal?.throwIfAborted();if(offset!==size)throw new AppError('MEDIA_INVALID');
 };
 try{
 // Deferred owners and specialized streams retain their own admission/lease.
 if(value.read!==FileContent.prototype.read||value.stream!==FileContent.prototype.stream){await consume(contentStagedStream(value,{signal}));return result;}
 // A whole-buffer consumer releases nothing until authentication completes;
 // it needs one decode, unlike the authenticated-before-first-yield stream.
 await requireContentKey(value.workspace);signal?.throwIfAborted();const vault=value.workspace.vault,key=vault.key,handle=await open(value.file,'r');
 try{
  const before=await handle.stat({bigint:true});if(!before.isFile()||before.nlink>1n)throw new AppError('UNSAFE');
  const check=contentReadGuard(value,handle,before,vault,key,signal);await check();
  const hash=createHash('sha256');
  async function* chunks(){for await(const chunk of decoded(handle,value.workspace,value.file)){signal?.throwIfAborted();hash.update(chunk);yield chunk;}}
  await consume(chunks());if(hash.digest('hex')!==value.sha256)throw new AppError('MEDIA_INVALID');await check();
 }finally{await handle.close();}
 // Decoding retains an internal cipher key. Closing or replacing its live
 // owner before completion must still refuse the buffered plaintext.
 signal?.throwIfAborted();if(value.workspace.vault!==vault||vault.key!==key)throw new AppError('ACCESS_LOCKED');
 return result;
 }catch(error){result?.fill(0);throw error;}
}
export async function writePublicFile(file,value,{mode=0o600}={}){
 const reservation=await diskCapacity.reserve(path.dirname(file),contentSize(value));let handle;
 try{handle=await open(file,'wx',mode);let size=0;const hash=createHash('sha256');for await(const chunk of contentStream(value)){await reservation.write(chunk.length,()=>writeAll(handle,chunk,size));size+=chunk.length;hash.update(chunk);}if(size!==contentSize(value)||hash.digest('hex')!==contentHash(value))throw new AppError('STALE');await handle.sync();}
 finally{try{await handle?.close();}finally{reservation.release();}}
}
export async function serveContent(req,res,content,type,{signal}={}){
  const size=contentSize(content);let start=0,end=size-1,status=200;
  res.setHeader('Content-Type',type);res.setHeader('Accept-Ranges','bytes');
  if(req.headers.range){const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);start=match?.[1]?Number(match[1]):Math.max(0,size-Number(match?.[2]));end=match?.[1]&&match[2]?Math.min(Number(match[2]),size-1):size-1;
    if(!match||!match[1]&&!match[2]||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=size){res.writeHead(416,{'Content-Range':`bytes */${size}`});res.end();return;}status=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${size}`);
  }
  if(!(content instanceof FileContent)){res.writeHead(status,{'Content-Length':Math.max(0,end-start+1)});res.end(req.method==='HEAD'?undefined:Buffer.from(content).subarray(start,end+1));return;}
  const controller=signal?null:new AbortController(),closed=()=>{if(!res.writableEnded)controller?.abort();};
  if(controller){res.once('close',closed);signal=controller.signal;}
  if(req.method==='HEAD'){
   try{await content.verifyMetadata({signal});signal.throwIfAborted();res.writeHead(status,{'Content-Length':Math.max(0,end-start+1)});res.end();}
   finally{if(controller)res.off('close',closed);}return;
  }
  const iterator=content.read(start,end,{signal});
  try{
    // Authenticate before the first response byte. A segmented seek checks the
    // header and requested chunks; complete reads retain whole-file checking.
    const first=await iterator.next();signal.throwIfAborted();
    res.writeHead(status,{'Content-Length':Math.max(0,end-start+1)});
    async function* chunks(){if(!first.done)yield first.value;yield* iterator;}
    await pipeline(Readable.from(chunks()),res);
  }finally{if(controller)res.off('close',closed);await iterator.return();}
}

export async function describeContent(workspace,file,{signal,verification='complete'}={}){
 if(!['complete','descriptor'].includes(verification))throw new AppError('INVALID');
 await requireContentKey(workspace);return withNativeContentFile(workspace,file,async(parent,name)=>{const handle=await parent.file(name),vault=workspace.vault,key=vault.key,retained=Buffer.from(key);let size=0,sha256;const hash=createHash('sha256');
 try{const stat=await handle.stat({bigint:true});signal?.throwIfAborted();
  if(verification==='descriptor'){const magic=Buffer.alloc(8);await handle.read(magic,0,8,0);if(magic.equals(SEGMENTED_ENVELOPE)){const header=readSegmentedHeader(await readFilePart(handle,SEGMENTED_HEADER_BYTES,0),retained,workspace.fileAAD(file));if(stat.size!==BigInt(header.storedSize))throw new AppError('ENCRYPTION_DAMAGED');size=header.size;sha256=header.sha256;}}
  // Legacy envelopes have no authenticated size/digest descriptor. They still
  // need a complete verification pass before supplying a copy's expectations.
  if(sha256===undefined){for await(const bytes of decoded(handle,workspace,file)){signal?.throwIfAborted();size+=bytes.length;hash.update(bytes);}sha256=hash.digest('hex');}
  signal?.throwIfAborted();if(workspace.vault!==vault||vault.key!==key||!retained.equals(key))throw new AppError('ACCESS_LOCKED');if(!sameFile(stat,await handle.stat({bigint:true}))||(await parent.stat(name)).identity!==handle.identity)throw new AppError('MEDIA_INVALID');
 }finally{retained.fill(0);await handle.close();}
 return new FileContent(workspace,file,size,sha256);});
}
