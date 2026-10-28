import {Worker} from 'node:worker_threads';
import {runPdfValidator} from './pdf-validator-process.js';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {resolvePdfValidationRuntime} from './pdf-archival-runtime.js';
import {pdfArchivalReceipt} from './pdf-archival-validation.js';
export {resolvePdfValidationRuntime,pdfArchivalAvailable} from './pdf-archival-runtime.js';
const fail=code=>Object.assign(new Error(code),{code});
const max=64*1024*1024;
function convert(bytes,{signal,maxBytes}){const input=Uint8Array.from(bytes);return new Promise((resolve,reject)=>{
 const worker=new Worker(new URL('./pdf-archival-worker.js',import.meta.url),{workerData:{bytes:input,maxBytes},transferList:[input.buffer],resourceLimits:{maxOldGenerationSizeMb:512,maxYoungGenerationSizeMb:32}});let settled=false;
 const finish=(error,value)=>{if(settled)return;settled=true;signal.removeEventListener('abort',abort);void worker.terminate().then(()=>error?reject(error):resolve(value),()=>reject(error??fail('PDF_ARCHIVAL_FAILED')));},abort=()=>finish(signal.reason);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
 worker.once('message',message=>{if(message.error)return finish(fail(message.error==='PDF_CAPACITY'?'PDF_CAPACITY':'PDF_ARCHIVAL_FAILED'));if(!(message.bytes instanceof Uint8Array)||message.bytes.length>maxBytes)return finish(fail('PDF_ARCHIVAL_FAILED'));finish(null,Buffer.from(message.bytes.buffer,message.bytes.byteOffset,message.bytes.byteLength));});worker.once('error',()=>finish(fail('PDF_ARCHIVAL_FAILED')));worker.once('exit',()=>{if(!settled)finish(fail('PDF_ARCHIVAL_FAILED'));});
});}
export async function applyPdfArchival(bytes,{runtime,signal:external,maxBytes=max,timeoutMs=60000}={}){
 external?.throwIfAborted();if(!(bytes instanceof Uint8Array)||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>max||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>300000)throw fail('PDF_ARCHIVAL_FAILED');if(bytes.length>maxBytes)throw fail('PDF_CAPACITY');
 const controller=new AbortController(),signal=external?AbortSignal.any([external,controller.signal]):controller.signal,timer=setTimeout(()=>controller.abort(fail('PDF_ARCHIVAL_FAILED')),timeoutMs);let directory;
 try{
  const verified=await resolvePdfValidationRuntime({directory:runtime?.directory,signal});signal.throwIfAborted();const output=await convert(bytes,{signal,maxBytes});signal.throwIfAborted();directory=await mkdtemp(path.join(os.tmpdir(),'observanda-pdf-archival-'));const file=path.join(directory,'document.pdf');await writeFile(file,output,{mode:0o600});signal.throwIfAborted();const report=await runPdfValidator(verified,file,directory,{profile:'2u',signal});signal.throwIfAborted();const sha256=createHash('sha256').update(output).digest('hex');return {bytes:output,validation:pdfArchivalReceipt(report,{sha256,bytes:output.length})};
 }finally{clearTimeout(timer);if(directory){if(path.dirname(directory)!==path.resolve(os.tmpdir())||!path.basename(directory).startsWith('observanda-pdf-archival-'))throw fail('PDF_ARCHIVAL_FAILED');await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100});}}
}
