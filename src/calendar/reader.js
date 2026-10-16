import {moduleDomainContext} from '../module-domain-context.js';
import {operationalReadDomains} from '../project-module-read-context.js';
import {ModuleCatalogue} from '../modules/catalogue.js';
import {workspaceModules} from '../modules/index.js';
import {calendarFacts} from './facts.js';
import {calendarEntity} from '../web/modules/calendar-model.js';
import {ownerLabel} from '../web/modules/scope.js';
import {calendarWindow} from './window.js';
import {AppError} from '../errors.js';
import {proseText} from '../web/prose-model.js';
import {withScratch} from '../scratch-work.js';
const sourceTypes=['subscription','calendar-connection'];
export async function readCalendar(workspace,book,range,{detailId=null,connectionsOnly=false,includeConnections=true,signal,emit=null,emitSource=null,eventSources=false,includeSources=true,context=null}={}){
 const project=async(head,members,facts,original,parent)=>withScratch(async seen=>{
  const sources=[],events=[],connections=[],matches=calendarWindow(range),cache=new Map();
  async function projectEntity(value){
   const id=value.data.calendarId??value.data.resourceId,parents=new Map();
   if(id){
    let item=cache.get(id);if(!cache.has(id)){item=await parent(id);if(cache.size>=128)cache.delete(cache.keys().next().value);cache.set(id,item);}
    if(!item)throw new AppError('CATALOGUE_DAMAGED');parents.set(id,item);
   }
   let source;
   const event=calendarEntity(book,value,parents,(id,name,color,projectId)=>{source={id,name,color,projectId,owner:ownerLabel(book,projectId),readOnly:false};return id;});
   if(source&&includeSources&&await seen.add(source.id)){if(emitSource)await emitSource(source);else sources.push(source);}
   return event&&eventSources?{...event,source}:event;
  }
  for await(const member of members()){
   signal?.throwIfAborted();
   if(member.type&&!(includeConnections&&sourceTypes.includes(member.type))&&(connectionsOnly||member.type!=='calendar'))continue;
   const value=await facts(member);if(!value)continue;
   if(sourceTypes.includes(value.type)){if(includeConnections&&value.data.enabled){if(connections.length>=30)throw new AppError('CATALOGUE_DAMAGED');connections.push(await original(member.id));}}
   else if(!connectionsOnly&&value.type==='calendar')await projectEntity(value);
  }
  if(!connectionsOnly)for await(const member of members()){
   signal?.throwIfAborted();if(member.type&&!['task','event','booking'].includes(member.type))continue;
   const value=await facts(member);if(!value||!['task','event','booking'].includes(value.type))continue;
   const event=await projectEntity(value);if(!event||!matches(event))continue;
   if(event.id===detailId)event.notes=proseText((await original(member.id)).data.notes??'');
   if(emit)emit(event);else events.push(event);
  }
  return {workspaceId:book.id,revision:head.revision,sources,events,connections};
 },{signal});
 if(context)return project(context.head,()=>context.members({signal}),m=>context.calendar(m),id=>context.selected(id),async id=>{const member=await context.member(id);return member?context.calendar(member):null;});
 if(await workspace.storageKind()==='catalogue')return workspace.catalogue(async store=>{
  if((await store.snapshot()).metadata.id!==book.id)throw new AppError('WORKSPACE_CHANGED');
  const owned=await moduleDomainContext(store,c=>project(c.head,()=>c.members({signal}),m=>c.calendar(m),id=>c.selected(id),async id=>{const member=await c.member(id);return member?c.calendar(member):null;}),{domains:operationalReadDomains.planning});if(owned)return owned.value;
  const c=new ModuleCatalogue(store),head=await c.head(book.id);
  return project(head,()=>c.members(head,{signal}),m=>c.calendar(head,m),id=>c.selected(head,id),async id=>{const member=await c.member(head,id);return member?c.calendar(head,member):null;});
 });
 const data=await workspaceModules(workspace).current(book);
 return project(data,()=>data.entities,async e=>calendarFacts(e),async id=>data.entities.find(e=>e.id===id),async id=>{const entity=data.entities.find(e=>e.id===id);return entity?calendarFacts(entity):null;});
}
