// Retry compatibility is limited to an exact receipt transferred with its
// research owner. A former namespace alone never authorizes another command.
import {projectDomainSourceMatches} from './project-domain-origin.js';
import {intakeHash} from './intake/contract.js';
import {digest,serialize} from './storage-format.js';
export const projectRunReceiptOriginKey=(recordId,id)=>'project:run-receipt-origin:'+recordId+':'+id;
export async function projectRunRequestMatches(workspace,command,prior){
 if(prior.request===intakeHash(command))return true;if(!workspace.projectId)return false;
 return workspace.catalogue(async store=>{
  const origin=await store.object(projectRunReceiptOriginKey(command.recordId,command.id)),migration=await store.object('project:research-migration');
  if(origin?.version!==1||origin.recordId!==command.recordId||origin.id!==command.id||origin.projectId!==workspace.projectId||origin.namespaceId!==command.workspaceId||origin.receiptHash!==digest(serialize(prior)))return false;
  if(migration?.version!==1||migration.projectId!==origin.projectId||migration.sourceNamespace!==origin.sourceNamespace||!await projectDomainSourceMatches(store,'run-receipts',origin,migration)||migration.namespaceId!==origin.namespaceId||(await store.snapshot()).metadata.id!==command.workspaceId)return false;
  return prior.request===intakeHash({...command,workspaceId:origin.sourceNamespace});
 });
}
