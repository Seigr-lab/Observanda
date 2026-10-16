import path from 'node:path';
import {Workspace} from '../storage.js';
import {readAccess} from '../access.js';
import {clearVault} from '../encryption.js';
import {readCalendar} from './reader.js';
import {uuid,date} from '../modules/validation.js';
import {ownerLabel} from '../web/modules/scope.js';
import {calendarWindow} from './window.js';
import {fetchCalendar} from './fetch.js';
import {parseFeed} from './parse.js';
import {AppError} from '../errors.js';
import {digest} from '../storage-format.js';
export const calendarScopeVersion=book=>digest(JSON.stringify([book.id,book.title,book.projects]));
export class CalendarSources{
 constructor({fetch=fetchCalendar,parse=parseFeed,read=readCalendar}={}){this.read=read;this.fetch=fetch;this.parse=parse;this.connections=new Map();this.cache=new Map();this.generation=0;}
 clear(){this.generation++;for(const c of this.connections.values())clearVault(c.vault);this.connections.clear();this.cache.clear();}
 async unlock(entity,credentials,authenticate){
  const generation=this.generation,root=path.resolve(entity.data.path),access=await readAccess(root);
  const vault=await authenticate(root,access,credentials.username??'',credentials.password??'',credentials.recovery??'');
  try{
   const workspace=new Workspace(root,vault),{metadata:book}=await workspace.outline();
   if(this.generation!==generation||(await readAccess(root)).etag!==access.etag)throw new AppError('WORKSPACE_CHANGED');
   const old=this.connections.get(entity.id);if(old)clearVault(old.vault);
   this.connections.set(entity.id,{vault,root,etag:access.etag,workspaceId:book.id});return book.title;
  }catch(e){clearVault(vault);throw e;}
 }
 reconcile(entities,{partial=false}={}){
  for(const [id,c] of this.connections){const e=entities.find(e=>e.id===id);if(partial&&!e)continue;if(!e?.data.enabled||path.resolve(e.data.path)!==c.root){clearVault(c.vault);this.connections.delete(id);}}
  for(const [id,c] of this.cache){const e=entities.find(e=>e.id===id);if(partial&&!e)continue;if(!e?.data.enabled||e.data.url!==c.url)this.cache.delete(id);}
 }
 async detail(workspace,{sourceId,eventId,range},{signal}={}){
  if(!uuid(sourceId)||typeof eventId!=='string'||!eventId||eventId.length>8192||!range||!date(range.from)||!date(range.to)||range.from>=range.to||Date.parse(range.to)-Date.parse(range.from)>93*86400000)throw new AppError('INVALID');
  try{new Intl.DateTimeFormat('en',{timeZone:range.timeZone??'UTC'});}catch{throw new AppError('INVALID');}
  let event;const result=await this.data(workspace,range,{signal,detail:{sourceId,eventId},emit:value=>{if(value.sourceId===sourceId&&value.id===eventId)event=value;}}),source=result.sources.find(s=>s.id===sourceId);
  if(source?.locked)throw new AppError('CALENDAR_LOCKED');if(source?.error)throw new AppError('CALENDAR_FORMAT');
  if(!event)throw new AppError('NOT_FOUND');return {event};
 }
 async data(workspace,range,{refresh=false,detail=null,signal,emit=null,serial=false,emitSource=null,eventSources=false}={}){
  const generation=this.generation,{metadata:book}=await workspace.outline(),snapshot=await this.read(workspace,book,range,{signal,emit,emitSource,eventSources,detailId:detail?.eventId??null}),result={sources:snapshot.sources,events:snapshot.events,scopeVersion:calendarScopeVersion(book)},versions=new Map([['scope',calendarScopeVersion(book)],['local',snapshot.revision]]),matches=calendarWindow(range);
  const live=new Set(snapshot.connections.map(e=>e.id));
  for(const [id,c] of this.connections)if(!live.has(id)){clearVault(c.vault);this.connections.delete(id);}
  for(const id of this.cache.keys())if(!live.has(id))this.cache.delete(id);
  const queue=snapshot.connections.filter(e=>!detail||detail.sourceId===e.id);
  const collect=async entity=>{
   let emitted=false;
   const d=entity.data,source={id:entity.id,name:d.name,color:d.color,projectId:d.projectId,owner:ownerLabel(book,d.projectId),readOnly:true,kind:entity.type};
   result.sources.push(source);
   try{
    let events=[];
    if(entity.type==='subscription'){
     let cached=this.cache.get(entity.id);
     if(refresh||!cached||cached.url!==d.url||Date.now()-cached.at>300000){
      const text=await this.fetch(d.url,{signal});cached={url:d.url,text,hash:digest(text),at:Date.now()};
      if(this.generation!==generation)throw new AppError('ACCESS_LOCKED');
      this.cache.set(entity.id,cached);
     }
     events=(await this.parse(cached.text,range,{signal})).map(e=>{const {notes,...summary}=e;return e.id===detail?.eventId?e:summary;});source.checkedAt=new Date(cached.at).toISOString();versions.set(entity.id,cached.hash);
    }else{
     const connected=this.connections.get(entity.id);
     if(!connected||connected.root!==path.resolve(d.path))throw new AppError('CALENDAR_LOCKED');
     if((await readAccess(connected.root)).etag!==connected.etag){clearVault(connected.vault);this.connections.delete(entity.id);throw new AppError('CALENDAR_LOCKED');}
     const ws=new Workspace(connected.root,connected.vault),{metadata:other}=await ws.outline();
     if(other.id!==connected.workspaceId||other.id===book.id)throw new AppError('CALENDAR_SELF');
     const detailId=detail?.eventId.startsWith(other.id+':')?detail.eventId.slice(other.id.length+1):null;
     const projected=await readCalendar(ws,other,range,{signal,detailId,includeConnections:false,includeSources:false,emit:emit?e=>{emitted=true;emit({...e,id:other.id+':'+e.id,origin:ownerLabel(other,e.projectId),sourceId:source.id,projectId:d.projectId,readOnly:true,...(eventSources?{source}: {})});}:null});
     if((await readAccess(connected.root)).etag!==connected.etag){clearVault(connected.vault);this.connections.delete(entity.id);throw new AppError('CALENDAR_LOCKED');}
     if(emit&&calendarScopeVersion((await ws.outline()).metadata)!==calendarScopeVersion(other))throw new AppError('CALENDAR_CURSOR');
     events=projected.events.map(e=>({...e,id:other.id+':'+e.id,origin:ownerLabel(other,e.projectId)}));source.checkedAt=new Date().toISOString();versions.set(entity.id,[other.id,projected.revision,calendarScopeVersion(other),connected.etag]);
    }
    signal?.throwIfAborted();if(this.generation!==generation)throw new AppError('ACCESS_LOCKED');
    for(const e of events){if(!matches(e))continue;const value={...e,sourceId:source.id,projectId:d.projectId,readOnly:true,...(eventSources?{source}: {})};if(emit)emit(value);else result.events.push(value);}
   }catch(error){if(signal?.aborted||emitted)throw error;source.error=error instanceof AppError?error.message:'Calendar could not refresh.';source.locked=error.code==='CALENDAR_LOCKED';versions.set(entity.id,['unavailable',source.error]);}
  };
  let failure;
  await Promise.all(Array.from({length:Math.min(serial?1:4,queue.length)},async()=>{while(queue.length&&!failure){if(this.generation!==generation)return;try{await collect(queue.shift());}catch(error){failure=error;}}}));
  if(failure)throw failure;
  // Recheck access and source settings after asynchronous network reads.
  const latest=await this.read(workspace,book,range,{signal,connectionsOnly:true}),allowed=new Map(latest.connections.filter(e=>live.has(e.id)).map(e=>[e.id,e]));
  if(emit&&(latest.revision!==snapshot.revision||calendarScopeVersion((await workspace.outline()).metadata)!==result.scopeVersion))throw new AppError('CALENDAR_CURSOR');
  for(const s of result.sources.filter(s=>s.readOnly)){
   const before=snapshot.connections.find(e=>e.id===s.id),after=allowed.get(s.id);
   if(!after||JSON.stringify(before.data)!==JSON.stringify(after.data)){
    if(emit)throw new AppError('CALENDAR_CURSOR');
    result.events=result.events.filter(e=>e.sourceId!==s.id);s.error='This source changed. Refresh the calendar.';this.cache.delete(s.id);
    const c=this.connections.get(s.id);if(c){clearVault(c.vault);this.connections.delete(s.id);}
   }
   if(emitSource)await emitSource(s);
  }
  signal?.throwIfAborted();if(this.generation!==generation)throw new AppError('ACCESS_LOCKED');
  result.events=result.events.filter(matches);result.version=digest(JSON.stringify([...versions].sort(([a],[b])=>a.localeCompare(b))));result.workspaceId=book.id;
  return result;
 }
}
