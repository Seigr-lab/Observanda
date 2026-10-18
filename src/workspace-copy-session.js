// The HTTP layer supplies activation; this owner keeps copy credentials alive
// through that handoff and erases its temporary keys on every exit path.
import {ProjectLocationAccess} from './project-location-access.js';
import {WorkspaceProjectCopy} from './workspace-project-copy.js';
import {WorkspaceCopyRecovery} from './workspace-copy-recovery.js';
import {resolveLocation,probeLocation} from './locations.js';
export async function withWorkspaceCopySession(application,client,operation,options={}) {
  const access=new ProjectLocationAccess(application,client,options);
  const bundle=new WorkspaceProjectCopy(application.workspace,{...options,withProject:(id,use)=>access.withProject(id,use),withBook:(project,id,use)=>access.withBook(project,id,use),onCopiedBook:owner=>access.books.copied(owner),onCopiedProject:owner=>access.copied(owner)});
  try {
    return await operation({
      plan:(input,options)=>bundle.plan(input,options),
      copy:async plan=>{const destination=await bundle.copy(plan,{activateCatalogue:true});await access.seal(destination);return destination;},
      encrypted:async(plan,grant,vault)=>{const destination=await bundle.encrypted(plan,grant,vault);await access.seal(destination);return destination;},
      exportPortable:input=>bundle.exportPortable(input),
      portable:plan=>bundle.copy(plan,{activateCatalogue:false}),
      install:targetApplication=>access.install(targetApplication,client)
    });
  } finally {await access.close();}
}

export async function checkWorkspaceCopyDestination(workspace,input){
 const root=await resolveLocation(input),recovery=new WorkspaceCopyRecovery(workspace,root);
 try{return await probeLocation(root);}
 catch(error){
  if(error.code!=='STORAGE_INCOMPLETE')throw error;
  if(await recovery.plan())return {root,kind:'copy',resume:true};
  if(await recovery.emptyPreparation())return {root,kind:'new',resume:true};
  throw error;
 }
}
