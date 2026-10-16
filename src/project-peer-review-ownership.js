import {digest,serialize} from './storage-format.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
export async function projectPeerReviewOwnership(inventory,summary,{signal}={}){
 signal?.throwIfAborted();const projectIds=new Set();
 if(summary.direction==='outgoing'){
  if(summary.workspaceId!==inventory.namespaceId)throw new AppError('PROJECT_MIGRATION_OWNERSHIP');let selected=0;
  for(const record of summary.records){signal?.throwIfAborted();const owner=await inventory.record(record.id);if(!owner||owner.ambiguous||!researchId(owner.projectId))throw new AppError('PROJECT_MIGRATION_OWNERSHIP');projectIds.add(owner.projectId);if(owner.projectId===inventory.projectId)selected++;}
  if(selected&&selected!==summary.records.length)throw new AppError('PROJECT_MIGRATION_DEPENDENCY');
 }else if(summary.direction==='incoming'){
  const owner=await inventory.review?.(summary.id,summary);
  if(!owner||owner.id!==summary.id||owner.sourceNamespace!==inventory.namespaceId||owner.revision!==digest(serialize(summary))||!['project','workspace'].includes(owner.kind)||owner.kind==='project'&&!researchId(owner.projectId))throw new AppError('PROJECT_MIGRATION_OWNERSHIP');
  if(owner.kind==='project')projectIds.add(owner.projectId);
 }else throw new AppError('CATALOGUE_DAMAGED');
 return {selected:projectIds.has(inventory.projectId),projectIds:[...projectIds]};
}
