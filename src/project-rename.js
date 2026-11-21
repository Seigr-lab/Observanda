import {NativeProjectRelocation} from './native-project-relocation.js';
import {NativeRelocationOwners} from './native-relocation-owners.js';
// A project rename carries its existing nested owners. Only names, registry
// locations and recovery receipts change; record and evidence bytes stay put.
import {withProjectLifecycle} from './project-lifecycle.js';
import {privateDirectory,serialize} from './storage.js';
import {validateStorageName} from './storage-names.js';
import {projectRenameFile,readProjectRename,validProjectRenameSettings} from './project-rename-receipt.js';
import {nestedRenameRoot} from './workspace-rename-paths.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
export class ProjectRenames{
 constructor(registry,projectId){if(!researchId(projectId))throw new AppError('INVALID');this.registry=registry;this.projectId=projectId;}
 read(){return readProjectRename(this.registry,this.projectId);}
 async save(value){await privateDirectory(this.registry.workspace.root,'.observanda/project-renames');await this.registry.workspace.writeFile(projectRenameFile(this.registry,this.projectId),serialize(value));}
 scope(value){return {...value,source:nestedRenameRoot(this.registry.workspace.root,value.source),destination:nestedRenameRoot(this.registry.workspace.root,value.destination)};}
 async run(storage,{id,name,expectedName,settings=null,placement=null,withProject,withBook,check=async()=>{},checkpoint=async()=>{}}){
  if(settings!==null&&(!validProjectRenameSettings(settings)||settings.project?.id!==this.projectId||settings.project.title!==name||settings.project.parentId!=null))throw new AppError('INVALID');
  if(storage?.projectId!==this.projectId||!researchId(id))throw new AppError('INVALID');validateStorageName(name);validateStorageName(expectedName);if(placement&&name!==expectedName)throw new AppError('INVALID');
  return new NativeProjectRelocation(this).run(storage,{id,name,expectedName,settings,placement,withProject,withBook,check,checkpoint});
 }
 async cancelPrepared(vault,{check=async()=>{}}={}){return withProjectLifecycle(this.registry,this.projectId,'rename',async()=>{await check();const value=await this.read();if(!value||value.phase==='cancelled')return;if(!['preparing','prepared'].includes(value.phase))throw new AppError('STORAGE_RENAMING');await new NativeRelocationOwners(this,value,vault).discardPrepared();});}
 resume(vault,options={}){return new NativeProjectRelocation(this).resume(vault,options);}
}
