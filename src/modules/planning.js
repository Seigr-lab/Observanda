import {validTaskDependencies,localTaskDependency,validTaskObservations,sameTaskObservations,taskPrerequisiteEffect} from '../web/task-prerequisite-model.js';
import {ownedShape,checkOwner} from './ownership.js';
import {planningConstraintTypes,validatePlanningSource} from './planning-constraints.js';
import {prose} from './validation.js';
import {exact,text,date,instant,uuid,linksValid,linkCheck,requireValue,unique,saved} from './validation.js';
export function validateTask(d,{workspaceId,completion=true}={}){
 requireValue(ownedShape(d,['title','description','status','priority','dueOn','assignees','checklist','dependencies','links',...(Object.hasOwn(d,'prerequisiteObservations')?['prerequisiteObservations']:[])])&&text(d.title,240,true)&&prose(d.description,100000)&&['todo','doing','done','cancelled'].includes(d.status)&&['low','normal','high'].includes(d.priority)&&(d.dueOn===null||date(d.dueOn))&&Array.isArray(d.assignees)&&d.assignees.every(v=>text(v,160,true))&&unique(d.assignees)&&Array.isArray(d.checklist)&&d.checklist.every(c=>exact(c,['id','text','done'])&&uuid(c.id)&&text(c.text,2000,true)&&typeof c.done==='boolean')&&unique(d.checklist.map(c=>c.id))&&validTaskDependencies(d.dependencies,workspaceId)&&linksValid(d.links)&&(!completion||validTaskObservations(d,workspaceId)),'Task details');
}
export function validateBooking(d){
 requireValue(ownedShape(d,['title','resourceId','startsAt','endsAt','timeZone','places','kind','status','notes','links'])&&text(d.title,240,true)&&uuid(d.resourceId)&&instant(d.startsAt)&&instant(d.endsAt)&&d.startsAt<d.endsAt&&text(d.timeZone,80,true)&&Number.isSafeInteger(d.places)&&d.places>0&&['work','maintenance'].includes(d.kind)&&['confirmed','cancelled'].includes(d.status)&&prose(d.notes,100000)&&linksValid(d.links),'Booking details');
 try{new Intl.DateTimeFormat('en',{timeZone:d.timeZone});}catch{requireValue(false,'Time zone');}
}
export function validatePlanning(entities,{workspaceId}={}){
 const tasks=new Map(entities.filter(e=>e.type==='task').map(e=>[e.id,e])),visiting=new Set(),done=new Set();
 function visit(id){
  requireValue(!visiting.has(id),'Task dependencies form a cycle');if(done.has(id))return;
  const t=tasks.get(id);requireValue(!!t,'Task dependency');visiting.add(id);
  requireValue(validTaskObservations(t.data,workspaceId),'Task prerequisite observations');
  for(const dependency of t.data.dependencies)if(localTaskDependency(dependency,workspaceId))visit(typeof dependency==='string'?dependency:dependency.id);
  if(t.data.status==='done')requireValue(t.data.checklist.every(c=>c.done)&&t.data.dependencies.every(value=>!localTaskDependency(value,workspaceId)||tasks.get(typeof value==='string'?value:value.id)?.data.status==='done'),'Complete checklist and dependencies before finishing this task','TASK_BLOCKED');
  visiting.delete(id);done.add(id);
 }
 for(const id of tasks.keys())visit(id);
 const bookings=entities.filter(e=>e.type==='booking'&&e.data.status==='confirmed');
 for(const resourceId of new Set(bookings.map(e=>e.data.resourceId))){
  const resource=entities.find(e=>e.id===resourceId&&e.type==='resource');
  requireValue(resource?.data.kind==='equipment','Booked equipment');
  const capacity=resource.data.capacity,events=bookings.filter(e=>e.data.resourceId===resourceId).flatMap(e=>{
   const places=e.data.kind==='maintenance'?capacity:e.data.places;
   return [{at:e.data.startsAt,delta:places},{at:e.data.endsAt,delta:-places}];
  }).sort((a,b)=>a.at.localeCompare(b.at)||a.delta-b.delta);
  let occupied=0;for(const event of events){occupied+=event.delta;requireValue(occupied<=capacity,'Equipment already booked during this period','BOOKING_CONFLICT');}
 }
}
export const planningDefinitions={
 types:{task:validateTask,booking:validateBooking},
 validate:[validatePlanning],
 constraintTypes:planningConstraintTypes,validateSource:validatePlanningSource,
 commands:{
  async 'task.save'(tx,p){
   const old=saved(tx,p,'task');
   validateTask(p.data,{workspaceId:tx.book.id,completion:false});
   if(Object.hasOwn(p.data,'prerequisiteObservations'))requireValue(old&&sameTaskObservations(old.data,p.data),'Task prerequisite observations are assigned by the server','TASK_PREREQUISITE_CHANGED');
   const {prerequisiteObservations,...authored}=p.data;void prerequisiteObservations;
   checkOwner(tx,authored);await linkCheck(tx,authored.links,old?.data.links);
   const effect=taskPrerequisiteEffect(old,authored,{workspaceId:tx.book.id});let data=authored;
   if(tx.taskPrerequisites)data=await tx.taskPrerequisites.prepare(old,authored,{id:p.id,now:tx.now,workspaceId:tx.book.id});
   else{
    requireValue(!effect.needsAccess||!effect.foreignReferences.length,'Task prerequisite access required','TASK_PREREQUISITE_ACCESS');
    if(authored.status==='done'&&effect.foreignReferences.length&&old?.data.prerequisiteObservations)data={...authored,prerequisiteObservations:structuredClone(old.data.prerequisiteObservations)};
   }
   validateTask(data,{workspaceId:tx.book.id});tx.put('task',p.id,data);
  },
  async 'booking.save'(tx,p){
   const old=saved(tx,p,'booking'),d=p.data;validateBooking(d);checkOwner(tx,d);await linkCheck(tx,d.links,old?.data.links);
   const r=tx.get(d.resourceId);requireValue(r?.type==='resource'&&r.data.kind==='equipment','Equipment');
   if(d.status==='confirmed')requireValue(r.data.status==='available','Equipment is on hold or retired','BOOKING_UNAVAILABLE');
   tx.put('booking',p.id,d);
  }
 }
};
