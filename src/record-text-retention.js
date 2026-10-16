// Encode a logical string supplied as text windows, with exactly the same byte
// spelling as serialize(string). A surrogate pair may straddle two windows.
import {RecordSequenceBuilder} from './record-tree-values.js';
import {AppError} from './errors.js';
import {recordTextJSON} from './record-string-stream.js';

export async function retainRecordText(storage,chunks,{signal}={}){
 const builder=new RecordSequenceBuilder(storage),size=32768;
 let buffer=Buffer.alloc(size),used=0,bytes=0;
 async function emit(text){
  const source=Buffer.from(text);bytes+=source.length;
  if(!Number.isSafeInteger(bytes))throw new AppError('LIMIT');
  for(let offset=0;offset<source.length;){
   signal?.throwIfAborted();const count=Math.min(size-used,source.length-offset);
   buffer.set(source.subarray(offset,offset+count),used);used+=count;offset+=count;
   if(used===size){await builder.addNode({type:'bytes',value:buffer.toString('base64')});buffer=Buffer.alloc(size);used=0;}
  }
 }
 for await(const text of recordTextJSON(chunks,{signal}))await emit(text);
 await emit('\n');
 if(used)await builder.addNode({type:'bytes',value:buffer.subarray(0,used).toString('base64')});
 signal?.throwIfAborted();return storage.put('value',{type:'string',root:await builder.finishIndex(),bytes});
}
