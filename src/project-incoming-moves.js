// Incoming moves reserve their independent identities, not a workspace writer.
// Namespace admission uses the same short leases as imports. Encrypted owner
// pointers refer to one bounded journal instead of duplicating the tree.
import path from 'node:path';
import {opendir,unlink} from 'node:fs/promises';
import {assertRegular,privateDirectory,serialize} from './storage.js';
import {withWriterLease} from './writer-lease.js';
import {pendingProjectImports,projectImportOwners} from './project-import-state.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
const file=(registry,id,owner=false)=>{if(!researchId(id))throw new AppError('INVALID');return path.join(registry.workspace.root,'.observanda',owner?'project-incoming-owners':'project-incoming-moves',id+'.obsv');};
async function read(registry,id,owner=false){
 const selected=file(registry,id,owner),stat=await assertRegular(selected,{missing:true});if(!stat)return null;if(stat.size>(owner?4096:2*1024*1024))throw new AppError('STORAGE_MOVE_STATE');
 let value;try{value=JSON.parse(await registry.workspace.readFile(selected,'utf8'));}catch{throw new AppError('STORAGE_MOVE_STATE');}
 if(!value||value.version!==1||value.workspaceId!==registry.workspaceId||![value.id,value.projectId,value.sourceWorkspaceId].every(researchId)||value.sourceWorkspaceId===registry.workspaceId)throw new AppError('STORAGE_MOVE_STATE');
 if(owner){
  if(Object.keys(value).sort().join()!=='id,projectId,sourceWorkspaceId,version,workspaceId'||value.projectId!==id)throw new AppError('STORAGE_MOVE_STATE');
  return value;
 }
 if(Object.keys(value).sort().join()!=='addresses,id,parentId,projectId,projects,sourceWorkspaceId,version,workspaceId'||value.id!==id||value.parentId!==null&&!researchId(value.parentId)||!Array.isArray(value.projects)||!value.projects.length||value.projects.length>4097||!value.projects.every(researchId)||new Set(value.projects).size!==value.projects.length||!value.projects.includes(value.projectId)||!Array.isArray(value.addresses)||value.addresses.length<value.projects.length||value.addresses.length>8192)throw new AppError('STORAGE_MOVE_STATE');
 const namespaces=new Set(),vaults=new Set();for(const address of value.addresses){if(!address||Object.keys(address).sort().join()!=='namespaceId,vaultId'||!researchId(address.namespaceId)||!researchId(address.vaultId)||namespaces.has(address.namespaceId)||vaults.has(address.vaultId))throw new AppError('STORAGE_MOVE_STATE');namespaces.add(address.namespaceId);vaults.add(address.vaultId);}return value;
}
async function* pending(registry){
 const directory=path.join(registry.workspace.root,'.observanda/project-incoming-moves');if(!await assertRegular(directory,{directory:true,missing:true}))return;
 for await(const entry of await opendir(directory)){if(!entry.name.endsWith('.obsv')||!researchId(entry.name.slice(0,-5)))continue;const value=await read(registry,entry.name.slice(0,-5));if(value)yield value;}
}
export function incomingProjectMove(registry,projectId){return read(registry,projectId,true);}
export async function assertIncomingProjectAddresses(registry,owners,{except=null}={}){
 const selected=Array.isArray(owners)?projectImportOwners(registry,{owners}):owners;
 for await(const value of pending(registry))if(value.id!==except)for(const address of value.addresses)if(await selected.find('namespace',address.namespaceId)||await selected.find('vault',address.vaultId))throw new AppError('STORAGE_PROJECT_BUSY');
}
export async function reserveIncomingProjectMove(registry,value){
 const owners=[...value.entries.map(entry=>({...entry,kind:'project'})),...(value.rootBooks.books??[]).map(entry=>({...entry,kind:'lab-book'})),...(value.projects??[]).flatMap(project=>(project.books??[]).map(entry=>({...entry,kind:'lab-book'})))];
 if(owners.length>8192)throw new AppError('LIMIT');
 const incoming={version:1,id:value.id,workspaceId:registry.workspaceId,sourceWorkspaceId:value.workspaceId,projectId:value.projectId,parentId:value.placement.parentId,projects:value.entries.map(entry=>entry.projectId).sort(),addresses:owners.map(({namespaceId,vaultId})=>({namespaceId,vaultId})).sort((a,b)=>a.namespaceId.localeCompare(b.namespaceId))};
 await privateDirectory(registry.workspace.root,'.observanda/project-incoming-moves');const directory=await privateDirectory(registry.workspace.root,'.observanda/project-incoming-owners'),raw=serialize(incoming),locks=[];
 for(const owner of owners){const directory=await privateDirectory(registry.workspace.root,owner.kind==='project'?'.observanda/project-import-addresses':'.observanda/lab-book-directory');locks.push(path.join(directory,owner.namespaceId+'.lock'));}
 locks.sort();locks.push(...incoming.projects.map(id=>path.join(directory,id+'.lock')));
 const next=async index=>{
  if(index<locks.length)return withWriterLease(locks[index],()=>next(index+1),{wait:false});
  await assertIncomingProjectAddresses(registry,owners,{except:incoming.id});
  const projectIds=new Set(incoming.projects),namespaces=new Set(incoming.addresses.map(address=>address.namespaceId)),vaults=new Set(incoming.addresses.map(address=>address.vaultId));
  for await(const importing of pendingProjectImports(registry))for await(const owner of projectImportOwners(registry,importing).entries())if(projectIds.has(owner.projectId)||namespaces.has(owner.namespaceId)||vaults.has(owner.vaultId))throw new AppError('STORAGE_PROJECT_BUSY');
  for(const id of incoming.projects){const previous=await read(registry,id,true);if(previous&&(previous.id!==incoming.id||previous.sourceWorkspaceId!==incoming.sourceWorkspaceId))throw new AppError('STORAGE_PROJECT_BUSY');}
  const previous=await read(registry,incoming.id);if(previous&&serialize(previous)!==raw)throw new AppError('CONFLICT');
  await registry.workspace.writeFile(file(registry,incoming.id),raw);
  for(const projectId of incoming.projects)await registry.workspace.writeFile(file(registry,projectId,true),serialize({version:1,id:incoming.id,workspaceId:registry.workspaceId,sourceWorkspaceId:incoming.sourceWorkspaceId,projectId}));
 };return next(0);
}
export async function releaseIncomingProjectMove(registry,value){
 const ids=value.entries.map(entry=>entry.projectId).sort();
 for(const id of ids){const selected=file(registry,id,true);await withWriterLease(path.join(path.dirname(selected),id+'.lock'),async()=>{const prior=await read(registry,id,true);if(!prior)return;if(prior.id!==value.id||prior.sourceWorkspaceId!==value.workspaceId)throw new AppError('CONFLICT');await unlink(selected);});}
 const selected=file(registry,value.id),prior=await read(registry,value.id);if(prior){if(prior.sourceWorkspaceId!==value.workspaceId)throw new AppError('CONFLICT');await unlink(selected);}
}
export async function assertIncomingProjectMovesSettled(registry,parents){
 const ids=new Set(parents);for await(const value of pending(registry))if(ids.has(value.parentId)||value.projects.some(id=>ids.has(id)))throw new AppError('STORAGE_PROJECT_BUSY');
}
