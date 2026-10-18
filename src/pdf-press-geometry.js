import {Worker} from 'node:worker_threads';
import {validPdfPress} from './web/pdf-press-model.js';
const fail=code=>Object.assign(new Error(code),{code});
const limit=64*1024*1024;
// Parser and serializer run outside the application thread. Only this final
// generated PDF is expanded; measurement prints keep their original geometry.
export async function applyPdfPressGeometry(bytes,press,{signal,maxBytes=limit,timeoutMs=30000}={}){
 signal?.throwIfAborted();
 if(!(bytes instanceof Uint8Array)||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>limit||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>300000)throw fail('PDF_PRESS');
 if(bytes.byteLength>maxBytes)throw fail('PDF_CAPACITY');
 if(press===undefined)return bytes;
 if(!validPdfPress(press))throw fail('PDF_PRESS');
 if(bytes.byteLength<5||Buffer.from(bytes.buffer,bytes.byteOffset,5).toString()!=='%PDF-')throw fail('PDF_PRESS_FAILED');
 const input=Uint8Array.from(bytes);
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./pdf-press-worker.js',import.meta.url),{workerData:{bytes:input,press:{...press},maxBytes},transferList:[input.buffer],resourceLimits:{maxOldGenerationSizeMb:512,maxYoungGenerationSizeMb:32}});
  let settled=false;
  const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);void worker.terminate().then(()=>error?reject(error):resolve(result),()=>reject(error??fail('PDF_PRESS_FAILED')));};
  const abort=()=>finish(signal.reason),timer=setTimeout(()=>finish(fail('PDF_PRESS_FAILED')),timeoutMs);
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  worker.once('message',result=>{if(result?.error)return finish(fail(result.error==='PDF_CAPACITY'?'PDF_CAPACITY':'PDF_PRESS_FAILED'));if(!(result?.bytes instanceof Uint8Array)||result.bytes.byteLength>maxBytes)return finish(fail('PDF_PRESS_FAILED'));finish(null,Buffer.from(result.bytes.buffer,result.bytes.byteOffset,result.bytes.byteLength));});
  worker.once('error',()=>finish(fail('PDF_PRESS_FAILED')));worker.once('exit',()=>{if(!settled)finish(fail('PDF_PRESS_FAILED'));});
 });
}
