import {FileContent,contentSize} from './file-content.js';
import {AppError} from './errors.js';
import {setImmediate as yieldTurn} from 'node:timers/promises';

const block=48*1024,prefix='{"encoding":"base64","content":"',suffix='"}';
// The JSON wire format is unchanged. Base64 is emitted in bounded windows,
// retaining at most two bytes across input boundaries, including Unicode text.
export class GithubBlobBody{
 constructor(content){
  this.content=content;this.size=contentSize(content);this.length=prefix.length+4*Math.ceil(this.size/3)+suffix.length;
  if(!Number.isSafeInteger(this.size)||this.size<0||!Number.isSafeInteger(this.length))throw new AppError('INVALID');
 }
 async *chunks({signal}={}){
  signal?.throwIfAborted();yield prefix;let size=0,tail=Buffer.alloc(0);
  const content=this.content;
  async function* source(){
   if(content instanceof FileContent){yield* content.stream(0,content.size-1,{signal});return;}
   if(typeof content==='string'){
    for(let start=0;start<content.length;){let end=Math.min(start+block,content.length);if(end<content.length&&content.charCodeAt(end-1)>=0xd800&&content.charCodeAt(end-1)<=0xdbff&&content.charCodeAt(end)>=0xdc00&&content.charCodeAt(end)<=0xdfff)end--;yield Buffer.from(content.slice(start,end));start=end;}
   }else{const bytes=Buffer.isBuffer(content)?content:Buffer.from(content);for(let start=0;start<bytes.length;start+=block)yield bytes.subarray(start,start+block);}
  }
  for await(const bytes of source()){
   signal?.throwIfAborted();size+=bytes.length;if(size>this.size)throw new AppError('MEDIA_INVALID');
   for(let start=0;start<bytes.length;start+=block){
    signal?.throwIfAborted();const chunk=bytes.subarray(start,start+block),joined=tail.length?Buffer.concat([tail,chunk]):chunk,end=joined.length-joined.length%3;
    if(end)yield joined.subarray(0,end).toString('base64');tail=Buffer.from(joined.subarray(end));
    await yieldTurn();signal?.throwIfAborted();
   }
  }
  signal?.throwIfAborted();if(size!==this.size)throw new AppError('MEDIA_INVALID');if(tail.length)yield tail.toString('base64');yield suffix;
 }
}
