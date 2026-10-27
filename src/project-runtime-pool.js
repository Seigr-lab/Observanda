import {registerRuntimeEnvironment} from './database-runtime-environment.js';
import {AppError} from './errors.js';
import {nativeResources} from './native-resource-budget.js';

// References own running work. Only idle project services are cache entries;
// eviction never borrows a workspace writer or stops a sibling's connection.
export class ProjectRuntimePool{
 constructor({close,idleMs=60000,maxIdle=2}){
  if(typeof close!=='function'||!Number.isSafeInteger(idleMs)||idleMs<0||!Number.isSafeInteger(maxIdle)||maxIdle<0)throw new AppError('INVALID');
  this.stop=close;this.idleMs=idleMs;this.maxIdle=maxIdle;this.entries=new Map();this.stopping=false;this.clock=0;
  this.removePressure=nativeResources.onPressure(()=>{for(const entry of this.entries.values())if(!entry.users&&!entry.manual&&!entry.closing)void this.close(entry.root,{idle:true}).catch(()=>{});});
 }
 async acquire(root,open,{manual=false}={}){
  for(;;){
   if(this.stopping)throw new AppError('DATABASE_CANCELLED');
   let entry=this.entries.get(root);
   if(entry?.closing){try{await entry.closing;}catch{/* The next open must authenticate and recover its durable owner. */}continue;}
   if(!entry){entry={root,users:0,env:null,manual:false,timer:null,closing:null,drained:[],unused:0};this.entries.set(root,entry);}
   const release=this.retain(entry);
   try{
    const env=await open();
    if(entry.env!==env){entry.env=env;registerRuntimeEnvironment(env,()=>this.retain(entry));}
    if(manual)entry.manual=true;
    return {env,release};
   }catch(error){release();if(!entry.users&&!entry.env&&!entry.closing&&this.entries.get(root)===entry)this.entries.delete(root);throw error;}
  }
 }
 retain(entry){
  if(this.entries.get(entry.root)!==entry||entry.closing&&!entry.users)throw new AppError('DATABASE_CANCELLED');
  clearTimeout(entry.timer);entry.timer=null;entry.users++;let released=false;
  return ()=>{
   if(released)return;released=true;entry.users--;
   if(!entry.users){entry.unused=++this.clock;for(const resolve of entry.drained.splice(0))resolve();if(!entry.closing)this.idle(entry);}
  };
 }
 idle(entry){
  if(entry.manual||!entry.env||this.stopping)return;
  entry.timer=setTimeout(()=>{void this.close(entry.root,{idle:true}).catch(()=>{});},this.idleMs);entry.timer.unref?.();
  const idle=[...this.entries.values()].filter(value=>value.env&&!value.users&&!value.manual&&!value.closing).sort((a,b)=>a.unused-b.unused);
  for(const value of idle.slice(0,Math.max(0,idle.length-this.maxIdle)))void this.close(value.root,{idle:true}).catch(()=>{});
 }
 close(root,{idle=false}={}){
  const entry=this.entries.get(root);if(!entry)return Promise.resolve();
  if(entry.closing)return entry.closing;if(idle&&(entry.users||entry.manual))return Promise.resolve();
  clearTimeout(entry.timer);entry.timer=null;
  // Stop releases runtime credentials and the kernel lease even on failure.
  // An authenticated open then recovers the durable owner; never retain a
  // rejected in-memory promise as a permanent lock on this project.
  entry.closing=(async()=>{
   if(entry.users)await new Promise(resolve=>entry.drained.push(resolve));
   try{await this.stop(root);}finally{if(this.entries.get(root)===entry)this.entries.delete(root);}
  })();return entry.closing;
 }
 stats(){const entries=[...this.entries.values()];return {open:entries.length,active:entries.filter(e=>e.users>0).length,references:entries.reduce((sum,e)=>sum+e.users,0),idle:entries.filter(e=>e.env&&!e.users&&!e.closing&&!e.manual).length,closing:entries.filter(e=>e.closing).length};}
 async closeAll(){this.stopping=true;this.removePressure();const results=await Promise.allSettled([...this.entries.keys()].map(root=>this.close(root)));const failed=results.find(result=>result.status==='rejected');if(failed)throw failed.reason;}
}
