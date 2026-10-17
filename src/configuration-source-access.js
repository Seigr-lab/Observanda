// Resolve a selected template through the same grants as its owning project.
// A pin carries identity and revision proof, never a filesystem location.
import {ProjectLocationAccess} from './project-location-access.js';
import {configurationOwner} from './configuration-commands.js';
import {AppError} from './errors.js';
export function configurationSourceAccess(application,client,{check=async()=>{}}={}){
 return async(pin,operation)=>{
  const selected=configurationOwner(pin);await check();
  if(application.closed)throw new AppError('ACCESS_LOCKED');
  if((await application.workspace.outline()).metadata.id===selected.workspaceId){const result=await operation(application.workspace);await check();return result;}
  const owners=new ProjectLocationAccess(application,client,{check});
  try{return await owners.withProject(selected.projectId,project=>selected.slot==='labBookTemplate'?operation(project):owners.withBook(project,selected.notebookId,operation));}
  finally{await owners.close();}
 };
}
