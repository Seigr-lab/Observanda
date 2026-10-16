import {AppError} from './errors.js';
import {moduleDomainContext} from './module-domain-context.js';
import {readProjectDomainRegistry} from './project-domain-registry.js';
import {validTaskReference,validTaskConstraintFacts} from './web/task-prerequisite-model.js';

export const TASK_DEPENDENCY_OWNER_LIMIT=32;

// Task facts and their member hashes are authenticated by the selected domain.
// Neither graph admission nor labels require the authored task body.
export async function readPlanningTaskFromStore(store,reference,{label=false}={}){
 if(!validTaskReference(reference))throw new AppError('INVALID');
  if((await store.snapshot()).metadata.id!==reference.workspaceId)throw new AppError('WORKSPACE_CHANGED');
  const registry=await readProjectDomainRegistry(store);
  if(registry?.commandVersion!==1||!registry.domains.includes('tasks'))throw new AppError('TASK_PREREQUISITE_UNSUPPORTED');
  const result=await moduleDomainContext(store,async context=>{
   let member;try{member=await context.member(reference.id);}catch(error){if(error.code!=='MODULE_REFERENCE')throw error;throw new AppError('NOT_FOUND');}
   if(!member||member.type!=='task')throw new AppError('NOT_FOUND');
   const constraint=await context.constraint(member);
   if(constraint.id!==reference.id||constraint.type!=='task'||!validTaskConstraintFacts(constraint.data,reference.workspaceId))throw new AppError('CATALOGUE_DAMAGED');
   const value={reference:{...reference},revision:member.revision,hash:member.hash,constraintHash:member.constraintHash,constraint};
   if(label)value.title=(await context.view(member)).title;
   return value;
  },{domains:['tasks'],scoped:false});
  if(!result)throw new AppError('TASK_PREREQUISITE_UNSUPPORTED');return result.value;
}
export const readPlanningTask=(storage,reference,options)=>storage.catalogue(store=>readPlanningTaskFromStore(store,reference,options));
