import {createHash} from 'node:crypto';
import {AppError} from './errors.js';
import {withScratch} from './scratch-work.js';
import {safeLivePath,retainLiveManifest,retainRemovedLivePaths} from './publication-live-manifest.js';
import {validLiveManifestBudget} from './publication-live-budget.js';
import {spoolLiveManifest} from './publication-live-spool.js';
import {performance} from 'node:perf_hooks';

export {deploymentInventory,recordDeploymentInventory,prepareDeploymentInventory,assertDeploymentInventory,deploymentInventoryPaths} from './publication-live-inventory.js';
const safePath=safeLivePath;
const minimumTransferRate=64*1024;

export class LiveVerificationError extends Error{
 constructor(path,reason){super(reason);this.issue={path,reason};}
}
// At most four streaming requests, each with an exact trusted byte budget,
// an idle deadline and a nonrefreshing deadline scaled to that byte budget.
export async function verifyLiveFiles(request,base,receipt,{removed=[],fileManifest,removedCount=0,signal,progress=async()=>{},timeoutMs=30000,deadlineMs}={}){
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>2147483647||deadlineMs!==undefined&&(!Number.isSafeInteger(deadlineMs)||deadlineMs<1))throw new AppError('INVALID');
 const root=new URL(base.endsWith('/')?base:base+'/'),controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
 async function read(name,{bytes,max=bytes,sha,consume,absent=false}={}){
  if(!safePath(name))throw new LiveVerificationError('publication.json','manifest');
  const url=new URL(name,root);if(url.origin!==root.origin||!url.pathname.startsWith(root.pathname))throw new LiveVerificationError('publication.json','manifest');
  const scope=new AbortController(),abort=()=>scope.abort(combined.reason);let timer,deadline;
  const duration=deadlineMs??timeoutMs+Math.ceil((max??0)/minimumTransferRate)*1000;if(!Number.isSafeInteger(duration))throw new LiveVerificationError(name,'size');
  const until=performance.now()+duration,checkDeadline=()=>{if(performance.now()>=until)scope.abort(new Error('deadline'));scope.signal.throwIfAborted();};
  const expire=()=>{const left=until-performance.now();if(left<=0)scope.abort(new Error('deadline'));else deadline=setTimeout(expire,Math.min(2147483647,left));};expire();
  const refresh=()=>{clearTimeout(timer);timer=setTimeout(()=>scope.abort(new Error('timeout')),timeoutMs);};refresh();combined.addEventListener('abort',abort,{once:true});if(combined.aborted)abort();
  let reader;
  const bounded=promise=>new Promise((resolve,reject)=>{const stop=()=>reject(scope.signal.reason);scope.signal.addEventListener('abort',stop,{once:true});if(scope.signal.aborted)stop();Promise.resolve(promise).then(resolve,reject).finally(()=>scope.signal.removeEventListener('abort',stop));});
  try{
   const response=await bounded(request(url,{redirect:'error',signal:scope.signal,headers:{'Cache-Control':'no-cache'}}));
   reader=response.body?.getReader();
   clearTimeout(timer);
   if(absent){if(![404,410].includes(response.status))throw new LiveVerificationError(name,'removed');return {bytes:0};}
   if(!response.ok)throw new LiveVerificationError(name,'missing');
   const hash=createHash('sha256');let received=0,finished=false,transferError;
   const chunks=async function*(){
    try{if(reader)while(true){checkDeadline();refresh();const {done,value}=await bounded(reader.read());clearTimeout(timer);checkDeadline();if(done)break;received+=value.length;if(!Number.isSafeInteger(received)||max!==undefined&&received>max)throw new LiveVerificationError(name,'size');hash.update(value);yield value;}finished=true;}
    catch(error){transferError=error;throw error;}
   };
   try{if(consume)await consume(chunks(),scope.signal);else for await(const chunk of chunks())void chunk;}catch(error){throw transferError??error;}checkDeadline();
   if(!finished)throw new LiveVerificationError(name,'manifest');
   if(bytes!==undefined&&received!==bytes)throw new LiveVerificationError(name,'size');
   if(sha&&hash.digest('hex')!==sha)throw new LiveVerificationError(name,'hash');
   return {bytes:received};
  }catch(error){if(error instanceof LiveVerificationError||error instanceof AppError)throw error;combined.throwIfAborted();throw new LiveVerificationError(name,'unavailable');}
  finally{clearTimeout(timer);clearTimeout(deadline);combined.removeEventListener('abort',abort);if(reader)reader.cancel().catch(()=>{});scope.abort();}
 }
 const fail=reason=>new LiveVerificationError('publication.json',reason);
 async function verifyRows(pending,first,files,removedCount){
   const total=files+removedCount;let scheduled=0,done=0,bytes=first.bytes;
   if(!Number.isSafeInteger(total))throw fail('inventory');
   const worker=async()=>{while(true){combined.throwIfAborted();const item=await pending.next();if(item.done)return;if(++scheduled>total)throw fail('inventory');const f=item.value,result=await read(f.path,{bytes:f.bytes,sha:f.sha256,absent:f.absent});bytes+=result.bytes;await progress({done:++done,total});}};
   try{
    const workers=Array.from({length:Math.min(4,Math.max(1,total))},()=>worker().catch(error=>{controller.abort(error);throw error;}));
    const outcomes=await Promise.allSettled(workers),failure=outcomes.find(o=>o.status==='rejected');if(failure)throw failure.reason;
   }finally{await pending.return();}
   if(done!==total)throw fail('inventory');
   await read('publication.json',{bytes:first.bytes,sha:receipt.manifestHash});
   return {at:new Date().toISOString(),manifestHash:receipt.manifestHash,url:new URL('publication.json',root).href,files:files+1,removed:removedCount,bytes};
 }
 try{
  if(!validLiveManifestBudget(receipt))throw fail('metadata');
  if(!/^[a-f0-9]{64}$/.test(receipt.manifestHash??'')||typeof receipt.releaseId!=='string'||!receipt.releaseId)throw fail('manifest');
  if(fileManifest){
   const ref=receipt.fileInventory;
   if(ref?.type!=='files'||ref.root?.count!==receipt.manifestFiles+1||!Number.isSafeInteger(removedCount)||removedCount<0)throw fail('metadata');
   const descriptor=await fileManifest.find(ref,'publication.json');
   if(descriptor?.path!=='publication.json'||descriptor.bytes!==receipt.manifestBytes||descriptor.sha256!==receipt.manifestHash)throw fail('metadata');
   const first=await read(descriptor.path,{bytes:descriptor.bytes,sha:descriptor.sha256});
   async function* rows(){
    for await(const file of fileManifest.entries(ref))if(file.path!==descriptor.path)yield file;
    let previous='';
    for await(const path of removed){
     if(!safePath(path)||path<=previous||await fileManifest.find(ref,path))throw fail('inventory');previous=path;yield {path,absent:true};
    }
   }
   return await verifyRows(rows(),first,receipt.manifestFiles,removedCount);
  }
  return await withScratch(async work=>{
   let files;
   const first=await withScratch(async raw=>{
    let stored;const first=await read('publication.json',{bytes:receipt.manifestBytes,sha:receipt.manifestHash,consume:async(chunks,signal)=>{stored=await spoolLiveManifest(chunks,raw,receipt.manifestBytes,{signal,fail});}});
    files=await retainLiveManifest(stored.chunks({signal:combined}),work,receipt.releaseId,{signal:combined,fail,expectedFiles:receipt.manifestFiles,maxBytes:receipt.manifestBytes});return first;
   },{signal:combined});
   const removedCount=await retainRemovedLivePaths(work,removed,{signal:combined,fail});
   return verifyRows(work.items(),first,files,removedCount);
  },{signal:combined});
 }finally{controller.abort();}
}
