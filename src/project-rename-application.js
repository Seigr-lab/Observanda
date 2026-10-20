import {configurationCheckpoint} from './configuration-commands.js';
import {digest,serialize} from './storage-format.js';
import {projectTransferRunning} from './project-transfer-tasks.js';
import {ProjectSessionOwner} from './project-session-owner.js';
import {validProjectPlacement} from './project-placement.js';
import {workspaceRename} from './workspace-rename-state.js';
// Normal project settings and restart recovery share the same location owner.
import path from 'node:path';
import {ProjectRenames} from './project-rename.js';
import {pendingProjectRename,locateProjectRename,projectRenameFile} from './project-rename-receipt.js';
import {ProjectLocationAccess} from './project-location-access.js';
import {ProjectStorage} from './project-storage.js';
import {StructureCommands} from './structure-commands.js';
import {readAccess} from './access.js';
import {authenticateKeyring} from './security/keyring.js';
import {cloneVault,clearVault} from './encryption.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
export class ProjectRenameApplication{
 constructor(application){this.application=application;}
 async moveStatus(projectId,legacy,root){
  if(legacy&&!['complete','cancelled'].includes(legacy.phase))return legacy;
  const registry=await this.application.registry(),renames=new ProjectRenames(registry,projectId),value=await renames.read();if(!value?.placement)return legacy;
  const scope=renames.scope(value);if(['complete','cancelled'].includes(value.phase)&&![scope.source,scope.destination].includes(root))return legacy;
  return {id:value.id,projectId,source:scope.source,destination:scope.destination,phase:value.phase,mode:'placement',running:projectTransferRunning(projectRenameFile(registry,projectId)),canCancel:false};
 }
 async resumeMove(client,projectId,data,options){
  if(!data||Object.keys(data).join()!=='id'||!researchId(data.id))throw new AppError('INVALID');
  const registry=await this.application.registry(),value=await new ProjectRenames(registry,projectId).read();
  if(value?.id!==data.id||!value.placement)return null;
  if(value.phase==='cancelled')throw new AppError(value.cancelReason==='volume'?'STORAGE_RENAME_VOLUME':'CONFLICT');
  return this.reparent(client,projectId,{id:value.id,...value.placement},options);
 }
 async recover(client,projectId,{check=async()=>{},deferPrepared=false,skipId=null}={}){
  const app=this.application,registry=await app.registry(),value=await pendingProjectRename(registry,projectId);if(!value||value.id===skipId)return;
  if(projectTransferRunning(projectRenameFile(registry,value.projectId))){const error=new AppError('STORAGE_RENAMING');error.projectId=value.projectId;throw error;}
  const renames=new ProjectRenames(registry,value.projectId),session=app.session(client),saved=session.get(value.projectId),root=await locateProjectRename(registry,value),access=await readAccess(root);let vault;
  if(deferPrepared&&['preparing','prepared'].includes(value.phase)&&!await workspaceRename(root))return;
  try{
   await check();if(app.closed||saved?.locked)throw new AppError('ACCESS_LOCKED');
   if(saved?.vault&&saved.etag===access.etag&&saved.vault.id===value.vaultId&&saved.expires>Date.now())vault=cloneVault(saved.vault);
   else vault=await app.authenticate(root,access,'','','');authenticateKeyring(access.value,vault);
   const current=async()=>{await check();if(app.closed||session.get(value.projectId)!==saved||saved?.locked||saved?.vault&&saved.expires<=Date.now())throw new AppError('ACCESS_LOCKED');};
   await current();await app.jobs.invalidateProject(value.projectId);
   if(['preparing','prepared'].includes(value.phase)&&!await workspaceRename(root)){
    const owners=new ProjectLocationAccess(app,client,{check:current,skipRenameId:value.id});
    try{
     const storage=await owners.withProject(value.projectId,storage=>storage);
     if(value.settings&&(await storage.outline()).etag!==value.settings.etag){await renames.cancelPrepared(vault,{check:current});return;}
     await owners.withScopedAccess(async scoped=>{await this.withParent(client,value.placement?.parentId??null,current,check=>renames.run(storage,{id:value.id,name:path.posix.basename(value.destination),expectedName:path.posix.basename(value.source),settings:value.settings??null,placement:value.placement??null,check:async owner=>{await check();await scoped.check(owner);},...this.callbacks(scoped)}),value.id);await scoped.adoptProjectRename(renames);});
    }catch(error){
     if(error.code!=='CONFLICT')throw error;const latest=await renames.read();
     if(latest?.phase==='cancelled')return;
     if(latest&&['preparing','prepared'].includes(latest.phase)&&!await workspaceRename(root)&&latest.settings&&(await new ProjectStorage(root,value.projectId,vault).outline()).etag!==latest.settings.etag){await renames.cancelPrepared(vault,{check:current});return;}
     throw error;
    }finally{await owners.close();}
   }else{
    const result=await renames.resume(vault,{check:current});
    if(result&&session.get(value.projectId)===saved&&saved?.vault&&!saved.locked&&saved.expires>Date.now()){saved.root=result.project.root;saved.etag=(await readAccess(result.project.root)).etag;}
   }
  }catch(error){if(error.code==='STORAGE_RENAME_VOLUME'&&(await renames.read())?.phase==='cancelled')return;if(['ACCESS_LOCKED','ACCESS_DENIED','ACCESS_WAIT','AUTH','DEVICE_UNKNOWN'].includes(error.code))error.projectId??=value.projectId;throw error;}
  finally{clearVault(vault);}
 }
 async withParent(client,parentId,check,operation,skipRenameId=null){
  if(parentId===null)return operation(check);
  const owner=new ProjectSessionOwner(this.application,client,parentId,{check,skipRenameId});
  try{return await owner.use(()=>operation(()=>owner.check()));}catch(error){if(['ACCESS_LOCKED','ACCESS_DENIED','ACCESS_WAIT','AUTH','DEVICE_UNKNOWN'].includes(error.code))error.projectId??=parentId;throw error;}finally{await owner.close();}
 }
 async reparent(client,projectId,data,{check=async()=>{}}={}){
  if(!data||Object.keys(data).sort().join()!=='expectedParentId,id,parentId'||!researchId(data.id))throw new AppError('INVALID');
  const placement={parentId:data.parentId,expectedParentId:data.expectedParentId};if(!validProjectPlacement(placement))throw new AppError('INVALID');
  const app=this.application;await this.recover(client,projectId,{check});const registry=await app.registry(),owners=new ProjectLocationAccess(app,client,{check,skipRenameId:data.id});
  try{
   const storage=await owners.withProject(projectId,storage=>storage),entry=await registry.locate(projectId),renames=new ProjectRenames(registry,projectId),prior=await renames.read();
   if(prior?.id===data.id){if(!prior.placement||prior.placement.parentId!==placement.parentId||prior.placement.expectedParentId!==placement.expectedParentId)throw new AppError('CONFLICT');if(prior.phase==='complete')return {project:entry};}
   if(entry.parentId!==placement.expectedParentId)throw new AppError('CONFLICT');if(entry.parentId===placement.parentId)return {project:entry};
   await owners.withScopedAccess(async scoped=>{await this.withParent(client,placement.parentId,check,async current=>{await app.jobs.invalidateProject(projectId);await renames.run(storage,{id:data.id,name:path.basename(storage.root),expectedName:path.basename(storage.root),placement,check:async owner=>{await current();await scoped.check(owner);},...this.callbacks(scoped)});});await scoped.adoptProjectRename(renames);});return {project:await registry.locate(projectId)};
  }catch(error){
   const receipt=await new ProjectRenames(registry,projectId).read().catch(()=>undefined);
   if(receipt===null||receipt&&receipt.id!==data.id)error.operationNotStarted=true;throw error;
  }finally{await owners.close();}
 }
 callbacks(owners){return {withProject:(id,use)=>owners.withProject(id,async storage=>{await this.application.jobs.invalidateProject(id);return use(storage);}),withBook:(project,id,use)=>owners.withBook(project,id,use)};}
 async save(client,projectId,data,{check=async()=>{}}={}){
  if(!data||Object.keys(data).some(key=>!['etag','id','project','configurationDraft','configurationPin'].includes(key))||!researchId(data.id)||typeof data.etag!=='string'||data.project?.id!==projectId||data.project.parentId!=null)throw new AppError('INVALID');
  const app=this.application,selected=data.configurationDraft!==undefined||data.configurationPin!==undefined;await this.recover(client,projectId,{check});const registry=await app.registry(),owners=new ProjectLocationAccess(app,client,{check,skipRenameId:data.id});
  try{
   const storage=await owners.withProject(projectId,storage=>storage),renames=new ProjectRenames(registry,projectId),prior=await renames.read();let settings={etag:data.etag,project:data.project};
   if(selected&&prior?.id===data.id){const input=digest(serialize({etag:data.etag,project:data.project,draft:data.configurationDraft,pin:data.configurationPin}));if(prior.settings?.input!==input)throw new AppError('CONFLICT');settings=prior.settings;}
   if(prior?.id===data.id&&prior.phase==='complete'){
    if(JSON.stringify(prior.settings)!==JSON.stringify(settings))throw new AppError('CONFLICT');
   }else if(path.basename(storage.root)===data.project.title){
    const result=await new StructureCommands(storage).execute('structure',{etag:data.etag,change:{kind:'project',value:data.project},response:'outline',commandId:data.id,...(selected?{configurationDraft:data.configurationDraft,configurationPin:data.configurationPin}:{})});await registry.refreshSummary(projectId,result.book);return result;
   }else{
    if(selected&&prior?.id!==data.id){
     const owner={workspaceId:(await storage.outline()).metadata.id,projectId,notebookId:null,slot:'labBookTemplate'},checkpoint=await storage.catalogue(store=>configurationCheckpoint(store,owner,data.configurationDraft,data.configurationPin));
     const project={...data.project};if(checkpoint.absent)delete project.labBookTemplate;else project.labBookTemplate={name:checkpoint.name,configuration:checkpoint.configuration};
     settings={etag:data.etag,project,...(checkpoint.draft?{checkpoint:data.configurationDraft}:{}),input:digest(serialize({etag:data.etag,project:data.project,draft:data.configurationDraft,pin:data.configurationPin}))};
    }
    await app.jobs.invalidateProject(projectId);await owners.withScopedAccess(async scoped=>{await renames.run(storage,{id:data.id,name:data.project.title,expectedName:path.basename(storage.root),settings,check:owner=>scoped.check(owner),...this.callbacks(scoped)});await scoped.adoptProjectRename(renames);});
   }
   const entry=await registry.locate(projectId),opened=new ProjectStorage(entry.root,projectId,storage.vault);
   const result=await opened.catalogue(store=>store.recordOutline());await registry.refreshSummary(projectId,result.book);return result;
  }finally{await owners.close();}
 }
}
