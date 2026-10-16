// Departed identities stay distinct from deletion. A reference identifies its
// new workspace without storing a machine path or granting access to it.
import {researchId} from './web/research-reference.js';
import {selectProjectTree} from './project-tree-manifest.js';
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
  const current=await registry.read(),active=current.value.projects.filter(entry=>ids.has(entry.projectId));
  if(!active.length){
   const departures=new Map((current.value.relocated??[]).map(entry=>[entry.projectId,entry]));
   if(entries.every(entry=>{const moved=departures.get(entry.projectId);return same(moved,entry,identity)&&moved.operationId===operationId&&moved.workspaceId===workspaceId;}))return current;
   throw new AppError('CONFLICT');
  }
  const byId=new Map(active.map(entry=>[entry.projectId,entry]));
  if(active.length!==entries.length||entries.some(entry=>!same(byId.get(entry.projectId),entry,[...identity,'root','parentId'])))throw new AppError('CONFLICT');
  const {entries:selected}=selectProjectTree({...entries[0],vault:{id:entries[0].vaultId}},current.value.projects);
  if(selected.length+1!==entries.length||selected.some(entry=>!ids.has(entry.projectId)))throw new AppError('CONFLICT');
  try{return await registry.change(current.revision,value=>{
   value.projects=value.projects.filter(entry=>!ids.has(entry.projectId));value.relocated??=[];
   value.relocated.push(...entries.map(entry=>({...Object.fromEntries(identity.map(key=>[key,entry[key]])),workspaceId,operationId})));return value;
  });}catch(error){if(error.code!=='CONFLICT'||attempt>=7)throw error;}
 }
}
