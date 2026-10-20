import {createPortabilityCollection,portabilityCollection,validPortabilityCollection} from './portability-collection.js';
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
 if(!value||![1,2].includes(value.version)||value.workspaceId!==registry.workspaceId||![value.id,value.projectId,value.sourceWorkspaceId].every(researchId)||value.sourceWorkspaceId===registry.workspaceId)throw new AppError('STORAGE_MOVE_STATE');
 if(owner){
  if(value.version!==1)throw new AppError('STORAGE_MOVE_STATE');
  if(Object.keys(value).sort().join()!=='id,projectId,sourceWorkspaceId,version,workspaceId'||value.projectId!==id)throw new AppError('STORAGE_MOVE_STATE');
  return value;
 }
 if(value.version===2){if(Object.keys(value).sort().join()!=='id,owners,parentId,projectId,sourceWorkspaceId,version,workspaceId'||value.id!==id||value.parentId!==null&&!researchId(value.parentId)||!validPortabilityCollection(value.owners)||value.owners.count<1)throw new AppError('STORAGE_MOVE_STATE');return value;}
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
 for await(const value of pending(registry))if(value.id!==except){const addresses=value.version===2?portabilityCollection(registry.workspace,value.owners).entries():value.addresses;for await(const address of addresses)if(await selected.find('namespace',address.namespaceId)||await selected.find('vault',address.vaultId))throw new AppError('STORAGE_PROJECT_BUSY');}
}
export async function reserveIncomingProjectMove(registry,value,{owners:nativeOwners}={}){
 if(nativeOwners)return reserveNativeIncoming(registry,value,nativeOwners);
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
 const incoming=await read(registry,value.id);if(!incoming&&value.ownerDirectoryVersion===2)return;
 const ids=incoming?.version===2?(async function*(){for await(const owner of portabilityCollection(registry.workspace,incoming.owners).entries({index:'project'}))yield owner.projectId;})():value.entries.map(entry=>entry.projectId).sort();
 for await(const id of ids){const selected=file(registry,id,true);await withWriterLease(path.join(path.dirname(selected),id+'.lock'),async()=>{const prior=await read(registry,id,true);if(!prior)return;if(prior.id!==value.id||prior.sourceWorkspaceId!==value.workspaceId)throw new AppError('CONFLICT');await unlink(selected);});}
 const selected=file(registry,value.id),prior=await read(registry,value.id);if(prior){if(prior.sourceWorkspaceId!==value.workspaceId)throw new AppError('CONFLICT');await unlink(selected);}
}
export async function assertIncomingProjectMovesSettled(registry,parents){
 const ids=new Set(parents);for await(const value of pending(registry)){if(ids.has(value.parentId))throw new AppError('STORAGE_PROJECT_BUSY');if(value.version===2){const owners=portabilityCollection(registry.workspace,value.owners);for(const id of ids)if(id!==null&&await owners.find('project',id))throw new AppError('STORAGE_PROJECT_BUSY');}else if(value.projects.some(id=>ids.has(id)))throw new AppError('STORAGE_PROJECT_BUSY');}
}

// A complete reservation becomes visible before individual address checks.
// New imports observe it; an already admitted import still holds its existing
// address lease. Both orders refuse collisions without retaining every lease.
async function reserveNativeIncoming(registry,value,owners){
 const directory=await privateDirectory(registry.workspace.root,'.observanda/project-incoming-moves');
 return withWriterLease(path.join(directory,'admission.lock'),async()=>{
  let incoming=await read(registry,value.id);
  if(incoming){
   if(incoming.version!==2||incoming.projectId!==value.projectId||incoming.sourceWorkspaceId!==value.workspaceId||incoming.parentId!==value.placement.parentId)throw new AppError('CONFLICT');
   const retained=portabilityCollection(registry.workspace,incoming.owners);if(retained.count!==owners.count)throw new AppError('CONFLICT');
   for await(const owner of owners.entries()){const prior=await retained.get(owner.relative);if(!prior||['kind','relative','projectId','labBookId','namespaceId','vaultId'].some(key=>prior[key]!==owner[key]))throw new AppError('CONFLICT');}
  }else{
   const rows=async function*(){for await(const owner of owners.entries())yield {kind:owner.kind,relative:owner.relative,projectId:owner.projectId,...(owner.labBookId?{labBookId:owner.labBookId}:{}),namespaceId:owner.namespaceId,vaultId:owner.vaultId};};
   const selected=await createPortabilityCollection(registry.workspace,rows(),{id:value.id});
   incoming={version:2,id:value.id,workspaceId:registry.workspaceId,sourceWorkspaceId:value.workspaceId,projectId:value.projectId,parentId:value.placement.parentId,owners:selected};
   await registry.workspace.writeFile(file(registry,value.id),serialize(incoming));
  }
  const selected=portabilityCollection(registry.workspace,incoming.owners);await assertIncomingProjectAddresses(registry,selected,{except:value.id});
  for await(const owner of selected.entries()){
   const addressDirectory=await privateDirectory(registry.workspace.root,owner.kind==='project'?'.observanda/project-import-addresses':'.observanda/lab-book-directory');
   await withWriterLease(path.join(addressDirectory,owner.namespaceId+'.lock'),async()=>{
    for await(const importing of pendingProjectImports(registry)){const other=projectImportOwners(registry,importing);if(await other.find('namespace',owner.namespaceId)||await other.find('vault',owner.vaultId)||owner.kind==='project'&&await other.find('project',owner.projectId))throw new AppError('STORAGE_PROJECT_BUSY');}
   },{wait:false});
   if(owner.kind==='project'){
    const ownerDirectory=await privateDirectory(registry.workspace.root,'.observanda/project-incoming-owners');
    await withWriterLease(path.join(ownerDirectory,owner.projectId+'.lock'),async()=>{
     const previous=await read(registry,owner.projectId,true);if(previous&&(previous.id!==value.id||previous.sourceWorkspaceId!==value.workspaceId))throw new AppError('STORAGE_PROJECT_BUSY');
     await registry.workspace.writeFile(file(registry,owner.projectId,true),serialize({version:1,id:value.id,workspaceId:registry.workspaceId,sourceWorkspaceId:value.workspaceId,projectId:owner.projectId}));
    },{wait:false});
   }
  }
 });
}
