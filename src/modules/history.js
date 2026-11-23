import {AppError} from '../errors.js';
import {digest,serialize} from '../storage-format.js';
import {uuid} from './validation.js';
import {ModuleHistoryIndex,moduleHistorySummary} from './history-index.js';
import {workspaceModules} from './index.js';
const hash=value=>digest(serialize(value));
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const invalidCursor=()=>{throw new AppError('MODULE_HISTORY_CURSOR');};
// Lists contain summaries only. Opening a revision loads one retained command,
// checks its exact identity and returns only the requested item's saved body.
export class ModuleHistory{
 constructor(workspace,{context}={}){this.workspace=workspace;this.modules=workspaceModules(workspace);this.readContext=context;}
 async context(operation,id=null){
  if(this.readContext)return this.readContext(operation);
  return this.workspace.catalogue(async store=>{
   const {projectModuleHistoryOwner}=await import('../project-module-history-context.js');
   return (await projectModuleHistoryOwner(store))(id,operation);
  });
 }
 async summaries(context,id,revisions,before=context.head.revision+1){
  const {store,head}=context,member=await context.member(id),base=head?.historyVersion===1?member.historyFrom:member.revision,found=new Map();
  const index=new ModuleHistoryIndex(store);for(const revision of revisions)if(revision>base)found.set(revision,await index.read(id,revision));
  if(found.size!==revisions.length){
   const wanted=new Set(revisions.filter(r=>!found.has(r)));
   const rows=store.db.rows('SELECT command_id,ordinal,payload FROM module_events WHERE ordinal<$1 ORDER BY ordinal DESC',[before],{batchSize:1});
   // Older catalogues retain their original receipts. Only missing legacy
   // summaries are derived, one event at a time, with no full-history array.
   for await(const row of rows){
    const event=await context.catalogue.event(row);this.modules.validateEvent(event);
    const entity=event.changes.find(e=>e.id===id&&wanted.has(e.revision));
    if(entity){found.set(entity.revision,moduleHistorySummary(event,entity,row.ordinal));wanted.delete(entity.revision);if(!wanted.size)break;}
   }
   if(wanted.size)damaged();
  }
  const summaries=revisions.map(revision=>found.get(revision));
  for(const value of summaries){if(value.ordinal>=before)damaged();before=value.ordinal;}
  return summaries;
 }
 async page({id,cursor=null,limit=20}){
  if(!uuid(id)||!Number.isSafeInteger(limit)||limit<1||limit>20||cursor!==null&&(typeof cursor!=='string'||cursor.length>4096))throw new AppError('INVALID');
  return this.context(async context=>{
   const member=await context.member(id);if(!member)throw new AppError('NOT_FOUND');let anchor;
   const ordinal=context.head.revision+1;
   try{anchor=cursor?context.decode(cursor):{workspaceId:context.workspaceId,id,total:member.revision,offset:0,limit,before:ordinal};}catch{invalidCursor();}
   if(!anchor||anchor.workspaceId!==context.workspaceId||anchor.id!==id||anchor.limit!==limit||!Number.isSafeInteger(anchor.total)||anchor.total<1||anchor.total>member.revision||!Number.isSafeInteger(anchor.offset)||anchor.offset<0||anchor.offset>=anchor.total||!Number.isSafeInteger(anchor.before)||anchor.before<1||anchor.before>ordinal)invalidCursor();
   const revisions=Array.from({length:Math.min(limit,anchor.total-anchor.offset)},(_,i)=>anchor.total-anchor.offset-i),items=await this.summaries(context,id,revisions,anchor.before),next=anchor.offset+items.length;
   return {id,items,total:anchor.total,offset:anchor.offset,currentRevision:member.revision,changed:anchor.total!==member.revision,cursor:context.encode(anchor),nextCursor:next<anchor.total?context.encode({...anchor,offset:next,before:items.at(-1).ordinal}):null};
  },id);
 }
 async read({id,revision}){
  if(!uuid(id)||!Number.isSafeInteger(revision)||revision<1)throw new AppError('INVALID');
  return this.context(async context=>{
   const member=await context.member(id);if(!member||revision>member.revision)throw new AppError('NOT_FOUND');
   const [summary]=await this.summaries(context,id,[revision]);let event;
   const row=await context.store.db.get('SELECT command_id,ordinal,payload FROM module_events WHERE command_id=$1',summary.commandId);
   if(!row||row.ordinal!==summary.ordinal)damaged();event=await context.catalogue.event(row);
   this.modules.validateEvent(event);const entity=event.changes.find(e=>e.id===id&&e.revision===revision);
   if(!entity||hash(event)!==summary.eventHash||hash(entity)!==summary.entityHash||serialize(summary)!==serialize(moduleHistorySummary(event,entity,summary.ordinal)))damaged();
   return {entity,at:event.at,action:event.action,currentRevision:member.revision};
  },id);
 }
}
