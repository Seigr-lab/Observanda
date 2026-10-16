// Namespace addresses locate one independent book without opening sibling
// databases. The containing project still authenticates and validates membership.
import path from 'node:path';
import {assertRegular,privateDirectory,serialize} from './storage.js';
import {withWriterLease,writerLeaseHeld} from './writer-lease.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
const keys=['projectId','labBookId','namespaceId','vaultId'];
const identity=value=>Object.fromEntries(keys.map(key=>[key,value[key]]));
const same=(a,b)=>keys.every(key=>a?.[key]===b?.[key]);
export class LabBookDirectory{
 constructor(registry){this.registry=registry;this.workspace=registry.workspace;}
 file(namespaceId){if(!researchId(namespaceId))throw new AppError('INVALID');return path.join(this.workspace.root,'.observanda','lab-book-directory',namespaceId+'.obsv');}
 async read(namespaceId){
  const file=this.file(namespaceId);await this.workspace.requireStorageKey();
  await assertRegular(path.dirname(file),{directory:true,missing:true});const stat=await assertRegular(file,{missing:true});if(!stat)return null;
  if(stat.size>4096)throw new AppError('LIMIT');let value;
  try{value=JSON.parse(await this.workspace.readFile(file,'utf8'));}catch(error){if(error instanceof SyntaxError)throw new AppError('FORMAT');throw error;}
  if(!value||Object.keys(value).sort().join()!=='labBookId,namespaceId,projectId,vaultId,version,workspaceId'||value.version!==1||value.workspaceId!==this.registry.workspaceId||value.namespaceId!==namespaceId||!keys.every(key=>researchId(value[key])))throw new AppError('FORMAT');
  return identity(value);
 }
 async register(projectId,book){
  const entry=identity({...book,projectId});if(!keys.every(key=>researchId(entry[key]))||entry.namespaceId===this.registry.workspaceId)throw new AppError('INVALID');
  await this.workspace.requireStorageKey();const file=this.file(entry.namespaceId),directory=await privateDirectory(this.workspace.root,'.observanda/lab-book-directory');
  const lock=path.join(directory,entry.namespaceId+'.lock'),register=async()=>{
   const projects=(await this.registry.read()).value;
   if(!projects.projects.some(project=>project.projectId===projectId)||projects.projects.some(project=>project.namespaceId===entry.namespaceId)||(projects.deleted??[]).some(project=>project.namespaceId===entry.namespaceId))throw new AppError('DATABASE_LOCATION');
   const previous=await this.read(entry.namespaceId);if(previous){if(!same(previous,entry))throw new AppError('DATABASE_LOCATION');return previous;}
   await this.workspace.writeFile(file,serialize({version:1,workspaceId:this.registry.workspaceId,...entry}));return entry;
  };return writerLeaseHeld(lock)?register():withWriterLease(lock,register);
 }
 async relocate(previous,next){
  if(![previous,next].every(value=>value&&keys.every(key=>researchId(value[key])))||['namespaceId','labBookId','vaultId'].some(key=>previous[key]!==next[key]))throw new AppError('INVALID');
  const file=this.file(next.namespaceId),directory=await privateDirectory(this.workspace.root,'.observanda/lab-book-directory');
  return withWriterLease(path.join(directory,next.namespaceId+'.lock'),async()=>{
   await this.registry.locate(next.projectId);const current=await this.read(next.namespaceId);
   if(same(current,next))return current;if(!same(current,previous))throw new AppError('CONFLICT');
   await this.workspace.writeFile(file,serialize({version:1,workspaceId:this.registry.workspaceId,...identity(next)}));return identity(next);
  });
 }
 async locate(namespaceId){
  const book=await this.read(namespaceId);if(!book)return null;
  const project=await this.registry.locate(book.projectId);
  return {...project,namespaceId:book.namespaceId,labBookId:book.labBookId,bookVaultId:book.vaultId};
 }
}
