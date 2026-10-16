import {projectModuleInputEpochMatches} from './project-module-input-epochs.js';
// Source module histories resolve their exact retained project-domain command.
// Locations confer no access and never substitute a newer current entity.
import {withRetiredProjectCatalogue} from './project-retired-records.js';
import {ProjectSourceAuthority,validProjectSourceAuthority} from './project-source-authority.js';
import {projectModuleDomainReader} from './project-module-domain-reader.js';
import {projectModuleOriginEvent} from './project-module-domain-receipts.js';
import {moduleReceiptOriginKey} from './project-module-receipts.js';
import {projectDomainSourceMatches} from './project-domain-origin.js';
import {ModuleCatalogue} from './modules/catalogue.js';
import {uuid,exact,instant} from './modules/validation.js';
import {digest,serialize} from './storage-format.js';
import {revisionId} from './web/revision-model.js';
import {AppError} from './errors.js';
const format='observanda-retired-module',hash=value=>digest(serialize(value)),natural=value=>Number.isSafeInteger(value)&&value>0;
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
export const retiredModule=value=>value?.format===format;
export function validRetiredModule(value){return exact(value,['format','version','kind','owner','commandId','ordinal','hash',...(value?.kind==='entity'?['id','revision','type','createdAt']:[])])&&retiredModule(value)&&value.version===1&&['event','entity'].includes(value.kind)&&validProjectSourceAuthority(value.owner)&&uuid(value.commandId)&&natural(value.ordinal)&&revisionId(value.hash)&&(value.kind==='event'||uuid(value.id)&&natural(value.revision)&&typeof value.type==='string'&&value.type.length>0&&instant(value.createdAt));}
export function retiredModuleLocation(owner,commandId,ordinal,value,{entity=false}={}){
 const location={format,version:1,kind:entity?'entity':'event',owner:structuredClone(owner),commandId,ordinal,hash:hash(value),...(entity?{id:value.id,revision:value.revision,type:value.type,createdAt:value.createdAt}:{})};if(!validRetiredModule(location))throw new AppError('INVALID');return location;
}
export async function withRetainedProjectModuleEvents(store,receipt,consume){
 if(!validProjectSourceAuthority(receipt)||store.workspace.projectId!==receipt.projectId||store.workspace.vault.id!==receipt.vaultId||store.domain!==undefined)throw new AppError('INVALID');
 const reader=await projectModuleDomainReader(store);
 const run=async context=>consume(async commandId=>{
  if(!uuid(commandId))throw new AppError('INVALID');const root=context?.research??store,origin=await root.object(moduleReceiptOriginKey(commandId));
  if(origin?.version!==1||origin.commandId!==commandId||origin.projectId!==receipt.projectId||origin.namespaceId!==receipt.namespaceId||origin.sourceNamespace!==receipt.sourceNamespace||!natural(origin.sourceOrdinal))damaged();
  let event;
  if(context){const command=await context.identities.read('command',commandId);if(!command)damaged();event=await projectModuleOriginEvent(root,command,await context.identities.fragments(command));}
  else {
   const catalogue=new ModuleCatalogue(root),head=await catalogue.head(receipt.namespaceId);event=await catalogue.receipt(commandId,head.revision);
   const migration=await root.object('project:module-migration'),research=await root.object('project:research-migration');
   if(origin.layout!==undefined||!await projectModuleInputEpochMatches(root,origin,migration)||!await projectDomainSourceMatches(root,'modules',origin,research)||!await projectDomainSourceMatches(root,'modules',migration,research))damaged();
  }
  if(!event||hash(event)!==origin.eventHash)damaged();return {event,ordinal:origin.sourceOrdinal};
 });
 return reader?reader.run(run):run(null);
}
async function resolve(store,value,kind,commandId,ordinal,id,revision){
 if(!retiredModule(value))return value;
 if(!validRetiredModule(value)||value.kind!==kind||kind==='event'&&(value.commandId!==commandId||value.ordinal!==ordinal)||kind==='entity'&&(value.id!==id||value.revision!==revision))damaged();
 return withRetiredProjectCatalogue(store,value.owner,{kind:'project',id:value.owner.projectId,domain:'research'},to=>withRetainedProjectModuleEvents(to,value.owner,async read=>{
  const retained=await read(value.commandId);if(retained.ordinal!==value.ordinal)damaged();const original=kind==='event'?retained.event:retained.event.changes.find(entity=>entity.id===id&&entity.revision===revision);if(!original||hash(original)!==value.hash||kind==='entity'&&(original.type!==value.type||original.createdAt!==value.createdAt))damaged();return original;
 }));
}
export const resolveModuleEvent=(store,row,value)=>resolve(store,value,'event',row.command_id,row.ordinal);
export const resolveModuleEntity=(store,row,value)=>resolve(store,value,'entity',null,null,row.id,row.revision);

// A source-side ownership audit can classify a retired foreign owner without
// opening that owner's database or reading its private event bodies.
const sourceAuthorities=new WeakMap();
export async function sourceModuleRetiredProject(store,projectId){
 if(store.workspace.projectId||!uuid(projectId))throw new AppError('INVALID');
 let cache=sourceAuthorities.get(store);if(!cache){cache=new Map();sourceAuthorities.set(store,cache);}let receipt=cache.get(projectId);
 if(!receipt){receipt=await new ProjectSourceAuthority(store).receipt(projectId);if(!receipt)return null;if((await store.snapshot()).metadata.id!==receipt.sourceNamespace)damaged();cache.set(projectId,receipt);}return receipt;
}
export async function retiredModuleSourceOwner(store,value,{kind,id,revision,ordinal,hash:expectedHash}={}){
 if(!retiredModule(value))return null;
 if(!validRetiredModule(value)||store.workspace.projectId||value.kind!==kind||kind==='entity'&&(value.id!==id||value.revision!==revision||value.hash!==expectedHash)||kind==='event'&&(value.commandId!==id||value.ordinal!==ordinal))damaged();
 const receipt=await sourceModuleRetiredProject(store,value.owner.projectId);if(!receipt||hash(receipt)!==hash(value.owner))damaged();return {kind:'project',projectId:receipt.projectId};
}
