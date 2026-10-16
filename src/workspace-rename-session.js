// The application retains only the requesting session's existing project
// grants through an authenticated parent-directory rename.
import {ProjectLocationAccess} from './project-location-access.js';
export async function withWorkspaceRenameSession(application,client,operation,options={}){
 const access=new ProjectLocationAccess(application,client,options);
 try{return await operation({
  begin:async(renames,name,settings)=>{
   const source=application.workspace.root;
   const result=await renames.begin(application.workspace,name,{...settings,withBook:(project,id,use)=>access.withBook(project,id,use),withProject:async(id,use)=>{
    await application.jobs.invalidateProject(id);return access.withProject(id,use);
   }});
   if(result.id)await access.renamed(renames,result.id,source,result.destination);
   return result;
  },
  install:target=>access.install(target,client)
 });}finally{await access.close();}
}
