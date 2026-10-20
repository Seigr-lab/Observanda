import path from 'node:path';
import {AppError} from './errors.js';
import {Workspace} from './storage.js';
import {resumeWorkspaceRename} from './workspace-rename-recovery.js';
import {ProjectLocationAccess} from './project-location-access.js';
import {ScopedLocationAccess} from './scoped-location-access.js';
import {portabilityCollection} from './portability-collection.js';
// Native callbacks borrow one owner at a time. Only existing client grants are
// staged through activation; retained recovery keys never become login grants.
export async function withWorkspaceRenameSession(application,client,operation,options={}){
 return ScopedLocationAccess.run(application,client,options,async scoped=>{
  let legacy;
  const legacyAccess=()=>legacy??=new ProjectLocationAccess(application,client,options);
  const settingsFor=(access,settings)=>({...settings,check:item=>scoped.check(item),withBook:(project,id,use)=>access.withBook(project,id,use),withProject:async(id,use)=>{await application.jobs.invalidateProject(id);return access.withProject(id,use);}});
  const retain=async(renames,result)=>{
   if(!result.id)return;const receipt=await renames.read(result.id);
   if(receipt.version===2)await scoped.renamed(portabilityCollection(new Workspace(result.destination,application.workspace.vault),receipt.owners),result.source,result.destination);
   else await legacyAccess().renamed(renames,result.id,result.source,result.destination);
  };
  try{return await operation({
   begin:async(renames,name,settings)=>{
    const native=application.workspace.vault&&await application.workspace.storageKind()==='catalogue',result=await renames.begin(application.workspace,name,settingsFor(native?scoped:legacyAccess(),settings));await retain(renames,result);return result;
   },
   resume:async(renames,id,settings)=>{
    const recovery=await renames.recovery(application.workspace.root);if(!recovery||recovery.value.id!==id)throw new AppError('STORAGE_RENAME_STATE');
    if(recovery.value.version!==2)legacyAccess().captureRename(recovery.value);
    let result=await resumeWorkspaceRename(renames,application.workspace.root,id,application.workspace.vault,{...settings,check:item=>scoped.check(item)});
    if(!result.id){if(legacy){await legacy.close();legacy=null;}const native=application.workspace.vault&&await application.workspace.storageKind()==='catalogue';result=await renames.begin(application.workspace,path.basename(recovery.value.destination),settingsFor(native?scoped:legacyAccess(),settings));}
    await retain(renames,result);return result;
   },
   install:target=>legacy?legacy.install(target,client):scoped.install(target,client)
  });}finally{await legacy?.close();}
 });
}
