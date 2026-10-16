import path from 'node:path';
import {CalendarSources,calendarScopeVersion} from './calendar/service.js';
import {calendarPage} from './calendar/pages.js';
import {readCalendar} from './calendar/reader.js';
import {ProjectModuleReader} from './project-module-reader.js';
import {ModuleReader} from './modules/reader.js';
import {readProjectDomainRegistry} from './project-domain-registry.js';
import {operationalReadDomains} from './project-module-read-context.js';
import {AppError} from './errors.js';
export const projectCalendarRequest=route=>['/api/calendars/page','/api/calendars/event','/api/calendars/unlock'].includes(route)?{write:false,limit:65536,calendar:route.split('/').at(-1)}:null;
async function calendarReader(storage,namespaceId,signal){
 const managed=await storage.catalogue(async store=>(await readProjectDomainRegistry(store))?.commandVersion===1);
 if(!managed)return new ModuleReader(storage);
 const reader=new ProjectModuleReader(storage,namespaceId);
 return {context:(id,operation)=>reader.context(id,operation,{domains:operationalReadDomains.planning,signal}),selected:(data,options)=>reader.selected(data,options)};
}
async function readProjectCalendar(storage,book,range,options){
 const reader=await calendarReader(storage,book.id,options.signal);
 return reader.context(book.id,context=>{
  if(calendarScopeVersion(book)!==calendarScopeVersion(context.book))throw new AppError('CALENDAR_CURSOR');
  return readCalendar(storage,book,range,{...options,context});
 });
}
// Source credentials and feed caches belong to one authenticated project/client
// pair. They are invalidated with that project's access and never shared globally.
export class ProjectCalendars{
 constructor(options={}){this.options=options;this.sessions=new WeakMap();this.owners=new Set();}
 forget(session,id){const entries=this.sessions.get(session),entry=entries?.get(id);if(entry){entry.sources.clear();this.owners.delete(entry);entries.delete(id);}}
 invalidateProject(projectId){for(const entry of this.owners)if(entry.projectId===projectId){entry.sources.clear();this.owners.delete(entry);entry.closed=true;}}
 expire(now=Date.now()){for(const entry of this.owners)if(entry.expires<=now){entry.sources.clear();this.owners.delete(entry);entry.closed=true;}}
 clear(){for(const entry of this.owners)entry.sources.clear();this.owners.clear();this.sessions=new WeakMap();}
 invalidateBook(projectId,labBookId){const id='book:'+projectId+':'+labBookId;for(const entry of this.owners)if(entry.id===id){entry.sources.clear();this.owners.delete(entry);entry.closed=true;}}
 owner(session,storage,etag,{ownerId=storage.projectId,projectId=storage.projectId}={}){
  let entries=this.sessions.get(session);if(!entries){entries=new Map();this.sessions.set(session,entries);}
  let entry=entries.get(ownerId);
  if(entry&&(entry.closed||entry.root!==storage.root||entry.etag!==etag||entry.expires<=Date.now())){this.forget(session,ownerId);entry=null;}
  if(!entry){entry={id:ownerId,projectId,root:storage.root,etag,sources:new CalendarSources({...this.options,read:readProjectCalendar})};entries.set(ownerId,entry);this.owners.add(entry);}
  entry.expires=Date.now()+8*60*60*1000;return entry.sources;
 }
 reconcile(session,id,entities){this.sessions.get(session)?.get(id)?.sources.reconcile(entities,{partial:true});}
 async run(session,storage,etag,method,data,{signal,authenticate,ownerId=storage.projectId,projectId=storage.projectId}={}){
  const {metadata:book}=await storage.outline();if(data?.workspaceId!==book.id)throw new AppError('WORKSPACE_CHANGED');
  const source=this.owner(session,storage,etag,{ownerId,projectId}),reader=await calendarReader(storage,book.id,signal);
  if(method==='page')return calendarPage(storage,source,data,{signal,reader});
  if(method==='event')return source.detail(storage,data,{signal});
  if(method!=='unlock')throw new AppError('INVALID');
  const {entity}=await reader.selected({workspaceId:book.id,id:data.id},{signal});
  if(entity.type!=='calendar-connection'||!entity.data.enabled)throw new AppError('NOT_FOUND');
  if(path.resolve(entity.data.path)===path.resolve(storage.root))throw new AppError('CALENDAR_SELF');
  return {title:await source.unlock(entity,data,authenticate)};
 }
}
