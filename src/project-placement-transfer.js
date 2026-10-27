// A complete project tree moves through independently authenticated owners.
// Destination registration precedes retirement of the frozen original tree.
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {atomicReplace as rename} from './atomic-replace.js';
import {unlinkPersistent as unlink,persistRename} from './filesystem-persistence.js';
import {ProjectStorage} from './project-storage.js';
import {LabBookStorage} from './lab-book-storage.js';
import {copyProjectOwnerLocation,projectTransferReceipt} from './project-transfer.js';
import {copyLabBookLocation,labBookTransferReceipt} from './lab-book-transfer.js';
import {placementOwners} from './project-placement-transfer-state.js';
import {catalogueBinding} from './postgres-activation.js';
import {databaseRetention,verifyDatabaseRetention} from './workspace-database-retention.js';
import {projectMoveDirectory,assertProjectMoveDirectory,ownedProjectFolder} from './project-move-boundaries.js';
import {removeRetiredProject} from './owned-storage-retirement.js';
import {assertRegular,atomicWrite,serialize} from './storage.js';
import {readAccess} from './access.js';
import {authenticateKeyring} from './security/keyring.js';
import {MOVE_SOURCE,moveSource} from './workspace-move-state.js';
import {workspaceRename} from './workspace-rename-state.js';
import {nestedRenameRoot} from './workspace-rename-paths.js';
import {databaseProvider} from './workspace-database-context.js';
import {workspaceDatabaseLease} from './workspace-database-lease.js';
import {assertLabBookDatabaseStopped} from './lab-book-postgres.js';
import {assertProjectDatabaseStopped} from './project-postgres.js';
import {operationStage,operationItem} from './operation-progress.js';
import {AppError} from './errors.js';
const at=(root,relative)=>relative?nestedRenameRoot(root,relative):root;
const storageAt=(root,owner,vault)=>owner.kind==='project'?new ProjectStorage(at(root,owner.relative),owner.ownerId,vault):new LabBookStorage(at(root,owner.relative),owner.ownerId,vault);
const inside=(a,b)=>b.startsWith(a+path.sep);
export class ProjectPlacementTransfer{
 constructor(command,value,vault,{check=async()=>{},checkpoint=async()=>{}}={}){this.command=command;this.value=value;this.vault=vault;this.check=check;this.checkpoint=checkpoint;this.fresh=false;}
 async using(root,operation){
  const value=this.value,storage=new ProjectStorage(root,value.projectId,this.vault),{projects,books}=this.command.helpers(storage);
  try{
   await projects.load(this.command.scope(value));await books.load(value.id,value.rootBooks);
   const keys=new Map([['',this.vault]]);
   for(const item of projects.projects??[])keys.set(item.relative,projects.keys.get(item.projectId));
   for(const owner of [books,...projects.bookOwners.values()])for(const item of owner.books){const relative=path.relative(root,path.join(owner.project.root,item.directory)).split(path.sep).join('/');keys.set(relative,owner.keys.get(item.labBookId));}
   const owners=placementOwners(value).map(item=>{const key=keys.get(item.relative);if(!key||key.id!==item.vaultId)throw new AppError('ACCESS_LOCKED');return {...item,storage:storageAt(root,item,key)};});
   return await operation(owners);
  }finally{projects.close();books.close();}
 }
 async begin(){
  const value=this.value,scope=this.command.scope(value);
  await this.using(scope.source,async owners=>{
   const entries=[];
   for(const {storage,...owner} of owners){const binding=await catalogueBinding(storage.root);if(binding?.placement!==owner.kind||binding[owner.kind==='project'?'projectId':'labBookId']!==owner.ownerId)throw new AppError('DATABASE_LOCATION');entries.push({...owner,id:randomUUID(),sourceId:binding.id,sourceIdentity:await projectMoveDirectory(storage.root)});}
   value.version=2;value.transfer={owners:entries};value.phase='copying';await this.command.save(value);await this.checkpoint('copying',value);
  });
 }
 async copy(){
  const value=this.value,scope=this.command.scope(value);let fresh=true;
  await this.using(scope.source,async owners=>{
   await operationStage('copy-project',{},async()=>{
    for(const [index,owner] of owners.entries()){
     await this.check();const item=value.transfer.owners[index],source=owner.storage,destination=at(scope.destination,item.relative);
     await assertProjectMoveDirectory(source.root,item.sourceIdentity);authenticateKeyring((await readAccess(source.root)).value,source.vault);
     if((await catalogueBinding(source.root))?.id!==item.sourceId||(await workspaceRename(source.root))?.id!==value.id)throw new AppError('STORAGE_MOVE_STATE');
     if(item.destinationIdentity)await assertProjectMoveDirectory(destination,item.destinationIdentity);
     const projectRoots=owners.filter(other=>inside(source.root,other.storage.root)).map(other=>other.storage.root);let verified=false;
     operationItem(item.relative||path.basename(scope.source));
     const copy=item.kind==='project'?copyProjectOwnerLocation:copyLabBookLocation;
     await copy(source,destination,{id:item.id,projectRoots,retainIncomplete:true,relocation:true,
      checkpoint:async(stage,...args)=>{if(stage==='verified')verified=true;await this.check();await this.checkpoint('copy:'+stage,value,item.relative,...args);},
      onVerified:async(target,receipt)=>{
       const binding=await catalogueBinding(target.root);
       if(item.destinationId&&item.destinationId!==binding?.id)throw new AppError('DATABASE_LOCATION');
       if(receipt.sourceId!==item.sourceId||receipt.namespaceId!==item.namespaceId||receipt.id!==item.id||binding?.placement!==item.kind||binding[item.kind==='project'?'projectId':'labBookId']!==item.ownerId)throw new AppError('DATABASE_LOCATION');
       item.destinationId=binding.id;item.destinationIdentity=await projectMoveDirectory(target.root);item.retention=await source.catalogue(store=>databaseRetention(store.db));await this.command.save(value);
      }
     });fresh&&=verified;await this.checkpoint('owner-copied',value,item.relative);
    }
   });
  });
  const identities=new Map();for(const item of value.transfer.owners){const stat=await assertRegular(at(scope.destination,item.relative),{directory:true});identities.set(item.relative,{dev:String(stat.dev),ino:String(stat.ino)});}
  for(const book of value.rootBooks.books??[])book.identity=identities.get(book.directory);
  for(const project of value.projects??[]){project.identity=identities.get(project.relative);for(const book of project.books??[])book.identity=identities.get(path.posix.join(project.relative,book.directory));}
  value.phase='moved';await this.command.save(value);this.fresh=fresh;await this.checkpoint('transferred',value);
 }
 async activate(){
  const value=this.value,scope=this.command.scope(value);
  for(const item of value.transfer.owners){const root=at(scope.destination,item.relative);await assertProjectMoveDirectory(root,item.destinationIdentity);if((await workspaceRename(root))?.id!==value.id)throw new AppError('STORAGE_MOVE_STATE');await unlink(path.join(root,'.observanda/copy-in-progress')).catch(error=>{if(error.code!=='ENOENT')throw error;});}
 }
 async targets(owners){
  const value=this.value,scope=this.command.scope(value);
  for(const [index,{storage}] of owners.entries()){
   const item=value.transfer.owners[index];await assertProjectMoveDirectory(storage.root,item.destinationIdentity);authenticateKeyring((await readAccess(storage.root)).value,storage.vault);
   const binding=await catalogueBinding(storage.root),receipt=await (item.kind==='project'?projectTransferReceipt:labBookTransferReceipt)(storage);
   if(binding?.id!==item.destinationId||binding.placement!==item.kind||binding[item.kind==='project'?'projectId':'labBookId']!==item.ownerId||receipt?.phase!=='verified'||receipt.id!==item.id||receipt.sourceId!==item.sourceId||receipt.namespaceId!==item.namespaceId||receipt.source!==at(scope.source,item.relative))throw new AppError('STORAGE_MOVE_STATE');
   if(!this.fresh)await verifyDatabaseRetention(storage,item.retention);
  }
 }
 async retire(){
  const value=this.value,scope=this.command.scope(value),retired=path.join(path.dirname(scope.source),'.observanda-project-move-'+value.id),rootOwner=value.transfer.owners.find(item=>item.relative==='');
  return this.using(scope.destination,async owners=>{
   await this.targets(owners);
   await operationStage('remove-original',{unit:'files'},async()=>{
    await this.check();if(value.phase==='registered'){value.phase='retiring';await this.command.save(value);await this.checkpoint('retiring',value);}
    if(value.phase==='retiring'){
     if(await assertRegular(retired,{directory:true,missing:true})){
      await assertProjectMoveDirectory(retired,rootOwner.sourceIdentity);const marker=await moveSource(retired);if(marker?.id!==value.id||marker.destination!==scope.destination)throw new AppError('STORAGE_MOVE_STATE');
     }else{
      const marker=await moveSource(scope.source);if(marker&&(marker.id!==value.id||marker.destination!==scope.destination))throw new AppError('STORAGE_MOVE_STATE');
      for(const [index,owner] of [...owners.entries()].reverse()){
       const item=value.transfer.owners[index],source=storageAt(scope.source,item,owner.storage.vault);await assertProjectMoveDirectory(source.root,item.sourceIdentity);authenticateKeyring((await readAccess(source.root)).value,source.vault);
       if((await catalogueBinding(source.root))?.id!==item.sourceId||(await workspaceRename(source.root))?.id!==value.id)throw new AppError('STORAGE_MOVE_STATE');
       const children=value.transfer.owners.filter(other=>other.relative!==item.relative&&inside(source.root,at(scope.source,other.relative))).map(other=>path.relative(source.root,at(scope.source,other.relative)).split(path.sep).join('/'));await ownedProjectFolder(source.root,children);
       const stop=item.kind==='project'?'stopProjectForRename':'stopLabBookForRename',provider=databaseProvider();if(!provider?.[stop])throw new AppError('DATABASE_LOCATION');
       if(!marker)await provider[stop](source.root,item.ownerId,source.vault,value.id);
       const lease=await workspaceDatabaseLease(path.join(source.root,'.observanda/postgresql'));
       try{await (item.kind==='project'?assertProjectDatabaseStopped:assertLabBookDatabaseStopped)(source.root,item.ownerId,source.vault);}finally{await lease.close();}
       await this.checkpoint('source-owner-stopped',value,item.relative);
      }
      await atomicWrite(path.join(scope.source,MOVE_SOURCE),serialize({id:value.id,destination:scope.destination}));await this.checkpoint('retire-frozen',value);await this.check();await rename(scope.source,retired);await this.checkpoint('source-retired',value);
     }
     await persistRename(scope.source,retired);value.phase='retired';await this.command.save(value);await this.checkpoint('retired',value);
    }
    if(value.phase!=='retired')throw new AppError('STORAGE_MOVE_STATE');
    await removeRetiredProject({...scope,sourceDirectory:rootOwner.sourceIdentity},{ownerDirectories:value.transfer.owners.map(item=>item.relative).filter(Boolean),verify:!this.fresh,checkpoint:async(stage,...args)=>{await this.check();await this.checkpoint('retire:'+stage,value,...args);}});await this.checkpoint('source-removed',value);
   });
  });
 }
}
