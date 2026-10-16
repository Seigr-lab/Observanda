import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {AppError} from '../errors.js';
// Isolated read-only process: cancellation also stops stalled filesystem reads.
export function inspectSource(input,{signal,onProgress=()=>{},timeout=300000}={}){
 if(signal?.aborted)return Promise.reject(new AppError('INVENTORY_CANCELLED'));
 if(!input||Object.keys(input).some(k=>!['source','manifest','expectedPin'].includes(k))||JSON.stringify(input).length>8192)throw new AppError('INVENTORY_INVALID');
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[fileURLToPath(new URL('./worker.js',import.meta.url))],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  let buffer='',bytes=0,result,inspection,failure;
  const stop=error=>{failure??=error;child.kill();},abort=()=>stop(new AppError('INVENTORY_CANCELLED'));
  signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>stop(new AppError('INVENTORY_TIMEOUT')),timeout);
  child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{
   bytes+=Buffer.byteLength(chunk);if(bytes>64*1024*1024){stop(new AppError('INVENTORY_LIMIT'));return;}
   buffer+=chunk;let end;
   while((end=buffer.indexOf('\n'))!==-1){
    const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
    try{const value=JSON.parse(line);if(value.error)failure??=new AppError(value.error.code,value.error.details);
     else if(value.progress&&!result)onProgress(value.progress);
     else if(value.result&&!result)result=value.result;
     else if(value.inspection&&result&&!inspection&&Number.isSafeInteger(value.inspection.durationMs)&&value.inspection.durationMs>=0&&Number.isSafeInteger(value.inspection.peakMemoryBytes)&&value.inspection.peakMemoryBytes>0)inspection=value.inspection;
     else throw Error();
    }catch{stop(new AppError('INVENTORY_INVALID'));break;}
   }
  });
  child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});
  child.once('error',()=>{failure??=new AppError('IO');});
  child.once('close',code=>{
   clearTimeout(timer);signal?.removeEventListener('abort',abort);
   if(signal?.aborted)failure=new AppError('INVENTORY_CANCELLED');
   if(failure)return reject(failure);
   if(code!==0||!result||!inspection||buffer)return reject(new AppError('INVENTORY_INVALID'));
   resolve({...result,inspection});
  });
  child.stdin.end(JSON.stringify(input));
  if(signal?.aborted)abort();
 });
}
