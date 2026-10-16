// Exact record identities without a complete serialized copy. The persisted
// spelling is JSON.stringify(value, null, 2) followed by one newline; logical
// revisions use the existing canonical property order without whitespace.
import {createHash} from 'node:crypto';
import {jsonChunks} from './web/json-chunks.js';

export function recordEncoding(value,{signal}={}){
 const hash=createHash('sha256');let bytes=0,lines=1;
 for(const chunk of jsonChunks(value,{pretty:true,signal})){
  hash.update(chunk);bytes+=chunk.length;
  for(const byte of chunk)if(byte===10)lines++;
 }
 hash.update('\n');
 return {revision:hash.digest('hex'),bytes:bytes+1,memberBytes:bytes+4*lines};
}
export function recordContentRevision(value,{signal}={}){
 const hash=createHash('sha256');
 for(const chunk of jsonChunks(value,{canonical:true,signal}))hash.update(chunk);
 return hash.digest('hex');
}
