import {incomingProjectMove} from './project-incoming-moves.js';
import {assertImportedProjectReady} from './project-import-state.js';
import {readProjectArchiveIdentity} from './project-archive.js';
import {projectPortableReferences} from './project-portable-references.js';
import {ProjectStorage} from './project-storage.js';
import {readAccess} from './access.js';
import {authenticateKeyring} from './security/keyring.js';
import {catalogueBinding} from './postgres-activation.js';
import {AppError} from './errors.js';
// Access is supplied by the authenticated application session, never inferred
// from knowing a folder or a project ID. Only the selected owner is opened.
export class ProjectRouter{
 constructor(registry,{authorize,unlock,recover}){if(typeof authorize!=='function'||typeof unlock!=='function')throw new AppError('INVALID');this.registry=registry;this.authorize=authorize;this.unlock=unlock;this.recover=recover;}
 async withProject(projectId,operation,{action='read',target=null,locationOnly=false}={}){
  if(!['read','write'].includes(action)||typeof operation!=='function')throw new AppError('INVALID');
  if(await this.authorize({projectId,action,target})!==true)throw new AppError('ACCESS_DENIED');
  if(!locationOnly&&await incomingProjectMove(this.registry,projectId))throw new AppError('STORAGE_PROJECT_BUSY');
  await assertImportedProjectReady(this.registry,projectId);let entry=await this.registry.locate(projectId);const binding=await catalogueBinding(entry.root),access=await readAccess(entry.root);
  if(binding&&(binding.placement!=='project'||binding.projectId!==projectId)||access.value.vaultId!==entry.vaultId)throw new AppError('DATABASE_LOCATION');
  const vault=await this.unlock(entry,access);if(!vault?.key)throw new AppError('ACCESS_LOCKED');
  if(access.value.formatVersion!==3)throw new AppError('ACCESS_FORMAT');authenticateKeyring(access.value,vault);
  if(!binding){const identity=await readProjectArchiveIdentity(entry.root,vault);if(identity.projectId!==projectId||identity.namespaceId!==entry.namespaceId)throw new AppError('DATABASE_LOCATION');}
  if(locationOnly){if(action!=='read')throw new AppError('INVALID');return operation(new ProjectStorage(entry.root,projectId,vault),null);}
  if(this.recover){await this.recover(entry,vault);entry=await this.registry.locate(projectId);const next=await readAccess(entry.root);if(entry.vaultId!==vault.id||next.value.vaultId!==vault.id)throw new AppError('DATABASE_LOCATION');authenticateKeyring(next.value,vault);}
  const storage=new ProjectStorage(entry.root,projectId,vault),outline=await storage.outline();
  if(outline.metadata.id!==entry.namespaceId)throw new AppError('DATABASE_LOCATION');
  await projectPortableReferences(storage,entry);
  await this.registry.refreshSummary(projectId,outline.metadata);
  return operation(storage,outline);
 }
}
