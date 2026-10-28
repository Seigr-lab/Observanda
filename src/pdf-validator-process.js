import {spawn} from 'node:child_process';
import {parserEnvironment} from './parser-process.js';
import {nativeMediaAdmission} from './native-media-admission.js';
import {diagnosticPhase} from './operational-diagnostics.js';

const profiles={
 '2u':{failure:'PDF_ARCHIVAL_FAILED',unavailable:'PDF_ARCHIVAL_UNAVAILABLE',maxFailures:'5',exitCodes:[0]},
 ua1:{failure:'PDF_ACCESSIBILITY_FAILED',unavailable:'PDF_ACCESSIBILITY_UNAVAILABLE',maxFailures:'1',exitCodes:[0,1]}
};
const fail=code=>Object.assign(new Error(code),{code});
const outputLimit=2*1024*1024,diagnosticLimit=256*1024;
// The Java heap plus native overhead is a launch reservation, not an OS memory
// limit. The caller authenticates the pinned runtime and owns the input folder.
export async function runPdfValidator(runtime,file,directory,{profile,signal,admission=nativeMediaAdmission,spawnProcess=spawn}={}){
 signal?.throwIfAborted();
 if(!Object.hasOwn(profiles,profile))throw new TypeError('Invalid PDF validation profile');
 const policy=profiles[profile];let release;
 try{release=await admission.acquire(640*1024*1024,{signal});}
 catch(error){if(error.code==='MEDIA_RESOURCE_LIMIT')throw fail('PDF_CAPACITY');throw error;}
 try{return await diagnosticPhase('validate-pdf',()=>{
  signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
   let child;
   try{child=spawnProcess(runtime.java,['-Djava.awt.headless=true','-Xmx512m','-Duser.home='+directory,'-Djava.io.tmpdir='+directory,'-jar',runtime.jar,'--format','json','--flavour',profile,'--maxfailuresdisplayed',policy.maxFailures,'--loglevel','0',file],{cwd:directory,env:parserEnvironment(runtime.java,directory),windowsHide:true,stdio:['ignore','pipe','pipe']});}
   catch{reject(fail(policy.unavailable));return;}
   let chunks=[],size=0,diagnostics=0,failed=false,error;
   const stop=reason=>{
    if(failed)return;failed=true;error=reason;chunks=[];
    // Validation publishes no data. Terminate immediately on cancellation or
    // overflow, then await close before releasing capacity or deleting input.
    try{child.kill('SIGKILL');}catch{/* close remains authoritative */}
   },abort=()=>stop(signal.reason);
   child.stdout.on('data',chunk=>{if(failed)return;if(chunk.length>outputLimit-size)stop(fail(policy.failure));else{size+=chunk.length;chunks.push(chunk);}});
   child.stderr.on('data',chunk=>{if(failed)return;if(chunk.length>diagnosticLimit-diagnostics)stop(fail(policy.failure));else diagnostics+=chunk.length;});
   child.once('error',()=>{if(!failed){failed=true;error=fail(policy.unavailable);}chunks=[];});
   child.once('close',code=>{
    signal?.removeEventListener('abort',abort);
    if(failed||!policy.exitCodes.includes(code))reject(failed?error:fail(policy.failure));
    else resolve(Buffer.concat(chunks,size).toString('utf8'));
   });
   signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  });
 });}finally{release();}
}
