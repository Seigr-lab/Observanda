import {ProjectDomains} from './project-domains.js';
import {projectDomainHandoff} from './project-domain-lock.js';
import {taskAdmissionDatabase,withTaskAdmission} from './task-admission-lock.js';
import {reserveTaskAdmissionBudget} from './task-admission-budget.js';
import {TASK_DEPENDENCY_OWNER_LIMIT} from './planning-task-reader.js';
import {assertNotDeleting} from './workspace-delete-state.js';
import {assertNotMoving} from './workspace-move-state.js';
import {assertNotRenaming} from './workspace-rename-state.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';

export async function withPlanningTaskLeases(namespaces,useOwner,operation,{signal,check=async()=>{}}={}){
 if(!Array.isArray(namespaces)||!namespaces.length||!namespaces.every(researchId)||new Set(namespaces).size!==namespaces.length)throw new AppError('INVALID');
 if(namespaces.length>TASK_DEPENDENCY_OWNER_LIMIT)throw new AppError('TASK_DEPENDENCY_OWNER_LIMIT');
 const ordered=[...namespaces].sort(),descriptors=new Map(),groups=new Map();
 async function open(namespaceId){
  signal?.throwIfAborted();await check();
  let opened;try{return await useOwner(namespaceId,async storage=>opened={db:await new ProjectDomains(storage,namespaceId).connection(),root:storage.root});}
  catch(error){await opened?.db.close().catch(()=>{});throw error;}
 }
 // Authenticate the complete resource set before reserving any long-held
 // connection. Discovery does not retain source vaults or task originals.
 for(const namespaceId of ordered){
  const {db,root}=await open(namespaceId);let failure;
  try{descriptors.set(namespaceId,{...taskAdmissionDatabase(db),root});}catch(error){failure=error;throw error;}finally{try{await db.close();}catch(error){if(!failure)throw error;}}
 }
 const releaseBudget=reserveTaskAdmissionBudget(descriptors.values());
 let failure;
 try{
  async function next(index){
   if(index===ordered.length){signal?.throwIfAborted();await check();const result=await operation();signal?.throwIfAborted();await check();return result;}
   const namespaceId=ordered[index],expected=descriptors.get(namespaceId),opened=await open(namespaceId);let candidate=opened.db,failure;
   try{
    const actual=taskAdmissionDatabase(candidate);
    if(opened.root!==expected.root||actual.physical!==expected.physical||actual.catalogueId!==expected.catalogueId)throw new AppError('TASK_PREREQUISITE_CHANGED');
    let db=groups.get(actual.physical);
    if(db){await candidate.close();candidate=null;}
    else{db=candidate;candidate=null;groups.set(actual.physical,db);await db.run('BEGIN READ ONLY');}
    // One authenticated physical database can hold several owner's advisory
    // keys without opening a separate connection for each catalogue schema.
    const owner=Object.create(db);owner.id=actual.catalogueId;
    await projectDomainHandoff(owner,{shared:true});
    return await withTaskAdmission(owner,namespaceId,async()=>{
     signal?.throwIfAborted();await check();
     await assertNotDeleting(expected.root);await assertNotMoving(expected.root);await assertNotRenaming(expected.root);
     return next(index+1);
    });
   }catch(error){failure=error;throw error;}finally{try{await candidate?.close();}catch(error){if(!failure)throw error;}}
  }
  return await next(0);
 }catch(error){failure=error;throw error;
 }finally{
  try{
   const results=await Promise.allSettled([...groups.values()].reverse().map(async db=>{try{await db.run('ROLLBACK');}finally{await db.close();}}));
   const failed=results.find(result=>result.status==='rejected');if(failed&&!failure)throw failed.reason;
  }finally{releaseBudget();}
 }
}
