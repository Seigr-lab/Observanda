import {FileContent} from './file-content.js';
import {AppError} from './errors.js';

// Ephemeral authenticated previews have an independent memory budget. Prepared
// media stays on disk; count its descriptor rather than its streaming length.
export class DesignCandidates{
 constructor({maxEntries=5,maxBytes=64*1024*1024}={}){this.maxEntries=maxEntries;this.maxBytes=maxBytes;this.items=new Map();this.bytes=0;}
 get size(){return this.items.size;}
 get(id){return this.items.get(id)?.candidate;}
 set(id,candidate){
  let bytes=0;
  for(const [name,value] of candidate.files)bytes+=name.length*2+(value instanceof FileContent?1024:typeof value==='string'?value.length*2:value.byteLength);
  bytes+=JSON.stringify({...candidate,files:undefined}).length*2;
  if(!Number.isSafeInteger(bytes)||bytes>this.maxBytes)throw new AppError('DESIGN_PREVIEW_LIMIT');
  this.delete(id);
  while(this.items.size&&(this.items.size>=this.maxEntries||this.bytes+bytes>this.maxBytes))this.delete(this.items.keys().next().value);
  this.items.set(id,{candidate,bytes});this.bytes+=bytes;return this;
 }
 delete(id){const item=this.items.get(id);if(!item)return false;this.items.delete(id);this.bytes-=item.bytes;return true;}
 clear(){this.items.clear();this.bytes=0;}
}
