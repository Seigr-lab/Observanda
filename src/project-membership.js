import {assertProjectImportsSettled} from './project-import-state.js';
// Child creation and parent relocation meet at a short, parent-specific lease.
// The workspace holds these control files so moving a project never moves a held lease.
import path from 'node:path';
import {AsyncLocalStorage} from 'node:async_hooks';
const deletionMembership=new AsyncLocalStorage();
export const projectDeletionMembership=(id,operation)=>deletionMembership.run(id,operation);
import {opendir} from 'node:fs/promises';
import {assertRegular,privateDirectory} from './storage.js';
import {withWriterLease} from './writer-lease.js';
import {assertNotDeleting} from './workspace-delete-state.js';
import {assertNotRenaming} from './workspace-rename-state.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
export async function withProjectMembership(registry,parents,operation,{wait=true}={}){
 const ids=[...new Set(parents.map(id=>id??registry.workspaceId))].sort();if(!ids.every(researchId))throw new AppError('INVALID');
 const directory=await privateDirectory(registry.workspace.root,'.observanda/project-membership');
 const next=async index=>{
  if(index===ids.length)return operation();
  return withWriterLease(path.join(directory,ids[index]+'.lock'),async()=>{
   const root=ids[index]===registry.workspaceId?registry.workspace.root:(await registry.locate(ids[index])).root;await assertRegular(root,{directory:true});await assertNotRenaming(root);await assertNotDeleting(root);
   const receipt=path.join(registry.workspace.root,'.observanda/project-deletions',ids[index]+'.obsv'),stat=await assertRegular(receipt,{missing:true});
   if(stat){
    if(stat.size>16*1024*1024)throw new AppError('STORAGE_DELETE_STATE');let pending;try{pending=JSON.parse(await registry.workspace.readFile(receipt,'utf8'));}catch{throw new AppError('STORAGE_DELETE_STATE');}
    if(pending.phase!=='complete'&&pending.id!==deletionMembership.getStore())throw new AppError('STORAGE_DELETING');
   }
   return next(index+1);
  },{wait});
 };
 return next(0);
}
export async function assertProjectCreationSettled(registry,parents){
 await assertProjectImportsSettled(registry,parents);
 const ids=new Set(parents),registered=new Set((await registry.read()).value.projects.map(p=>p.projectId)),directory=path.join(registry.workspace.root,'.observanda/project-creation');
 if(!await assertRegular(directory,{directory:true,missing:true}))return;
 for await(const entry of await opendir(directory)){
  if(!entry.name.endsWith('.obsv')||!researchId(entry.name.slice(0,-5)))continue;
  const file=path.join(directory,entry.name),stat=await assertRegular(file);if(stat.size>16*1024*1024)throw new AppError('STORAGE_PROJECT_BUSY');
  let value;try{value=JSON.parse(await registry.workspace.readFile(file,'utf8'));}catch{throw new AppError('STORAGE_PROJECT_BUSY');}
  if(value.version!==1||!researchId(value.projectId))throw new AppError('STORAGE_PROJECT_BUSY');
  if(value.phase==='prepared'&&!registered.has(value.projectId)&&ids.has(value.parentId??null))throw new AppError('STORAGE_PROJECT_BUSY');
 }
}

// An interrupted relocation reserves both parent memberships until its
// physical move and registry update agree. Ordinary parent records stay usable.
export async function assertProjectRelocationsSettled(registry,parents,{except=null}={}){
 const ids=new Set(parents),directory=path.join(registry.workspace.root,'.observanda/project-renames');if(!await assertRegular(directory,{directory:true,missing:true}))return;
 for await(const entry of await opendir(directory)){
  if(!entry.name.endsWith('.obsv')||!researchId(entry.name.slice(0,-5))||entry.name===except+'.obsv')continue;
  const file=path.join(directory,entry.name),stat=await assertRegular(file);if(stat.size>16*1024*1024)throw new AppError('STORAGE_PROJECT_BUSY');
  let value;try{value=JSON.parse(await registry.workspace.readFile(file,'utf8'));}catch{throw new AppError('STORAGE_PROJECT_BUSY');}
  if(value.version!==1||!researchId(value.projectId))throw new AppError('STORAGE_PROJECT_BUSY');
  if(!['complete','cancelled'].includes(value.phase)&&(ids.has(value.parentId)||value.placement&&ids.has(value.placement.parentId)))throw new AppError('STORAGE_PROJECT_BUSY');
 }
}
