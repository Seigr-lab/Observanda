import {jsonFitsBytes,jsonByteLength} from './web/json-chunks.js';

// Owned by one calculation, never shared across owners or executions. Both
// page count and encoded size are bounded; this is not an RSS measurement.
export class EvaluationPageCache{
 constructor({maxPages=12,maxBytes=4*1024*1024}={}){
  if(!Number.isSafeInteger(maxPages)||maxPages<1||maxPages>128||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>16*1024*1024)throw new RangeError('Invalid evaluation cache capacity');
  this.maxPages=maxPages;this.maxBytes=maxBytes;this.values=new Map();this.bytes=0;
 }
 get size(){return this.values.size;}
 get(key){const item=this.values.get(key);if(!item)return;this.values.delete(key);this.values.set(key,item);return item.value;}
 set(key,value,{signal}={}){
  this.delete(key);const keyBytes=Buffer.byteLength(key);
  if(keyBytes>this.maxBytes||!jsonFitsBytes(value,this.maxBytes-keyBytes,{signal}))return;
  const bytes=keyBytes+jsonByteLength(value,{signal});
  while(this.size>=this.maxPages||this.bytes+bytes>this.maxBytes)this.delete(this.values.keys().next().value);
  this.values.set(key,{value,bytes});this.bytes+=bytes;
 }
 delete(key){const item=this.values.get(key);if(item){this.bytes-=item.bytes;this.values.delete(key);}}
 clear(){this.values.clear();this.bytes=0;}
}
