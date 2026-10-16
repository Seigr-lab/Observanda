import {withScratch} from '../scratch-work.js';
import {scratchOrder} from '../scratch-order.js';
import {requireValue} from './validation.js';
export const planningConstraintTypes=['task','booking','resource'];
const edgePageSize=32;
const blocked='Complete checklist and dependencies before finishing this task';
function sameTaskConstraints(previous,current){
 if(previous?.type!=='task')return false;
 const a=previous.data,b=current.data;
 return a.status===b.status&&a.dependencies.length===b.dependencies.length&&a.dependencies.every((id,i)=>id===b.dependencies[i])&&a.checklist.length===b.checklist.length&&a.checklist.every((item,i)=>item.done===b.checklist[i].done);
}
async function validateTasks(source,work){
 const edgeKey=(id,page)=>'edges:'+id+':'+page;
 async function enter(task,parent){
  requireValue(task?.type==='task','Task dependency');
  const {id,data}=task;
  if(data.status==='done')requireValue(data.checklist.every(c=>c.done),blocked,'TASK_BLOCKED');
  await work.put('task:'+id,{status:data.status,done:!data.dependencies.length});
  if(!data.dependencies.length)return null;
  // Stage each adjacency once per traversal. Pending edges and frames live in
  // encrypted scratch storage; neither JS recursion nor a full graph is retained.
  let pages=[];
  for(let offset=edgePageSize;offset<data.dependencies.length;offset+=edgePageSize){
   pages.push([edgeKey(id,offset/edgePageSize),data.dependencies.slice(offset,offset+edgePageSize)]);
   if(pages.length===32){await work.putMany(pages);pages=[];}
  }
  await work.putMany(pages);
  return {id,parent,status:data.status,total:data.dependencies.length,page:0,offset:0,dependencies:data.dependencies.slice(0,edgePageSize)};
 }
 for await(const initial of source.all('task')){
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
