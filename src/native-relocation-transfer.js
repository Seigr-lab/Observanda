// Copy fallback for the same owner identities. Progress is indexed separately
// from the immutable recovery-key root carried by the selected project archive.
import path from 'node:path';
import {opendir} from 'node:fs/promises';
import {atomicReplace as rename} from './atomic-replace.js';
import {unlinkPersistent as unlink,persistRename} from './filesystem-persistence.js';
import {copyProjectOwnerLocation,projectTransferReceipt} from './project-transfer.js';
import {copyLabBookLocation,labBookTransferReceipt} from './lab-book-transfer.js';
import {workspaceCopyTransferId} from './workspace-copy-directory.js';
import {databaseRetention,verifyDatabaseRetention} from './workspace-database-retention.js';
import {catalogueBinding} from './postgres-activation.js';
import {projectMoveDirectory,assertProjectMoveDirectory} from './project-move-boundaries.js';
import {assertRegular,atomicWrite,digest,serialize,workspaceFile} from './storage.js';
import {workspaceRename} from './workspace-rename-state.js';
import {MOVE_SOURCE,moveSource} from './workspace-move-state.js';
import {removeRetiredProject} from './owned-storage-retirement.js';
import {relocationOwnerRoot,relocationOwnerId,assertNativeRelocationDatabases} from './native-relocation-owners.js';
import {databaseProvider} from './workspace-database-context.js';
import {workspaceDatabaseLease} from './workspace-database-lease.js';
import {assertLabBookDatabaseStopped} from './lab-book-postgres.js';
import {assertProjectDatabaseStopped} from './project-postgres.js';
import {AppError} from './errors.js';
export class NativeRelocationTransfer{
 constructor(owners,{check=async()=>{},checkpoint=async()=>{}}={}){this.selected=owners;this.command=owners.command;this.value=owners.value;this.owners=owners.owners;this.check=check;this.checkpoint=checkpoint;this.fresh=false;}
 async begin(){this.value.copied=true;this.value.phase='copying';await this.command.save(this.value);await this.checkpoint('copying',this.value);}
 async copy(){
  const value=this.value,scope=this.command.scope(value);let fresh=true;
  for await(const item of this.owners.entries())await this.selected.use(scope.source,item,async source=>{
   await this.check(item);await assertProjectMoveDirectory(source.root,item.identity);if((await catalogueBinding(source.root))?.id!==item.sourceId||(await workspaceRename(source.root))?.id!==value.id)throw new AppError('STORAGE_MOVE_STATE');
   const destination=relocationOwnerRoot(scope.destination,item),id=workspaceCopyTransferId(value.id,item.namespaceId);if(item.destinationIdentity)await assertProjectMoveDirectory(destination,item.destinationIdentity);let verified=false;
   const excludeProject=async root=>{const suffix=path.relative(scope.source,root).split(path.sep).join('/');return root!==source.root&&Boolean(await this.owners.get(suffix));};
   await (item.kind==='project'?copyProjectOwnerLocation:copyLabBookLocation)(source,destination,{id,retainIncomplete:true,relocation:true,excludeProject,boundaryRevision:digest(serialize({keys:value.ownerKeys,relative:item.relative})),
    checkpoint:async(stage,...args)=>{if(stage==='verified')verified=true;await this.check(item);await this.checkpoint('copy:'+stage,value,item.relative,...args);},
    onVerified:async(target,receipt)=>{const binding=await catalogueBinding(target.root);if(item.destinationId&&item.destinationId!==binding?.id||receipt.sourceId!==item.sourceId||receipt.namespaceId!==item.namespaceId||receipt.id!==id||binding?.placement!==item.kind||binding[item.kind==='project'?'projectId':'labBookId']!==relocationOwnerId(item))throw new AppError('DATABASE_LOCATION');
     await this.owners.update(item.relative,{destinationId:binding.id,destinationIdentity:await projectMoveDirectory(target.root),retention:await source.catalogue(store=>databaseRetention(store.db))});await this.command.save(value);
    }
   });fresh&&=verified;await this.checkpoint('owner-copied',value,item.relative);
  },{identity:false});
  value.phase='moved';await this.command.save(value);this.fresh=fresh;await this.checkpoint('transferred',value);
 }
 async activate(){for await(const item of this.owners.entries()){const root=relocationOwnerRoot(this.command.scope(this.value).destination,item);await assertProjectMoveDirectory(root,item.destinationIdentity);if((await workspaceRename(root))?.id!==this.value.id)throw new AppError('STORAGE_MOVE_STATE');await unlink(path.join(root,'.observanda/copy-in-progress')).catch(error=>{if(error.code!=='ENOENT')throw error;});}}
 async verify(){
  const value=this.value,scope=this.command.scope(value);for await(const item of this.owners.entries())await this.selected.use(scope.destination,item,async storage=>{
   const binding=await catalogueBinding(storage.root),receipt=await (item.kind==='project'?projectTransferReceipt:labBookTransferReceipt)(storage);
   if(binding?.id!==item.destinationId||receipt?.phase!=='verified'||receipt.id!==workspaceCopyTransferId(value.id,item.namespaceId)||receipt.sourceId!==item.sourceId||receipt.namespaceId!==item.namespaceId||receipt.source!==relocationOwnerRoot(scope.source,item))throw new AppError('STORAGE_MOVE_STATE');if(!this.fresh)await verifyDatabaseRetention(storage,item.retention);
  });
 }
 async retire(){
  const value=this.value,scope=this.command.scope(value),retired=path.join(path.dirname(scope.source),'.observanda-project-move-'+value.id),root=await this.owners.get('');await this.verify();await this.check();
  if(value.phase==='registered'){value.phase='retiring';await this.command.save(value);await this.checkpoint('retiring',value);}
  if(value.phase==='retiring'){
   if(await assertRegular(retired,{directory:true,missing:true})){await assertProjectMoveDirectory(retired,root.identity);const marker=await moveSource(retired);if(marker?.id!==value.id||marker.destination!==scope.destination)throw new AppError('STORAGE_MOVE_STATE');}
   else{
    const marker=await moveSource(scope.source);if(marker&&(marker.id!==value.id||marker.destination!==scope.destination))throw new AppError('STORAGE_MOVE_STATE');await assertNativeRelocationDatabases(scope.source,this.owners);
    for await(const item of this.owners.entries({reverse:true}))await this.selected.use(scope.source,item,async storage=>{
     await assertProjectMoveDirectory(storage.root,item.identity);const descriptor=path.basename(await workspaceFile(storage.root));for await(const child of await opendir(storage.root))if(!['.observanda',descriptor].includes(child.name)){const relative=path.posix.join(item.relative,child.name);if(!child.isDirectory()||!await this.owners.get(relative))throw new AppError('STORAGE_MOVE_CONTENTS');}if((await catalogueBinding(storage.root))?.id!==item.sourceId||(await workspaceRename(storage.root))?.id!==value.id)throw new AppError('STORAGE_MOVE_STATE');const provider=databaseProvider(),method=item.kind==='project'?'stopProjectForRename':'stopLabBookForRename';if(!provider?.[method])throw new AppError('DATABASE_LOCATION');if(!marker)await provider[method](storage.root,relocationOwnerId(item),storage.vault,value.id);
     const lease=await workspaceDatabaseLease(path.join(storage.root,'.observanda/postgresql'));try{await (item.kind==='project'?assertProjectDatabaseStopped:assertLabBookDatabaseStopped)(storage.root,relocationOwnerId(item),storage.vault);}finally{await lease.close();}await this.checkpoint('source-owner-stopped',value,item.relative);
    },{keysRoot:scope.destination,identity:false});
    await atomicWrite(path.join(scope.source,MOVE_SOURCE),serialize({id:value.id,destination:scope.destination}));await this.checkpoint('retire-frozen',value);await this.check();await rename(scope.source,retired);await this.checkpoint('source-retired',value);
   }
   await persistRename(scope.source,retired);value.phase='retired';await this.command.save(value);await this.checkpoint('retired',value);
  }
  if(value.phase!=='retired')throw new AppError('STORAGE_MOVE_STATE');
  const ownerRelative=async relative=>{for(let prefix=path.posix.dirname(relative);prefix!=='.';prefix=path.posix.dirname(prefix))if(await this.owners.get(prefix))return relative.slice(prefix.length+1);return relative;};
  await this.command.registry.workspace.withCatalogueConnections(()=>removeRetiredProject({...scope,sourceDirectory:root.identity},{ownerRelative,verify:!this.fresh,checkpoint:async(stage,...args)=>{await this.check(root);await this.checkpoint('retire:'+stage,value,...args);}}));await this.checkpoint('source-removed',value);
 }
}
