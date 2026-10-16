import {withScratch} from '../scratch-work.js';
import {scratchOrder} from '../scratch-order.js';
import {requireValue} from './validation.js';
export const planningConstraintTypes=['task','booking','resource'];
export async function validatePlanningSource(source){
 await withScratch(async work=>{
  let tasksNeeded=!source.changes;const resources=source.changes&&new Set();
  if(source.changes)for(const entity of source.changes.values()){
   if(entity.type==='task')tasksNeeded=true;
   if(entity.type==='booking'){resources.add(entity.data.resourceId);const old=await source.previous(entity.id);if(old)resources.add(old.data.resourceId);}
   if(entity.type==='resource'){const old=await source.previous(entity.id);if(old&&(old.data.kind!==entity.data.kind||old.data.capacity!==entity.data.capacity))resources.add(entity.id);}
  }
  if(tasksNeeded)
  for await(const initial of source.all('task')){
   if(!initial.data.dependencies.length){
    if(initial.data.status==='done')requireValue(initial.data.checklist.every(c=>c.done),'Complete checklist and dependencies before finishing this task','TASK_BLOCKED');
    continue;
   }
   if(await work.has('done:'+initial.id))continue;
   let frame={id:initial.id,parent:null,offset:0,entered:false};
   while(frame){
    const task=await source.get(frame.id);requireValue(task?.type==='task','Task dependency');
    if(!frame.entered){
     requireValue(!await work.has('visiting:'+frame.id),'Task dependencies form a cycle');
     await work.add('visiting:'+frame.id);frame.entered=true;
     if(task.data.status==='done')requireValue(task.data.checklist.every(c=>c.done),'Complete checklist and dependencies before finishing this task','TASK_BLOCKED');
    }
    const dependency=task.data.dependencies[frame.offset];
    if(dependency!==undefined){
     const target=await source.get(dependency);requireValue(target?.type==='task','Task dependency');
     if(task.data.status==='done')requireValue(target.data.status==='done','Complete checklist and dependencies before finishing this task','TASK_BLOCKED');
     frame.offset++;
     requireValue(!await work.has('visiting:'+dependency),'Task dependencies form a cycle');
     if(await work.has('done:'+dependency))continue;
     await work.put('frame:'+frame.id,frame);frame={id:dependency,parent:frame.id,offset:0,entered:false};
    }else{
     await work.remove('visiting:'+frame.id);await work.add('done:'+frame.id);
     const parent=frame.parent;await work.remove('frame:'+frame.id);frame=parent===null?null:await work.get('frame:'+parent);
     requireValue(parent===null||!!frame,'Task traversal state');
    }
   }
  }
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
