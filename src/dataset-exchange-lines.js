import {createHash} from 'node:crypto';
import {AppError} from './errors.js';
import {exact} from './modules/validation.js';
import {revisionId} from './web/revision-model.js';

const invalid=()=>{throw new AppError('MATERIAL_INVALID');};
// Native material metadata files are admitted at 16 MiB. A single frame carries
// one selected item plus its envelope, independently of the dataset's size.
export const maxExchangeFrameBytes=16*1024*1024+65536;
const lf=Buffer.from([10]);
async function* lines(chunks,signal){
 let partial=null,length=0;
 for await(const source of chunks){
  signal?.throwIfAborted();
  if(!(source instanceof Uint8Array))invalid();
  const chunk=Buffer.from(source.buffer,source.byteOffset,source.byteLength);
  for(let start=0;start<chunk.length;){
   const end=chunk.indexOf(10,start),piece=chunk.subarray(start,end<0?chunk.length:end);
   const required=length+piece.length;
   if(required>maxExchangeFrameBytes)invalid();
   if(end>=0&&!length){
    if(!piece.length)invalid();
    yield piece;start=end+1;continue;
   }
   // Accumulate partial lines in a single geometrically grown buffer even
   // when the reader receives one incoming byte per chunk.
   if(required>(partial?.length??0)){
    const next=Buffer.allocUnsafe(Math.min(maxExchangeFrameBytes,Math.max(required,partial?partial.length*2:4096)));
    partial?.copy(next,0,0,length);partial=next;
   }
   piece.copy(partial,length);length=required;
   if(end<0)break;
   const bytes=partial.subarray(0,length);partial=null;length=0;start=end+1;
   yield bytes;
  }
 }
 if(length)invalid();
}

// The consumer can populate a private staging destination as each frame is
// checked. Only the returned receipt permits it to finalize that destination.
export async function* exchangeLineFrames(chunks,{signal}={}){
 const hash=createHash('sha256'),decode=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
 let receipt=null,frames=0,columns=0,rows=0,cells=0;
 for await(const bytes of lines(chunks,signal)){
  signal?.throwIfAborted();
  if(receipt)invalid();
  let frame;
  try{
   const text=decode.decode(bytes);frame=JSON.parse(text);
   // Version one specifies canonical JSON lines. This also prevents a second
   // field with the same name from hiding a different value in an import.
   if(JSON.stringify(frame)!==text)invalid();
  }catch{invalid();}
  if(!frame||typeof frame!=='object'||Array.isArray(frame)||typeof frame.type!=='string')invalid();
  if(frame.type==='complete'){
   if(!exact(frame,['type','frames','rows','columns','cells','sha256'])||!revisionId(frame.sha256)||frame.frames!==frames||frame.rows!==rows||frame.columns!==columns||frame.cells!==cells||frame.sha256!==hash.digest('hex'))invalid();
   receipt=frame;
  }else{
   if(!frames&&frame.type!=='dataset')invalid();
   hash.update(bytes).update(lf);frames++;
   if(frame.type==='column')columns++;
   if(frame.type==='row')rows++;
   if(frame.type==='cell')cells++;
   if(![frames,columns,rows,cells].every(Number.isSafeInteger))invalid();
   yield frame;
  }
 }
 signal?.throwIfAborted();
 if(!receipt||!frames)invalid();
 yield receipt;
}

export async function readExchangeLines(chunks,accept,options){
 let receipt;
 for await(const frame of exchangeLineFrames(chunks,options)){
  if(frame.type==='complete')receipt=frame;else await accept(frame);
 }
 return receipt;
}
