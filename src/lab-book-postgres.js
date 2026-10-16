// A lab book owns its database independently of its containing project.
// Moving the book changes its location, not its cryptographic identity.
import {realpath,readFile} from 'node:fs/promises';
import path from 'node:path';
import {hkdfSync} from 'node:crypto';
import {WorkspacePostgres} from './workspace-postgres.js';
import {ProjectRuntimePool} from './project-runtime-pool.js';
import {clearVault,unseal} from './encryption.js';
import {assertRegular} from './storage.js';
import {AppError} from './errors.js';

const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
export const LAB_BOOK_DATABASE_DIRECTORY='.observanda/postgresql';
function runtimeVault(labBookId,vault){
 if(!uuid(labBookId))throw new AppError('INVALID');
 if(!Buffer.isBuffer(vault?.key)||vault.key.length!==32)throw new AppError('ACCESS_LOCKED');
 if(!uuid(vault.id))throw new AppError('ACCESS_DENIED');
 return {id:labBookId,key:Buffer.from(hkdfSync('sha256',vault.key,Buffer.from(vault.id),Buffer.from('Observanda/lab-book-postgresql/v1/'+labBookId),32))};
}
export class LabBookPostgres{
 #runtime;#environments=new Map();#pool;
 constructor({idleMs,maxIdle,...options}={}){
  this.#runtime=new WorkspacePostgres(options);
  this.#pool=new ProjectRuntimePool({idleMs,maxIdle,close:root=>this.#stop(root)});
 }
 async #lease(root,labBookId,vault,{create=false,manual=false}={}){
  const key=runtimeVault(labBookId,vault);
  try{
   root=await realpath(root);
   return await this.#pool.acquire(root,async()=>{
    const source=await this.#runtime.open(root,key,{create});
    let entry=this.#environments.get(root);
    if(entry?.source!==source){
     const env={...source};
     delete env.OBSERVANDA_WORKSPACE_DATABASE_ROOT;
     delete env.OBSERVANDA_PROJECT_DATABASE_ROOT;delete env.OBSERVANDA_PROJECT_ID;
     env.OBSERVANDA_LAB_BOOK_DATABASE_ROOT=root;env.OBSERVANDA_LAB_BOOK_ID=labBookId;
     entry={source,env};this.#environments.set(root,entry);
    }
    return entry.env;
   },{manual});
  }finally{clearVault(key);}
 }
 acquire(root,labBookId,vault,options){return this.#lease(root,labBookId,vault,options);}
 async open(root,labBookId,vault,options={}){const lease=await this.#lease(root,labBookId,vault,{...options,manual:true});lease.release();return lease.env;}
 async #stop(root){
  const entry=this.#environments.get(root);
  try{await this.#runtime.closeWorkspace(root);}
  finally{if(entry)delete entry.env.OBSERVANDA_DATABASE_URL;if(this.#environments.get(root)===entry)this.#environments.delete(root);}
 }
 async closeLabBook(root){root=await realpath(root).catch(error=>{if(error.code==='ENOENT')return path.resolve(root);throw error;});await this.#pool.close(root);}
 async stopForRename(root,labBookId,vault,renameId){
  const key=runtimeVault(labBookId,vault);
  try{await this.#runtime.authorizeRename(root,key,renameId);await this.closeLabBook(root);await this.#runtime.stopForRename(root,key,renameId);}finally{clearVault(key);}
 }
 async stopForDeletion(root,labBookId,vault,deleteId){
  const key=runtimeVault(labBookId,vault);
  try{await this.#runtime.authorizeDeletion(root,key,deleteId);await this.closeLabBook(root);await this.#runtime.stopForDeletion(root,key,deleteId);}finally{clearVault(key);}
 }
 async stopForMove(root,labBookId,vault,moveId){
  const key=runtimeVault(labBookId,vault);
  try{await this.#runtime.authorizeMove(root,key,moveId);await this.closeLabBook(root);await this.#runtime.stopForMove(root,key,moveId);}finally{clearVault(key);}
 }
 stats(){return this.#pool.stats();}
 async close(){await this.#pool.closeAll();await this.#runtime.close();}
}

export async function assertLabBookDatabaseStopped(root,labBookId,vault){
 const file=path.join(root,LAB_BOOK_DATABASE_DIRECTORY,'service.observanda');await assertRegular(file);
 const key=runtimeVault(labBookId,vault);let bytes;
 try{
  bytes=unseal(await readFile(file),key.key,'Observanda/workspace-postgresql/v1/'+key.id);
  const state=JSON.parse(bytes.toString('utf8'));
  if(state.workspaceId!==labBookId||state.running!==false)throw new AppError('DATABASE_WORKSPACE_RUNNING');
 }finally{bytes?.fill(0);clearVault(key);}
}
