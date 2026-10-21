import {ownedMoveSource,assertNotMoving} from './workspace-move-state.js';
import {assertNotRenaming,workspaceRename} from './workspace-rename-state.js';
// Dedicated PostgreSQL lifecycles. This owner never redirects a workspace to
// another workspace's cluster and never changes the process environment.
import path from 'node:path';
import {realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {startManagedPostgres,stopManagedPostgres} from './postgres-runtime.js';
import {assertRegular} from './storage.js';
import {AppError} from './errors.js';
import {assertNotDeleting,workspaceDeletion} from './workspace-delete-state.js';

export const WORKSPACE_DATABASE_DIRECTORY='.observanda/postgresql';
const keyIdentity=vault=>{
 if(!Buffer.isBuffer(vault?.key)||vault.key.length!==32)throw new AppError('ACCESS_LOCKED');
 return createHash('sha256').update(vault.id).update(vault.key).digest('hex');
};
export class WorkspacePostgres{
 constructor({ownerId,runtimeDirectory,env=process.env,onProgress=()=>{},signal}={}){
  this.ownerId=ownerId;this.runtimeDirectory=runtimeDirectory;this.env={...env};delete this.env.OBSERVANDA_DATABASE_URL;
  this.onProgress=onProgress;this.signal=signal;this.instances=new Map();this.stopping=false;
 }
 async open(root,vault,{create=false}={}){
  if(this.stopping)throw new AppError('DATABASE_CANCELLED');
  root=await realpath(root);await assertNotDeleting(root);await assertNotMoving(root);await assertNotRenaming(root);
  // Shutdown may drain the owner while those filesystem checks are pending.
  // No awaited work separates this second admission from registering startup.
  if(this.stopping)throw new AppError('DATABASE_CANCELLED');
  const identity=keyIdentity(vault),prior=this.instances.get(root);
  if(prior){if(prior.identity!==identity)throw new AppError('ACCESS_DENIED');if(prior.closing)throw new AppError('DATABASE_RUNNING');return (await prior.pending).env;}
  const directory=path.join(root,WORKSPACE_DATABASE_DIRECTORY);
  const env={...this.env},entry={identity};this.instances.set(root,entry);
  env.OBSERVANDA_WORKSPACE_DATABASE_ROOT=root;
  const startupVault={id:vault.id,key:Buffer.from(vault.key)};
  entry.pending=(async()=>{
   try{
    if(!create&&!await assertRegular(path.join(directory,'service.observanda'),{missing:true}))throw new AppError('CATALOGUE_UNAVAILABLE');
    const service=await startManagedPostgres({directory,env,workspace:{root,vault:startupVault,ownerId:this.ownerId},runtimeDirectory:this.runtimeDirectory,onProgress:this.onProgress,signal:this.signal});
    try{await assertNotDeleting(root);await assertNotMoving(root);await assertNotRenaming(root);}catch(error){await service.close();throw error;}return {service,env};
   }catch(error){if(this.instances.get(root)===entry)this.instances.delete(root);throw error;}
   finally{startupVault.key.fill(0);}
  })();
  return (await entry.pending).env;
 }
 async authorizeDeletion(root,vault,deleteId){
  root=await realpath(root);await assertNotDeleting(root,deleteId);
  const marker=await workspaceDeletion(root);if(!marker||marker.id!==deleteId||marker.source!==root)throw new AppError('STORAGE_DELETE_STATE');
  const identity=keyIdentity(vault),prior=this.instances.get(root);if(prior&&prior.identity!==identity)throw new AppError('ACCESS_DENIED');
  return root;
 }
 async stopForDeletion(root,vault,deleteId){
  root=await this.authorizeDeletion(root,vault,deleteId);await this.closeWorkspace(root);
  const service=await stopManagedPostgres({directory:path.join(root,WORKSPACE_DATABASE_DIRECTORY),env:{...this.env},workspace:{root,vault,ownerId:this.ownerId,deleteId}});
  await service.close();
 }
 async authorizeRename(root,vault,renameId){
  root=await realpath(root);const marker=await workspaceRename(root);
  if(marker?.id!==renameId)throw new AppError('STORAGE_RENAME_STATE');
  const identity=keyIdentity(vault),prior=this.instances.get(root);if(prior&&prior.identity!==identity)throw new AppError('ACCESS_DENIED');
  return root;
 }
 async stopForRename(root,vault,renameId){
  root=await this.authorizeRename(root,vault,renameId);await this.closeWorkspace(root);
  const service=await stopManagedPostgres({directory:path.join(root,WORKSPACE_DATABASE_DIRECTORY),env:{...this.env},workspace:{root,vault,ownerId:this.ownerId,renameId}});
  await service.close();
 }
 async authorizeMove(root,vault,moveId){
  root=await realpath(root);if((await ownedMoveSource(root))?.id!==moveId)throw new AppError('STORAGE_MOVE_STATE');
  const identity=keyIdentity(vault),prior=this.instances.get(root);if(prior&&prior.identity!==identity)throw new AppError('ACCESS_DENIED');return root;
 }
 async stopForMove(root,vault,moveId){
  root=await this.authorizeMove(root,vault,moveId);await this.closeWorkspace(root);
  const service=await stopManagedPostgres({directory:path.join(root,WORKSPACE_DATABASE_DIRECTORY),env:{...this.env},workspace:{root,vault,ownerId:this.ownerId,moveId}});await service.close();
 }
 async cached(root){const entry=this.instances.get(await realpath(root));if(!entry||entry.closing)throw new AppError('ACCESS_LOCKED');return (await entry.pending).env;}
 async closeWorkspace(root){
  root=await realpath(root).catch(error=>{if(error.code==='ENOENT')return path.resolve(root);throw error;});const entry=this.instances.get(root);if(!entry)return;
  // Retain ownership until shutdown has finished. Concurrent opens must not
  // launch a second process while the first is still flushing its files.
  entry.closing??=(async()=>{
   try{const {service}=await entry.pending;await service.close();}
   finally{
    // Managed close always releases its kernel lease and clears credentials,
    // even if pg_ctl failed. The next authenticated open checks the durable
    // owner and recovers that exact cluster before starting a server.
    if(this.instances.get(root)===entry)this.instances.delete(root);
   }
  })();
  await entry.closing;
 }
 async close(){
  this.stopping=true;const results=await Promise.allSettled([...this.instances.keys()].map(root=>this.closeWorkspace(root)));
  const failure=results.find(result=>result.status==='rejected');if(failure)throw failure.reason;
 }
}
