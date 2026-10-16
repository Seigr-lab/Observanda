import path from 'node:path';
import {AppError} from './errors.js';
import {resumeWorkspaceRename} from './workspace-rename-recovery.js';
// The application retains only the requesting session's existing project
// grants through an authenticated parent-directory rename.
import {ProjectLocationAccess} from './project-location-access.js';
export async function withWorkspaceRenameSession(application,client,operation,options={}){
 let access=new ProjectLocationAccess(application,client,options);
 try{return await operation({
  begin:async(renames,name,settings)=>{
   const source=application.workspace.root;
   const result=await renames.begin(application.workspace,name,{...settings,withBook:(project,id,use)=>access.withBook(project,id,use),withProject:async(id,use)=>{
    await application.jobs.invalidateProject(id);return access.withProject(id,use);
   }});
   if(result.id)await access.renamed(renames,result.id,source,result.destination);
   return result;
  },
  resume:async(renames,id,settings)=>{
   const recovery=await renames.recovery(application.workspace.root);
   if(!recovery||recovery.value.id!==id)throw new AppError('STORAGE_RENAME_STATE');
   access.captureRename(recovery.value);
   let result=await resumeWorkspaceRename(renames,application.workspace.root,id,application.workspace.vault,settings);
   if(!result.id){
    await access.close();access=new ProjectLocationAccess(application,client,options);
    result=await renames.begin(application.workspace,path.basename(recovery.value.destination),{...settings,withBook:(project,book,use)=>access.withBook(project,book,use),withProject:async(project,use)=>{await application.jobs.invalidateProject(project);return access.withProject(project,use);}});
   }
   if(result.id)await access.renamed(renames,result.id,result.source,result.destination);
   return result;
  },
  install:target=>access.install(target,client)
 });}finally{await access.close();}
}
