// A selected tree retains native identity pages; credentials stay with each
// independent owner and are used only while its transfer is awaited.
import path from 'node:path';
import {ProjectBookCopy} from './project-book-copy.js';
import {copyProjectLocation} from './project-transfer.js';
import {captureProjectTreeDirectory,verifyProjectTreeDirectory,writeProjectTree,validateProjectTree} from './project-tree-manifest.js';
import {withProjectLifecycle} from './project-lifecycle.js';
import {withProjectMembership,assertProjectCreationSettled,assertProjectRelocationsSettled} from './project-membership.js';
import {workspaceCopyTransferId} from './workspace-copy-directory.js';
import {databaseProvider} from './workspace-database-context.js';
import {readAccess} from './access.js';
import {serialize,digest} from './storage.js';
import {researchId} from './web/research-reference.js';
import {operationStage,operationItem,operationAdvance} from './operation-progress.js';
import {AppError} from './errors.js';
export class ProjectTreeCopy{
 constructor(registry,storage,{withProject,withProjectBook,portable=false}={}){Object.assign(this,{registry,storage,withProject,withBook:withProjectBook,portable});}
 prepare(){return this.storage.withCatalogueConnections(()=>this.registry.workspace.withCatalogueConnections(()=>this.prepareTree()));}
 async prepareTree(){
  this.tree=await captureProjectTreeDirectory(this.registry,this.storage);
  if(this.tree.count&&typeof this.withProject!=='function')throw new AppError('ACCESS_LOCKED');
  for await(const entry of this.tree.entries())await this.withProject(entry.projectId,async storage=>{
   await withProjectLifecycle(this.registry,entry.projectId,'open',async()=>{}, {wait:false});
   if(storage.root!==entry.root||storage.vault.id!==entry.vaultId||(await storage.outline()).metadata.id!==entry.namespaceId)throw new AppError('CONFLICT');
   if(this.portable){const access=await readAccess(storage.root);if(!access.value.password&&!access.value.recovery)throw new AppError('STORAGE_PORTABLE_PROJECT_ACCESS',[path.basename(storage.root)]);}
   const books=new ProjectBookCopy(storage);try{await books.prepare(this.withBook?(id,use)=>this.withBook(storage,id,use):undefined,{portable:this.portable});}finally{books.close();}
  });
  await this.current();await writeProjectTree(this.storage,this.tree.manifest);return this.tree;
 }
 current(){return this.storage.withCatalogueConnections(()=>this.registry.workspace.withCatalogueConnections(()=>verifyProjectTreeDirectory(this.registry,this.storage,this.tree)));}
 boundary(root){const relative=path.relative(this.storage.root,root).split(path.sep).join('/');return digest(serialize({tree:this.tree.manifest,relative}));}
 exclude(root){return async candidate=>{const relative=path.relative(this.storage.root,candidate).split(path.sep).join('/');return candidate!==root&&!!await this.tree.collection.get(relative);};}
 async legacyRoots(root){const roots=[];for await(const entry of this.tree.entries()){const relative=path.relative(root,entry.root);if(relative&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative))roots.push(entry.root);if(roots.length>4096)throw new AppError('CONFLICT');}return roots;}
 async using(operation){
  const iterator=this.tree.collection.entries({index:'project'})[Symbol.asyncIterator]();
  const next=async()=>{const selected=await iterator.next();if(selected.done){await this.current();return operation();}const id=selected.value.projectId;
   return withProjectMembership(this.registry,[id],async()=>{await assertProjectCreationSettled(this.registry,[id]);await assertProjectRelocationsSettled(this.registry,[id]);return id===this.storage.projectId?next():withProjectLifecycle(this.registry,id,'open',next,{wait:false});},{wait:false});};
  try{return await next();}finally{await iterator.return?.();}
 }
 async copy(target,receipt,save,{checkpoint=async()=>{}}={}){
  if(receipt.projectTree===undefined){receipt.projectTree=this.tree.manifest;receipt.projectTransfersVersion=2;await save();}
  const saved=validateProjectTree(receipt.projectTree);if(['projectId','namespaceId','vaultId'].some(key=>saved[key]!==this.tree.manifest[key]))throw new AppError('CONFLICT');
  if(saved.version===2){if(serialize(saved)!==serialize(this.tree.manifest)||receipt.projectTransfersVersion!==2)throw new AppError('CONFLICT');}
  else{
   if(saved.projects.length!==this.tree.count||!Array.isArray(receipt.projectTransfers)||receipt.projectTransfers.length!==this.tree.count||receipt.projectTransfers.some(item=>!researchId(item.id))||new Set(receipt.projectTransfers.map(item=>item.id)).size!==this.tree.count)throw new AppError('CONFLICT');
   for(const entry of saved.projects){const current=await this.tree.collection.find('project',entry.projectId);if(!current||['projectId','namespaceId','vaultId','parentId','relative'].some(key=>current[key]!==entry[key]))throw new AppError('CONFLICT');}
  }
  await operationStage('copy-child-projects',{unit:'projects',total:this.tree.count},async()=>{
   for await(const entry of this.tree.entries()){
    const destination=path.join(target.root,...entry.relative.split('/'));operationItem(entry.relative);
    const id=receipt.projectTransfersVersion===2?workspaceCopyTransferId(receipt.id,entry.projectId):receipt.projectTransfers.find(item=>item.projectId===entry.projectId)?.id;if(!researchId(id))throw new AppError('CONFLICT');
    await this.withProject(entry.projectId,async storage=>{
     try{await copyProjectLocation(storage,destination,{id,portable:this.portable,excludeProject:this.exclude(storage.root),boundaryRevision:this.boundary(storage.root),legacyProjectRoots:()=>this.legacyRoots(storage.root),withBook:this.withBook?(id,use)=>this.withBook(storage,id,use):undefined,checkpoint:(stage,file)=>checkpoint('project-'+stage,{projectId:entry.projectId,file})});}
     finally{await databaseProvider()?.closeProject(destination);}
    });operationAdvance();await checkpoint('project',entry.projectId);
   }
  });await this.current();await writeProjectTree(target,this.tree.manifest);await checkpoint('project-tree');
 }
}
