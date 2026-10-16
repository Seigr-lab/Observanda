import {createHash} from 'node:crypto';
import {AppError} from './errors.js';
import {withScratch} from './scratch-work.js';
import {safeLivePath,retainLiveManifest,retainRemovedLivePaths} from './publication-live-manifest.js';

export {deploymentInventory,recordDeploymentInventory,prepareDeploymentInventory,assertDeploymentInventory,deploymentInventoryPaths} from './publication-live-inventory.js';
const safePath=safeLivePath;

export class LiveVerificationError extends Error{
 constructor(path,reason){super(reason);this.issue={path,reason};}
}
// At most four bounded streaming requests. Headers and each body read have an
// idle deadline, so a large transfer can continue while it is making progress.
export async function verifyLiveFiles(request,base,receipt,{removed=[],signal,progress=async()=>{},timeoutMs=30000}={}){
 const root=new URL(base.endsWith('/')?base:base+'/'),controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
 async function read(name,{bytes,max=bytes,sha,consume,absent=false}={}){
  if(!safePath(name))throw new LiveVerificationError('publication.json','manifest');
  const url=new URL(name,root);if(url.origin!==root.origin||!url.pathname.startsWith(root.pathname))throw new LiveVerificationError('publication.json','manifest');
  const scope=new AbortController(),abort=()=>scope.abort(combined.reason);let timer;
  const refresh=()=>{clearTimeout(timer);timer=setTimeout(()=>scope.abort(new Error('timeout')),timeoutMs);};refresh();combined.addEventListener('abort',abort,{once:true});if(combined.aborted)abort();
  let reader;
  const bounded=promise=>new Promise((resolve,reject)=>{const stop=()=>reject(scope.signal.reason);scope.signal.addEventListener('abort',stop,{once:true});if(scope.signal.aborted)stop();Promise.resolve(promise).then(resolve,reject).finally(()=>scope.signal.removeEventListener('abort',stop));});
  try{
   const response=await bounded(request(url,{redirect:'error',signal:scope.signal,headers:{'Cache-Control':'no-cache'}}));
   reader=response.body?.getReader();
   refresh();
   if(absent){if(![404,410].includes(response.status))throw new LiveVerificationError(name,'removed');return {bytes:0};}
   if(!response.ok)throw new LiveVerificationError(name,'missing');
   const hash=createHash('sha256');let received=0,finished=false,transferError;
   const chunks=async function*(){
    try{if(reader)while(true){const {done,value}=await bounded(reader.read());if(done)break;received+=value.length;if(!Number.isSafeInteger(received)||max!==undefined&&received>max)throw new LiveVerificationError(name,'size');if(value.length)refresh();hash.update(value);yield value;}finished=true;}
    catch(error){transferError=error;throw error;}
   };
   try{if(consume)await consume(chunks());else for await(const chunk of chunks())void chunk;}catch(error){throw transferError??error;}
   if(!finished)throw new LiveVerificationError(name,'manifest');
   if(bytes!==undefined&&received!==bytes)throw new LiveVerificationError(name,'size');
   if(sha&&hash.digest('hex')!==sha)throw new LiveVerificationError(name,'hash');
   return {bytes:received};
  }catch(error){if(error instanceof LiveVerificationError||error instanceof AppError)throw error;combined.throwIfAborted();throw new LiveVerificationError(name,'unavailable');}
  finally{clearTimeout(timer);combined.removeEventListener('abort',abort);if(reader)reader.cancel().catch(()=>{});scope.abort();}
 }
 try{
  return await withScratch(async work=>{
   let files;const fail=reason=>new LiveVerificationError('publication.json',reason);
   if(!/^[a-f0-9]{64}$/.test(receipt.manifestHash??'')||typeof receipt.releaseId!=='string'||!receipt.releaseId)throw fail('manifest');
   const first=await read('publication.json',{sha:receipt.manifestHash,consume:async chunks=>{files=await retainLiveManifest(chunks,work,receipt.releaseId,{signal:combined,fail});}});
   const removedCount=await retainRemovedLivePaths(work,removed,{signal:combined,fail}),total=files+removedCount;
   let done=0,bytes=first.bytes;const pending=work.items();
   const worker=async()=>{while(true){combined.throwIfAborted();const item=await pending.next();if(item.done)return;const f=item.value,result=await read(f.path,{bytes:f.bytes,sha:f.sha256,absent:f.absent});bytes+=result.bytes;await progress({done:++done,total});}};
   try{
    const workers=Array.from({length:Math.min(4,total)},()=>worker().catch(error=>{controller.abort(error);throw error;}));
    const outcomes=await Promise.allSettled(workers),failure=outcomes.find(o=>o.status==='rejected');if(failure)throw failure.reason;
   }finally{await pending.return();}
   await read('publication.json',{bytes:first.bytes,sha:receipt.manifestHash});
   return {at:new Date().toISOString(),manifestHash:receipt.manifestHash,url:new URL('publication.json',root).href,files:files+1,removed:removedCount,bytes};
  },{signal:combined});
 }finally{controller.abort();}
}
