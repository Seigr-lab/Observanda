import {AppError} from './errors.js';

// Evaluation-local sparse boundaries for legacy pages with variable row counts.
// Eviction only adds a later scan; it never changes a retained row address.
export class DatasetOrdinalCache{
 constructor({maxAnchors=128,maxBytes=128*1024}={}){
  if(!Number.isSafeInteger(maxAnchors)||maxAnchors<1||maxAnchors>4096||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>4*1024*1024)throw new AppError('INVALID');
  this.maxAnchors=maxAnchors;this.maxBytes=maxBytes;this.anchors=new Map();this.bytes=0;
 }
 remember(source,page,start){
  if(typeof source!=='string'||!Number.isSafeInteger(page)||page<0||!Number.isSafeInteger(start)||start<0)throw new AppError('DATASET_WINDOW_INVALID');
  const key=source+':'+page,bytes=Buffer.byteLength(key)+Buffer.byteLength(source)+48,old=this.anchors.get(key);
  if(old){if(old.start!==start)throw new AppError('DATASET_WINDOW_INVALID');this.anchors.delete(key);this.bytes-=old.bytes;}
  if(bytes>this.maxBytes)return;
  while(this.anchors.size>=this.maxAnchors||this.bytes+bytes>this.maxBytes){const first=this.anchors.keys().next().value;this.bytes-=this.anchors.get(first).bytes;this.anchors.delete(first);}
  this.anchors.set(key,{source,page,start,bytes});this.bytes+=bytes;
 }
 nearest(source,accept,closer){
  let result={page:0,start:0},selected;
  for(const [key,value] of this.anchors)if(value.source===source&&accept(value)&&closer(value,result)){result=value;selected=key;}
  if(selected){this.anchors.delete(selected);this.anchors.set(selected,result);}return result;
 }
 async pageStart(source,target,load,{signal}={}){
  if(!Number.isSafeInteger(target)||target<0)throw new AppError('DATASET_WINDOW_INVALID');
  let {page,start}=this.nearest(source,value=>value.page<=target,(a,b)=>a.page>=b.page);
  while(page<target){signal?.throwIfAborted();const count=await load(page);if(!Number.isSafeInteger(count)||count<0||!Number.isSafeInteger(start+count))throw new AppError('DATASET_WINDOW_INVALID');start+=count;this.remember(source,++page,start);}
  signal?.throwIfAborted();return start;
 }
 async locate(source,ordinal,pageCount,load,{signal}={}){
  if(!Number.isSafeInteger(ordinal)||ordinal<0||!Number.isSafeInteger(pageCount)||pageCount<0)throw new AppError('DATASET_WINDOW_INVALID');
  let {page,start}=this.nearest(source,value=>value.start<=ordinal&&value.page<pageCount,(a,b)=>a.start>b.start||a.start===b.start&&a.page>=b.page);
  for(;page<pageCount;page++){
   signal?.throwIfAborted();const count=await load(page);if(!Number.isSafeInteger(count)||count<0||!Number.isSafeInteger(start+count))throw new AppError('DATASET_WINDOW_INVALID');
   this.remember(source,page,start);this.remember(source,page+1,start+count);if(ordinal<start+count)return {page,row:ordinal-start};start+=count;
  }
  throw new AppError('DATASET_WINDOW_INVALID');
 }
 clear(){this.anchors.clear();this.bytes=0;}
}
