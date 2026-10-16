// A destination grant belongs to one client and expires independently of the
// source workspace. Passwords are consumed by authentication, never retained.
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {Workspace} from './storage.js';
import {inspectLocation} from './locations.js';
import {readAccess} from './access.js';
import {clearVault} from './encryption.js';
import {projectMoveDirectory,assertProjectMoveDirectory} from './project-move-boundaries.js';
import {assertNotRenaming} from './workspace-rename-state.js';
import {assertNotDeleting} from './workspace-delete-state.js';
import {AppError} from './errors.js';
const fields=(data,names)=>{if(!data||Array.isArray(data)||Object.keys(data).some(key=>!names.includes(key)))throw new AppError('INVALID');};
export class ProjectWorkspaceTargets{
 constructor(application,locations=async()=>[]){this.application=application;this.locations=locations;this.entries=new Map();this.disposals=new Set();}
 async list(){return {workspaces:(await this.locations()).filter(item=>item.path!==this.application.workspace.root).map(({path,title})=>({path,title}))};}
 async dispose(entry){try{await entry.application.close();}finally{clearVault(entry.vault);}}
 expire(){for(const [id,entry] of this.entries)if(entry.expires<=Date.now()&&!entry.active){this.entries.delete(id);const done=this.dispose(entry).finally(()=>this.disposals.delete(done));this.disposals.add(done);done.catch(()=>{});}}
 async close(){const values=[...this.entries.values()];this.entries.clear();const results=await Promise.allSettled([...values.map(entry=>this.dispose(entry)),...this.disposals]);const failure=results.find(result=>result.status==='rejected');if(failure)throw failure.reason;}
 async open(client,data,{check=async()=>{}}={}){
  fields(data,['path','username','password','recovery']);if(typeof data.path!=='string'||['username','password','recovery'].some(key=>typeof data[key]!=='string'||data[key].length>1024))throw new AppError('INVALID');
  await check();this.expire();if(this.entries.size>=8)throw new AppError('LIMIT');
  if(!(await this.list()).workspaces.some(item=>item.path===data.path))throw new AppError('NOT_FOUND');
  const location=await inspectLocation(data.path);if(location.kind!=='workspace'||location.root!==data.path)throw new AppError('STORAGE_PATH');
  await assertNotRenaming(location.root);await assertNotDeleting(location.root);const access=await readAccess(location.root);let vault,application;
  try{
   vault=await this.application.authenticate(location.root,access,data.username,data.password,data.recovery);
   application=new this.application.constructor(new Workspace(location.root,vault),{deviceStore:this.application.deviceStore,authenticate:this.application.authenticate});
   const registry=await application.registry();if(registry.workspaceId===(await this.application.registry()).workspaceId)throw new AppError('INVALID');
   await check();if(this.application.closed||(await readAccess(location.root)).etag!==access.etag)throw new AppError('ACCESS_LOCKED');
   const id=randomBytes(24).toString('hex'),entry={client,application,vault,registry,access:access.etag,identity:await projectMoveDirectory(location.root),expires:Date.now()+30*60*1000,active:0};this.entries.set(id,entry);vault=null;application=null;
   return {id,workspaceId:registry.workspaceId,title:path.basename(location.root)};
  }finally{if(application)await application.close();clearVault(vault);}
 }
 async use(client,id,operation,{check=async()=>{}}={}){
  const entry=typeof id==='string'&&this.entries.get(id);if(!entry||entry.client!==client)throw new AppError('PROJECT_MOVE_DESTINATION_ACCESS');
  const current=async()=>{await check();if(this.application.closed||entry.application.closed||this.entries.get(id)!==entry||entry.expires<=Date.now())throw new AppError('PROJECT_MOVE_DESTINATION_ACCESS');await assertProjectMoveDirectory(entry.application.workspace.root,entry.identity);if((await readAccess(entry.application.workspace.root)).etag!==entry.access)throw new AppError('PROJECT_MOVE_DESTINATION_ACCESS');};
  entry.active++;try{await current();return await operation(entry,current);}finally{entry.active--;}
 }
 async release(client,id){const entry=this.entries.get(id);if(!entry||entry.client!==client)throw new AppError('PROJECT_MOVE_DESTINATION_ACCESS');if(entry.active)throw new AppError('STORAGE_PROJECT_BUSY');this.entries.delete(id);await this.dispose(entry);return {released:true};}
}
