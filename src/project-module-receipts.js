import {projectModuleInputEpochMatches} from './project-module-input-epochs.js';
import {projectDomainSourceMatches} from './project-domain-origin.js';
import {moduleCommandFingerprint} from './modules/command-fingerprint.js';
import {digest,serialize} from './storage-format.js';
export const moduleReceiptOriginKey=id=>'project:module-event-origin:'+id;
export async function moduleReceiptMatches(store,command,event,fingerprint){
 if(event.fingerprint===fingerprint)return true;
 if(!store.workspace.projectId)return false;
 const origin=await store.object(moduleReceiptOriginKey(command.commandId)),migration=await store.object('project:module-migration'),research=await store.object('project:research-migration');
 if(!origin||origin.version!==1||origin.projectId!==store.workspace.projectId||origin.namespaceId!==command.workspaceId||origin.commandId!==command.commandId||origin.eventHash!==digest(serialize(event)))return false;
 if(migration?.version!==1||migration.projectId!==origin.projectId||migration.namespaceId!==origin.namespaceId||migration.sourceNamespace!==origin.sourceNamespace||!await projectModuleInputEpochMatches(store,origin,migration))return false;
 if(research?.version!==1||research.projectId!==origin.projectId||research.namespaceId!==origin.namespaceId||research.sourceNamespace!==origin.sourceNamespace||(await store.snapshot()).metadata.id!==command.workspaceId)return false;
 if(!await projectDomainSourceMatches(store,'modules',origin,research)||!await projectDomainSourceMatches(store,'modules',migration,research))return false;
 return moduleCommandFingerprint({...command,workspaceId:origin.sourceNamespace})===event.fingerprint;
}
