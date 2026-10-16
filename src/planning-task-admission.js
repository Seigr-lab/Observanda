import {AppError} from './errors.js';
import {readPlanningTask} from './planning-task-reader.js';
import {withPlanningTaskLeases} from './planning-task-leases.js';
import {evaluateTaskPrerequisites} from './modules/task-prerequisite-graph.js';
import {validateTask} from './modules/planning.js';
import {exact,uuid} from './modules/validation.js';
import {taskConstraintDraft,sameTaskConstraintDraft,taskPrerequisiteEffect} from './web/task-prerequisite-model.js';

// A command retains one result writer. Source owners supply authenticated task
// facts and shared lifecycle leases, never source catalogue mutations.
export async function withPlanningTaskAdmission(storage,namespaceId,command,{sourceAccess,check=async()=>{},signal}={},execute){
 const payload=command.payload;
 if(!exact(payload,['id','expectedRevision','data'])||!uuid(payload.id)||payload.expectedRevision!==null&&(!Number.isSafeInteger(payload.expectedRevision)||payload.expectedRevision<1))throw new AppError('INVALID');
 validateTask(payload.data,{workspaceId:namespaceId,completion:false});
 const draft=taskConstraintDraft(payload.data),reference={workspaceId:namespaceId,type:'task',id:payload.id};
 const active=async()=>{signal?.throwIfAborted();await check();};
 let previous=null;await active();
 try{previous=await readPlanningTask(storage,reference);}catch(error){if(error.code!=='NOT_FOUND')throw error;}
 if((previous?.revision??null)!==payload.expectedRevision)throw new AppError('MODULE_CHANGED',[{field:payload.id}]);
 const effect=taskPrerequisiteEffect(previous?.constraint.data,draft,{workspaceId:namespaceId});
 function prepared(observations,verify){
  return {verify,async prepare(old,authored,{id,now,workspaceId}){
   if(id!==payload.id||workspaceId!==namespaceId||(old?.revision??null)!==payload.expectedRevision||!sameTaskConstraintDraft(authored,draft))throw new AppError('TASK_PREREQUISITE_CHANGED');
   await verify();
   if(authored.status!=='done')return authored;
   const retained=effect.completionRequired?observations:previous?.constraint.data.prerequisiteObservations;
   return retained?.length?{...authored,prerequisiteObservations:effect.completionRequired?retained.map(value=>({...value,observedAt:now})):structuredClone(retained)}:authored;
  }};
 }
 // Cosmetic edits and reopening do not inspect foreign task content. The
 // ordinary result transaction still takes its task gate and revision check.
 if(!effect.needsAccess||draft.dependencies.length===0)return execute({taskPrerequisites:prepared([],active)});
 for(let attempt=0;attempt<3;attempt++){
  let access=null,failure;const expanded=Symbol('task-closure-expanded');
  const remote=async()=>{if(!sourceAccess)throw new AppError('TASK_PREREQUISITE_ACCESS');return access??=await sourceAccess(namespaceId,{signal});};
  const read=ref=>ref.workspaceId===namespaceId?readPlanningTask(storage,ref):remote().then(source=>source.read(ref));
  const verify=async()=>{await active();await access?.verify();};
  const useOwner=(namespace,consume)=>namespace===namespaceId?consume(storage):remote().then(source=>source.useOwner(namespace,consume));
  try{
   const discovery=await evaluateTaskPrerequisites({workspaceId:namespaceId,id:payload.id,data:draft},read,{signal}),involved=new Set(discovery.owners);
   return await withPlanningTaskLeases(discovery.owners,useOwner,async()=>{
    await verify();
    const admittedRead=ref=>{if(!involved.has(ref.workspaceId))throw expanded;return read(ref);};
    const result=await evaluateTaskPrerequisites({workspaceId:namespaceId,id:payload.id,data:draft},admittedRead,{signal,onOwner:namespace=>{if(!involved.has(namespace))throw expanded;}});
    await verify();return execute({taskPrerequisites:prepared(result.observations,verify)});
   },{signal,check:verify});
  }catch(error){failure=error;if(error!==expanded&&error?.code!=='TASK_PREREQUISITE_CHANGED')throw error;if(attempt===2)throw new AppError('TASK_PREREQUISITE_CHANGED');}
  finally{try{await access?.close();}catch(error){if(!failure)throw error;}}
 }
 throw new AppError('TASK_PREREQUISITE_CHANGED');
}
