// The installation's complete workspace directory is independent of its
// bounded recent-items list. A name reservation spans only a location change.
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {createPersistentDirectory as mkdir} from './filesystem-persistence.js';
import {assertRegular,atomicWrite,serialize} from './storage.js';
import {withWriterLease} from './writer-lease.js';
import {workspaceFolderName,validateWorkspaceName} from './workspace-names.js';
import {AppError} from './errors.js';
const nameKey=root=>workspaceFolderName(root).normalize('NFC').toLowerCase();
const validRoot=root=>typeof root==='string'&&path.isAbsolute(root)&&path.resolve(root)===root&&root!==path.parse(root).root&&!/[\x00-\x1f]/.test(root);
export class WorkspaceDirectory{
 constructor(file,{seed=async()=>[]}={}){this.file=file;this.seed=seed;}
 async read(){
  const stat=await assertRegular(this.file,{missing:true});let value={version:1,roots:[]};
  if(stat){
   if(stat.size>4*1024*1024)throw new AppError('PREFERENCES_FORMAT');
   try{value=JSON.parse(await readFile(this.file,'utf8'));}catch{throw new AppError('PREFERENCES_FORMAT');}
   if(value?.version!==1||Object.keys(value).sort().join()!=='roots,version'||!Array.isArray(value.roots)||value.roots.some(root=>!validRoot(root))||new Set(value.roots).size!==value.roots.length)throw new AppError('PREFERENCES_FORMAT');
  }
  for(const root of await this.seed())if(validRoot(root)&&!value.roots.includes(root))value.roots.push(root);
  return value;
 }
 async lock(operation){
  await mkdir(path.dirname(this.file),{recursive:true,mode:0o700});
  return withWriterLease(this.file+'.lock',operation);
 }
 async list(){const {roots}=await this.read();return roots.map(root=>({path:root,title:workspaceFolderName(root),conflict:roots.some(other=>other!==root&&nameKey(other)===nameKey(root))}));}
 async using(root,{replacing=null,allowExisting=false}={},operation){
  if(!validRoot(root)||replacing!==null&&!validRoot(replacing))throw new AppError('STORAGE_PATH');
  validateWorkspaceName(workspaceFolderName(root));
  return this.lock(async()=>{
   const value=await this.read();
   if(!(allowExisting&&value.roots.includes(root))&&value.roots.some(other=>other!==root&&other!==replacing&&nameKey(other)===nameKey(root)))throw new AppError('WORKSPACE_NAME_EXISTS');
   const result=await operation();
   const roots=[...new Set([...value.roots.filter(item=>item!==replacing),root])];
   await atomicWrite(this.file,serialize({version:1,roots}));return result;
  });
 }
 async forget(root){return this.lock(async()=>{const value=await this.read();await atomicWrite(this.file,serialize({...value,roots:value.roots.filter(item=>item!==root)}));});}
}
