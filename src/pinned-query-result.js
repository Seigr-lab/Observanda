import {randomBytes,createHash} from 'node:crypto';
import {QueryResultSort,QueryCachePressure} from './query-result-sort.js';
import {openQueryCacheFiles} from './query-cache-files.js';
import {onVaultRetire} from './vault-lifecycle.js';
import {queryCacheSuspended,registerQueryCacheRoot} from './query-cache-lifecycle.js';
import {currentQueryCacheScope,assertQueryCacheScope,onQueryCacheScopeRetire} from './query-cache-scope.js';
import {nativeResources} from './native-resource-budget.js';
import {AppError} from './errors.js';
import {detachedQueryCache} from './query-cache-detached.js';
const hash=value=>createHash('sha256').update(value).digest('hex');
const collation=JSON.stringify({icu:process.versions.icu,node:process.versions.node,options:new Intl.Collator('en',{numeric:true}).resolvedOptions()});
const generations=new WeakMap();let serial=0;
const pressure=error=>error instanceof QueryCachePressure||['WORKLOAD_BUSY','STORAGE_FULL','ENOSPC','EDQUOT'].includes(error?.code);
const retire=(cache,entry)=>()=>cache.dispose(entry);
function durableCheck(scope,vault,key,fingerprint,root,controller){return ()=>{controller?.signal.throwIfAborted();assertQueryCacheScope(scope);if(vault.key!==key||!Buffer.isBuffer(vault.key)||hash(vault.key)!==fingerprint)throw new AppError('ACCESS_LOCKED');if(queryCacheSuspended(root))throw new QueryCachePressure();};}
function expiry(cache,entry,ttl){return detachedQueryCache(()=>{const timer=setTimeout(()=>{void cache.dispose(entry).catch(()=>{});},ttl);timer.unref();return timer;});}
async function waiting(promise,signal){
 if(!signal)return promise;signal.throwIfAborted();let abort;
 try{return await Promise.race([promise,new Promise((_,reject)=>{abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});})]);}
 finally{signal.removeEventListener('abort',abort);}
}

export class PinnedQueryResults{
 constructor({open=openQueryCacheFiles,max=8,builders=2,ttl=10*60*1000,now=Date.now,budget=nativeResources}={}){Object.assign(this,{open,max,builders,ttl,now,budget});this.entries=new Map();this.disposals=new Set();this.building=0;this.reading=0;}
 async dispose(entry){
  if(entry.closing)return entry.closing;entry.retired=true;entry.controller.abort(new QueryCachePressure());entry.key.fill(0);clearTimeout(entry.timer);if(this.entries.get(entry.signature)===entry)this.entries.delete(entry.signature);
  entry.closing=(async()=>{try{await Promise.allSettled([...entry.pending]);await entry.files?.close();}finally{entry.unregister?.();entry.unsubscribe?.();entry.unscope?.();}})();this.disposals.add(entry.closing);entry.closing.then(()=>this.disposals.delete(entry.closing),()=>this.disposals.delete(entry.closing));return entry.closing;
 }
 track(entry,operation){const promise=Promise.resolve().then(operation);entry.pending.add(promise);promise.then(()=>entry.pending.delete(promise),()=>entry.pending.delete(promise));return promise;}
 async clear(){const result=await Promise.allSettled([...this.entries.values()].map(entry=>this.dispose(entry)).concat([...this.disposals]));const failed=result.find(value=>value.status==='rejected');if(failed)throw failed.reason;}
 async window({workspace,ownerId,snapshotId,queryHash,order,deferredOrder,point,after=null,offset=null,limit=25,includeEqual=true,preceding=false,reuse=true,signal},produce){
  if(offset!==null&&(!Number.isSafeInteger(offset)||offset<0||after!==null))throw new AppError('INVALID');
  signal?.throwIfAborted();if(typeof workspace?.root!=='string'||!Buffer.isBuffer(workspace?.vault?.key)||queryCacheSuspended(workspace.root))return null;
  const scope=currentQueryCacheScope(),vault=workspace.vault,key=vault.key,fingerprint=hash(key),root=workspace.root,projectId=workspace.projectId??null,labBookId=workspace.labBookId??null,lifetimeVault=scope?.vault??vault,lifetimeKey=lifetimeVault?.key;
  if(!Buffer.isBuffer(lifetimeKey))return null;const lifetimeFingerprint=hash(lifetimeKey);let generation=generations.get(lifetimeVault);if(!generation||generation.key!==lifetimeKey||generation.fingerprint!==lifetimeFingerprint){generation={key:lifetimeKey,fingerprint:lifetimeFingerprint,id:++serial};generations.set(lifetimeVault,generation);}
  const signature=hash(JSON.stringify([root,projectId,labBookId,ownerId,vault.id,fingerprint,generation.id,scope?.tokens.map(token=>token.id),snapshotId,queryHash,collation]));let entry=this.entries.get(signature),created=false;
  const owner=()=>{if(workspace.root!==root||(workspace.projectId??null)!==projectId||(workspace.labBookId??null)!==labBookId)throw new AppError('DATABASE_LOCATION');if(workspace.vault!==vault||vault.key!==key||!Buffer.isBuffer(vault.key)||hash(vault.key)!==fingerprint)throw new AppError('ACCESS_LOCKED');if(queryCacheSuspended(root))throw new QueryCachePressure();};
  const durable=durableCheck(scope,lifetimeVault,lifetimeKey,lifetimeFingerprint,root);
  const admitted=()=>{signal?.throwIfAborted();owner();durable();};
  try{
   admitted();
   if(entry&&(entry.expires<=this.now()||!reuse&&entry.receipt)){await this.dispose(entry);entry=null;}
   if(!entry){
    if(this.building>=this.builders)return null;
    if(this.entries.size>=this.max){const old=[...this.entries.values()].filter(value=>!value.pending.size).sort((a,b)=>a.used-b.used)[0];if(!old)return null;await this.dispose(old);}
    const controller=new AbortController(),pending=new Set(),ttl=Math.min(this.ttl,(scope?.expires??Infinity)-Date.now());entry={signature,key:randomBytes(32),controller,pending,expires:this.now()+ttl,used:this.now(),retired:false};
    const retiring=retire(this,entry);entry.unregister=registerQueryCacheRoot(workspace.root,retiring);if(!entry.unregister){entry.key.fill(0);return null;}
    entry.unsubscribe=onVaultRetire(lifetimeVault,retiring);if(scope)entry.unscope=onQueryCacheScopeRetire(scope,retiring);entry.timer=expiry(this,entry,ttl);this.entries.set(signature,entry);this.building++;created=true;
    const lifetime=durableCheck(scope,lifetimeVault,lifetimeKey,lifetimeFingerprint,root,controller);
    entry.build=this.track(entry,async()=>{
     const check=()=>{admitted();lifetime();};let permit;
     try{
      check();permit=this.budget.reserve('buffer',32*1024*1024);entry.files=await detachedQueryCache(()=>this.open(workspace,{signal:AbortSignal.any([controller.signal,...(signal?[signal]:[])]),check:lifetime}));check();const sort=new QueryResultSort(entry.files,entry.key,entry.files.id,{check});
      const input=await produce(check),receipt=await sort.build(input.rows,order,{deferredOrder});check();const metadata=await input.finish?.()??{};
      if(Buffer.byteLength(JSON.stringify(metadata))>256*1024)throw new QueryCachePressure();await entry.files.finish();check();entry.receipt=receipt;entry.metadata=structuredClone(metadata);
     }finally{this.building--;permit?.release();}
    });
   }
   await waiting(entry.build,signal);if(entry.receipt)entry.build=null;admitted();entry.used=this.now();if(this.reading>=8)return null;
   return await this.track(entry,async()=>{
    admitted();entry.controller.signal.throwIfAborted();let permit;this.reading++;
    try{permit=this.budget.reserve('buffer',8*1024*1024);await entry.files.assertNamed();
    // New callbacks check this request's signal. The builder's request context
    // is never retained as the lifetime of a completed result.
    const check=()=>{admitted();entry.controller.signal.throwIfAborted();},sort=new QueryResultSort(entry.files,entry.key,entry.files.id,{check}),receipt=entry.receipt;
    const skipped=offset!==null?Math.min(offset,receipt.total):after?await sort.rank(receipt,after,order,{includeEqual,deferredOrder}):0,records=await sort.page(receipt,skipped,limit),prior=preceding?await sort.page(receipt,Math.max(0,skipped-limit-1),Math.min(limit+1,skipped)):[];check();await entry.files.assertNamed();
    return {...structuredClone(entry.metadata),total:receipt.total,skipped,records,preceding:prior.map(point)};
    }finally{this.reading--;permit?.release();}
   });
  }catch(error){if(signal?.aborted){if(created&&!entry?.receipt)await this.dispose(entry);throw signal.reason;}const retired=entry?.controller.signal.aborted;if(entry)await this.dispose(entry);if(retired){try{admitted();}catch(current){if(!pressure(current))throw current;}}if(pressure(error)||retired)return null;throw error;}
 }
 stats(){return {entries:this.entries.size,building:this.building,reading:this.reading};}
}
export const pinnedQueryResults=new PinnedQueryResults();
