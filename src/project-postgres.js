// Physical PostgreSQL ownership for a portable project. This does not select a
// project from a workspace catalogue or fall back to an installation database.
// WorkspacePostgres supplies the existing portable process/lease implementation;
// its historical name does not grant access to a containing workspace.
import {realpath,readFile} from 'node:fs/promises';
import path from 'node:path';
import {hkdfSync} from 'node:crypto';
import {WorkspacePostgres} from './workspace-postgres.js';
import {ProjectRuntimePool} from './project-runtime-pool.js';
import {clearVault,unseal} from './encryption.js';
import {assertRegular} from './storage.js';
import {AppError} from './errors.js';
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
export const PROJECT_DATABASE_DIRECTORY='.observanda/postgresql';
function runtimeVault(projectId,vault){
 if(!uuid(projectId))throw new AppError('INVALID');
 if(!Buffer.isBuffer(vault?.key)||vault.key.length!==32)throw new AppError('ACCESS_LOCKED');
 if(!uuid(vault.id))throw new AppError('ACCESS_DENIED');
 // Bind the runtime credentials to both the project and its independent keyring.
 // A workspace key, another project ID or another vault cannot open this cluster.
 return {id:projectId,key:Buffer.from(hkdfSync('sha256',vault.key,Buffer.from(vault.id),Buffer.from('Observanda/project-postgresql/v1/'+projectId),32))};
}
export class ProjectPostgres{
 #runtime;#environments=new Map();#pool;
 constructor({idleMs,maxIdle,...options}={}){
  this.#runtime=new WorkspacePostgres(options);
  this.#pool=new ProjectRuntimePool({idleMs,maxIdle,close:root=>this.#stop(root)});
 }
 async #lease(root,projectId,vault,{create=false,manual=false}={}){
  const key=runtimeVault(projectId,vault);
  try{
   root=await realpath(root);
   return await this.#pool.acquire(root,async()=>{
    const source=await this.#runtime.open(root,key,{create});
    // Project routing remains explicit even though the portable process owner
    // is shared with workspace runtimes.
    let entry=this.#environments.get(root);
    if(entry?.source!==source){
     const env={...source};delete env.OBSERVANDA_WORKSPACE_DATABASE_ROOT;
     env.OBSERVANDA_PROJECT_DATABASE_ROOT=root;env.OBSERVANDA_PROJECT_ID=projectId;
     entry={source,env};this.#environments.set(root,entry);
    }
    return entry.env;
   },{manual});
  }finally{clearVault(key);}
 }
 acquire(root,projectId,vault,options){return this.#lease(root,projectId,vault,options);}
 // Explicit environment consumers own a manual service lifetime. Normal
 // catalogue connections use acquire and release their runtime automatically.
 async open(root,projectId,vault,options={}){const lease=await this.#lease(root,projectId,vault,{...options,manual:true});lease.release();return lease.env;}
 async #stop(root){
  const entry=this.#environments.get(root);
  try{await this.#runtime.closeWorkspace(root);}
  finally{if(entry)delete entry.env.OBSERVANDA_DATABASE_URL;if(this.#environments.get(root)===entry)this.#environments.delete(root);}
 }
 async closeProject(root){root=await realpath(root).catch(error=>{if(error.code==='ENOENT')return path.resolve(root);throw error;});await this.#pool.close(root);}
 async stopForRename(root,projectId,vault,renameId){
  const key=runtimeVault(projectId,vault);
  try{await this.#runtime.authorizeRename(root,key,renameId);await this.closeProject(root);await this.#runtime.stopForRename(root,key,renameId);}finally{clearVault(key);}
 }
 async stopForMove(root,projectId,vault,id){
  const key=runtimeVault(projectId,vault);
  try{await this.#runtime.authorizeMove(root,key,id);await this.closeProject(root);await this.#runtime.stopForMove(root,key,id);}finally{clearVault(key);}
 }
 async stopForDeletion(root,projectId,vault,deleteId){
  const key=runtimeVault(projectId,vault);
  try{await this.#runtime.authorizeDeletion(root,key,deleteId);await this.closeProject(root);await this.#runtime.stopForDeletion(root,key,deleteId);}finally{clearVault(key);}
 }
 stats(){return this.#pool.stats();}
 async close(){await this.#pool.closeAll();await this.#runtime.close();}

}

export async function assertProjectDatabaseStopped(root,projectId,vault){
 const file=path.join(root,PROJECT_DATABASE_DIRECTORY,'service.observanda');await assertRegular(file);
 const key=runtimeVault(projectId,vault);let bytes;
 try{
  bytes=unseal(await readFile(file),key.key,'Observanda/workspace-postgresql/v1/'+key.id);
  const state=JSON.parse(bytes.toString('utf8'));
  if(state.workspaceId!==projectId||state.running!==false)throw new AppError('DATABASE_WORKSPACE_RUNNING');
 }finally{bytes?.fill(0);clearVault(key);}
}
