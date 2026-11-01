import path from 'node:path';
import {Workspace} from '../storage.js';
import {readAccess} from '../access.js';
import {clearVault} from '../encryption.js';
import {readCalendar} from './reader.js';
import {uuid,date} from '../modules/validation.js';
import {ownerLabel,ownerDescriptor} from '../web/modules/scope.js';
import {calendarWindow} from './window.js';
import {fetchCalendar} from './fetch.js';
import {parseFeed} from './parse.js';
import {AppError} from '../errors.js';
import {calendarSourcePlan,verifyCalendarSourcePlan,calendarSourceError} from './source-plan.js';
import {retireQueryCacheScope} from '../query-cache-scope.js';
export {calendarScopeVersion} from './source-plan.js';
export class CalendarSources{
 constructor({fetch=fetchCalendar,parse=parseFeed,read=readCalendar}={}){this.read=read;this.fetch=fetch;this.parse=parse;this.connections=new Map();this.cache=new Map();this.generation=0;}
 clear(){this.generation++;const draining=[retireQueryCacheScope(this),...Array.from(this.connections.values(),c=>clearVault(c.vault))];this.connections.clear();this.cache.clear();const closed=Promise.all(draining);void closed.catch(()=>{});return closed;}
 async unlock(entity,credentials,authenticate){
  const generation=this.generation,root=path.resolve(entity.data.path),access=await readAccess(root);
  const vault=await authenticate(root,access,credentials.username??'',credentials.password??'',credentials.recovery??'');
  try{
   const workspace=new Workspace(root,vault),{metadata:book}=await workspace.outline();
   if(this.generation!==generation||(await readAccess(root)).etag!==access.etag)throw new AppError('WORKSPACE_CHANGED');
   const old=this.connections.get(entity.id);if(old)await clearVault(old.vault);
   this.connections.set(entity.id,{vault,root,etag:access.etag,workspaceId:book.id});return book.title;
  }catch(e){await clearVault(vault);throw e;}
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
 prepare(workspace,range,options){return calendarSourcePlan(this,workspace,range,options);}
 verify(plan,options){return verifyCalendarSourcePlan(this,plan,options);}
 async data(workspace,range,{refresh=false,detail=null,signal,emit=null,serial=false,emitSource=null,eventSources=false,prepared=null}={}){
  const plan=prepared??await this.prepare(workspace,range,{refresh,detail,signal}),generation=this.generation;
  if(plan.service!==this||plan.workspace!==workspace||JSON.stringify(plan.range)!==JSON.stringify(range))throw new AppError('INVALID');
  const check=()=>{signal?.throwIfAborted();if(this.generation!==generation||plan.generation!==generation)throw new AppError('ACCESS_LOCKED');};check();
  const project=emit?async event=>{check();await emit(event);check();}:null;
  const snapshot=await this.read(workspace,plan.book,range,{signal,emit:project,emitSource,eventSources,detailId:detail?.eventId??null});
  if(snapshot.revision!==plan.snapshot.revision)throw new AppError('CALENDAR_CURSOR');
  const result={sources:snapshot.sources,events:snapshot.events,scopeVersion:plan.scopeVersion},matches=calendarWindow(range),queue=[...plan.sources];
  const collect=async entry=>{
   const {entity,connected,storage,book:other}=entry,d=entity.data,source={...entry.source};let emitted=false;result.sources.push(source);
   if(source.error){if(emitSource)await emitSource(source);return;}
   try{
    let events=[];
    if(entity.type==='subscription')events=(await this.parse(entry.cached.text,range,{signal})).map(event=>{const {notes,...summary}=event;return event.id===detail?.eventId?event:summary;});
    else{
     if(this.connections.get(entity.id)!==connected||(await readAccess(connected.root)).etag!==connected.etag)throw new AppError('CALENDAR_LOCKED');
     const detailId=detail?.eventId.startsWith(other.id+':')?detail.eventId.slice(other.id.length+1):null;
     const projected=await readCalendar(storage,other,range,{signal,detailId,includeConnections:false,includeSources:false,emit:project?async event=>{emitted=true;await project({...event,id:other.id+':'+event.id,origin:ownerLabel(other,event.projectId),originDisplay:ownerDescriptor(other,event.projectId),sourceId:source.id,projectId:d.projectId,readOnly:true,...(eventSources?{source}: {})});}:null});
     if(projected.revision!==entry.revision)throw new AppError('CALENDAR_CURSOR');
     events=projected.events.map(event=>({...event,id:other.id+':'+event.id,origin:ownerLabel(other,event.projectId),originDisplay:ownerDescriptor(other,event.projectId)}));
    }
    check();for(const event of events){if(!matches(event))continue;const value={...event,sourceId:source.id,projectId:d.projectId,readOnly:true,...(eventSources?{source}: {})};if(project){emitted=true;await project(value);}else result.events.push(value);}
   }catch(error){check();if(emitted)throw error;calendarSourceError(source,error);}
   if(emitSource)await emitSource(source);
  };
  let failure;await Promise.all(Array.from({length:Math.min(serial?1:4,queue.length)},async()=>{while(queue.length&&!failure){try{await collect(queue.shift());}catch(error){failure=error;}}}));if(failure)throw failure;
  await this.verify(plan,{signal});check();result.events=result.events.filter(matches);result.version=plan.version;result.workspaceId=plan.book.id;return result;
 }
}
