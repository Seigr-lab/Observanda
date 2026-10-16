// A feature domain belongs to an authenticated workspace or project namespace.
// Existing project key derivation remains stable across application updates.
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
export function moduleDomainOwner(storage,namespaceId){
 if(!researchId(namespaceId)||storage.projectId!=null&&!researchId(storage.projectId))throw new AppError('INVALID');
 return storage.projectId==null?{version:2,projectId:null,namespaceId}:{version:1,projectId:storage.projectId,namespaceId};
}
export function moduleDomainKeyScope(storage,namespaceId){
 const owner=moduleDomainOwner(storage,namespaceId);
 return owner.projectId===null?{label:'Observanda/workspace-domain/v1',salt:namespaceId,identity:null}:{label:'Observanda/project-domain/v1',salt:owner.projectId,identity:owner.projectId};
}
