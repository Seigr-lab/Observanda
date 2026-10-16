import {Worker} from 'node:worker_threads';
import {AppError} from '../errors.js';
export function parseFeed(text,range,{signal}={}){
 return new Promise((resolve,reject)=>{
  signal?.throwIfAborted();
  const worker=new Worker(new URL('./worker.js',import.meta.url),{workerData:{text,range},resourceLimits:{maxOldGenerationSizeMb:64}});
  let settled=false;
  function finish(error,value){if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);void worker.terminate();if(error)reject(error);else resolve(value);}
  const abort=()=>finish(signal.reason??new DOMException('Aborted','AbortError'));
  const timer=setTimeout(()=>finish(new AppError('CALENDAR_LIMIT')),4000);
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return;}
  worker.once('message',result=>finish(result.error?new AppError(result.error):null,result.events));
  worker.once('error',()=>finish(new AppError('CALENDAR_FORMAT')));
  worker.once('exit',()=>{if(!settled)finish(new AppError('CALENDAR_LIMIT'));});
 });
}
