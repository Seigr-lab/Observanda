import {Worker} from 'node:worker_threads';
import {validPdfPrintCondition,PDF_ICC_MAX_BYTES} from './web/pdf-print-condition-model.js';
const fail=code=>Object.assign(new Error(code),{code}),limit=64*1024*1024;
// The trusted renderer supplies a retained condition, never a filesystem path.
// This report concerns colour resources, not PDF/X or physical press fidelity.
export async function applyPdfPrintOutput(bytes,{printCondition,iccProfile,signal,maxBytes=limit,timeoutMs=60000}={}){
 signal?.throwIfAborted();
 if(!(bytes instanceof Uint8Array)||bytes.length<5||!validPdfPrintCondition(printCondition)||!(iccProfile instanceof Uint8Array)||iccProfile.byteLength>PDF_ICC_MAX_BYTES||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>limit||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>300000)throw fail('PDF_PRINT_PROFILE');
 if(bytes.byteLength>maxBytes)throw fail('PDF_CAPACITY');const input=Uint8Array.from(bytes),profile=Uint8Array.from(iccProfile);
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./pdf-print-worker.js',import.meta.url),{workerData:{bytes:input,printCondition,iccProfile:profile,maxBytes},transferList:[input.buffer,profile.buffer],resourceLimits:{maxOldGenerationSizeMb:512,maxYoungGenerationSizeMb:32}});
  let settled=false;const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);void worker.terminate().then(()=>error?reject(error):resolve(result),()=>reject(error??fail('PDF_PRINT_FAILED')));},abort=()=>finish(signal.reason),timer=setTimeout(()=>finish(fail('PDF_PRINT_FAILED')),timeoutMs);
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  worker.once('message',result=>{if(result?.error)return finish(fail(['PDF_PRINT_PROFILE','PDF_CAPACITY','PDF_PRINT_COLOR'].includes(result.error)?result.error:'PDF_PRINT_FAILED'));if(!(result?.bytes instanceof Uint8Array)||result.bytes.byteLength>maxBytes||!result.print)return finish(fail('PDF_PRINT_FAILED'));finish(null,{bytes:Buffer.from(result.bytes.buffer,result.bytes.byteOffset,result.bytes.byteLength),print:result.print});});
  worker.once('error',()=>finish(fail('PDF_PRINT_FAILED')));worker.once('exit',()=>{if(!settled)finish(fail('PDF_PRINT_FAILED'));});
 });
}
