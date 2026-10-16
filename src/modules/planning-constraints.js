import {localTaskDependency,validTaskObservations,sameTaskConstraintDraft,sameTaskObservations} from '../web/task-prerequisite-model.js';
import {withScratch} from '../scratch-work.js';
import {scratchOrder} from '../scratch-order.js';
import {requireValue} from './validation.js';
export const planningConstraintTypes=['task','booking','resource'];
const edgePageSize=32;
const blocked='Complete checklist and dependencies before finishing this task';
function sameTaskConstraints(previous,current){return previous?.type==='task'&&sameTaskConstraintDraft(previous.data,current.data)&&sameTaskObservations(previous.data,current.data);}
async function validateTasks(source,work){
 const edgeKey=(id,page)=>'edges:'+id+':'+page;
 async function enter(task,parent){
  requireValue(task?.type==='task','Task dependency');
  const {id,data}=task;requireValue(validTaskObservations(data,source.workspaceId),'Task prerequisite observations');
  if(data.status==='done')requireValue(data.checklist.every(c=>c.done),blocked,'TASK_BLOCKED');
  // Stage each local adjacency once per traversal. Foreign observations are
  // retained evidence; integrity never opens or imports their source owners.
  let first=[],page=[],pages=[],total=0;
  for(const dependency of data.dependencies)if(localTaskDependency(dependency,source.workspaceId)){
   page.push(typeof dependency==='string'?dependency:dependency.id);total++;
   if(page.length===edgePageSize){
    if(total===edgePageSize)first=page;else pages.push([edgeKey(id,total/edgePageSize-1),page]);
    page=[];if(pages.length===32){await work.putMany(pages);pages=[];}
   }
  }
  if(total<edgePageSize)first=page;
  else if(page.length)pages.push([edgeKey(id,Math.floor(total/edgePageSize)),page]);
  await work.putMany(pages);await work.put('task:'+id,{status:data.status,done:total===0});
  if(!total)return null;
  return {id,parent,status:data.status,total,page:0,offset:0,dependencies:first};
 }
 for await(const initial of source.all('task')){
  requireValue(validTaskObservations(initial.data,source.workspaceId),'Task prerequisite observations');
  if(!initial.data.dependencies.length){
   if(initial.data.status==='done')requireValue(initial.data.checklist.every(c=>c.done),blocked,'TASK_BLOCKED');
   continue;
  }
  if(await work.has('task:'+initial.id))continue;
  let frame=await enter(initial,null);
  while(frame){
   if(frame.offset===frame.dependencies.length&&(frame.page+1)*edgePageSize<frame.total){
    const key=edgeKey(frame.id,++frame.page);frame.dependencies=await work.get(key);frame.offset=0;
    requireValue(Array.isArray(frame.dependencies)&&frame.dependencies.length>0,'Task traversal state');await work.remove(key);
   }
   if(frame.offset<frame.dependencies.length){
    const dependency=frame.dependencies[frame.offset++],known=await work.get('task:'+dependency);
    if(known){
     if(frame.status==='done')requireValue(known.status==='done',blocked,'TASK_BLOCKED');
     requireValue(known.done,'Task dependencies form a cycle');
     continue;
    }
    const target=await source.get(dependency);requireValue(target?.type==='task','Task dependency');
    if(frame.status==='done')requireValue(target.data.status==='done',blocked,'TASK_BLOCKED');
    const child=await enter(target,frame.id);
    if(child){await work.put('frame:'+frame.id,frame);frame=child;}
   }else{
    await work.put('task:'+frame.id,{status:frame.status,done:true});
    const parent=frame.parent;await work.remove('frame:'+frame.id);frame=parent===null?null:await work.get('frame:'+parent);
    requireValue(parent===null||!!frame,'Task traversal state');
   }
  }
 }
}
export async function validatePlanningSource(source){
 await withScratch(async work=>{
  const changes=source.changes;let tasksNeeded=!changes;const resources=changes&&new Set();
  if(changes)for(const entity of changes.values()){
   if(entity.type==='task'&&!tasksNeeded)tasksNeeded=!sameTaskConstraints(await source.previous?.(entity.id),entity);
   if(entity.type==='booking'){resources.add(entity.data.resourceId);const old=await source.previous(entity.id);if(old)resources.add(old.data.resourceId);}
   if(entity.type==='resource'){const old=await source.previous(entity.id);if(old&&(old.data.kind!==entity.data.kind||old.data.capacity!==entity.data.capacity))resources.add(entity.id);}
  }
  // Only a current authenticated projection can prove that an edit leaves the
  // constraints unchanged. Audits and semantic edits still check every root,
  // including completed dependents whose prerequisites have been reopened.
  if(tasksNeeded)await validateTasks(source,work);
  if(resources&&!resources.size)return;
  await work.clear();const events=scratchOrder(work,'bookings:');
  for await(const {id,data:d} of source.all('booking'))if(d.status==='confirmed'&&(!resources||resources.has(d.resourceId))){
   const resource=await source.get(d.resourceId);requireValue(resource?.type==='resource'&&resource.data.kind==='equipment','Booked equipment');
   const places=String(d.kind==='maintenance'?resource.data.capacity:d.places),capacity=String(resource.data.capacity);
   await events.put(d.resourceId+':'+d.startsAt+':1:'+id,{resourceId:d.resourceId,delta:places,capacity});
   await events.put(d.resourceId+':'+d.endsAt+':0:'+id,{resourceId:d.resourceId,delta:'-'+places,capacity});
  }
  let previous=null,occupied=0n;
  for await(const event of events.items()){
   if(event.resourceId!==previous){previous=event.resourceId;occupied=0n;}
   occupied+=BigInt(event.delta);requireValue(occupied<=BigInt(event.capacity),'Equipment already booked during this period','BOOKING_CONFLICT');
  }
 });
}
