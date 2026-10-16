import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {readPlanningTask} from './planning-task-reader.js';
import {exact,uuid} from './modules/validation.js';
import {validTaskConstraintDraft,taskDependencyReference,sameTaskReference} from './web/task-prerequisite-model.js';

const unavailable=new Set(['NOT_FOUND','PROJECT_DELETED','PROJECT_MOVED','LAB_BOOK_DELETED','ACCESS_LOCKED','ACCESS_DENIED','ACCESS_WAIT','AUTH','DEVICE_UNKNOWN','TASK_PREREQUISITE_UNSUPPORTED']);
export async function planningTaskReadiness(storage,namespaceId,command,{sourceAccess,check=async()=>{},signal}={}){
 if(!exact(command,['workspaceId','id','expectedRevision','data','offset','limit'])||command.workspaceId!==namespaceId||!uuid(command.id)||command.expectedRevision!==null&&(!Number.isSafeInteger(command.expectedRevision)||command.expectedRevision<1)||!validTaskConstraintDraft(command.data,namespaceId)||!Number.isSafeInteger(command.offset)||command.offset<0||command.offset>command.data.dependencies.length||!Number.isSafeInteger(command.limit)||command.limit<1||command.limit>25)throw new AppError('INVALID');
 const {id,data,expectedRevision,offset,limit}=command;let access=null,previous=null,failure;
 const active=async()=>{signal?.throwIfAborted();await check();};
 try{
  await active();
  try{previous=await readPlanningTask(storage,{workspaceId:namespaceId,type:'task',id});}catch(error){if(error.code!=='NOT_FOUND')throw error;}
  if((previous?.revision??null)!==expectedRevision)throw new AppError('MODULE_CHANGED',[{field:id}]);
  const observations=previous?.constraint.data.prerequisiteObservations??[],items=[];
  for(const dependency of data.dependencies.slice(offset,offset+limit)){
   await active();const reference=taskDependencyReference(dependency,namespaceId),observed=observations.find(value=>sameTaskReference(value.reference,reference));
   try{
    let selected;
    if(sourceAccess){access??=await sourceAccess(namespaceId,{signal});selected=await access.read(reference,{label:true});}
    else{if(reference.workspaceId!==namespaceId)throw new AppError('TASK_PREREQUISITE_ACCESS');selected=await readPlanningTask(storage,reference,{label:true});}
    const item={reference,status:'available',...(selected.owner?{owner:selected.owner}:{}),title:selected.title,taskStatus:selected.constraint.data.status,revision:selected.revision};
    if(observed){item.observedRevision=observed.revision;item.changed=!sameTaskReference(observed.canonicalReference,selected.reference)||observed.revision!==selected.revision||observed.hash!==selected.hash||observed.constraintHash!==selected.constraintHash;}
    items.push(item);
   }catch(error){
    if(!unavailable.has(error.code))throw error;
    items.push({reference,status:'unavailable',code:error.code,...(error.projectId?{projectId:error.projectId}:{}),...(error.labBookId?{labBookId:error.labBookId}:{}),...(observed?{observedRevision:observed.revision}:{} )});
   }
  }
  await active();await access?.verify();const total=data.dependencies.length,next=offset+items.length;
  return {workspaceId:namespaceId,id,draftFingerprint:digest(serialize([namespaceId,id,expectedRevision,data,offset,limit])),scope:'page',total,offset,checked:items.length,previousOffset:offset?Math.max(0,offset-limit):null,nextOffset:next<total?next:null,items};
 }catch(error){failure=error;throw error;}finally{try{await access?.close();}catch(error){if(!failure)throw error;}}
}
