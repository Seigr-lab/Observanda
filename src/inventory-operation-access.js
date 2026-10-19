import {AsyncLocalStorage} from 'node:async_hooks';
import {AppError} from './errors.js';
import {ownerSourceHost} from './owner-source-host.js';
import {projectCollectionReader} from './project-collection-reader.js';
import {LabBookDirectory} from './lab-book-directory.js';
import {researchId} from './web/research-reference.js';

// Every phase uses the initiating client grants and releases its owner before
// selecting another. Credentials remain request-owned and are never journaled.
export async function inventoryOperationAccess(application,client,workspaceId,{scope=null,labBookId=null,check=async()=>{},signal}={}){
 await check();signal?.throwIfAborted();
 const {registry}=await ownerSourceHost(application,{workspaceId,scope,labBookId}),reader=projectCollectionReader(application,client,check),readers=new Map(),owners=new Map(),visits=new AsyncLocalStorage();let closed=false;
 const active=()=>{signal?.throwIfAborted();if(closed)throw new AppError('WORKSPACE_CHANGED');};
 const same=(a,b)=>a.workspaceId===b.workspaceId&&a.projectId===b.projectId&&a.labBookId===b.labBookId;
 async function locateIn(registry,namespaceId){
  if(!researchId(namespaceId))throw new AppError('INVALID');
  if(namespaceId===registry.workspaceId)return {workspaceId:namespaceId,projectId:null,labBookId:null};
  let entry;try{entry=await registry.namespace(namespaceId);}catch(error){if(error.code!=='NOT_FOUND')throw error;entry=await new LabBookDirectory(registry).locate(namespaceId);if(!entry)throw error;}
  return {workspaceId:entry.namespaceId,projectId:entry.projectId,labBookId:entry.labBookId??null};
 }
 async function locate(namespaceId){
  try{return {application,owner:await locateIn(registry,namespaceId),sourceWorkspaceId:null,check};}
  catch(error){
   if(!['NOT_FOUND','PROJECT_MOVED'].includes(error.code))throw error;
   const connected=await application.inventoryConnections?.locate(client,namespaceId,locateIn,{check});if(connected)return connected;
   throw new AppError('INVENTORY_SOURCE_WORKSPACE');
  }
 }
 return {
  workspaceId,
  async connections(action,data){active();await check();return application.inventoryConnections.request(client,action,data,{check});},
  async useOwner(namespaceId,consume){
   active();const selected=await locate(namespaceId),owner=selected.owner,previous=owners.get(namespaceId);
   if(previous&&(!same(previous.owner,owner)||previous.sourceWorkspaceId!==selected.sourceWorkspaceId))throw new AppError('WORKSPACE_CHANGED');
   if(!previous&&owners.size>=32)throw new AppError('INVENTORY_OWNER_LIMIT');
   let sourceReader=reader;
   if(selected.sourceWorkspaceId){sourceReader=readers.get(selected.sourceWorkspaceId);if(!sourceReader){sourceReader=projectCollectionReader(selected.application,client,selected.check);readers.set(selected.sourceWorkspaceId,sourceReader);}}
   try{return await sourceReader.useStorage(owner,async(storage,{check:verify})=>{
    const current=async()=>{active();await verify();await selected.check();await check();const latest=await locate(namespaceId);if(!same(owner,latest.owner)||selected.sourceWorkspaceId!==latest.sourceWorkspaceId)throw new AppError('WORKSPACE_CHANGED');};
    const visit={active:true,namespaceId,selected,verify};
    try{return await visits.run(visit,async()=>{await current();const value=await consume(storage,owner,{check:current});await current();owners.set(namespaceId,{...selected,verify});return value;});}
    finally{visit.active=false;}
   });}catch(error){if(selected.sourceWorkspaceId)error.sourceWorkspaceId=selected.sourceWorkspaceId;throw error;}
  },
  async verify(){
   active();const visit=visits.getStore();
   if(visit?.active){
    // Participant transaction checkpoints run inside useStorage. Recheck the
    // exact grants directly instead of reentering its ordered reader queue.
    for(const saved of owners.values())await saved.verify();
    await visit.verify();
   }else{await reader.verify();for(const saved of readers.values())await saved.verify();}
   for(const [id,selected] of owners){const latest=await locate(id);if(!same(selected.owner,latest.owner)||selected.sourceWorkspaceId!==latest.sourceWorkspaceId)throw new AppError('WORKSPACE_CHANGED');}
   if(visit?.active&&!owners.has(visit.namespaceId)){const latest=await locate(visit.namespaceId);if(!same(visit.selected.owner,latest.owner)||visit.selected.sourceWorkspaceId!==latest.sourceWorkspaceId)throw new AppError('WORKSPACE_CHANGED');}
   await check();
  },
  async close(){closed=true;owners.clear();const results=await Promise.allSettled([reader.close(),...[...readers.values()].map(saved=>saved.close())]);readers.clear();const failed=results.find(result=>result.status==='rejected');if(failed)throw failed.reason;}
 };
}
export const inventoryOperationAccessFactory=(application,client,options={})=>(workspaceId,{signal}={})=>inventoryOperationAccess(application,client,workspaceId,{...options,signal});
