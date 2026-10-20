// Parent deletion promotes independent subprojects by the normal native
// placement command. A durable plan identifies each source and operation;
// a retry never invents a new destination or repeats a completed placement.
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {readFile,realpath} from 'node:fs/promises';
import {ProjectRenames} from './project-rename.js';
import {WorkspaceProjectRename} from './workspace-project-rename.js';
import {ProjectBookOwners} from './project-book-owners.js';
import {directoryIdentity,sameDirectory} from './project-rename-receipt.js';
import {assertRegular,digest} from './storage.js';
import {researchId} from './web/research-reference.js';
import {validateStorageName} from './storage-names.js';
import {operationStage,operationAdvance,operationItem} from './operation-progress.js';
import {AppError} from './errors.js';
import {projectRegistryDescendantPrefix} from './project-registry-locations.js';
export const insideProject=(root,child)=>{const relative=path.relative(root,child);return relative!==''&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
const hash=async root=>digest(await readFile(path.join(root,'.observanda/access.json')));
export function validatePreservedChildren(value,source,workspace){
 if(!Array.isArray(value)||!value.length||value.length>50000)throw new AppError('STORAGE_DELETE_STATE');
 const ids=new Set(),names=new Set();
 for(const item of value){
  if(!item||Object.keys(item).sort().join()!=='accessHash,directory,id,identity,namespaceId,projectId,vaultId'||![item.id,item.projectId,item.namespaceId,item.vaultId].every(researchId)||ids.has(item.projectId)||names.has(item.directory)||!['dev','ino'].every(key=>typeof item.identity?.[key]==='string')||!/^[a-f0-9]{64}$/.test(item.accessHash??''))throw new AppError('STORAGE_DELETE_STATE');
  validateStorageName(item.directory,{nameError:'STORAGE_DELETE_STATE'});if(item.directory.toLowerCase()==='.observanda'||path.join(workspace,item.directory)===source)throw new AppError('STORAGE_DELETE_STATE');ids.add(item.projectId);names.add(item.directory);
 }
 return value;
}
export class ProjectChildPreservation{
 constructor(registry,project){this.registry=registry;this.project=project;this.children=[];}
 async prepare(prior,{withProject,withBook}){
  const nested=await physicalProjectDescendants(this.registry,this.project.root),direct=nested.filter(entry=>entry.parentId===this.project.projectId);
  this.children=prior??direct.map(entry=>({id:randomUUID(),projectId:entry.projectId,namespaceId:entry.namespaceId,vaultId:entry.vaultId,directory:path.basename(entry.root)}));
  if(!this.children.length)return [];
  if(typeof withProject!=='function')throw new AppError('ACCESS_LOCKED');
  if(nested.some(entry=>!this.children.some(child=>entry.root===path.join(this.project.root,child.directory)||insideProject(path.join(this.project.root,child.directory),entry.root))))throw new AppError('CONFLICT');
  for(const child of this.children){
   const source=path.join(this.project.root,child.directory),target=path.join(this.registry.workspace.root,child.directory);
   if(source===target||source===this.registry.workspace.root||target===this.project.root)throw new AppError('STORAGE_PATH');
   let current=await this.registry.locate(child.projectId),pending=await new ProjectRenames(this.registry,child.projectId).read();
   if(pending&&!['complete','cancelled'].includes(pending.phase)&&pending.id!==child.id)throw new AppError('STORAGE_PROJECT_BUSY');
   await withProject(child.projectId,async storage=>{
    current=await this.registry.locate(child.projectId);
    if(storage.root!==current.root||storage.vault.id!==child.vaultId||current.namespaceId!==child.namespaceId||![source,target].includes(current.root)||current.root===source&&current.parentId!==this.project.projectId||current.root===target&&current.parentId!==null||await realpath(current.root)!==current.root)throw new AppError('CONFLICT');
    const identity=directoryIdentity(await assertRegular(current.root,{directory:true})),accessHash=await hash(current.root);
    if(prior&&(!sameDirectory(identity,child.identity)||accessHash!==child.accessHash))throw new AppError('CONFLICT');
    if(current.root===target){
     const completed=await new ProjectRenames(this.registry,child.projectId).read();if(completed?.id!==child.id||completed.phase!=='complete')throw new AppError('CONFLICT');return;
    }
    if(await assertRegular(target,{directory:true,missing:true}))throw new AppError('EXISTS');
    const projects=new WorkspaceProjectRename(storage,{registry:this.registry}),books=new ProjectBookOwners(storage);
    try{await projects.prepare(withProject,withBook);await books.prepare(typeof withBook==='function'?(id,use)=>withBook(storage,id,use):undefined);}finally{projects.close();books.close();}
    child.identity=identity;child.accessHash=accessHash;
   });
  }
  return validatePreservedChildren(this.children,this.project.root,this.registry.workspace.root);
 }
 async run({withProject,withBook,check,checkpoint=async()=>{},placeChild}){
  if(!this.children.length)return;
  return operationStage('delete-preserve-projects',{unit:'projects',total:this.children.length},async()=>{
   for(const child of this.children){
    operationItem(child.directory);const target=path.join(this.registry.workspace.root,child.directory),entry=await this.registry.locate(child.projectId);
    if(entry.root!==target){
     const renames=new ProjectRenames(this.registry,child.projectId);
     if(placeChild)await placeChild(child,{parentId:null,expectedParentId:this.project.projectId});
     else{const storage=await withProject(child.projectId,storage=>storage);await renames.run(storage,{id:child.id,name:child.directory,expectedName:child.directory,placement:{parentId:null,expectedParentId:this.project.projectId},withProject,withBook,check,checkpoint:(stage,value)=>checkpoint('preserve-'+stage,value,child.projectId)});}
    }
    const current=await this.registry.locate(child.projectId);if(current.root!==target||current.parentId!==null||!sameDirectory(directoryIdentity(await assertRegular(target,{directory:true})),child.identity))throw new AppError('STORAGE_DELETE_STATE');
    await checkpoint('child-preserved',child);operationAdvance();
   }
  });
 }
}

export async function physicalProjectDescendants(registry,root){return registry.inspect(async view=>{const entries=[];for await(const row of view.entries({index:'location',prefix:projectRegistryDescendantPrefix(root,registry.workspace.root)}))entries.push(row.entry);return entries;});}
