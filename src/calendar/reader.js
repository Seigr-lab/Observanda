import {moduleDomainContext} from '../module-domain-context.js';
import {operationalReadDomains} from '../project-module-read-context.js';
import {ModuleCatalogue} from '../modules/catalogue.js';
import {workspaceModules} from '../modules/index.js';
import {calendarFacts} from './facts.js';
import {calendarEntity} from '../web/modules/calendar-model.js';
import {ownerLabel,ownerDescriptor} from '../web/modules/scope.js';
import {calendarWindow} from './window.js';
import {AppError} from '../errors.js';
import {proseText} from '../web/prose-model.js';
import {withScratch} from '../scratch-work.js';
import {ModuleBrowseIndex} from '../modules/browse-index.js';
const sourceTypes=['subscription','calendar-connection'];
async function* typedMembers(context,types,signal,indexed=true){
 if(!types.length)return;const plans=indexed?await context.browse?.({types,sort:'title',signal}):null;
 if(plans){for(const plan of plans)for await(const view of plan.rows()){signal?.throwIfAborted();const member=await context.member(view.id);if(!member)throw new AppError('CATALOGUE_DAMAGED');yield member;}return;}
 for await(const member of context.members({signal,types}))if(!member.type||types.includes(member.type))yield member;
}
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
   const event=calendarEntity(book,value,parents,(id,name,color,projectId)=>{source={id,name,color,projectId,owner:ownerLabel(book,projectId),ownerDisplay:ownerDescriptor(book,projectId),readOnly:false};return id;});
   if(source&&includeSources&&await seen.add(source.id)){if(emitSource)await emitSource(source);else sources.push(source);}
   return event&&eventSources?{...event,source}:event;
  }
  for await(const member of members([...(includeConnections?sourceTypes:[]),...(!connectionsOnly&&includeSources?['calendar']:[])])){
   signal?.throwIfAborted();
   if(member.type&&!(includeConnections&&sourceTypes.includes(member.type))&&(connectionsOnly||member.type!=='calendar'))continue;
   const value=await facts(member);if(!value)continue;
   if(sourceTypes.includes(value.type)){if(includeConnections&&value.data.enabled){if(connections.length>=30)throw new AppError('CATALOGUE_DAMAGED');connections.push(await original(member.id));}}
   else if(!connectionsOnly&&value.type==='calendar')await projectEntity(value);
  }
  if(!connectionsOnly)for await(const member of members(['task','event','booking'],false)){
   signal?.throwIfAborted();if(member.type&&!['task','event','booking'].includes(member.type))continue;
   const value=await facts(member);if(!value||!['task','event','booking'].includes(value.type))continue;
   const event=await projectEntity(value);if(!event||!matches(event))continue;
   if(event.id===detailId)event.notes=proseText((await original(member.id)).data.notes??'');
   if(emit)await emit(event);else events.push(event);
  }
  return {workspaceId:book.id,revision:head.revision,sources,events,connections};
 },{signal});
 if(context)return project(context.head,(types,indexed)=>typedMembers(context,types,signal,indexed),m=>context.calendar(m),id=>context.selected(id),async id=>{const member=await context.member(id);return member?context.calendar(member):null;});
 if(await workspace.storageKind()==='catalogue')return workspace.catalogue(async store=>{
  if((await store.snapshot()).metadata.id!==book.id)throw new AppError('WORKSPACE_CHANGED');
  const owned=await moduleDomainContext(store,c=>project(c.head,(types,indexed)=>typedMembers(c,types,signal,indexed),m=>c.calendar(m),id=>c.selected(id),async id=>{const member=await c.member(id);return member?c.calendar(member):null;}),{domains:operationalReadDomains.planning});if(owned)return owned.value;
  const c=new ModuleCatalogue(store),head=await c.head(book.id);
  const context={members:options=>c.members(head,options),member:id=>c.member(head,id),browse:async options=>{const plan=await new ModuleBrowseIndex(c).plan(head,options);return plan?[plan]:null;}};
  return project(head,(types,indexed)=>typedMembers(context,types,signal,indexed),m=>c.calendar(head,m),id=>c.selected(head,id),async id=>{const member=await c.member(head,id);return member?c.calendar(head,member):null;});
 });
 const data=await workspaceModules(workspace).current(book);
 async function* members(types){for(const member of data.entities)if(types.includes(member.type))yield member;}
 return project(data,members,async e=>calendarFacts(e),async id=>data.entities.find(e=>e.id===id),async id=>{const entity=data.entities.find(e=>e.id===id);return entity?calendarFacts(entity):null;});
}
