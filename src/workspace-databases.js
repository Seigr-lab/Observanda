import {startManagedPostgres} from './postgres-runtime.js';
import {startScratchPostgres} from './scratch-postgres.js';
import {inheritRuntimeStorage} from './database-runtime-environment.js';
import path from 'node:path';
import {readFile,realpath} from 'node:fs/promises';
import {createPersistentDirectory as mkdir} from './filesystem-persistence.js';
import {randomUUID} from 'node:crypto';
import {WorkspacePostgres} from './workspace-postgres.js';
import {ProjectPostgres} from './project-postgres.js';
import {ownerWorkspaceRoot} from './owner-postgres.js';
import {ownerRoleName} from './owner-database-role.js';
import {LabBookPostgres} from './lab-book-postgres.js';
import {assertCatalogueOwner} from './project-catalogue-owner.js';
import {outsideWorkspace} from './postgres-runtime.js';
import {catalogueBinding} from './postgres-activation.js';
import {assertRegular,atomicWrite} from './storage.js';
import {installDatabaseProvider} from './workspace-database-context.js';
import {AppError} from './errors.js';
import {workspaceDatabaseLease} from './workspace-database-lease.js';
import {waitRuntimeStartup} from './runtime-startup-wait.js';

export class WorkspaceDatabases{
 constructor({directory,ownerId,env=process.env,signal,onProgress=()=>{},projectRuntime={},labBookRuntime={}}){
  this.directory=path.resolve(directory);this.env={...env};delete this.env.OBSERVANDA_DATABASE_URL;
  this.signal=signal;this.onProgress=onProgress;this.instances=new WorkspacePostgres({ownerId,env:this.env,runtimeDirectory:this.directory,signal,onProgress});
  // One cluster per workspace: projects and lab books use the cluster of the
  // workspace containing their folder, each under its own role.
  this.projects=new ProjectPostgres({workspaces:this.instances,idleMs:projectRuntime.idleMs,maxIdle:projectRuntime.maxIdle});
  this.labBooks=new LabBookPostgres({workspaces:this.instances,idleMs:labBookRuntime.idleMs,maxIdle:labBookRuntime.maxIdle});
  this.instances.beforeClose=root=>this.closeOwners(root);
 }
 async environment(root,{create=false,detached=false,vault,projectId,labBookId,signal}={}){
  signal?.throwIfAborted();
  if(this.closing)throw new AppError('DATABASE_CANCELLED');
  root=await realpath(root);const binding=await catalogueBinding(root);
  assertCatalogueOwner(binding,projectId,labBookId);
  signal?.throwIfAborted();
  if(detached&&!binding&&!create)return this.archiveEnvironment(root,projectId,labBookId,{signal});
  if(labBookId!==undefined)return waitRuntimeStartup(this.labBooks.open(root,labBookId,vault,{create:create||!binding}),signal);
  if(projectId!==undefined)return waitRuntimeStartup(this.projects.open(root,projectId,vault,{create:create||!binding}),signal);
  if(binding&&binding.placement!=='workspace')throw new AppError('ACCESS_UPGRADE');
  if(!vault?.key)return this.instances.cached(root,{signal});
  return this.instances.open(root,vault,{create:create||!binding,signal});
 }
 // A deletion may address a catalogue in the installation-wide cluster
 // ('installation' placement). Reopen that existing cluster only; never
 // create its replacement.
 async deletionEnvironment(root,{vault}={}){
  if(this.closing)throw new AppError('DATABASE_CANCELLED');
  const binding=await catalogueBinding(await realpath(root));
  if(binding?.placement!=='installation')return this.environment(root,{vault});
  this.legacyStart??=(async()=>{
   const env={...this.env},service=await startManagedPostgres({directory:this.directory,env,signal:this.signal,onProgress:this.onProgress,existingOnly:true});
   return {env,service};
  })().catch(error=>{this.legacyStart=null;throw error;});
  return (await this.legacyStart).env;
 }
 async acquireEnvironment(root,options={}){
  options.signal?.throwIfAborted();
  if(this.closing)throw new AppError('DATABASE_CANCELLED');
  if(options.projectId===undefined&&options.labBookId===undefined)return {env:await this.environment(root,options),release:()=>{}};
  root=await realpath(root);const binding=await catalogueBinding(root);assertCatalogueOwner(binding,options.projectId,options.labBookId);
  options.signal?.throwIfAborted();
  if(options.detached&&!binding&&!options.create)return {env:await this.archiveEnvironment(root,options.projectId,options.labBookId,{signal:options.signal}),release:()=>{}};
  // Each acquire synchronously derives its own runtime key before its first
  // await. Keep that startup and pool lease owned after the request leaves;
  // release the eventual lease without admitting a cancelled SQL connection.
  const pending=options.labBookId!==undefined?this.labBooks.acquire(root,options.labBookId,options.vault,{create:options.create||!binding}):this.projects.acquire(root,options.projectId,options.vault,{create:options.create||!binding});
  try{return await waitRuntimeStartup(pending,options.signal);}
  catch(error){void pending.then(lease=>lease.release(),()=>{});throw error;}
 }
 // An unpublished archive is checked in a temporary schema. It does not own
 // a destination database until the user opens that workspace or project.
 async archiveEnvironment(root,projectId,labBookId,{signal}={}){
  const source=await this.scratch({signal}),env={...source};inheritRuntimeStorage(source,env);delete env.OBSERVANDA_WORKSPACE_DATABASE_ROOT;delete env.OBSERVANDA_PROJECT_DATABASE_ROOT;delete env.OBSERVANDA_PROJECT_ID;delete env.OBSERVANDA_LAB_BOOK_DATABASE_ROOT;delete env.OBSERVANDA_LAB_BOOK_ID;
  if(labBookId!==undefined){env.OBSERVANDA_LAB_BOOK_ID=labBookId;env.OBSERVANDA_LAB_BOOK_DATABASE_ROOT=root;}
  if(projectId!==undefined){env.OBSERVANDA_PROJECT_ID=projectId;env.OBSERVANDA_PROJECT_DATABASE_ROOT=root;}
  return env;
 }
 async scratch({signal}={}){
  signal?.throwIfAborted();
  if(this.closing)throw new AppError('DATABASE_CANCELLED');
  this.scratchStart??=startScratchPostgres({runtimeDirectory:this.directory,env:this.env,signal:this.signal,onProgress:this.onProgress}).then(owner=>{this.scratchEnv=owner.env;return owner;});
  return (await waitRuntimeStartup(this.scratchStart,signal)).env;
 }
 async closeWorkspace(root){await this.instances.closeWorkspace(root);}
 healthEnvironments(root){return {scratch:this.closing?null:this.scratchEnv??null,selected:this.closing||!root?null:this.instances.healthEnvironment(root)};}
 async closeProject(root){await this.projects.closeProject(root);}
 async closeLabBook(root){await this.labBooks.closeLabBook(root);}
 // A workspace cluster stops only after its projects and lab books drained.
 async closeOwners(root){
  const results=await Promise.allSettled([this.projects.closeHome(root),this.labBooks.closeHome(root)]);
  const failed=results.find(result=>result.status==='rejected');if(failed)throw failed.reason;
 }
 ownerOpen(kind,root){return (kind==='lab-book'?this.labBooks:this.projects).isOpen(root);}
 settleOwner(kind,root){return (kind==='lab-book'?this.labBooks:this.projects).settle(root);}
 async details(workspace){
  if(!workspace)return {placement:'workspace',path:null};
  const binding=await catalogueBinding(workspace.root);assertCatalogueOwner(binding,workspace.projectId,workspace.labBookId);
  // Projects and lab books report the cluster of their workspace.
  if(workspace.labBookId!==undefined)return {placement:'lab-book',labBookId:workspace.labBookId,path:path.join(await ownerWorkspaceRoot(await realpath(workspace.root)),'.observanda','postgresql')};
  if(workspace.projectId!==undefined)return {placement:'project',projectId:workspace.projectId,path:path.join(await ownerWorkspaceRoot(await realpath(workspace.root)),'.observanda','postgresql')};
  if(binding&&binding.placement!=='workspace')throw new AppError('ACCESS_UPGRADE');
  return {placement:'workspace',path:path.join(workspace.root,'.observanda','postgresql')};
 }
 async stopProjectForMove(root,projectId,vault,id){return this.projects.stopForMove(root,projectId,vault,id);}
 async stopLabBookForMove(root,labBookId,vault,id){return this.labBooks.stopForMove(root,labBookId,vault,id);}
 async stopLabBookForDeletion(root,labBookId,vault,deleteId){return this.labBooks.stopForDeletion(root,labBookId,vault,deleteId);}
 async stopLabBookForRename(root,labBookId,vault,id){return this.labBooks.stopForRename(root,labBookId,vault,id);}
 async stopProjectForDeletion(root,projectId,vault,deleteId){return this.projects.stopForDeletion(root,projectId,vault,deleteId);}
 async stopProjectForRename(root,projectId,vault,id){return this.projects.stopForRename(root,projectId,vault,id);}
 // A transfer that replaced its source removes the source catalogue once the
 // source folder is gone; the owner's role leaves when it owns nothing else.
 async retireOwnerCatalogue(root,ownerId,catalogueId){
  const home=await ownerWorkspaceRoot(path.resolve(root)),{service}=await this.instances.running(home);
  if(typeof service.dropOwnerCatalogue!=='function')throw new AppError('DATABASE_RUNTIME');
  await service.dropOwnerCatalogue(ownerRoleName(ownerId),catalogueId);
 }
 async stopWorkspaceForRename(root,vault,id){return this.instances.stopForRename(root,vault,id);}
 async stopWorkspaceForDeletion(root,vault,deleteId){return this.instances.stopForDeletion(root,vault,deleteId);}
 close(){
  return this.closing??=(async()=>{
   // Every owner must drain even if another one's shutdown fails. Detachment
   // is also unconditional; one error must not leave the whole provider locked.
   // Owners release their connections before the workspace clusters stop.
   let closed;
   try{closed=await Promise.allSettled([
    Promise.allSettled([Promise.resolve().then(()=>this.projects.close()),Promise.resolve().then(()=>this.labBooks.close())]).then(async owners=>{
     const results=[...owners,...await Promise.allSettled([Promise.resolve().then(()=>this.instances.close())])];
     const failed=results.find(result=>result.status==='rejected');if(failed)throw failed.reason;
    }),
    (async()=>{const owner=await this.scratchStart?.catch(()=>null);await owner?.service.close();})(),
    (async()=>{const owner=await this.legacyStart?.catch(()=>null);await owner?.service.close();})(),
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
