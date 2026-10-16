// Source workspace grants are explicit, client-owned and never part of a BOM journal.
import path from 'node:path';
import {ProjectWorkspaceTargets} from './project-workspace-targets.js';
import {projectRequest} from './project-application.js';
import {exact,uuid} from './modules/validation.js';
import {AppError} from './errors.js';
export class InventoryWorkspaceConnections{
 constructor(application,locations){this.targets=new ProjectWorkspaceTargets(application,locations);}
 expire(){this.targets.expire();}
 close(){return this.targets.close();}
 async request(client,action,data,{check=async()=>{}}={}){
  const {workspaceId,...input}=data;
  if(action==='list'){if(!exact(input,[]))throw new AppError('INVALID');await check();return {workspaceId,...await this.targets.list(),connections:[...this.targets.entries.values()].filter(entry=>entry.client===client&&entry.expires>Date.now()).map(entry=>({sourceWorkspaceId:entry.registry.workspaceId,title:path.basename(entry.application.workspace.root)}))};}
  if(action==='open'){
   const opened=await this.targets.open(client,input,{check});
   for(const [id,entry] of this.targets.entries)if(id!==opened.id&&entry.client===client&&entry.registry.workspaceId===opened.workspaceId){entry.expires=0;if(!entry.active)await this.targets.release(client,id);}
   return {workspaceId,sourceWorkspaceId:opened.workspaceId,connectionId:opened.id,title:opened.title};
  }
  if(action==='close'){
   const precise=Object.hasOwn(input,'connectionId');
   if(!exact(input,['sourceWorkspaceId',...(precise?['connectionId']:[])])||!uuid(input.sourceWorkspaceId)||precise&&(typeof input.connectionId!=='string'||!/^[a-f0-9]{48}$/.test(input.connectionId)))throw new AppError('INVALID');
   await check();const entry=precise?this.targets.entries.get(input.connectionId):null;
   if(entry&&(entry.client!==client||entry.registry.workspaceId!==input.sourceWorkspaceId))throw new AppError('INVALID');
   // A late response may clean up only its own grant. An already replaced grant
   // is a successful no-op, so it cannot disconnect a newer view's connection.
   const selected=precise?(entry?[[input.connectionId,entry]]:[]):[...this.targets.entries].filter(([,entry])=>entry.client===client&&entry.registry.workspaceId===input.sourceWorkspaceId);
   for(const [id] of selected)await this.targets.release(client,id);return {workspaceId,closed:true};
  }
  if(action!=='unlock'||!exact(input,['sourceWorkspaceId','projectId',...(Object.hasOwn(input,'labBookId')?['labBookId']:[]),'username','password','recovery'])||!uuid(input.sourceWorkspaceId)||!uuid(input.projectId)||Object.hasOwn(input,'labBookId')&&!uuid(input.labBookId))throw new AppError('INVALID');
  const {sourceWorkspaceId,projectId,labBookId,...credentials}=input;
  return this.use(client,sourceWorkspaceId,async(entry,current)=>{
   if(!labBookId)return entry.application.unlock(client,projectId,credentials,{check:current});
   return entry.application.run(client,projectRequest('/api/projects/'+projectId+'/lab-books/'+labBookId+'/access/unlock','POST'),credentials,{check:current});
  },{check});
 }
 async use(client,workspaceId,operation,{check=async()=>{}}={}){
  this.expire();const selected=[...this.targets.entries].reverse().find(([,entry])=>entry.client===client&&entry.registry.workspaceId===workspaceId);
  if(!selected){const error=new AppError('INVENTORY_SOURCE_WORKSPACE');error.sourceWorkspaceId=workspaceId;throw error;}
  const sourceError=error=>{if(error.code==='PROJECT_MOVE_DESTINATION_ACCESS')error=new AppError('INVENTORY_SOURCE_WORKSPACE');error.sourceWorkspaceId=workspaceId;return error;};
  try{return await this.targets.use(client,selected[0],(entry,current)=>operation(entry,async()=>{try{await current();}catch(error){throw sourceError(error);}}),{check});}
  catch(error){throw sourceError(error);}
 }
 async locate(client,namespaceId,locate,{check=async()=>{}}={}){
  await check();this.expire();let found=null;
  const ids=new Set([...this.targets.entries.values()].filter(entry=>entry.client===client).map(entry=>entry.registry.workspaceId));
  for(const workspaceId of ids){
   let value;try{value=await this.use(client,workspaceId,async(entry,current)=>{
    try{const owner=await locate(entry.registry,namespaceId);await current();return {application:entry.application,owner,sourceWorkspaceId:workspaceId,check:current};}
    catch(error){if(['NOT_FOUND','PROJECT_MOVED'].includes(error.code))return null;throw error;}
   },{check});}catch(error){await check();if(['INVENTORY_SOURCE_WORKSPACE','ACCESS_LOCKED','ACCESS_DENIED','AUTH','DEVICE_UNKNOWN','ENOENT','ENOTDIR','STORAGE_MOVE_STATE','STORAGE_RENAMING','STORAGE_DELETING'].includes(error.code))continue;throw error;}
   if(value){if(found)throw new AppError('INVENTORY_SOURCE_AMBIGUOUS');found=value;}
  }
  await check();return found;
 }
}
