// A signed request keeps its historical namespace. Only the exact selected
// request's authenticated origin can map its summary to the new project.
import {projectDomainSourceMatches} from './project-domain-origin.js';
import {reviewHash} from './security/review-exchange.js';
import {referenceNamespaceMatches} from './research-reference-namespace.js';
import {AppError} from './errors.js';
export const projectReviewOriginKey=id=>'project:review-origin:'+id;
export const reviewScopeHash=summary=>reviewHash({id:summary.id,workspaceId:summary.workspaceId,direction:summary.direction,records:summary.records.map(({id,revision})=>({id,revision}))});
export async function reviewScopeNamespace(store,summary){
 if(!store.workspace.projectId||summary.direction!=='outgoing')return summary.workspaceId;
 const origin=await store.object(projectReviewOriginKey(summary.id));if(!origin)return summary.workspaceId;
 const migration=await store.object('project:research-migration');
 if(origin.version!==1||origin.id!==summary.id||origin.projectId!==store.workspace.projectId||origin.sourceNamespace!==summary.workspaceId||origin.scopeHash!==reviewScopeHash(summary)||migration?.version!==1||migration.projectId!==origin.projectId||migration.namespaceId!==origin.namespaceId||migration.sourceNamespace!==origin.sourceNamespace||!await projectDomainSourceMatches(store,'peer-reviews',origin,migration))throw new AppError('CATALOGUE_DAMAGED');
 for(const record of summary.records)if(!await referenceNamespaceMatches(store,{kind:'record',id:record.id,workspaceId:summary.workspaceId}))throw new AppError('CATALOGUE_DAMAGED');
 return origin.namespaceId;
}

export async function assertProjectReviewPacket(workspace,packet){
 if(!workspace.projectId)return;
 return workspace.catalogue(async store=>{
  const origin=await store.object(projectReviewOriginKey(packet.request.value.id));if(!origin)return;
  const migration=await store.object('project:research-migration');
  if(origin.version!==1||origin.id!==packet.request.value.id||origin.projectId!==workspace.projectId||origin.requestHash!==reviewHash(packet.request)||migration?.version!==1||migration.projectId!==origin.projectId||migration.namespaceId!==origin.namespaceId||migration.sourceNamespace!==origin.sourceNamespace||!await projectDomainSourceMatches(store,'peer-reviews',origin,migration)||(await store.snapshot()).metadata.id!==origin.namespaceId)throw new AppError('CATALOGUE_DAMAGED');
 });
}
