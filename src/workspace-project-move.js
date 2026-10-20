import {assertProjectMoveDirectory} from './project-move-boundaries.js';
import {captureWorkspaceCopyDirectory} from './workspace-copy-directory.js';
import {withWorkspaceMoveDirectory} from './workspace-move-directory.js';
import {NativeProjectMoveBooks} from './native-project-book-move.js';
import {readWorkspaceProjectMove as read,saveWorkspaceProjectMove as save} from './workspace-project-move-state.js';
import {WORKSPACE_BUNDLE_MOVE,WORKSPACE_BUNDLE_MOVE_LEASE} from './workspace-transfer-controls.js';
export {WORKSPACE_BUNDLE_MOVE} from './workspace-transfer-controls.js';
import {withRetiredRecordCopy} from './project-retired-records.js';
// Compose independent project handoffs before relocating their workspace owner.
// Each completed project remains usable through the source workspace's registry.
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {readdir,opendir,unlink,rmdir} from 'node:fs/promises';
import {Workspace,assertRegular,privateDirectory,atomicWrite,serialize} from './storage.js';
import {ProjectStorage} from './project-storage.js';
import {ProjectRegistry} from './project-registry.js';
import {ProjectMoves} from './project-move.js';
import {WorkspaceCopyRecovery} from './workspace-copy-recovery.js';
import {resolveLocation,prepareCopyDestination,probeLocation} from './locations.js';
import {moveWorkspace,readMoveReceipt,finishWorkspaceMove} from './workspace-move.js';
import {moveSource} from './workspace-move-state.js';
import {withWriterLease} from './writer-lease.js';
import {operationStage,operationAdvance,operationItem} from './operation-progress.js';
import {AppError} from './errors.js';
import {isStorageTemporary} from './storage-temporary.js';
import {cloneVault,clearVault} from './encryption.js';
const lease=WORKSPACE_BUNDLE_MOVE_LEASE;
const inside=(parent,child)=>{const r=path.relative(parent,child);return r!==''&&r!=='..'&&!r.startsWith('..'+path.sep)&&!path.isAbsolute(r);};
const same=(a,b)=>['projectId','namespaceId','vaultId','parentId'].every(key=>a[key]===b[key]);
async function assertMoveRegistry(registry,directory,{complete=false}={}){
 return registry.inspect(async view=>{
  if(view.count!==directory.count)throw new AppError('CONFLICT');
  for await(const entry of directory.entries()){const row=await view.get(entry.projectId);if(row?.state!=='active'||!same(entry,row.entry)||!(complete?[entry.destination]:[entry.root,entry.destination]).includes(row.entry.root))throw new AppError('CONFLICT');}
  return view.revision;
 });
}
async function normalizeRegistry(target,value,directory){
 if(!directory)return withWorkspaceMoveDirectory(target,value,selected=>normalizeRegistry(target,value,selected));
 const registry=new ProjectRegistry(target,value.workspaceId),revision=await assertMoveRegistry(registry,directory,{complete:true});
 const changes=async function*(){for await(const entry of directory.entries()){const current=await registry.state(entry.projectId);if(current.revision!==revision||current.state!=='active')throw new AppError('CONFLICT');yield {state:'active',entry:current.entry};}};
 await registry.applyBatch(revision,changes());
}
export async function finishWorkspaceProjectMove(target,options={}){
 if(!await read(target))return finishWorkspaceMove(target.root,{...options,vault:target.vault});
 return withWriterLease(path.join(target.root,lease),async()=>{
  const value=await read(target);if(!value)throw new AppError('STORAGE_MOVE_STATE');
  const receipt=await readMoveReceipt(target.root);if(!receipt||receipt.id!==value.id||receipt.source!==value.source||value.version===2&&serialize(receipt.directory)!==serialize(value.directory)||value.phase==='projects')throw new AppError('STORAGE_MOVE_STATE');
  const result=await finishWorkspaceMove(target.root,{...options,vault:target.vault});
  if(result.phase==='complete'&&value.phase!=='complete'){await normalizeRegistry(target,value);value.phase='complete';await save(target,value);}
  return result;
 });
}
export async function checkWorkspaceMoveDestination(source,input){
 const root=await resolveLocation(input),value=await read(new Workspace(root,source.vault));
 if(value){if(value.source!==source.root||value.phase==='complete')throw new AppError('EXISTS');return {root,kind:'move',resume:true};}
 if(await new WorkspaceCopyRecovery(source,root).emptyPreparation())return {root,kind:'move',resume:true};
 return probeLocation(root);
}
export class WorkspaceProjectMove{
 constructor(source,{withProject,withBook,onCopiedBook,onMovedProject=async()=>{},beforeMove=async()=>{},check=async()=>{},checkpoint=async()=>{}}={}){this.beforeMove=beforeMove;this.source=source;this.withBook=withBook;this.onCopiedBook=onCopiedBook;this.withProject=withProject;this.onMovedProject=onMovedProject;this.check=check;this.checkpoint=checkpoint;}
 async prepare(input){
  const destination=await resolveLocation(input);if(destination===this.source.root||inside(this.source.root,destination)||inside(destination,this.source.root))throw new AppError('STORAGE_PATH');
  const target=new Workspace(destination,this.source.vault),retained=await read(target);if(retained){if(retained.source!==this.source.root)throw new AppError('STORAGE_MOVE_STATE');return {target,value:retained};}
  const outline=await this.source.outline(),registry=new ProjectRegistry(this.source,outline.metadata.id),pin=await captureWorkspaceCopyDirectory(registry);
  const value={version:2,projectPlacement:2,id:randomUUID(),workspaceId:registry.workspaceId,vaultId:this.source.vault.id,source:this.source.root,destination,phase:'projects',directory:pin};
  await withWorkspaceMoveDirectory(this.source,value,async directory=>{
   if(directory.count&&typeof this.withProject!=='function')throw new AppError('ACCESS_LOCKED');
   for await(const entry of directory.entries()){
    if(entry.root===destination||inside(entry.root,destination)||inside(destination,entry.root))throw new AppError('STORAGE_PATH');
    await this.withProject(entry.projectId,async owner=>{if(owner.root!==entry.root||owner.vault.id!==entry.vaultId||(await owner.outline()).metadata.id!==entry.namespaceId)throw new AppError('CONFLICT');await NativeProjectMoveBooks.authorize(owner,this.withBook?((id,use)=>this.withBook(owner,id,use)):undefined);});
   }
   await assertMoveRegistry(registry,directory);await this.check();
  });
  if(!await new WorkspaceCopyRecovery(this.source,destination).emptyPreparation())await prepareCopyDestination(destination);
  await this.checkpoint('claim');
  for(const name of await readdir(path.join(destination,'.observanda')))if(name.startsWith('.write-')&&isStorageTemporary(name)){const file=path.join(destination,'.observanda',name);await assertRegular(file);await unlink(file);}
  await save(target,value);await this.checkpoint('prepared');return {target,value};
 }
 async run(input,options={}){const vault=cloneVault(this.source.vault),source=new Workspace(this.source.root,vault);try{return await withRetiredRecordCopy(this.source,source,()=>new WorkspaceProjectMove(source,this).perform(input,options));}finally{clearVault(vault);}}
 async perform(input,{activate}={}){
  if(typeof activate!=='function')throw new AppError('INVALID');await this.check();const {target}=await this.prepare(input);
  return withWriterLease(path.join(target.root,lease),async()=>{
   const value=await read(target);if(!value||value.source!==this.source.root)throw new AppError('STORAGE_MOVE_STATE');
   if(value.phase==='complete')return {id:value.id,source:value.source,destination:target.root,phase:'complete',error:null};
   const receiptOwner=await readMoveReceipt(target.root)?target:this.source,registry=new ProjectRegistry(receiptOwner,value.workspaceId),moves=new ProjectMoves(registry);
   return withWorkspaceMoveDirectory(receiptOwner,value,async directory=>{
   if(value.phase==='projects'){
    await assertMoveRegistry(registry,directory);
    await operationStage('move-workspace-projects',{unit:'projects',total:directory.count},async()=>{
     for await(const entry of directory.entries()){
      await this.check();operationItem(entry.summary?.title??path.basename(entry.root));const parents=await directory.parents(entry);
      if(path.dirname(entry.destination)!==target.root)await privateDirectory(target.root,path.relative(target.root,path.dirname(entry.destination)).split(path.sep).join('/'));
      await this.beforeMove(entry.projectId);await this.withProject(entry.projectId,async owner=>{
       await moves.run(entry.projectId,owner.vault,{id:entry.transferId,path:entry.destination,workspaceMoveId:value.id,destinationParents:parents,...(value.version===2?{workspaceMove:{value,directory}}:{}),withBook:this.withBook?((id,use)=>this.withBook(owner,id,use)):undefined,onCopiedBook:this.onCopiedBook,checkpoint:(stage,...args)=>this.checkpoint('project:'+stage,{projectId:entry.projectId,args}),onAdopt:async latest=>this.onMovedProject(new ProjectStorage(latest.root,latest.projectId,owner.vault),entry.root,latest)});
       await this.onMovedProject(new ProjectStorage(entry.destination,entry.projectId,owner.vault),entry.root,await registry.locate(entry.projectId));
      });
      await this.checkpoint('project',entry.projectId);operationAdvance();
     }
    });
    await assertMoveRegistry(registry,directory,{complete:true});
    for await(const entry of directory.entries({reverse:true})){
     if(inside(value.source,entry.root)||!await directory.hasChildren(entry.projectId))continue;
     const receipt=await moves.read(entry.projectId);
     if(receipt?.phase!=='complete'||receipt.id!==entry.transferId||receipt.workspaceMoveId!==value.id||receipt.source!==entry.root||receipt.destination!==entry.destination||receipt.vaultId!==entry.vaultId||receipt.namespaceId!==entry.namespaceId||!(receipt.version===3?receipt.retainedCount:receipt.boundaries?.length)||!receipt.sourceDirectory)throw new AppError('STORAGE_MOVE_STATE');
     if(!await assertRegular(entry.root,{missing:true,directory:true}))continue;
     await assertProjectMoveDirectory(entry.root,receipt.sourceDirectory);
     try{await rmdir(entry.root);}catch(error){if(error.code==='ENOENT')continue;if(['ENOTEMPTY','EEXIST'].includes(error.code))throw new AppError('STORAGE_MOVE_CONTENTS');throw error;}
     await this.checkpoint('project-container',entry.projectId);
    }
    value.phase='workspace';await save(target,value);await this.checkpoint('projects');
   }
   await assertMoveRegistry(registry,directory,{complete:true});
   // A resumed request reacquires current project grants from the registry,
   // including owners whose handoff finished before the previous process ended.
   for await(const entry of directory.entries())await this.withProject(entry.projectId,async owner=>this.onMovedProject(new ProjectStorage(entry.destination,entry.projectId,owner.vault),entry.root,await registry.locate(entry.projectId)));
   const receipt=await readMoveReceipt(target.root);let result;
   if(receipt){
    if(receipt.id!==value.id||receipt.source!==value.source||value.version===2&&serialize(receipt.directory)!==serialize(value.directory))throw new AppError('STORAGE_MOVE_STATE');
    if(receipt.phase==='verified'){
     const marker=await moveSource(value.source);if(marker?.id!==value.id||marker.destination!==target.root)throw new AppError('STORAGE_MOVE_STATE');
     await unlink(path.join(target.root,'.observanda/copy-in-progress')).catch(error=>{if(error.code!=='ENOENT')throw error;});
     result=await moveWorkspace({...receipt,resume:true},{vault:this.source.vault,activate});
    }else{await activate(target.root,value.source);result=await finishWorkspaceMove(target.root,{vault:this.source.vault});}
   }else{
    const recovery=new WorkspaceCopyRecovery(this.source,target.root,{checkpoint:this.checkpoint,prepareDestination:()=>this.assertPrepared(target,value,directory)}),retained=await recovery.read();
    const captured=value.version===2?value.directory:await registry.read();
    const plan=retained?.plan??{source:value.source,destination:target.root,inventorySalt:value.id,...(value.version===2?{projectPlacement:2,projectRegistryRevision:value.directory.revision}:{projectRoots:value.projects.map(entry=>entry.root).filter(root=>inside(value.source,root))})};
    result=await recovery.run(plan,captured,checkpoint=>moveWorkspace({...checkpoint.state.plan,id:value.id,...(value.version===2?{directory:value.directory}:{})},{vault:this.source.vault,activate,recovery:checkpoint,moveDirectory:directory}));
   }
   if(result.phase==='complete'){await normalizeRegistry(target,value,directory);value.phase='complete';await save(target,value);await this.checkpoint('complete');}
   return result;
   });
  });
 }
 async assertPrepared(target,value,directory){
  const retained=await read(target);if(retained?.id!==value.id||retained.phase!=='workspace')throw new AppError('STORAGE_MOVE_STATE');
  const files=new Set([WORKSPACE_BUNDLE_MOVE,lease,'.observanda/copy-in-progress']);
  async function walk(relative){const absolute=path.join(target.root,relative);if(await directory.destination(absolute)){await assertRegular(absolute,{directory:true});return;}
   await assertRegular(absolute,{directory:true});for await(const child of await opendir(absolute)){
    const next=path.posix.join(relative,child.name);if(files.has(next)){await assertRegular(path.join(target.root,next));continue;}
    if(!child.isDirectory()||!await directory.destination(path.join(target.root,next))&&!await directory.destinationContainer(path.join(target.root,next)))throw new AppError('EXISTS');await walk(next);
   }
  }
  // The internal directory also contains the explicit claim and marker.
  for(const name of await readdir(target.root)){if(name==='.observanda'){await assertRegular(path.join(target.root,name),{directory:true});for(const inner of await readdir(path.join(target.root,name))){const relative=name+'/'+inner;if(files.has(relative)){await assertRegular(path.join(target.root,relative));continue;}if(!await directory.destination(path.join(target.root,relative))&&!await directory.destinationContainer(path.join(target.root,relative)))throw new AppError('EXISTS');await walk(relative);}}else await walk(name);}
  await atomicWrite(path.join(target.root,'.observanda/copy-in-progress'),'incomplete\n');
 }
}
