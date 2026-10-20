// Departed identities stay distinct from deletion. A reference identifies its
// new workspace without storing a machine path or granting access to it.
import {researchId} from './web/research-reference.js';
import {selectProjectTree} from './project-tree-manifest.js';
import {projectRegistryLocationKey} from './project-registry-locations.js';
import path from 'node:path';
import {AppError} from './errors.js';
const same=(a,b,keys)=>keys.every(key=>a?.[key]===b?.[key]);
const identity=['projectId','namespaceId','vaultId'];
export function assertProjectPresent(value,{projectId,namespaceId}){
 const matches=entry=>projectId!==undefined?entry.projectId===projectId:entry.namespaceId===namespaceId;
 if(value.deleted?.some(matches))throw new AppError('PROJECT_DELETED');
 const moved=value.relocated?.find(matches);
 if(moved){const error=new AppError('PROJECT_MOVED');error.projectId=moved.projectId;error.workspaceId=moved.workspaceId;throw error;}
}
export function acceptRelocatedProject(value,entry){
 const prior=value.relocated?.find(item=>item.projectId===entry.projectId);
 if(prior&&!same(prior,entry,identity))throw new AppError('DATABASE_LOCATION');
 if(prior)value.relocated=value.relocated.filter(item=>item.projectId!==entry.projectId);
}
// Only the already verified destination handoff calls this publication step.
// One registry write removes the whole selected hierarchy, including its root.
export async function recordProjectDeparture(registry,entries,{workspaceId,operationId}){
 if(!researchId(workspaceId)||workspaceId===registry.workspaceId||!researchId(operationId)||!Array.isArray(entries)||!entries.length||entries.length>4097)throw new AppError('INVALID');
 if(entries.some(entry=>!entry||!identity.every(key=>researchId(entry[key]))))throw new AppError('INVALID');
 const ids=new Set(entries.map(entry=>entry.projectId));if(ids.size!==entries.length)throw new AppError('INVALID');
 for(let attempt=0;;attempt++){
  const current=await registry.inspect(async view=>{
   const rows=[];for(const entry of entries)rows.push(await view.get(entry.projectId));
   if(rows.every(row=>row?.state==='relocated')&&rows.every((row,index)=>same(row.entry,entries[index],identity)&&row.entry.operationId===operationId&&row.entry.workspaceId===workspaceId))return {revision:view.revision,complete:true};
   if(rows.some((row,index)=>row?.state!=='active'||!same(row.entry,entries[index],[...identity,'root','parentId'])))throw new AppError('CONFLICT');
   const selected=rows.map(row=>row.entry);selectProjectTree({...entries[0],vault:{id:entries[0].vaultId}},selected);
   for(const entry of entries)for await(const child of view.entries({index:'parent',prefix:entry.projectId+':'}))if(!ids.has(child.entry.projectId))throw new AppError('CONFLICT');
   const root=projectRegistryLocationKey(entries[0].root,registry.workspace.root);
   for await(const child of view.entries({index:'location',prefix:root+(root.startsWith('relative:')?'/':path.sep)}))if(!ids.has(child.entry.projectId))throw new AppError('STORAGE_PATH');
   return {revision:view.revision,complete:false};
  });
  if(current.complete)return current;
  try{return await registry.apply(current.revision,entries.map(entry=>({state:'relocated',entry:{...Object.fromEntries(identity.map(key=>[key,entry[key]])),workspaceId,operationId}})));}catch(error){if(error.code!=='CONFLICT'||attempt>=7)throw error;}
 }
}
