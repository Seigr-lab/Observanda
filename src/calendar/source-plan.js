import path from 'node:path';
import {Workspace} from '../storage.js';
import {readAccess} from '../access.js';
import {clearVault} from '../encryption.js';
import {readCalendar} from './reader.js';
import {ownerLabel,ownerDescriptor} from '../web/modules/scope.js';
import {digest} from '../storage-format.js';
import {AppError} from '../errors.js';
import messages from '../web/locales/en/calendar.json' with {type:'json'};
export const calendarScopeVersion=book=>digest(JSON.stringify([book.id,book.title,book.projects]));
const plans=new WeakSet();
export function calendarSourceError(source,error){source.error=error instanceof AppError?error.message:messages.refreshFailed;if(error instanceof AppError)source.errorCode=error.code;else source.errorKey='refreshFailed';source.locked=error.code==='CALENDAR_LOCKED';}
function check(service,plan,signal){signal?.throwIfAborted();if(!plans.has(plan)||plan.service!==service||plan.generation!==service.generation)throw new AppError('ACCESS_LOCKED');if(plan.workspace.root!==plan.root)throw new AppError('WORKSPACE_CHANGED');if(plan.grants.some(grant=>!Buffer.isBuffer(grant.vault?.key)))throw new AppError('CALENDAR_LOCKED');}
export async function calendarSourcePlan(service,workspace,range,{refresh=false,detail=null,signal}={}){
 const generation=service.generation,{metadata:book}=await workspace.outline(),current=await service.read(workspace,book,range,{signal,connectionsOnly:true}),snapshot={revision:current.revision,connections:structuredClone(current.connections)},scopeVersion=calendarScopeVersion(book),versions=new Map([['scope',scopeVersion],['local',snapshot.revision]]);
 const plan={service,workspace,root:workspace.root,range,book,snapshot,scopeVersion,generation,sources:[],grants:[]};plans.add(plan);check(service,plan,signal);
 const live=new Set(snapshot.connections.map(entity=>entity.id));
 for(const [id,connected] of service.connections)if(!live.has(id)){await clearVault(connected.vault);service.connections.delete(id);}
 for(const id of service.cache.keys())if(!live.has(id))service.cache.delete(id);
 plan.sources=snapshot.connections.filter(entity=>!detail||detail.sourceId===entity.id).map(entity=>{const d=entity.data;return {entity,source:{id:entity.id,name:d.name,color:d.color,projectId:d.projectId,owner:ownerLabel(book,d.projectId),ownerDisplay:ownerDescriptor(book,d.projectId),readOnly:true,kind:entity.type}};});
 const collect=async entry=>{
  check(service,plan,signal);const {entity,source}=entry,d=entity.data;
  try{
   if(entity.type==='subscription'){
    let cached=service.cache.get(entity.id);
    if(refresh||!cached||cached.url!==d.url||Date.now()-cached.at>(cached.error?60000:300000)){
     try{const text=await service.fetch(d.url,{signal});cached={url:d.url,text,hash:digest(text),at:Date.now()};}
     catch(error){check(service,plan,signal);cached={url:d.url,error,at:Date.now()};}
     check(service,plan,signal);service.cache.set(entity.id,cached);
    }
    entry.cached=cached;if(cached.error)throw cached.error;source.checkedAt=new Date(cached.at).toISOString();versions.set(entity.id,cached.hash);
   }else{
    const connected=service.connections.get(entity.id);if(!connected||connected.root!==path.resolve(d.path))throw new AppError('CALENDAR_LOCKED');
    if((await readAccess(connected.root)).etag!==connected.etag){await clearVault(connected.vault);service.connections.delete(entity.id);throw new AppError('CALENDAR_LOCKED');}
    const storage=new Workspace(connected.root,connected.vault),{metadata:other}=await storage.outline();if(other.id!==connected.workspaceId||other.id===book.id)throw new AppError('CALENDAR_SELF');
    const projection=await readCalendar(storage,other,range,{signal,connectionsOnly:true,includeConnections:false,includeSources:false});
    if((await readAccess(connected.root)).etag!==connected.etag){await clearVault(connected.vault);service.connections.delete(entity.id);throw new AppError('CALENDAR_LOCKED');}
    entry.connected=connected;entry.storage=storage;entry.book=other;entry.revision=projection.revision;entry.scopeVersion=calendarScopeVersion(other);plan.grants.push({vault:connected.vault});source.checkedAt=new Date().toISOString();versions.set(entity.id,[other.id,projection.revision,entry.scopeVersion,connected.etag]);
   }
  }catch(error){check(service,plan,signal);calendarSourceError(source,error);versions.set(entity.id,['unavailable',source.error]);}
 };
 const queue=[...plan.sources];let failure;await Promise.all(Array.from({length:Math.min(4,queue.length)},async()=>{while(queue.length&&!failure){try{await collect(queue.shift());}catch(error){failure=error;}}}));if(failure)throw failure;
 check(service,plan,signal);plan.version=digest(JSON.stringify([...versions].sort(([a],[b])=>a.localeCompare(b))));return plan;
}
export async function verifyCalendarSourcePlan(service,plan,{signal}={}){
 check(service,plan,signal);const latest=await service.read(plan.workspace,plan.book,plan.range,{signal,connectionsOnly:true});
 if(latest.revision!==plan.snapshot.revision||calendarScopeVersion((await plan.workspace.outline()).metadata)!==plan.scopeVersion||JSON.stringify(latest.connections)!==JSON.stringify(plan.snapshot.connections))throw new AppError('CALENDAR_CURSOR');
 for(const entry of plan.sources){
  check(service,plan,signal);const {entity,connected,cached}=entry;
  if(entity.type==='subscription'){
   const current=service.cache.get(entity.id);if(current?.hash!==cached?.hash||current?.error!==cached?.error||current?.url!==cached?.url)throw new AppError('CALENDAR_CURSOR');
  }else if(connected){
   if(service.connections.get(entity.id)!==connected||(await readAccess(connected.root)).etag!==connected.etag){
    // A query builder can own the cache being retired. Zero/abort immediately;
    // its enclosing cache boundary drains after the producer has unwound.
    void clearVault(connected.vault);if(service.connections.get(entity.id)===connected)service.connections.delete(entity.id);throw new AppError('CALENDAR_LOCKED');
   }
   const {metadata:book}=await entry.storage.outline(),projection=await readCalendar(entry.storage,book,plan.range,{signal,connectionsOnly:true,includeConnections:false,includeSources:false});
   if((await readAccess(connected.root)).etag!==connected.etag){void clearVault(connected.vault);if(service.connections.get(entity.id)===connected)service.connections.delete(entity.id);throw new AppError('CALENDAR_LOCKED');}
   if(book.id!==connected.workspaceId||calendarScopeVersion(book)!==entry.scopeVersion||projection.revision!==entry.revision)throw new AppError('CALENDAR_CURSOR');
  }
 }
 check(service,plan,signal);
}
