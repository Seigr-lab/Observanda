import {ProjectTreeCopy} from './project-tree-copy.js';
import {ProjectBookCopy} from './project-book-copy.js';
import {requireStorageName,storageFolderName} from './storage-names.js';
import {cancelProjectTransfer,transferTerminal} from './project-transfer-cancellation.js';
import {projectCopyRoots} from './project-copy-boundaries.js';
import {withProjectLifecycle} from './project-lifecycle.js';
// The workspace remembers a copy command, not the project's contents. A lost
// response or restarted window can resume the same destination and operation ID.
import path from 'node:path';
import {copyProjectLocation} from './project-transfer.js';
import {assertRegular,privateDirectory,serialize} from './storage.js';
import {resolveLocation} from './locations.js';
import {withWriterLease} from './writer-lease.js';
import {researchId} from './web/research-reference.js';
import {projectTransferRunning,trackProjectTransfer} from './project-transfer-tasks.js';
import {AppError} from './errors.js';
export class ProjectCopies{
 constructor(registry){this.registry=registry;this.workspace=registry.workspace;}
 get directory(){return '.observanda/project-copies';}
 get kind(){return 'copy';}
 get portable(){return false;}
 async prepare(storage,{withBook,portable=false}={}){const books=new ProjectBookCopy(storage);try{await books.prepare(withBook,{portable});}finally{books.close();}}
 transfer(storage,value,options){return copyProjectLocation(storage,value.destination,{...options,id:value.id,projectRoots:projectCopyRoots(storage.root,options.projects)});}
 file(projectId){if(!researchId(projectId))throw new AppError('INVALID');return path.join(this.workspace.root,this.directory,projectId+'.obsv');}
 async read(projectId){
  const file=this.file(projectId),stat=await assertRegular(file,{missing:true});if(!stat)return null;if(stat.size>8192)throw new AppError('STORAGE_COPY');
  let value;try{value=JSON.parse(await this.workspace.readFile(file,'utf8'));}catch{throw new AppError('STORAGE_COPY');}
  if(value?.version!==1||value.projectId!==projectId||!researchId(value.id)||!researchId(value.vaultId)||!['copying','complete','cancelled'].includes(value.phase)||![value.source,value.destination].every(root=>typeof root==='string'&&path.isAbsolute(root)&&path.resolve(root)===root))throw new AppError('STORAGE_COPY');return value;
 }
 async status(projectId){const value=await this.read(projectId);return value?{...value,running:projectTransferRunning(this.file(projectId)),canCancel:value.phase==='copying'}:null;}
 async cancel(storage,{id}={}){return cancelProjectTransfer(this.registry,storage,{id,kind:this.kind,file:this.file(storage.projectId),read:()=>this.read(storage.projectId),save:value=>this.workspace.writeFile(this.file(storage.projectId),serialize(value))});}
 async run(storage,options){return trackProjectTransfer(this.file(storage.projectId),()=>withProjectLifecycle(this.registry,storage.projectId,this.kind,()=>this.perform(storage,options)));}
 async perform(storage,{id,path:input,resume=false,onProgress,checkpoint,withBook,onCopiedBook,withProject,withProjectBook}={}){
  if(!researchId(id))throw new AppError('INVALID');const directory=await privateDirectory(this.workspace.root,this.directory);
  return withWriterLease(path.join(directory,storage.projectId+'.lock'),async()=>{
   const entry=await this.registry.locate(storage.projectId);if(entry.root!==storage.root||entry.vaultId!==storage.vault.id)throw new AppError('CONFLICT');
   let value=await this.read(storage.projectId),created=false;
   if(value?.id===id){if(value.vaultId!==storage.vault.id||input!==undefined&&await resolveLocation(input)!==value.destination)throw new AppError('CONFLICT');if(transferTerminal(value.phase))return value;if(value.source!==storage.root)throw new AppError('CONFLICT');}
   else{
    if(resume)throw new AppError('NOT_FOUND');if(value&&!transferTerminal(value.phase))throw new AppError('CONFLICT');
    value={version:1,id,projectId:storage.projectId,vaultId:storage.vault.id,source:storage.root,destination:await resolveLocation(input),phase:'copying'};created=true;
   }
   const tree=new ProjectTreeCopy(this.registry,storage,{withProject,withProjectBook,portable:this.portable});
   try{requireStorageName(value.destination,storageFolderName(storage.root));await this.prepare(storage,{withBook});await tree.prepare();}catch(error){if(created)error.operationNotStarted=true;throw error;}if(created)await this.workspace.writeFile(this.file(storage.projectId),serialize(value));
   await tree.using(()=>this.transfer(storage,value,{onProgress,checkpoint,withBook,onCopiedBook,projects:tree.tree.entries,beforeVerified:(target,receipt,save)=>tree.copy(target,receipt,save,{checkpoint})}));value.phase='complete';await this.workspace.writeFile(this.file(storage.projectId),serialize(value));return value;
  });
 }
}
