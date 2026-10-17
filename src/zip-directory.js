// ZIP central entries are public names and checksums. Spill their bounded
// buffer to an operation-owned temporary file; always remove it on return.
import {mkdtemp,open,unlink,rmdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
export class ZipDirectory{
 constructor(){this.pending=[];this.bytes=0;this.handle=null;this.root=null;this.file=null;}
 async append(...chunks){
  const size=chunks.reduce((n,chunk)=>n+chunk.length,0);
  if(!this.handle&&this.bytes+size>256*1024){
   this.root=await mkdtemp(path.join(os.tmpdir(),'observanda-zip-'));this.file=path.join(this.root,'directory');this.handle=await open(this.file,'wx+',0o600);
   for(const chunk of this.pending)await this.write(chunk);this.pending=[];
  }
  if(this.handle){for(const chunk of chunks)await this.write(chunk);}else this.pending.push(...chunks);
  this.bytes+=size;
 }
 async write(chunk){let offset=0;while(offset<chunk.length){const {bytesWritten}=await this.handle.write(chunk,offset,chunk.length-offset);if(!bytesWritten)throw Error('Unable to write ZIP directory');offset+=bytesWritten;}}
 async *chunks(){
  if(!this.handle){yield* this.pending;return;}
  let position=0;while(position<this.bytes){const buffer=Buffer.alloc(Math.min(65536,this.bytes-position)),{bytesRead}=await this.handle.read(buffer,0,buffer.length,position);if(!bytesRead)throw Error('Incomplete ZIP directory');position+=bytesRead;yield buffer.subarray(0,bytesRead);}
 }
 async close(){this.pending=[];try{await this.handle?.close();}finally{try{if(this.file)await unlink(this.file).catch(error=>{if(error.code!=='ENOENT')throw error;});}finally{if(this.root)await rmdir(this.root);}}}
}
