import {startScratchPostgres} from './scratch-postgres.js';
import path from 'node:path';
import {mkdir,readFile,realpath} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {WorkspacePostgres} from './workspace-postgres.js';
import {ProjectPostgres} from './project-postgres.js';
import {LabBookPostgres} from './lab-book-postgres.js';
import {assertCatalogueOwner} from './project-catalogue-owner.js';
import {outsideWorkspace} from './postgres-runtime.js';
import {catalogueBinding} from './postgres-activation.js';
import {assertRegular,atomicWrite} from './storage.js';
import {installDatabaseProvider} from './workspace-database-context.js';
import {AppError} from './errors.js';
import {workspaceDatabaseLease} from './workspace-database-lease.js';

export class WorkspaceDatabases{
 constructor({directory,ownerId,env=process.env,signal,onProgress=()=>{},projectRuntime={},labBookRuntime={}}){
  this.directory=path.resolve(directory);this.env={...env};delete this.env.OBSERVANDA_DATABASE_URL;
  this.signal=signal;this.onProgress=onProgress;this.instances=new WorkspacePostgres({ownerId,env:this.env,runtimeDirectory:this.directory,signal,onProgress});
  this.projects=new ProjectPostgres({ownerId,env:this.env,runtimeDirectory:this.directory,signal,onProgress,idleMs:projectRuntime.idleMs,maxIdle:projectRuntime.maxIdle});
  this.labBooks=new LabBookPostgres({ownerId,env:this.env,runtimeDirectory:this.directory,signal,onProgress,idleMs:labBookRuntime.idleMs,maxIdle:labBookRuntime.maxIdle});
 }
 async environment(root,{create=false,detached=false,vault,projectId,labBookId}={}){
  if(this.closing)throw new AppError('DATABASE_CANCELLED');
  root=await realpath(root);const binding=await catalogueBinding(root);
  assertCatalogueOwner(binding,projectId,labBookId);
  if(detached&&!binding&&!create)return this.archiveEnvironment(root,projectId,labBookId);
  if(labBookId!==undefined)return this.labBooks.open(root,labBookId,vault,{create:create||!binding});
  if(projectId!==undefined)return this.projects.open(root,projectId,vault,{create:create||!binding});
  if(binding&&binding.placement!=='workspace')throw new AppError('ACCESS_UPGRADE');
  if(!vault?.key)return this.instances.cached(root);
  return this.instances.open(root,vault,{create:create||!binding});
 }
 async acquireEnvironment(root,options={}){
  if(this.closing)throw new AppError('DATABASE_CANCELLED');
  if(options.projectId===undefined&&options.labBookId===undefined)return {env:await this.environment(root,options),release:()=>{}};
  root=await realpath(root);const binding=await catalogueBinding(root);assertCatalogueOwner(binding,options.projectId,options.labBookId);
  if(options.detached&&!binding&&!options.create)return {env:await this.archiveEnvironment(root,options.projectId,options.labBookId),release:()=>{}};
  if(options.labBookId!==undefined)return this.labBooks.acquire(root,options.labBookId,options.vault,{create:options.create||!binding});
  return this.projects.acquire(root,options.projectId,options.vault,{create:options.create||!binding});
 }
 // An unpublished archive is checked in a temporary schema. It does not own
 // a destination database until the user opens that workspace or project.
 async archiveEnvironment(root,projectId,labBookId){
  const env={...await this.scratch()};delete env.OBSERVANDA_WORKSPACE_DATABASE_ROOT;delete env.OBSERVANDA_PROJECT_DATABASE_ROOT;delete env.OBSERVANDA_PROJECT_ID;delete env.OBSERVANDA_LAB_BOOK_DATABASE_ROOT;delete env.OBSERVANDA_LAB_BOOK_ID;
  if(labBookId!==undefined){env.OBSERVANDA_LAB_BOOK_ID=labBookId;env.OBSERVANDA_LAB_BOOK_DATABASE_ROOT=root;}
  if(projectId!==undefined){env.OBSERVANDA_PROJECT_ID=projectId;env.OBSERVANDA_PROJECT_DATABASE_ROOT=root;}
  return env;
 }
 async scratch(){
  if(this.closing)throw new AppError('DATABASE_CANCELLED');
  this.scratchStart??=startScratchPostgres({runtimeDirectory:this.directory,env:this.env,signal:this.signal,onProgress:this.onProgress});
  return (await this.scratchStart).env;
 }
 async closeWorkspace(root){await this.instances.closeWorkspace(root);}
 async closeProject(root){await this.projects.closeProject(root);}
 async closeLabBook(root){await this.labBooks.closeLabBook(root);}
 async details(workspace){
  if(!workspace)return {placement:'workspace',path:null};
  const binding=await catalogueBinding(workspace.root);assertCatalogueOwner(binding,workspace.projectId,workspace.labBookId);
  if(workspace.labBookId!==undefined)return {placement:'lab-book',labBookId:workspace.labBookId,path:path.join(workspace.root,'.observanda','postgresql')};
  if(workspace.projectId!==undefined)return {placement:'project',projectId:workspace.projectId,path:path.join(workspace.root,'.observanda','postgresql')};
  if(binding&&binding.placement!=='workspace')throw new AppError('ACCESS_UPGRADE');
  return {placement:'workspace',path:path.join(workspace.root,'.observanda','postgresql')};
 }
 async stopProjectForMove(root,projectId,vault,id){return this.projects.stopForMove(root,projectId,vault,id);}
 async stopLabBookForMove(root,labBookId,vault,id){return this.labBooks.stopForMove(root,labBookId,vault,id);}
 async stopLabBookForDeletion(root,labBookId,vault,deleteId){return this.labBooks.stopForDeletion(root,labBookId,vault,deleteId);}
 async stopLabBookForRename(root,labBookId,vault,id){return this.labBooks.stopForRename(root,labBookId,vault,id);}
 async stopProjectForDeletion(root,projectId,vault,deleteId){return this.projects.stopForDeletion(root,projectId,vault,deleteId);}
 async stopProjectForRename(root,projectId,vault,id){return this.projects.stopForRename(root,projectId,vault,id);}
 async stopWorkspaceForRename(root,vault,id){return this.instances.stopForRename(root,vault,id);}
 async stopWorkspaceForDeletion(root,vault,deleteId){return this.instances.stopForDeletion(root,vault,deleteId);}
 close(){
  return this.closing??=(async()=>{
   // Every owner must drain even if another one's shutdown fails. Detachment
   // is also unconditional; one error must not leave the whole provider locked.
   let closed;
   try{closed=await Promise.allSettled([
    Promise.resolve().then(()=>this.instances.close()),
    Promise.resolve().then(()=>this.projects.close()),
    Promise.resolve().then(()=>this.labBooks.close()),
    (async()=>{const owner=await this.scratchStart?.catch(()=>null);await owner?.service.close();})(),
   ]);}finally{this.detach?.();}
   const failed=closed.find(result=>result.status==='rejected');if(failed)throw failed.reason;
  })();
 }

}
export async function startWorkspaceDatabases({directory,env=process.env,...options}){
 // Explicit external server profiles retain their configured lifecycle.
 if(env.OBSERVANDA_DATABASE_URL)return {managed:false,close:async()=>{}};
 directory=path.resolve(directory);await outsideWorkspace(directory);await mkdir(directory,{recursive:true,mode:0o700});await assertRegular(directory,{directory:true});
 const lease=await workspaceDatabaseLease(directory);let ownerId;
 try{
  const file=path.join(directory,'workspace-owner.json'),stat=await assertRegular(file,{missing:true});
  if(stat){if(stat.size>128)throw new AppError('DATABASE_RUNTIME');ownerId=JSON.parse(await readFile(file,'utf8')).id;}
  else{ownerId=randomUUID();await atomicWrite(file,JSON.stringify({id:ownerId}));}
 }finally{await lease.close();}
 if(typeof ownerId!=='string'||!/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(ownerId))throw new AppError('DATABASE_RUNTIME');
 const owner=new WorkspaceDatabases({directory,ownerId,env,...options});owner.detach=installDatabaseProvider(owner);owner.managed=true;return owner;
}
