import {persistRename} from './filesystem-persistence.js';
import {NativeProjectMove,validateNativeProjectMove,projectMoveAccessOwners} from './native-project-move.js';
import {projectRegistryDescendantPrefix} from './project-registry-locations.js';
import {ProjectBookCopy} from './project-book-copy.js';
import {ProjectBookMove,validateMoveBooks,clearMoveBookKeys} from './project-book-move.js';
import {requireStorageName,storageFolderName} from './storage-names.js';
import {assertRenameDatabaseOwners} from './workspace-rename-inventory.js';
import {cancelProjectTransfer,canCancelProjectMove,transferTerminal} from './project-transfer-cancellation.js';
import {projectCopyRoots,projectCopyBoundaries,retainedCopyRoots} from './project-copy-boundaries.js';
import {ownedProjectFolder,projectMoveDirectory,assertProjectMoveDirectory} from './project-move-boundaries.js';
import {removeRetiredProject} from './project-move-retirement.js';
import {withProjectLifecycle} from './project-lifecycle.js';
// A move has one selected project owner. Registry adoption and retirement are
// journalled independently so a restart can finish either without recopying.
import path from 'node:path';
import {realpath} from 'node:fs/promises';
import {atomicReplace as rename} from './atomic-replace.js';
import {ProjectStorage} from './project-storage.js';
import {copyProjectLocation} from './project-transfer.js';
import {assertRegular,privateDirectory,atomicWrite,serialize} from './storage.js';
import {catalogueBinding} from './postgres-activation.js';
import {databaseRetention,validDatabaseRetention,verifyDatabaseRetention} from './workspace-database-retention.js';
import {databaseProvider} from './workspace-database-context.js';
import {assertProjectDatabaseStopped} from './project-postgres.js';
import {readAccess} from './access.js';
import {authenticateKeyring} from './security/keyring.js';
import {MOVE_SOURCE,moveSource} from './workspace-move-state.js';
import {withWriterLease} from './writer-lease.js';
import {resolveLocation} from './locations.js';
import {researchId} from './web/research-reference.js';
import {withOperationProgress,operationSequence,operationStage} from './operation-progress.js';
import {projectTransferRunning,trackProjectTransfer} from './project-transfer-tasks.js';
import {AppError} from './errors.js';
const within=(a,b)=>{const relative=path.relative(a,b);return relative===''||!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);};
const retired=value=>path.join(path.dirname(value.source),'.observanda-project-move-'+value.id);
const status=value=>value?{id:value.id,projectId:value.projectId,source:value.source,destination:value.destination,phase:value.phase}:null;
export class ProjectMoves{
 constructor(registry){this.registry=registry;this.workspace=registry.workspace;}
 file(projectId){if(!researchId(projectId))throw new AppError('INVALID');return path.join(this.workspace.root,'.observanda/project-moves',projectId+'.obsv');}
 async read(projectId){
  const file=this.file(projectId),stat=await assertRegular(file,{missing:true});if(!stat)return null;if(stat.size>16*1024*1024)throw new AppError('STORAGE_MOVE_STATE');
  let value;try{value=JSON.parse(await this.workspace.readFile(file,'utf8'));}catch{throw new AppError('STORAGE_MOVE_STATE');}
  if(value?.version===3){if(value.projectId!==projectId)throw new AppError('STORAGE_MOVE_STATE');return validateNativeProjectMove(value);}
  if(![1,2].includes(value?.version)||value.projectId!==projectId||!researchId(value.id)||!researchId(value.vaultId)||!researchId(value.namespaceId)||!researchId(value.sourceId)||!['copying','verified','adopted','retired','complete','cancelled'].includes(value.phase)||value.workspaceMoveId!==undefined&&!researchId(value.workspaceMoveId)||![value.source,value.destination].every(root=>typeof root==='string'&&path.isAbsolute(root)&&path.resolve(root)===root&&root!==path.parse(root).root)||within(value.source,value.destination)||within(value.destination,value.source)||!['copying','cancelled'].includes(value.phase)&&(!researchId(value.destinationId)||!validDatabaseRetention(value.retention)))throw new AppError('STORAGE_MOVE_STATE');
  if(value.version===1&&(value.boundaries!==undefined||value.sourceDirectory!==undefined))throw new AppError('STORAGE_MOVE_STATE');
  try{retainedCopyRoots(value);}catch{throw new AppError('STORAGE_MOVE_STATE');}
  if(value.boundaries?.length&&(!value.sourceDirectory||!['dev','ino'].every(key=>/^[0-9]+$/.test(value.sourceDirectory[key]))))throw new AppError('STORAGE_MOVE_STATE');
  validateMoveBooks(value);return value;
 }
 ownerDirectory(value){return projectMoveAccessOwners(this.workspace,value);}
 async save(value){const raw=serialize(value);if(Buffer.byteLength(raw)>16*1024*1024-128)throw new AppError('LIMIT');await this.workspace.writeFile(this.file(value.projectId),raw);}
 async status(projectId){const value=await this.read(projectId);return value?{...status(value),running:projectTransferRunning(this.file(projectId)),canCancel:!projectTransferRunning(this.file(projectId))&&(value.version===3?!value.workspaceMoveId&&['preparing','prepared','frozen','copying','verified','cancelling','cancel-releasing'].includes(value.phase):await canCancelProjectMove(value))}:null;}
 async cancel(storage,{id,checkpoint}={}){const value=await this.read(storage.projectId);if(value?.version===3)return trackProjectTransfer(this.file(storage.projectId),()=>withProjectLifecycle(this.registry,storage.projectId,'move',()=>withWriterLease(path.join(path.dirname(this.file(storage.projectId)),storage.projectId+'.lock'),async()=>status(await new NativeProjectMove(this).cancel(storage,{id,checkpoint})))));return status(await cancelProjectTransfer(this.registry,storage,{id,kind:'move',file:this.file(storage.projectId),read:()=>this.read(storage.projectId),save:value=>this.save(value)}));}
 async run(projectId,vault,options){return trackProjectTransfer(this.file(projectId),()=>withProjectLifecycle(this.registry,projectId,'move',()=>this.perform(projectId,vault,options)));}
 async perform(projectId,vault,{id,path:input,resume=false,onProgress,checkpoint=async()=>{},adoptOnly=false,onAdopt=async()=>{},destinationParents=[],workspaceMoveId,workspaceMove,withBook,onCopiedBook}={}){
  if(!researchId(projectId)||!researchId(id)||typeof checkpoint!=='function'||workspaceMoveId!==undefined&&!researchId(workspaceMoveId)||!vault?.key||!Array.isArray(destinationParents)||destinationParents.some(root=>typeof root!=='string'||!path.isAbsolute(root)))throw new AppError('INVALID');
  const directory=await privateDirectory(this.workspace.root,'.observanda/project-moves');
  return withOperationProgress(onProgress,()=>withWriterLease(path.join(directory,projectId+'.lock'),()=>operationSequence('move-project',['copy-project','activate-destination','remove-original'],async()=>{
   let value=await this.read(projectId),entry=await this.registry.locate(projectId);
   if(value?.version===3||(!workspaceMoveId||workspaceMove)&&(!value||value.id!==id&&transferTerminal(value.phase)))return status(await new NativeProjectMove(this).run(projectId,vault,{id,path:input,resume,checkpoint,adoptOnly,onAdopt,withBook,onCopiedBook,workspaceMoveId,workspaceMove},value));
   if(value&&value.id!==id&&!transferTerminal(value.phase))throw new AppError('CONFLICT');
   if(value?.id===id){
    if(value.vaultId!==vault.id||input!==undefined&&await resolveLocation(input)!==value.destination)throw new AppError('CONFLICT');
    if(workspaceMoveId!==undefined&&value.workspaceMoveId!==undefined&&value.workspaceMoveId!==workspaceMoveId)throw new AppError('CONFLICT');
    if(transferTerminal(value.phase)){if(value.phase==='complete')await clearMoveBookKeys(new ProjectStorage(value.destination,projectId,vault),value);return status(value);}
    if(workspaceMoveId!==undefined&&value.workspaceMoveId===undefined){value.workspaceMoveId=workspaceMoveId;await this.save(value);}
   }else{
    if(resume||adoptOnly)throw new AppError('NOT_FOUND');
    const destination=await resolveLocation(input),source=await realpath(entry.root),members=await this.registry.inspect(async view=>{const selected=new Map([[entry.projectId,entry]]);for await(const row of view.entries({index:'location',prefix:projectRegistryDescendantPrefix(source,this.workspace.root)}))selected.set(row.entry.projectId,row.entry);for(const row of (await view.page({index:'location',prefix:projectRegistryDescendantPrefix(destination,this.workspace.root),limit:1})).items)selected.set(row.entry.projectId,row.entry);for(let parent=destination;;parent=path.dirname(parent)){const row=await view.get(this.registry.locationKey(parent),{index:'location'});if(row)selected.set(row.entry.projectId,row.entry);if(parent===path.dirname(parent))break;}for(const parent of destinationParents){const row=await view.get(this.registry.locationKey(parent),{index:'location'});if(row)selected.set(row.entry.projectId,row.entry);}return [...selected.values()];});
    if(within(source,destination)||within(destination,source)||within(this.workspace.root,destination)||within(destination,this.workspace.root)||members.some(item=>item.projectId!==projectId&&(within(destination,item.root)||within(item.root,destination)&&!destinationParents.includes(item.root))))throw new AppError('STORAGE_PATH');
    for(const parent of destinationParents){if(!members.some(item=>item.root===parent)||!within(parent,destination)||parent===destination||['.observanda/postgresql','.observanda/database-transition'].some(relative=>within(path.join(parent,relative),destination)))throw new AppError('STORAGE_PATH');}
    const boundaries=projectCopyBoundaries(source,projectCopyRoots(source,members)),books=new ProjectBookCopy(new ProjectStorage(source,projectId,vault));
    try{requireStorageName(destination,storageFolderName(source));await books.prepare(withBook,{relocation:true});await ownedProjectFolder(source,boundaries,books.books);await assertRenameDatabaseOwners(source,books.books.map(book=>path.join(source,book.directory)),{errorCode:'STORAGE_MOVE_CONTENTS',skipRoots:boundaries.map(relative=>path.resolve(source,...relative.split('/')))});}catch(error){error.operationNotStarted=true;throw error;}finally{books.close();}
    const access=await readAccess(source),binding=await catalogueBinding(source);authenticateKeyring(access.value,vault);
    if(entry.vaultId!==vault.id||binding?.placement!=='project'||binding.projectId!==projectId)throw new AppError('DATABASE_LOCATION');
    value={version:2,...(workspaceMoveId?{workspaceMoveId}:{}),boundaries,...(boundaries.length?{sourceDirectory:await projectMoveDirectory(source)}:{}),id,projectId,source,destination,vaultId:vault.id,namespaceId:entry.namespaceId,sourceId:binding.id,phase:'copying'};await this.save(value);
   }
   const source=new ProjectStorage(value.source,projectId,vault),target=new ProjectStorage(value.destination,projectId,vault);
   const checkTarget=async()=>{
    authenticateKeyring((await readAccess(target.root)).value,vault);const binding=await catalogueBinding(target.root);
    if(binding?.placement!=='project'||binding.projectId!==projectId||binding.id!==value.destinationId||(await target.outline()).metadata.id!==value.namespaceId)throw new AppError('DATABASE_LOCATION');
   };
   const adopt=async()=>operationStage('activate-destination',{},async()=>{
    await checkTarget();
    for(let attempt=0;;attempt++){
     const current=await this.registry.state(projectId),registered=current.state==='active'?current.entry:null;
     if(registered?.vaultId!==value.vaultId||registered.namespaceId!==value.namespaceId)throw new AppError('CONFLICT');
     if(registered.root===value.destination)break;if(registered.root!==value.source)throw new AppError('CONFLICT');
     try{await this.registry.relocate(target,{from:value.source,expected:current.revision});break;}catch(error){if(error.code!=='CONFLICT'||attempt>=7)throw error;}
    }
    await onAdopt(await this.registry.locate(projectId));await checkpoint('registry');value.phase='adopted';await this.save(value);await checkpoint('adopted');
   });
   const freeze=async(copied,receipt,books)=>{
    if(receipt.namespaceId!==value.namespaceId||receipt.sourceId!==value.sourceId)throw new AppError('CONFLICT');
    value.destinationId=(await catalogueBinding(copied.root)).id;value.retention=await source.catalogue(store=>databaseRetention(store.db));
    await ownedProjectFolder(source.root,value.boundaries??[],books.books);
    await assertRenameDatabaseOwners(source.root,books.books.map(book=>path.join(source.root,book.directory)),{errorCode:'STORAGE_MOVE_CONTENTS',skipRoots:retainedCopyRoots(value)});
    await new ProjectBookMove(source).persist(copied,value,books);
    value.phase='verified';await this.save(value);await checkpoint('verified');
    await atomicWrite(path.join(source.root,MOVE_SOURCE),serialize({id,destination:value.destination,...(value.books?.length?{books:value.books.map(book=>book.directory)}:{})}));await checkpoint('frozen');await adopt();
   };
   const children=new ProjectBookMove(source);
   try{
   let fresh=false,verified=false;
   if(value.phase==='copying'){
    if(adoptOnly)return status(value);
    await operationStage('copy-project',{},()=>copyProjectLocation(source,value.destination,{id,relocation:true,projectRoots:retainedCopyRoots(value),withBook,onCopiedBook,checkpoint:async(stage,...args)=>checkpoint('copy:'+stage,...args),afterVerified:freeze}));fresh=true;
   }
   if(value.phase==='verified'){
    const marker=await moveSource(source.root);
    if(marker){
     if(marker.id!==id||marker.destination!==value.destination||serialize(marker.books??[])!==serialize((value.books??[]).map(book=>book.directory)))throw new AppError('STORAGE_MOVE_STATE');
     await checkTarget();await children.load(target,value);await children.verify(target,value);await verifyDatabaseRetention(target,value.retention);verified=true;await adopt();
    }else{
     // Interruption before freezing left the original usable. Recheck it under
     // its writer before committing a previously prepared destination.
     await copyProjectLocation(source,value.destination,{id,relocation:true,projectRoots:retainedCopyRoots(value),withBook,onCopiedBook,checkpoint:async(stage,...args)=>checkpoint('copy:'+stage,...args),afterVerified:freeze});
    }
   }
   if(['adopted','retired'].includes(value.phase))await onAdopt(await this.registry.locate(projectId));
   if(adoptOnly)return status(value);
   if(!['adopted','retired'].includes(value.phase))throw new AppError('STORAGE_MOVE_STATE');
   await checkTarget();entry=await this.registry.locate(projectId);if(entry.root!==target.root)throw new AppError('CONFLICT');
   if(!verified){await children.load(target,value);if(!fresh){await children.verify(target,value);await verifyDatabaseRetention(target,value.retention);}}
   await operationStage('remove-original',{unit:'files'},async()=>{
    const nested=!!value.boundaries?.length,retiredRoot=retired(value);
    if(nested)await assertProjectMoveDirectory(source.root,value.sourceDirectory);
    if(value.phase==='adopted'){
     if(!nested&&await assertRegular(retiredRoot,{directory:true,missing:true})){
      const marker=await moveSource(retiredRoot);if(marker?.id!==id||marker.destination!==target.root||serialize(marker.books??[])!==serialize((value.books??[]).map(book=>book.directory)))throw new AppError('STORAGE_MOVE_STATE');
     }else{
      await ownedProjectFolder(source.root,value.boundaries??[],value.books??[]);const marker=await moveSource(source.root),binding=await catalogueBinding(source.root);authenticateKeyring((await readAccess(source.root)).value,vault);
      if(marker?.id!==id||marker.destination!==target.root||serialize(marker.books??[])!==serialize((value.books??[]).map(book=>book.directory))||binding?.id!==value.sourceId||binding.projectId!==projectId)throw new AppError('STORAGE_MOVE_STATE');
      const provider=databaseProvider();if(!provider?.closeProject)throw new AppError('DATABASE_RUNTIME');
      await children.stop(value,{checkpoint});
      if(!provider.stopProjectForMove)throw new AppError('DATABASE_RUNTIME');
      await provider.stopProjectForMove(source.root,projectId,vault,id);await assertProjectDatabaseStopped(source.root,projectId,vault);await checkpoint('stopped');
      if(!nested){await rename(source.root,retiredRoot);await checkpoint('renamed');}
     }
     if(!nested)await persistRename(value.source,retiredRoot);value.phase='retired';await this.save(value);await checkpoint('retired');
    }
    await removeRetiredProject(value,{verify:!fresh,checkpoint});value.phase='complete';await this.save(value);await clearMoveBookKeys(target,value);await checkpoint('complete');
   });
   return status(value);
   }finally{children.close();}
  })));
 }
}
