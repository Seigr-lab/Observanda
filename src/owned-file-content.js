// A deferred content owner keeps its credentials and read lease until the
// consumer finishes, cancels or fails. Stream queues bound buffered chunks.
import {PassThrough,Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {FileContent} from './file-content.js';
export class OwnedFileContent extends FileContent{
 constructor(workspace,file,size,sha256,withSource){super(workspace,file,size,sha256);this.withSource=withSource;}
 async *read(start=0,end=this.size-1,{signal}={}){
  signal?.throwIfAborted();const output=new PassThrough({objectMode:true,highWaterMark:1});let failure;
  output.on('error',()=>{});
  const pending=Promise.resolve().then(()=>this.withSource(content=>pipeline(Readable.from(content.read(start,end,{signal})),output,...(signal?[{signal}]:[])),{signal})).catch(error=>{failure=error;output.destroy(error);});
  try{yield* output;await pending;if(failure)throw failure;}
  finally{output.destroy();await pending;}
 }
 async verify(options){await this.withSource(content=>content.verify(options),options);return this;}
 copyTo(workspace,file,options){return this.withSource(content=>content.copyTo(workspace,file,options),options);}
}
