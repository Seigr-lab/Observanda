// The external manifest stays byte-for-byte meaningful under its original
// namespace. Only a transferred, pinned intake may resolve a new execution owner.
import {intakeHash} from './intake/contract.js';
import {referenceNamespaceMatches} from './research-reference-namespace.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
export const projectIntakeOriginKey=id=>{if(!researchId(id))throw new AppError('INTAKE_INVALID');return 'project:intake-origin:'+id;};
export async function projectIntakeTarget(workspace,manifest){
 if(!workspace.projectId)return manifest;
 return workspace.catalogue(async store=>{
  const namespaceId=(await store.snapshot()).metadata.id;if(manifest.workspaceId===namespaceId)return manifest;
  const proof=researchId(manifest.id)?await store.object(projectIntakeOriginKey(manifest.id)):null;
  if(proof?.version!==1||proof.projectId!==workspace.projectId||proof.id!==manifest.id||proof.recordId!==manifest.recordId||proof.sourceNamespace!==manifest.workspaceId||proof.namespaceId!==namespaceId||proof.pin!==intakeHash(manifest)||!await referenceNamespaceMatches(store,{kind:'record',id:manifest.recordId,workspaceId:manifest.workspaceId}))throw new AppError('WORKSPACE_CHANGED');
  return {...manifest,workspaceId:namespaceId};
 });
}
