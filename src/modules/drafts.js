import {checkpointHasStructuredCalculator} from '../structured-calculator-format.js';
import {catalogueFormat,catalogueRequiresCalculationPolicies,requireCalculationPolicies,catalogueRequiresStructuredCalculator,requireStructuredCalculator} from '../catalogue-format.js';
import {checkpointHasCalculationPolicy} from '../web/tools/calculation-policy.js';
import path from 'node:path';
import {digest,serialize} from '../storage.js';
import {AppError} from '../errors.js';
import {uuid,exact,text,object,requireValue} from './validation.js';
import {ModuleDraftIndex,moduleDraftSummary,moduleIdValid} from './draft-index.js';
import {checkpointKey,validCheckpointTime} from '../checkpoint-index.js';
import {MODULE_BYTES,MODULE_CHECKPOINT_BYTES,LEGACY_CHECKPOINT_BYTES} from './capacity.js';
import {validateDraftBase,expandDraftBase} from './draft-base.js';
export class ModuleDrafts{
 constructor(workspace){this.workspace=workspace;this.directory=path.join(workspace.root,'.observanda','module-drafts');this.index=new ModuleDraftIndex(workspace,id=>this.read(id,{indexed:false,expand:false}));}
 async read(id,{indexed=true,expand=true}={}){
  if(await this.workspace.storageKind()==='catalogue')return this.workspace.catalogue(()=>this.readValue(id,indexed,expand));
  return this.readValue(id,false,expand);
 }
 async readValue(id,indexed,expand){
  requireValue(uuid(id),'Draft id');
  await this.workspace.outline();const bytes=await this.workspace.readMetadata('.observanda/module-drafts/'+id+'.json',MODULE_BYTES);if(bytes===null)return null;let draft;
  try{draft=JSON.parse(bytes);}catch{throw new AppError('MODULE_FORMAT');}
  if(![1,2].includes(draft.formatVersion)||draft.id!==id||!moduleIdValid(draft.moduleId)||!validCheckpointTime(draft.updatedAt)||!Array.isArray(draft.drafts)||draft.formatVersion===2&&(draft.drafts.length>1||!draft.drafts.every(d=>Object.hasOwn(d,'baseRevision')&&d.baseRevision===d.expectedRevision&&!Object.hasOwn(d,'base')&&(d.baseRevision===null||Number.isSafeInteger(d.baseRevision)&&d.baseRevision>0))))throw new AppError('MODULE_FORMAT');
  if(draft.workspaceId!==(await this.workspace.outline()).metadata.id)throw new AppError('WORKSPACE_CHANGED');
  if(checkpointHasStructuredCalculator(draft)&&await this.workspace.storageKind()==='catalogue')await this.workspace.catalogue(async store=>{if(!catalogueRequiresStructuredCalculator(await catalogueFormat(store.catalogueDb??store.db)))throw new AppError('CATALOGUE_DAMAGED');});
  if(checkpointHasCalculationPolicy(draft)&&await this.workspace.storageKind()==='catalogue')await this.workspace.catalogue(async store=>{if(!catalogueRequiresCalculationPolicies(await catalogueFormat(store.catalogueDb??store.db)))throw new AppError('CATALOGUE_DAMAGED');});
  const result={draft,etag:digest(bytes)};if(indexed)await this.index.verifySelected(result,digest(serialize({text:bytes})));
  if(expand&&draft.formatVersion===2)result.draft={...draft,drafts:await Promise.all(draft.drafts.map(d=>expandDraftBase(this.workspace,d)))};
  return result;
 }
 async list(moduleId,{workspaceId=null,cursor=null,excludeId=null,limit=10}={},{signal}={}){
  requireValue(moduleIdValid(moduleId)&&Number.isInteger(limit)&&limit>0&&limit<=20&&(workspaceId===null||uuid(workspaceId))&&(excludeId===null||uuid(excludeId))&&(cursor===null||typeof cursor==='string'&&cursor.length>0&&cursor.length<=4096),'Recovery page');
  signal?.throwIfAborted();const owner=(await this.workspace.outline()).metadata.id;
  if(workspaceId!==null&&workspaceId!==owner)throw new AppError('WORKSPACE_CHANGED');
  if(await this.workspace.storageKind()==='catalogue')return this.index.page(owner,{scope:moduleId,cursor,excludeId,limit},{signal});
  let anchor={after:null,reverse:false};
  if(cursor){try{anchor=JSON.parse(Buffer.from(cursor,'base64url'));}catch{throw new AppError('DRAFT_CURSOR');}
   if(anchor?.workspaceId!==owner||anchor.moduleId!==moduleId||anchor.excludeId!==excludeId||anchor.limit!==limit||typeof anchor.after!=='string'||typeof anchor.reverse!=='boolean')throw new AppError('DRAFT_CURSOR');}
  const drafts=[];let more=false,opposite=false;
  for await(const file of this.workspace.metadataNames('.observanda/module-drafts')){
   signal?.throwIfAborted();if(!/^[a-f0-9-]{36}\.json$/.test(file)||file.slice(0,-5)===excludeId)continue;
   const value=await this.read(file.slice(0,-5),{expand:false});if(value?.draft.moduleId!==moduleId)continue;
   const summary=moduleDraftSummary(value,value.etag);if(!summary)continue;
   const {sourceRevision,workspaceId:unused,...item}=summary;void sourceRevision;void unused;const key=checkpointKey(item);
   if(anchor.after&&(anchor.reverse?key>=anchor.after:key<=anchor.after)){opposite=true;continue;}
   drafts.push(item);drafts.sort((a,b)=>(checkpointKey(a)<checkpointKey(b)?-1:1)*(anchor.reverse?-1:1));if(drafts.length>limit){drafts.pop();more=true;}
  }
  if(anchor.reverse)drafts.reverse();
  const encode=(item,reverse)=>Buffer.from(JSON.stringify({workspaceId:owner,moduleId,excludeId,limit,after:checkpointKey(item),reverse})).toString('base64url');
  return {workspaceId:owner,drafts,previousCursor:drafts.length&&(anchor.reverse?more:opposite)?encode(drafts[0],true):null,nextCursor:drafts.length&&(anchor.reverse?opposite:more)?encode(drafts.at(-1),false):null};
 }
 async write(command,{transferred=false}={}){
  return this.workspace.withLock(()=>this.writeLocked(command,{transferred}));
 }
 // The caller owns the workspace transaction, including any transfer receipt.
 async writeLocked(command,{transferred=false}={}){
  requireValue(exact(command,['workspaceId','id','moduleId','etag','drafts'])&&uuid(command.workspaceId)&&uuid(command.id)&&moduleIdValid(command.moduleId)&&(command.etag===null||/^[a-f0-9]{64}$/.test(command.etag))&&Array.isArray(command.drafts),'Recovery checkpoint');
  const compact=command.drafts.some(d=>Object.hasOwn(d??{},'baseRevision'));
  requireValue(!transferred||compact,'Recovery transfer item');
  requireValue(!compact||command.drafts.length===1,'Recovery items');
  for(const d of command.drafts){
   requireValue(object(d)&&exact(d,['id','type','expectedRevision',compact?'baseRevision':'base','data',...(Object.hasOwn(d,'operation')?['operation']:[])])&&uuid(d.id)&&text(d.type,80,true)&&(d.expectedRevision===null||Number.isSafeInteger(d.expectedRevision)&&d.expectedRevision>0)&&(compact?d.baseRevision===d.expectedRevision:d.base===null||object(d.base))&&object(d.data),'Recovery item');
   if(Object.hasOwn(d,'operation'))requireValue(exact(d.operation,['kind','values','base'])&&typeof d.operation.kind==='string'&&/^[a-z][a-z-]{0,79}$/.test(d.operation.kind)&&object(d.operation.values)&&object(d.operation.base),'Recovery operation');
  }
  requireValue(new Set(command.drafts.map(d=>d.id)).size===command.drafts.length,'Recovery items');
  const limit=compact?(transferred?MODULE_BYTES:MODULE_CHECKPOINT_BYTES):LEGACY_CHECKPOINT_BYTES;
  if(Buffer.byteLength(serialize(command))>limit)throw new AppError('LIMIT');
   if(command.workspaceId!==(await this.workspace.outline()).metadata.id)throw new AppError('WORKSPACE_CHANGED');
   const indexed=await this.workspace.storageKind()==='catalogue';if(indexed)await this.index.ensureLocked(command.workspaceId);
   const current=await this.read(command.id,{expand:false});
   // Replaying an acknowledged-or-lost write is harmless. A different payload
   // still needs the exact revision; never overwrite a concurrent checkpoint.
   if(current?.draft.moduleId===command.moduleId&&serialize(current.draft.drafts)===serialize(command.drafts))return current;
   if((current?.etag??null)!==command.etag)throw new AppError('DRAFT_CHANGED');
   if(current&&current.draft.moduleId!==command.moduleId)throw new AppError('DRAFT_CHANGED');
   if(compact)await validateDraftBase(this.workspace,command.drafts[0]);
   const draft={formatVersion:compact?2:1,workspaceId:command.workspaceId,id:command.id,moduleId:command.moduleId,updatedAt:new Date().toISOString(),drafts:command.drafts};
   const bytes=serialize(draft);
   if(Buffer.byteLength(bytes)>(compact?limit:MODULE_CHECKPOINT_BYTES))throw new AppError('LIMIT');
   if(indexed&&checkpointHasStructuredCalculator(draft))await this.workspace.catalogue(store=>requireStructuredCalculator(store.catalogueDb??store.db));
   if(indexed&&checkpointHasCalculationPolicy(draft))await this.workspace.catalogue(store=>requireCalculationPolicies(store.catalogueDb??store.db));
   await this.workspace.writeMetadata('.observanda/module-drafts/'+command.id+'.json',bytes);
   if(indexed){if(current)await this.index.removeLocked(current.draft);await this.index.putLocked({draft,etag:digest(bytes)},digest(serialize({text:bytes})));}
   return {draft,etag:digest(bytes)};
 }
}
