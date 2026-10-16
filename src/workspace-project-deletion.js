// A workspace deletion freezes each contained database before retiring its
// folder. Registered projects outside that folder are not deletion targets.
import path from 'node:path';
import {WorkspaceProjectOwners} from './workspace-project-owners.js';
import {ProjectRegistry} from './project-registry.js';
import {ProjectBookDeletion} from './project-book-deletion.js';
import {validateRenameProjects} from './rename-owner-receipts.js';
import {saveOwnerKeys,loadOwnerKeys,DELETE_PROJECT_KEYS_FILE} from './owned-operation-keys.js';
import {DELETE_MARKER,workspaceDeletion} from './workspace-delete-state.js';
import {assertRegular,atomicWrite,serialize} from './storage.js';
import {databaseProvider} from './workspace-database-context.js';
import {workspaceDatabaseLease} from './workspace-database-lease.js';
import {assertProjectDatabaseStopped} from './project-postgres.js';
import {withProjectLifecycle} from './project-lifecycle.js';
import {operationStage,operationAdvance,operationItem} from './operation-progress.js';
import {AppError} from './errors.js';
export class WorkspaceProjectDeletion extends WorkspaceProjectOwners{
 constructor(workspace,options={}){super(workspace,{...options,missingAccessCode:'ACCESS_LOCKED'});}
 bookOwner(storage){return new ProjectBookDeletion(storage);}
 async persist(value){
  if((await this.registry.read()).revision!==this.revision)throw new AppError('CONFLICT');
  if(!this.projects.length)return;
  for(const item of this.projects)await this.bookOwners.get(item.projectId).persist(value.id,item);
  value.projectRegistryRevision=this.revision;value.projectKeysHash=await saveOwnerKeys(this.workspace,value.id,this.keys,DELETE_PROJECT_KEYS_FILE);value.projects=this.projects;
 }
 async load(value){
  this.projects=validateRenameProjects(value.projects??[]);if(!this.projects.length)return;
  this.registry=new ProjectRegistry(this.workspace,value.workspaceId);if((await this.registry.read()).revision!==value.projectRegistryRevision)throw new AppError('STORAGE_DELETE_STATE');
  this.keys=await loadOwnerKeys(this.workspace,value.id,value.projectKeysHash,DELETE_PROJECT_KEYS_FILE);
  if(this.keys.size!==this.projects.length||this.projects.some(item=>this.keys.get(item.projectId)?.id!==item.vaultId))throw new AppError('STORAGE_DELETE_STATE');
  for(const item of this.projects){const owner=new ProjectBookDeletion(await this.checked(item));this.bookOwners.set(item.projectId,owner);await owner.load({...item,id:value.id});}
 }
 async stop(value,{checkpoint=async()=>{}}={}){
  if(!this.projects?.length)return;
  return operationStage('delete-project-databases',{unit:'projects',total:this.projects.length},async()=>{
   for(const item of this.projects){
    operationItem(item.relative);const storage=await this.checked(item),marker={version:1,id:value.id,source:storage.root},prior=await workspaceDeletion(storage.root);
    if(prior&&serialize(prior)!==serialize(marker))throw new AppError('STORAGE_DELETE_STATE');
    if(!prior)await withProjectLifecycle(this.registry,item.projectId,'open',()=>atomicWrite(path.join(storage.root,DELETE_MARKER),serialize(marker)));
    await checkpoint('project-frozen',value,item.projectId);await this.bookOwners.get(item.projectId).stop(value,{checkpoint});
    const provider=databaseProvider();if(!provider?.stopProjectForDeletion)throw new AppError('DATABASE_LOCATION');await provider.stopProjectForDeletion(storage.root,item.projectId,storage.vault,value.id);
    const lease=await workspaceDatabaseLease(path.join(storage.root,'.observanda/postgresql'));try{await assertProjectDatabaseStopped(storage.root,item.projectId,storage.vault);}finally{await lease.close();}
    await checkpoint('project-stopped',value,item.projectId);operationAdvance();
   }
  });
 }
}
