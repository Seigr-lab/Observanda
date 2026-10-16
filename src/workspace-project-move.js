import {ProjectBookCopy} from './project-book-copy.js';
import {WORKSPACE_BUNDLE_MOVE,WORKSPACE_BUNDLE_MOVE_LEASE} from './workspace-transfer-controls.js';
export {WORKSPACE_BUNDLE_MOVE} from './workspace-transfer-controls.js';
import {withRetiredRecordCopy} from './project-retired-records.js';
// Compose independent project handoffs before relocating their workspace owner.
// Each completed project remains usable through the source workspace's registry.
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {readdir,opendir,unlink} from 'node:fs/promises';
import {Workspace,assertRegular,privateDirectory,atomicWrite,serialize} from './storage.js';
import {ProjectStorage} from './project-storage.js';
import {ProjectRegistry} from './project-registry.js';
import {ProjectMoves} from './project-move.js';
import {WorkspaceCopyRecovery} from './workspace-copy-recovery.js';
import {resolveLocation,prepareCopyDestination,probeLocation} from './locations.js';
import {moveWorkspace,readMoveReceipt,finishWorkspaceMove} from './workspace-move.js';
import {moveSource} from './workspace-move-state.js';
import {withWriterLease} from './writer-lease.js';
import {researchId} from './web/research-reference.js';
import {operationStage,operationAdvance,operationItem} from './operation-progress.js';
import {AppError} from './errors.js';
import {isStorageTemporary} from './storage-temporary.js';
import {cloneVault,clearVault} from './encryption.js';
const lease=WORKSPACE_BUNDLE_MOVE_LEASE,limit=32*1024*1024;
const inside=(parent,child)=>{const r=path.relative(parent,child);return r!==''&&r!=='..'&&!r.startsWith('..'+path.sep)&&!path.isAbsolute(r);};
const same=(a,b)=>['projectId','namespaceId','vaultId'].every(key=>a[key]===b[key]);
async function read(target){
 if(!await assertRegular(target.root,{missing:true,directory:true})||!await assertRegular(path.join(target.root,'.observanda'),{missing:true,directory:true}))return null;
 const file=path.join(target.root,WORKSPACE_BUNDLE_MOVE),stat=await assertRegular(file,{missing:true});if(!stat)return null;if(stat.size>limit)throw new AppError('STORAGE_MOVE_STATE');
 let value;try{value=JSON.parse(await target.readFile(file,'utf8'));}catch{throw new AppError('STORAGE_MOVE_STATE');}
 if(value?.version!==1||!researchId(value.id)||!researchId(value.workspaceId)||value.vaultId!==target.vault?.id||value.destination!==target.root||typeof value.source!=='string'||!path.isAbsolute(value.source)||path.resolve(value.source)!==value.source||value.source===value.destination||inside(value.source,value.destination)||inside(value.destination,value.source)||!['projects','workspace','complete'].includes(value.phase)||!Array.isArray(value.projects))throw new AppError('STORAGE_MOVE_STATE');
 const ids=new Set(),destinations=new Set();for(const entry of value.projects){
  if(!['projectId','namespaceId','vaultId','transferId'].every(key=>researchId(entry?.[key]))||typeof entry.root!=='string'||!path.isAbsolute(entry.root)||path.resolve(entry.root)!==entry.root||typeof entry.destination!=='string'||!path.isAbsolute(entry.destination)||path.resolve(entry.destination)!==entry.destination||!inside(value.destination,entry.destination)||ids.has(entry.projectId)||destinations.has(entry.destination))throw new AppError('STORAGE_MOVE_STATE');
  ids.add(entry.projectId);destinations.add(entry.destination);
 }
 return value;
}
async function save(target,value){const raw=serialize(value);if(Buffer.byteLength(raw)>limit-128)throw new AppError('LIMIT');await target.writeFile(path.join(target.root,WORKSPACE_BUNDLE_MOVE),raw);}
async function normalizeRegistry(target,value){
 const registry=new ProjectRegistry(target,value.workspaceId),current=await registry.read();
 if(current.value.projects.length!==value.projects.length||value.projects.some(entry=>{const saved=current.value.projects.find(other=>other.projectId===entry.projectId);return !saved||!same(entry,saved)||saved.root!==entry.destination;}))throw new AppError('CONFLICT');
 await registry.change(current.revision,entries=>entries);
}
export async function finishWorkspaceProjectMove(target,options={}){
 if(!await read(target))return finishWorkspaceMove(target.root,{...options,vault:target.vault});
 return withWriterLease(path.join(target.root,lease),async()=>{
  const value=await read(target);if(!value)throw new AppError('STORAGE_MOVE_STATE');
  const receipt=await readMoveReceipt(target.root);if(!receipt||receipt.id!==value.id||receipt.source!==value.source||value.phase==='projects')throw new AppError('STORAGE_MOVE_STATE');
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
  const outline=await this.source.outline(),registry=new ProjectRegistry(this.source,outline.metadata.id),current=await registry.read();
  if(current.value.projects.length&&typeof this.withProject!=='function')throw new AppError('ACCESS_LOCKED');
  for(const entry of current.value.projects){
   if(entry.root===destination||inside(entry.root,destination)||inside(destination,entry.root))throw new AppError('STORAGE_PATH');
   await this.withProject(entry.projectId,async owner=>{if(owner.root!==entry.root||owner.vault.id!==entry.vaultId||(await owner.outline()).metadata.id!==entry.namespaceId)throw new AppError('CONFLICT');const books=new ProjectBookCopy(owner);try{await books.prepare(this.withBook?((id,use)=>this.withBook(owner,id,use)):undefined,{relocation:true});}finally{books.close();}});
  }
  await this.check();const projects=current.value.projects.map(entry=>({...entry,transferId:randomUUID(),destination:path.resolve(destination,inside(this.source.root,entry.root)?path.relative(this.source.root,entry.root):path.join('projects',entry.projectId,path.basename(entry.root)))}));
  if(!await new WorkspaceCopyRecovery(this.source,destination).emptyPreparation())await prepareCopyDestination(destination);
  await this.checkpoint('claim');
  for(const name of await readdir(path.join(destination,'.observanda')))if(name.startsWith('.write-')&&isStorageTemporary(name)){const file=path.join(destination,'.observanda',name);await assertRegular(file);await unlink(file);}
  const value={version:1,id:randomUUID(),workspaceId:registry.workspaceId,vaultId:this.source.vault.id,source:this.source.root,destination,phase:'projects',projects};await save(target,value);await this.checkpoint('prepared');return {target,value};
 }
 async run(input,options={}){const vault=cloneVault(this.source.vault),source=new Workspace(this.source.root,vault);try{return await withRetiredRecordCopy(this.source,source,()=>new WorkspaceProjectMove(source,this).perform(input,options));}finally{clearVault(vault);}}
 async perform(input,{activate}={}){
  if(typeof activate!=='function')throw new AppError('INVALID');await this.check();const {target}=await this.prepare(input);
  return withWriterLease(path.join(target.root,lease),async()=>{
   const value=await read(target);if(!value||value.source!==this.source.root)throw new AppError('STORAGE_MOVE_STATE');
   if(value.phase==='complete')return {id:value.id,source:value.source,destination:target.root,phase:'complete',error:null};
   const registry=new ProjectRegistry(this.source,value.workspaceId),moves=new ProjectMoves(registry);
   if(value.phase==='projects'){
    const current=await registry.read();if(current.value.projects.length!==value.projects.length||value.projects.some(entry=>{const now=current.value.projects.find(other=>other.projectId===entry.projectId);return !now||!same(entry,now)||![entry.root,entry.destination].includes(now.root);} ))throw new AppError('CONFLICT');
    await operationStage('move-workspace-projects',{unit:'projects',total:value.projects.length},async()=>{
     for(const entry of [...value.projects].sort((a,b)=>a.root.length-b.root.length)){
      await this.check();operationItem(entry.summary?.title??path.basename(entry.root));const parents=value.projects.filter(other=>inside(other.destination,entry.destination)).map(other=>other.destination);
      if(path.dirname(entry.destination)!==target.root)await privateDirectory(target.root,path.relative(target.root,path.dirname(entry.destination)).split(path.sep).join('/'));
      await this.beforeMove(entry.projectId);await this.withProject(entry.projectId,async owner=>{
       await moves.run(entry.projectId,owner.vault,{id:entry.transferId,path:entry.destination,workspaceMoveId:value.id,destinationParents:parents,withBook:this.withBook?((id,use)=>this.withBook(owner,id,use)):undefined,onCopiedBook:this.onCopiedBook,checkpoint:(stage,...args)=>this.checkpoint('project:'+stage,{projectId:entry.projectId,args}),onAdopt:async latest=>this.onMovedProject(new ProjectStorage(latest.root,latest.projectId,owner.vault),entry.root,latest)});
       await this.onMovedProject(new ProjectStorage(entry.destination,entry.projectId,owner.vault),entry.root,await registry.locate(entry.projectId));
      });
      await this.checkpoint('project',entry.projectId);operationAdvance();
     }
    });
    const latest=await registry.read();if(latest.value.projects.length!==value.projects.length||value.projects.some(entry=>{const now=latest.value.projects.find(other=>other.projectId===entry.projectId);return !now||!same(entry,now)||now.root!==entry.destination;}))throw new AppError('CONFLICT');
    value.phase='workspace';await save(target,value);await this.checkpoint('projects');
   }
   // A resumed request reacquires current project grants from the registry,
   // including owners whose handoff finished before the previous process ended.
   for(const entry of value.projects)await this.withProject(entry.projectId,async owner=>this.onMovedProject(new ProjectStorage(entry.destination,entry.projectId,owner.vault),entry.root,await registry.locate(entry.projectId)));
   const receipt=await readMoveReceipt(target.root);let result;
   if(receipt){
    if(receipt.id!==value.id||receipt.source!==value.source)throw new AppError('STORAGE_MOVE_STATE');
    if(receipt.phase==='verified'){
     const marker=await moveSource(value.source);if(marker?.id!==value.id||marker.destination!==target.root)throw new AppError('STORAGE_MOVE_STATE');
     await unlink(path.join(target.root,'.observanda/copy-in-progress')).catch(error=>{if(error.code!=='ENOENT')throw error;});
     result=await moveWorkspace({...receipt,resume:true},{vault:this.source.vault,activate});
    }else{await activate(target.root,value.source);result=await finishWorkspaceMove(target.root,{vault:this.source.vault});}
   }else{
    const recovery=new WorkspaceCopyRecovery(this.source,target.root,{checkpoint:this.checkpoint,prepareDestination:()=>this.assertPrepared(target,value)}),retained=await recovery.read(),directory=await registry.read();
    const plan=retained?.plan??{source:value.source,destination:target.root,inventorySalt:value.id,projectRoots:value.projects.map(entry=>entry.root).filter(root=>inside(value.source,root))};
    result=await recovery.run(plan,directory,checkpoint=>moveWorkspace({...checkpoint.state.plan,id:value.id},{vault:this.source.vault,activate,recovery:checkpoint}));
   }
   if(result.phase==='complete'){await normalizeRegistry(target,value);value.phase='complete';await save(target,value);await this.checkpoint('complete');}
   return result;
  });
 }
 async assertPrepared(target,value){
  const retained=await read(target);if(retained?.id!==value.id||retained.phase!=='workspace')throw new AppError('STORAGE_MOVE_STATE');
  const roots=value.projects.map(entry=>entry.destination),files=new Set([WORKSPACE_BUNDLE_MOVE,lease,'.observanda/copy-in-progress']);
  async function walk(relative){const absolute=path.join(target.root,relative);if(roots.includes(absolute)){await assertRegular(absolute,{directory:true});return;}
   await assertRegular(absolute,{directory:true});for await(const child of await opendir(absolute)){
    const next=path.posix.join(relative,child.name);if(files.has(next)){await assertRegular(path.join(target.root,next));continue;}
    if(!child.isDirectory()||!roots.some(root=>root===path.join(target.root,next)||inside(path.join(target.root,next),root)))throw new AppError('EXISTS');await walk(next);
   }
  }
  // The internal directory also contains the explicit claim and marker.
  for(const name of await readdir(target.root)){if(name==='.observanda'){await assertRegular(path.join(target.root,name),{directory:true});for(const inner of await readdir(path.join(target.root,name))){const relative=name+'/'+inner;if(files.has(relative)){await assertRegular(path.join(target.root,relative));continue;}if(!roots.some(root=>root===path.join(target.root,relative)||inside(path.join(target.root,relative),root)))throw new AppError('EXISTS');await walk(relative);}}else await walk(name);}
  await atomicWrite(path.join(target.root,'.observanda/copy-in-progress'),'incomplete\n');
 }
}
