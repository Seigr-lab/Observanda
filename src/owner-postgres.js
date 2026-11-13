// Projects and lab books keep their catalogues in their workspace's single
// PostgreSQL cluster (<workspace>/.observanda/postgresql). An owner never
// starts a cluster of its own: it logs in to the cluster of the workspace that
// contains its folder, which must already be open in this installation, with
// its own role (owner-database-role.js). A nested cluster inside an owner
// folder belongs to an earlier storage format and is refused unchanged.
import {realpath,readFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ProjectRuntimePool} from './project-runtime-pool.js';
import {registerRuntimeStorage} from './database-runtime-environment.js';
import {closeIdleConnections} from './database-idle-connections.js';
import {catalogueBinding,catalogueActivation} from './postgres-activation.js';
import {ownerRoleCredentials,verifyOwnerLogin} from './owner-database-role.js';
import {authenticateKeyring,ACCESS_LIMIT} from './security/keyring.js';
import {Client} from 'pg';
import {assertNotDeleting,workspaceDeletion} from './workspace-delete-state.js';
import {assertNotMoving,ownedMoveSource} from './workspace-move-state.js';
import {assertNotRenaming,workspaceRename} from './workspace-rename-state.js';
import {databaseProvider} from './workspace-database-context.js';
import {assertRegular} from './storage.js';
import {AppError} from './errors.js';

export const OWNER_NESTED_DATABASE_DIRECTORY='.observanda/postgresql';
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const identityOf=(ownerId,vault)=>createHash('sha256').update(ownerId).update('\0').update(vault.id).update('\0').update(vault.key).digest('hex');
const resolved=root=>realpath(root).catch(error=>{if(error.code==='ENOENT')return path.resolve(root);throw error;});
function ownerVault(ownerId,vault){
 if(!uuid(ownerId))throw new AppError('INVALID');
 if(!Buffer.isBuffer(vault?.key)||vault.key.length!==32)throw new AppError('ACCESS_LOCKED');
 if(!uuid(vault.id))throw new AppError('ACCESS_DENIED');
 return vault;
}
// Any entry at the earlier per-owner cluster location, including a file or a
// link, is old data: it is refused, never started, moved or removed.
export async function assertNoNestedCluster(root){
 const present=await assertRegular(path.join(root,OWNER_NESTED_DATABASE_DIRECTORY),{directory:true,missing:true}).catch(error=>{if(error.code==='UNSAFE')return true;throw error;});
 if(present)throw new AppError('DATABASE_NESTED_CLUSTER');
}
// The owner's own keyring authenticates its vault before a role is created
// or connections are released. A folder without a version 3 keyring (an
// unfinished copy) is authenticated by the role login instead. Strict
// authentication (before a first activation creates the owner's role) also
// refuses a keyring of another vault; otherwise a key of the keyring's own
// vault must match it, and another vault is refused by the role login.
async function authenticateOwnerKeyring(root,vault,{strict=false}={}){
 const file=path.join(root,'.observanda','access.json'),stat=await assertRegular(file,{missing:true});
 if(!stat)return;if(stat.size>ACCESS_LIMIT)throw new AppError('ACCESS_FORMAT');
 let value;try{value=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return;throw new AppError('ACCESS_FORMAT');}
 if(value?.formatVersion!==3||!strict&&value.vaultId!==vault.id)return;
 try{authenticateKeyring(value,vault);}catch(error){if(error.code==='ENCRYPTION_DAMAGED')throw new AppError('ACCESS_DENIED');throw error;}
}
// Every part lives inside its workspace folder. The containing workspace is
// the nearest ancestor whose catalogue binding is a workspace binding.
export async function ownerWorkspaceRoot(root){
 for(let current=path.dirname(root);;current=path.dirname(current)){
  let binding=null;
  try{binding=await catalogueBinding(current);}catch(error){if(!['EACCES','EPERM','ENOTDIR'].includes(error.code))throw error;}
  if(binding?.placement==='workspace')return current;
  // A workspace on a configured PostgreSQL server is not served by managed storage.
  if(binding?.placement==='installation')throw new AppError('ACCESS_UPGRADE');
  if(path.dirname(current)===current)throw new AppError('DATABASE_LOCATION');
 }
}
export class OwnerPostgres{
 #workspaces;#entries=new Map();#pool;
 // The environment of each owner derives from its workspace's running cluster.
 constructor({workspaces,idleMs,maxIdle}={}){
  if(!workspaces?.running)throw new AppError('INVALID');
  this.#workspaces=workspaces;
  this.#pool=new ProjectRuntimePool({idleMs,maxIdle,close:root=>this.#release(root)});
 }
 // Subclasses name the environment fields that route a catalogue to them
 // and verify that a binding belongs to them.
 ownerEnvironment(){throw new AppError('INVALID');}
 assertOwner(){throw new AppError('INVALID');}
 async #open(root,ownerId,vault,{create,signal}){
  // An earlier per-owner cluster is refused even while the owner is open.
  await assertNoNestedCluster(root);
  const identity=identityOf(ownerId,vault),prior=this.#entries.get(root);
  if(prior){if(prior.identity!==identity)throw new AppError('ACCESS_DENIED');if(this.#workspaces.isRunning(prior.home,prior.service))return prior.env;}
  await assertNotDeleting(root);await assertNotMoving(root);await assertNotRenaming(root);
  const binding=await catalogueBinding(root);this.assertOwner(binding,ownerId);
  if(!binding&&!create)throw new AppError('CATALOGUE_UNAVAILABLE');
  const home=await ownerWorkspaceRoot(root),{service,env:source}=await this.#workspaces.running(home,{signal});
  // A binding names the cluster that holds the schema: a folder carried into
  // another workspace is not served by that workspace's cluster.
  if(binding&&binding.cluster!==service.clusterId)throw new AppError('CATALOGUE_UNAVAILABLE');
  if(typeof service.ownerRole!=='function')throw new AppError('DATABASE_RUNTIME');
  await authenticateOwnerKeyring(root,vault,{strict:!binding});
  const {role,password}=ownerRoleCredentials(ownerId,vault);
  await service.ownerRole(role,password,{signal});
  const url=new URL(source.OBSERVANDA_DATABASE_URL);url.username=role;url.password=password;
  const env={...source,OBSERVANDA_DATABASE_URL:url.toString()};delete env.OBSERVANDA_WORKSPACE_DATABASE_ROOT;
  Object.assign(env,this.ownerEnvironment(root,ownerId));
  await verifyOwnerLogin(env.OBSERVANDA_DATABASE_URL,{signal});
  await assertNotDeleting(root);await assertNotMoving(root);await assertNotRenaming(root);
  if(!this.#workspaces.isRunning(home,service))throw new AppError('ACCESS_LOCKED');
  const current=this.#entries.get(root);
  if(current){if(current.identity!==identity)throw new AppError('ACCESS_DENIED');if(this.#workspaces.isRunning(current.home,current.service))return current.env;this.#retire(current);}
  const retire=registerRuntimeStorage(env,path.join(home,'.observanda','postgresql'));
  this.#entries.set(root,{identity,home,service,env,retire});
  return env;
 }
 // Parked connections of the owner's role close with it (the pool removes
 // them before the credentials are retired, so no later open reuses them).
 #retire(entry){const closed=closeIdleConnections(entry.env);entry.retire();delete entry.env.OBSERVANDA_DATABASE_URL;return closed;}
 async #release(root){
  const entry=this.#entries.get(root);
  if(entry){this.#entries.delete(root);await this.#retire(entry);}
 }
 async #lease(root,ownerId,vault,{create=false,manual=false,signal}={}){
  ownerVault(ownerId,vault);
  root=await realpath(root);
  return this.#pool.acquire(root,()=>this.#open(root,ownerId,vault,{create,signal}),{manual});
 }
 acquire(root,ownerId,vault,options){return this.#lease(root,ownerId,vault,options);}
 // Explicit environment consumers own a manual lifetime. Normal catalogue
 // connections use acquire and release their environment automatically.
 async open(root,ownerId,vault,options={}){const lease=await this.#lease(root,ownerId,vault,{...options,manual:true});lease.release();return lease.env;}
 async closeOwner(root){await this.#pool.close(await resolved(root));}
 // Closing a workspace first drains every owner using its cluster.
 async closeHome(home){
  const roots=[...this.#entries].filter(([,entry])=>entry.home===home).map(([root])=>root);
  const results=await Promise.allSettled(roots.map(root=>this.#pool.close(root)));
  const failed=results.find(result=>result.status==='rejected');if(failed)throw failed.reason;
 }
 isOpen(root){return this.#entries.has(root)||this.#pool.entries.has(root);}
 // A frozen owner holds no connection in use. An environment left idle by a
 // read after the freeze (for example a resumed journal verifying the owner)
 // is closed here; an owner with connections in use is still running.
 async settle(root){
  const entry=this.#pool.entries.get(root);
  // An explicitly opened environment belongs to its consumer until closed.
  if(entry&&!entry.closing&&(entry.users||entry.manual))return false;
  if(entry)await this.#pool.close(root);
  return !this.isOpen(root);
 }
 // Renames, moves and deletions freeze an owner: its lifecycle marker is
 // verified, its key is authenticated, and its connections drain and close.
 // The workspace cluster keeps running for every other owner. The lifecycle
 // markers are checked exactly as for a workspace.
 stopForRename(root,ownerId,vault,renameId){return this.#freeze(root,ownerId,vault,value=>this.#workspaces.authorizeRename(value,vault,renameId));}
 stopForMove(root,ownerId,vault,moveId){return this.#freeze(root,ownerId,vault,value=>this.#workspaces.authorizeMove(value,vault,moveId));}
 // A deleted owner's catalogue and role leave the workspace cluster too. When
 // the containing workspace is itself being deleted, its whole cluster goes.
 async stopForDeletion(root,ownerId,vault,deleteId){
  await this.#freeze(root,ownerId,vault,value=>this.#workspaces.authorizeDeletion(value,vault,deleteId));
  root=await resolved(root);const home=await ownerWorkspaceRoot(root);
  if(await workspaceDeletion(home))return;
  await this.#dropCatalogue(root,home,ownerId,vault);
 }
 // A copy that replaced its source (a transfer across volumes or into another
 // workspace) retires the source catalogue from the source workspace cluster.
 // The role stays while it still owns the copied catalogue in this cluster.
 async retireCatalogue(root,ownerId,vault,operationId){
  ownerVault(ownerId,vault);root=await resolved(root);
  if((await workspaceRename(root))?.id!==operationId&&(await ownedMoveSource(root))?.id!==operationId)throw new AppError('STORAGE_MOVE_STATE');
  if(this.isOpen(root))throw new AppError('DATABASE_WORKSPACE_RUNNING');
  await authenticateOwnerKeyring(root,vault);
  await this.#dropCatalogue(root,await ownerWorkspaceRoot(root),ownerId,vault);
 }
 async #dropCatalogue(root,home,ownerId,vault){
  const binding=await catalogueBinding(root);this.assertOwner(binding,ownerId);
  const {service,env:source}=await this.#workspaces.running(home);
  if(binding&&binding.cluster!==service.clusterId)throw new AppError('CATALOGUE_UNAVAILABLE');
  if(typeof service.dropOwnerCatalogue!=='function')throw new AppError('DATABASE_RUNTIME');
  // While the role exists, only the owner's key may remove what it owns.
  const {role,password}=ownerRoleCredentials(ownerId,vault),url=new URL(source.OBSERVANDA_DATABASE_URL);
  const client=new Client({connectionString:source.OBSERVANDA_DATABASE_URL,connectionTimeoutMillis:5000,statement_timeout:5000});client.on('error',()=>{});
  let present;try{await client.connect();present=(await client.query('SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=$1',[role])).rowCount>0;}catch{throw new AppError('DATABASE_UNAVAILABLE');}finally{await client.end().catch(()=>{});}
  if(present){url.username=role;url.password=password;await verifyOwnerLogin(url.toString());}
  // An interrupted activation may have created a schema before its binding.
  const activation=await catalogueActivation(root),ids=[...new Set([binding?.id,activation?.id].filter(Boolean))];
  if(!ids.length)await service.dropOwnerCatalogue(role,null);
  for(const id of ids)await service.dropOwnerCatalogue(role,id);
 }
 async #freeze(root,ownerId,vault,authorize){
  ownerVault(ownerId,vault);
  root=await authorize(await resolved(root));
  const entry=this.#entries.get(root);if(entry&&entry.identity!==identityOf(ownerId,vault))throw new AppError('ACCESS_DENIED');
  await authenticateOwnerKeyring(root,vault);
  await this.#pool.close(root);
 }
 stats(){return this.#pool.stats();}
 async close(){await this.#pool.closeAll();}
}
// The proof that replaced a stopped per-owner cluster: no nested cluster,
// an authenticated key, and no connection of this owner left open.
export async function assertOwnerDatabaseFrozen(kind,root,ownerId,vault){
 ownerVault(ownerId,vault);root=await resolved(root);
 await assertNoNestedCluster(root);await authenticateOwnerKeyring(root,vault);
 const provider=databaseProvider();if(provider?.settleOwner&&!await provider.settleOwner(kind,root))throw new AppError('DATABASE_WORKSPACE_RUNNING');
}
