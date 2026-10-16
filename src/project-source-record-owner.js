// Resolve only records whose metadata changed. The held inventory supplies
// retained lab-book ownership; new raw versions are checked by indexed ID.
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
export function projectSourceRecordOwner(store,inventory,{signal}={}){
 const cache=new Map();
 return async(id,{required=true}={})=>{
  signal?.throwIfAborted();if(!researchId(id))throw new AppError('CATALOGUE_DAMAGED');
  if(cache.has(id))return cache.get(id);
  const prior=await inventory.record(id);let projectId=prior?.projectId??null;
  if(prior?.ambiguous)throw new AppError('PROJECT_MIGRATION_OWNERSHIP');
  for await(const row of store.db.rows('SELECT DISTINCT scope_id FROM records WHERE id=$1',[id],{signal,batchSize:32})){
   const scope=await inventory.notebook(row.scope_id);
   if(!scope||scope.ambiguous||projectId!==null&&projectId!==scope.projectId)throw new AppError('PROJECT_MIGRATION_OWNERSHIP');
   projectId=scope.projectId;
  }
  if(projectId===null&&!required)return null;
  if(!researchId(projectId))throw new AppError('PROJECT_MIGRATION_OWNERSHIP');
  const owner={kind:'project',projectId};if(cache.size>=256)cache.delete(cache.keys().next().value);cache.set(id,owner);return owner;
 };
}
