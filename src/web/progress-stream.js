// Bounded NDJSON response with progress and one complete operation result.
import {t} from './i18n/index.js';
export async function readProgressStream(response,onProgress){
 const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let buffer='',bytes=0,result,finished=false;
 function line(value){
  if(finished)throw Error(t('operationStream','afterResult'));
  let event;try{event=JSON.parse(value);}catch{throw Error(t('operationStream','invalid'));}
  if(!event||typeof event!=='object'||Array.isArray(event)||Object.keys(event).length!==1)throw Error(t('operationStream','invalid'));
  if(event.error)throw event.error;
  if(event.progress)onProgress(event.progress);
  else if(event.result){result=event.result;finished=true;}
  else throw Error(t('operationStream','invalid'));
 }
 try{
  for(;;){const part=await reader.read();if(part.done)break;
   // Bound a single message, not the lifetime of an hours-long operation.
   for(let offset=0;offset<part.value.length;){
    const end=part.value.indexOf(10,offset),stop=end<0?part.value.length:end+1,chunk=part.value.subarray(offset,stop);
    bytes+=chunk.length;if(bytes>64*1024*1024)throw Error(t('operationStream','limit'));
    buffer+=decoder.decode(chunk,{stream:true});offset=stop;
    if(end>=0){line(buffer.slice(0,-1));buffer='';bytes=0;}
   }
  }
  buffer+=decoder.decode();if(buffer||!finished)throw Error(t('operationStream','interrupted'));return result;
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
