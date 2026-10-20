// Source and destination sessions authorize their own owners. The durable
// engine resumes from retained capabilities after physical relocation.
import path from 'node:path';
import {ProjectWorkspaceMoves} from './project-workspace-move.js';
import {ProjectLocationAccess} from './project-location-access.js';
import {ProjectSessionOwner} from './project-session-owner.js';
import {ProjectStorage} from './project-storage.js';
import {readProjectWorkspaceMove} from './project-workspace-move-state.js';
import {locateWorkspaceProjectMove,pendingWorkspaceProjectMoves} from './project-workspace-move-location.js';
import {projectDirectoryChoices} from './project-directory-query.js';
import {readAccess} from './access.js';
import {workspaceRename} from './workspace-rename-state.js';
import {authenticateKeyring} from './security/keyring.js';
import {cloneVault,clearVault} from './encryption.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
const accessCodes=['ACCESS_LOCKED','ACCESS_DENIED','ACCESS_WAIT','AUTH','DEVICE_UNKNOWN'];
export class ProjectWorkspaceMoveApplication{
 constructor(application){this.application=application;}
 async target(client,operation,data,options){
  const app=this.application,targets=app.moveTargets;
  if(operation==='move/targets'){if(Object.keys(data??{}).length)throw new AppError('INVALID');return targets.list();}
  if(operation==='move/target/open')return targets.open(client,data,options);
  if(operation==='move/pending')return pendingWorkspaceProjectMoves(await app.registry(),data);
  if(operation==='move/target/release'){if(Object.keys(data??{}).join()!=='target')throw new AppError('INVALID');return targets.release(client,data.target);}
  const {target,...input}=data??{};
  return targets.use(client,target,async(entry,check)=>{
   if(operation==='move/target/choices')return projectDirectoryChoices(entry.registry,input);
   if(operation!=='move/target/unlock'||!researchId(input.projectId)||Object.keys(input).some(key=>!['projectId','username','password','recovery'].includes(key)))throw new AppError('INVALID');
   const {projectId,...credentials}=input;return entry.application.unlock(client,projectId,credentials,{check});
  },options);
 }
 async run(client,projectId,data,{check=async()=>{}}={}){
  if(!data||Object.keys(data).sort().join()!=='expectedParentId,id,parentId,target'||!researchId(data.id)||![data.parentId,data.expectedParentId].every(id=>id===null||researchId(id)))throw new AppError('INVALID');
  const app=this.application,registry=await app.registry();
  return app.moveTargets.use(client,data.target,async(target,checkTarget)=>{
   const command=new ProjectWorkspaceMoves(registry,target.registry,projectId),prior=await command.read(),session=app.session(client);let saved=session.get(projectId),vault,owners,parentOwner;
   const current=async()=>{await checkTarget();await parentOwner?.check();if(app.closed||session.get(projectId)!==saved||saved?.locked||saved?.vault&&saved.expires<=Date.now())throw new AppError('ACCESS_LOCKED');};
   const withParent=async(id,use)=>{
    const owner=parentOwner??=new ProjectSessionOwner(target.application,client,id,{check:checkTarget});
    try{return await owner.use(use);}catch(error){if(accessCodes.includes(error.code)){error.projectId=id;error.destinationWorkspaceId=target.registry.workspaceId;error.projectName=path.basename((await target.registry.locate(id)).root);}throw error;}
   };
   try{
    if(prior&&prior.id===data.id&&(prior.target.workspaceId!==target.registry.workspaceId||prior.parentId!==data.expectedParentId||prior.placement.parentId!==data.parentId))throw new AppError('CONFLICT');
    const continuing=prior?.id===data.id&&!['cancelled'].includes(prior.phase)&&!(['preparing','prepared'].includes(prior.phase)&&!await workspaceRename(command.scope(prior).source));
    if(continuing){
     const root=await locateWorkspaceProjectMove(registry,prior),access=await readAccess(root);await current();
     vault=saved?.vault&&saved.etag===access.etag&&saved.vault.id===prior.vaultId?cloneVault(saved.vault):await app.authenticate(root,access,'','','');authenticateKeyring(access.value,vault);
     return await command.resume(vault,{check:current,withParent});
    }
    owners=new ProjectLocationAccess(app,client,{check:checkTarget});const storage=await owners.withProject(projectId,storage=>storage);saved=session.get(projectId);
    await app.jobs.invalidateProject(projectId);return await owners.withScopedAccess(scoped=>command.run(storage,{...data,check:async owner=>{await current();await scoped.check(owner);},withParent,withProject:(id,use)=>scoped.withProject(id,use),withBook:(parent,id,use)=>scoped.withBook(parent,id,use)}));
   }catch(error){if(accessCodes.includes(error.code)){error.projectId??=projectId;error.projectName??=prior?path.posix.basename(prior.source):path.basename((await registry.locate(projectId)).root);}throw error;}
   finally{if(owners)await owners.close();await parentOwner?.close();clearVault(vault);}
  },{check}).catch(async error=>{const receipt=await readProjectWorkspaceMove(registry,projectId).catch(()=>undefined);if(receipt===null||receipt&&receipt.id!==data.id)error.operationNotStarted=true;throw error;});
 }
 async unlockRecovery(client,projectId,data,{check=async()=>{}}={}){
  const app=this.application,registry=await app.registry(),value=await readProjectWorkspaceMove(registry,projectId);if(!value||value.phase==='cancelled'||value.phase==='complete'&&value.released===true)return null;
  if(!data||Object.keys(data).some(key=>!['username','password','recovery'].includes(key))||Object.values(data).some(item=>typeof item!=='string'||item.length>1024))throw new AppError('INVALID');
  const root=await locateWorkspaceProjectMove(registry,value),access=await readAccess(root),session=app.session(client),previous=session.get(projectId);let vault;
  try{await check();vault=await app.authenticate(root,access,data.username??'',data.password??'',data.recovery??'');authenticateKeyring(access.value,vault);await check();if(app.closed||session.get(projectId)!==previous||(await readAccess(root)).etag!==access.etag)throw new AppError('ACCESS_LOCKED');app.forget(session,projectId);const saved={root,etag:access.etag,vault:cloneVault(vault),expires:Date.now()+8*60*60*1000};session.set(projectId,saved);app.credentials.add(saved);return {projectId,locked:false};}finally{clearVault(vault);}
 }
}
