// Copy a selected project's descendants through their independent transfer owners.
// Only membership/lifecycle leases are shared; sibling project writers stay free.
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {ProjectBookCopy} from './project-book-copy.js';
import {copyProjectLocation} from './project-transfer.js';
import {projectCopyRoots} from './project-copy-boundaries.js';
import {selectProjectTree,writeProjectTree} from './project-tree-manifest.js';
import {withProjectLifecycle} from './project-lifecycle.js';
import {withProjectMembership,assertProjectCreationSettled,assertProjectRelocationsSettled} from './project-membership.js';
import {databaseProvider} from './workspace-database-context.js';
import {readAccess} from './access.js';
import {serialize} from './storage.js';
import {researchId} from './web/research-reference.js';
import {operationStage,operationItem,operationAdvance} from './operation-progress.js';
import {AppError} from './errors.js';
export class ProjectTreeCopy{
 constructor(registry,storage,{withProject,withProjectBook,portable=false}={}){this.registry=registry;this.storage=storage;this.withProject=withProject;this.withBook=withProjectBook;this.portable=portable;}
 async prepare(){
  const entries=(await this.registry.read()).value.projects;this.tree=selectProjectTree(this.storage,entries);
  if(this.tree.entries.length&&typeof this.withProject!=='function')throw new AppError('ACCESS_LOCKED');
  for(const entry of this.tree.entries)await this.withProject(entry.projectId,async storage=>{
   await withProjectLifecycle(this.registry,entry.projectId,'open',async()=>{}, {wait:false});
   if(storage.root!==entry.root||storage.vault.id!==entry.vaultId||(await storage.outline()).metadata.id!==entry.namespaceId)throw new AppError('CONFLICT');
   if(this.portable){const access=await readAccess(storage.root);if(!access.value.password&&!access.value.recovery)throw new AppError('STORAGE_PORTABLE_PROJECT_ACCESS',[path.basename(storage.root)]);}
   const books=new ProjectBookCopy(storage);try{await books.prepare(this.withBook?(id,use)=>this.withBook(storage,id,use):undefined,{portable:this.portable});}finally{books.close();}
  });
  await this.current();return this.tree;
 }
 async current(){const current=selectProjectTree(this.storage,(await this.registry.read()).value.projects);if(serialize(current.manifest)!==serialize(this.tree.manifest)||current.entries.some((entry,index)=>entry.root!==this.tree.entries[index].root))throw new AppError('CONFLICT');return current;}
 async using(operation){
  const parents=[this.storage.projectId,...this.tree.entries.map(entry=>entry.projectId)];
  return withProjectMembership(this.registry,parents,async()=>{
   await assertProjectCreationSettled(this.registry,parents);await assertProjectRelocationsSettled(this.registry,parents);await this.current();
   const ids=this.tree.entries.map(entry=>entry.projectId).sort();const next=index=>index===ids.length?operation():withProjectLifecycle(this.registry,ids[index],'open',()=>next(index+1),{wait:false});return next(0);
  },{wait:false});
 }
 async copy(target,receipt,save,{checkpoint=async()=>{}}={}){
  if(receipt.projectTree===undefined){receipt.projectTree=this.tree.manifest;receipt.projectTransfers=this.tree.entries.map(entry=>({projectId:entry.projectId,id:randomUUID()}));await save();}
  if(serialize(receipt.projectTree)!==serialize(this.tree.manifest)||!Array.isArray(receipt.projectTransfers)||receipt.projectTransfers.length!==this.tree.entries.length||receipt.projectTransfers.some((item,index)=>item.projectId!==this.tree.entries[index].projectId||!researchId(item.id))||new Set(receipt.projectTransfers.map(item=>item.id)).size!==receipt.projectTransfers.length)throw new AppError('CONFLICT');
  await operationStage('copy-child-projects',{unit:'projects',total:this.tree.entries.length},async()=>{
   for(const [index,entry] of this.tree.entries.entries()){
    const relative=this.tree.manifest.projects[index].relative,destination=path.join(target.root,...relative.split('/'));operationItem(relative);
    await this.withProject(entry.projectId,async storage=>{
     try{await copyProjectLocation(storage,destination,{id:receipt.projectTransfers[index].id,portable:this.portable,projectRoots:projectCopyRoots(storage.root,this.tree.entries),withBook:this.withBook?(id,use)=>this.withBook(storage,id,use):undefined,checkpoint:(stage,file)=>checkpoint('project-'+stage,{projectId:entry.projectId,file})});}
     finally{await databaseProvider()?.closeProject(destination);}
    });
    operationAdvance();await checkpoint('project',entry.projectId);
   }
  });
  await this.current();await writeProjectTree(target,this.tree.manifest);await checkpoint('project-tree');
 }
}
