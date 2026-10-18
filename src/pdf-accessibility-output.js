import {Worker} from 'node:worker_threads';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {resolvePdfValidationRuntime} from './pdf-archival-runtime.js';
import {PDF_VALIDATOR_VERSION,PDF_VALIDATOR_SHA256} from './pdf-validation-dependencies.js';
const fail=code=>Object.assign(new Error(code),{code}),limit=64*1024*1024;
const exact=(value,keys)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys.sort().join();
export function validPdfAccessibilityLayout(value){
 return exact(value,['version','layouts'])&&value.version===1&&Array.isArray(value.layouts)&&value.layouts.length>0&&value.layouts.length<=12000&&value.layouts.every(row=>exact(row,['widthMm','heightMm','margins',...['runningText','numberStyle','numberStart'].filter(key=>Object.hasOwn(row,key))])&&[row.widthMm,row.heightMm].every(n=>Number.isFinite(n)&&n>=40&&n<=1000)&&exact(row.margins,['top','right','bottom','left'])&&Object.values(row.margins).every(n=>Number.isFinite(n)&&n>=0&&n<=400)&&row.margins.left+row.margins.right<row.widthMm&&row.margins.top+row.margins.bottom<row.heightMm&&(row.runningText===undefined||Array.isArray(row.runningText)&&row.runningText.length<=8&&row.runningText.every(text=>typeof text==='string'&&text.length<=2048&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)))&&(row.numberStyle===undefined||['decimal','lower-roman','upper-roman'].includes(row.numberStyle))&&(row.numberStart===undefined||Number.isInteger(row.numberStart)&&row.numberStart>=1&&row.numberStart<=9999));
}
function input(bytes,{signal,maxBytes,timeoutMs}){signal?.throwIfAborted();if(!(bytes instanceof Uint8Array)||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>limit||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>300000)throw fail('PDF_ACCESSIBILITY_FAILED');if(bytes.length>maxBytes)throw fail('PDF_CAPACITY');}
// This improves generated tags; it is not certification. Identification is only
// written for an explicitly requested PDF/UA candidate, never ordinary output.
export async function applyPdfAccessibilityOutput(bytes,{accessibilityLayout,identifyPdfUa=false,signal,maxBytes=limit,timeoutMs=60000}={}){
 input(bytes,{signal,maxBytes,timeoutMs});if(typeof identifyPdfUa!=='boolean'||accessibilityLayout!==undefined&&!validPdfAccessibilityLayout(accessibilityLayout))throw fail('PDF_ACCESSIBILITY_FAILED');const copy=Uint8Array.from(bytes);
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./pdf-accessibility-worker.js',import.meta.url),{workerData:{bytes:copy,accessibilityLayout,identifyPdfUa,maxBytes},transferList:[copy.buffer],resourceLimits:{maxOldGenerationSizeMb:512,maxYoungGenerationSizeMb:32}});let settled=false;
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);void worker.terminate().then(()=>error?reject(error):resolve(value),()=>reject(error??fail('PDF_ACCESSIBILITY_FAILED')));},abort=()=>finish(signal.reason),timer=setTimeout(()=>finish(fail('PDF_ACCESSIBILITY_FAILED')),timeoutMs);
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();worker.once('message',message=>{if(message.error)return finish(fail(message.error==='PDF_CAPACITY'?'PDF_CAPACITY':'PDF_ACCESSIBILITY_FAILED'));if(!(message.bytes instanceof Uint8Array)||message.bytes.length>maxBytes)return finish(fail('PDF_ACCESSIBILITY_FAILED'));finish(null,Buffer.from(message.bytes.buffer,message.bytes.byteOffset,message.bytes.byteLength));});worker.once('error',()=>finish(fail('PDF_ACCESSIBILITY_FAILED')));worker.once('exit',()=>{if(!settled)finish(fail('PDF_ACCESSIBILITY_FAILED'));});
 });
}
export function pdfAccessibilityReport(text,{sha256,bytes}){
 try{
  if(typeof text!=='string'||Buffer.byteLength(text)>2*1024*1024||!/^[a-f0-9]{64}$/.test(sha256)||!Number.isSafeInteger(bytes)||bytes<1)throw fail();const report=JSON.parse(text).report,batch=report.batchSummary,jobs=report.jobs;
  if(batch.multiJob!==false||batch.totalJobs!==1||['outOfMemory','veraExceptions','failedParsingJobs','failedEncryptedJobs'].some(key=>batch[key]!==0)||!Array.isArray(jobs)||jobs.length!==1)throw fail();
  if(report.buildInformation.releaseDetails.length!==3||['core','validation-model','apps'].some(id=>report.buildInformation.releaseDetails.filter(row=>row.id===id&&row.version===PDF_VALIDATOR_VERSION).length!==1))throw fail();
  const job=jobs[0];if(job.itemDetails.size!==bytes||job.validationResult.length!==1)throw fail();const result=job.validationResult[0],details=result.details,summary=batch.validationSummary;
  if(result.jobEndStatus!=='normal'||result.profileName!=='PDF/UA-1 validation profile'||typeof result.compliant!=='boolean'||['passedRules','failedRules','passedChecks','failedChecks'].some(key=>!Number.isSafeInteger(details[key])||details[key]<0)||details.passedRules===0||details.passedChecks===0||result.compliant!==(details.failedRules===0&&details.failedChecks===0)||!Array.isArray(details.ruleSummaries)||details.ruleSummaries.length!==details.failedRules||summary.totalJobCount!==1||summary.failedJobCount!==0||summary.successfulJobCount!==1||summary.compliantPdfaCount!==(result.compliant?1:0)||summary.nonCompliantPdfaCount!==(result.compliant?0:1))throw fail();
  // Report no filenames, temporary directories, raw validator context or values
  // from the document. Clause/test numbers identify the official rule precisely.
  const findings=details.ruleSummaries.map(row=>{if(row.specification!=='ISO 14289-1:2014'||row.ruleStatus!=='FAILED'||!/^\d+(?:\.\d+)*$/.test(row.clause)||!Number.isSafeInteger(row.testNumber)||row.testNumber<1||!Number.isSafeInteger(row.failedChecks)||row.failedChecks<1)throw fail();return {clause:row.clause,testNumber:row.testNumber,failedChecks:row.failedChecks};});
  if(findings.reduce((sum,row)=>sum+row.failedChecks,0)!==details.failedChecks)throw fail();
  return {version:1,profile:'pdfua-1',sha256,validator:'veraPDF',validatorVersion:PDF_VALIDATOR_VERSION,validatorSha256:PDF_VALIDATOR_SHA256,automatedOnly:true,compliant:result.compliant,passedRules:details.passedRules,failedRules:details.failedRules,passedChecks:details.passedChecks,failedChecks:details.failedChecks,findings};
 }catch{throw fail('PDF_ACCESSIBILITY_FAILED');}
}
function validate(runtime,file,directory,signal){return new Promise((resolve,reject)=>{
 const env={...process.env};for(const key of Object.keys(env))if(['JAVA_TOOL_OPTIONS','_JAVA_OPTIONS','JDK_JAVA_OPTIONS','CLASSPATH','JAVA_OPTS'].includes(key.toUpperCase()))delete env[key];
 const child=spawn(runtime.java,['-Djava.awt.headless=true','-Xmx512m','-Duser.home='+directory,'-Djava.io.tmpdir='+directory,'-jar',runtime.jar,'--format','json','--flavour','ua1','--maxfailuresdisplayed','1','--loglevel','0',file],{cwd:directory,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let chunks=[],size=0,diagnostics=0,error=null;
 const stop=reason=>{error??=reason;child.kill();},abort=()=>stop(signal.reason);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();child.stdout.on('data',chunk=>{if((size+=chunk.length)>2*1024*1024)stop(fail('PDF_ACCESSIBILITY_FAILED'));else chunks.push(chunk);});child.stderr.on('data',chunk=>{if((diagnostics+=chunk.length)>256*1024)stop(fail('PDF_ACCESSIBILITY_FAILED'));});child.once('error',()=>{error??=fail('PDF_ACCESSIBILITY_UNAVAILABLE');});child.once('close',code=>{signal.removeEventListener('abort',abort);if(error||![0,1].includes(code))reject(error??fail('PDF_ACCESSIBILITY_FAILED'));else resolve(Buffer.concat(chunks,size).toString('utf8'));});
});}
export async function validatePdfAccessibilityOutput(bytes,{runtime,signal:external,maxBytes=limit,timeoutMs=60000}={}){
 input(bytes,{signal:external,maxBytes,timeoutMs});const controller=new AbortController(),signal=external?AbortSignal.any([external,controller.signal]):controller.signal,timer=setTimeout(()=>controller.abort(fail('PDF_ACCESSIBILITY_FAILED')),timeoutMs);let directory;
 try{
  let verified;try{verified=await resolvePdfValidationRuntime({directory:runtime?.directory,signal});}catch{signal.throwIfAborted();throw fail('PDF_ACCESSIBILITY_UNAVAILABLE');}directory=await mkdtemp(path.join(os.tmpdir(),'observanda-pdf-accessibility-'));const file=path.join(directory,'document.pdf');await writeFile(file,bytes,{mode:0o600});signal.throwIfAborted();const report=await validate(verified,file,directory,signal);signal.throwIfAborted();return pdfAccessibilityReport(report,{sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length});
 }finally{clearTimeout(timer);if(directory){if(path.dirname(directory)!==path.resolve(os.tmpdir())||!path.basename(directory).startsWith('observanda-pdf-accessibility-'))throw fail('PDF_ACCESSIBILITY_FAILED');await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100});}}
}
