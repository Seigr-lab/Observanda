import {ProjectRegistry} from './project-registry.js';
import {WorkspaceProjectOwners} from './workspace-project-owners.js';
import {validateRenameProjects} from './rename-owner-receipts.js';
export {validateRenameProjects} from './rename-owner-receipts.js';
import {ProjectBookRename,clearRenamedBooks} from './project-book-rename.js';
import {withWriterLease} from './writer-lease.js';
import {operationStage,operationAdvance,operationItem} from './operation-progress.js';
// Each nested project authorizes and freezes its own storage before the parent
// directory moves. The encrypted recovery capability survives interruption.
import path from 'node:path';
import {readFile,realpath,unlink} from 'node:fs/promises';
import {withProjectLifecycle} from './project-lifecycle.js';
import {assertRegular,atomicWrite,digest,serialize} from './storage.js';
import {databaseProvider} from './workspace-database-context.js';
import {assertProjectDatabaseStopped} from './project-postgres.js';
import {workspaceDatabaseLease} from './workspace-database-lease.js';
import {RENAME_MARKER,workspaceRename} from './workspace-rename-state.js';
import {saveRenameKeys,loadRenameKeys,RENAME_KEYS_FILE} from './workspace-rename-keys.js';
import {nestedRenameRoot} from './workspace-rename-paths.js';
import {AppError} from './errors.js';
const hash=async file=>digest(await readFile(file));
const identity=stat=>({dev:String(stat.dev),ino:String(stat.ino)});
const inside=(parent,child)=>{const relative=path.relative(parent,child);return relative!==''&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
export class WorkspaceProjectRename extends WorkspaceProjectOwners {
 bookOwner(storage){return new ProjectBookRename(storage);}




 async persist(value){
  if((await this.registry.read()).revision!==this.revision)throw new AppError('CONFLICT');
  if(!this.projects.length)return;
  for(const item of this.projects)await this.bookOwners.get(item.projectId).persist(value.id,item);
  value.projectRegistryRevision=this.revision;value.projectKeysHash=await saveRenameKeys(this.workspace,value.id,this.keys);value.projects=this.projects;
 }
 async load(value){
  if(!value.projects?.length)return;
  this.registry??=new ProjectRegistry(this.workspace,value.workspaceId);const current=await this.registry.read();
  if(!this.externalRegistry&&current.revision!==value.projectRegistryRevision)throw new AppError('STORAGE_RENAME_STATE');
  if(this.externalRegistry){
   const nested=current.value.projects.filter(entry=>inside(value.source,entry.root)||inside(value.destination,entry.root));
   if(nested.length!==value.projects.length||value.projects.some(item=>!nested.some(entry=>entry.projectId===item.projectId&&entry.namespaceId===item.namespaceId&&entry.vaultId===item.vaultId&&[nestedRenameRoot(value.source,item.relative),nestedRenameRoot(value.destination,item.relative)].includes(entry.root))))throw new AppError('STORAGE_RENAME_STATE');
  }
  this.keys=await loadRenameKeys(this.workspace,value.id,value.projectKeysHash);
  if(this.keys.size!==value.projects.length||value.projects.some(item=>this.keys.get(item.projectId)?.id!==item.vaultId))throw new AppError('STORAGE_RENAME_STATE');
  this.projects=value.projects;
  for(const item of this.projects){const books=new ProjectBookRename(await this.checked(item));this.bookOwners.set(item.projectId,books);await books.load(value.id,item);}
 }

 async freezeAndStop(value,{checkpoint=async()=>{}}={}){
  if(!this.projects?.length)return;
  return operationStage('rename-project-databases',{unit:'projects',total:this.projects.length},async()=>{
  for(const item of this.projects??[]){
   operationItem(path.basename(item.relative));const storage=await this.checked(item),prior=await workspaceRename(storage.root);
   if(prior&&(prior.version!==2||prior.id!==value.id||prior.projectId!==item.projectId||prior.parentSource!==value.source||prior.parentDestination!==value.destination||prior.relative!==item.relative))throw new AppError('STORAGE_RENAME_STATE');
   if(!prior)await withProjectLifecycle(this.registry,item.projectId,'open',()=>storage.withStorageHandoff(async()=>{
    await atomicWrite(path.join(storage.root,RENAME_MARKER),serialize({version:2,...(value.placement?{placement:true}:{}),id:value.id,source:nestedRenameRoot(value.source,item.relative),destination:nestedRenameRoot(value.destination,item.relative),parentSource:value.source,parentDestination:value.destination,relative:item.relative,projectId:item.projectId}));
   },{existing:true}));
   await checkpoint('project-frozen',value,item.projectId);
   await this.bookOwners.get(item.projectId).freezeAndStop(value,{checkpoint});
   const provider=databaseProvider();if(!provider?.stopProjectForRename)throw new AppError('DATABASE_LOCATION');
   await provider.stopProjectForRename(storage.root,item.projectId,storage.vault,value.id);
   const lease=await workspaceDatabaseLease(path.join(storage.root,'.observanda/postgresql'),{});
   try{await assertProjectDatabaseStopped(storage.root,item.projectId,storage.vault);}finally{await lease.close();}
   await checkpoint('project-stopped',value,item.projectId);operationAdvance();
  }
  });
 }
 async verify(){
  if(!this.projects?.length)return;
  return operationStage('rename-reopen-projects',{unit:'projects',total:this.projects.length},async()=>{
   for(const item of this.projects){operationItem(path.basename(item.relative));const storage=await this.checked(item);if((await storage.outline()).metadata.id!==item.namespaceId)throw new AppError('STORAGE_RENAME_STATE');await this.bookOwners.get(item.projectId).verify();operationAdvance();}
  });
 }

}
export async function clearRenamedProjects(root,value,{atSource=false}={}){
 for(const item of value.projects??[]){
  const target=nestedRenameRoot(root,item.relative),stat=await assertRegular(target,{directory:true});
  if(await realpath(target)!==target||serialize(identity(stat))!==serialize(item.identity)||await hash(path.join(target,'.observanda/access.json'))!==item.accessHash)throw new AppError('STORAGE_RENAME_STATE');
  await clearRenamedBooks(target,item,value);const marker=await workspaceRename(target);if(!marker)continue;
  if(marker.id!==value.id||marker.projectId!==item.projectId||marker.parentDestination!==value.destination||marker.parentSource!==value.source||root!==(atSource?value.source:value.destination))throw new AppError('STORAGE_RENAME_STATE');
  await unlink(path.join(target,RENAME_MARKER));
 }
 if(value.projects?.length){const file=path.join(root,RENAME_KEYS_FILE);if(await assertRegular(file,{missing:true})){if(await hash(file)!==value.projectKeysHash)throw new AppError('STORAGE_RENAME_STATE');await unlink(file);}}
}
