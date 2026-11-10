// Converts an ordinary book of a project into a lab book that keeps the book's
// identity. Each record moves through the authenticated record transfer engine,
// so its history, originals, datasets, figures, links and sharing state travel
// with the same verification as a single move. The conversion is one durable job
// in two passes. First every record is copied and verified while the project's
// book stays current and nothing is activated or retired. Only when that report
// is complete is each record activated in the lab book and retired from the
// project. Every pass resumes from the records actually present in each store,
// never from assumptions about how far an earlier attempt went.
import path from 'node:path';
import {opendir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {assertRegular,privateDirectory,serialize} from './storage.js';
import {withWriterLease} from './writer-lease.js';
import {trackProjectTransfer} from './project-transfer-tasks.js';
import {RecordOwnerSession} from './record-owner-session.js';
import {readRecordOwnerFence} from './record-owner-transfer-state.js';
import {LabBookCreation} from './lab-book-creation.js';
import {LabBookRegistry} from './lab-book-registry.js';
import {LabBookDirectory} from './lab-book-directory.js';
import {StructureCommands} from './structure-commands.js';
import {LabBookDeletions} from './lab-book-deletion.js';
import {cloneVault,clearVault} from './encryption.js';

const phases=new Set(['moving','verified','switched','returning','returned']);
const folder='.observanda/book-conversions';
export function bookConversionRequest(route,method='POST'){
 const match=/^\/api\/research\/books\/convert\/(plan|start|resume|return|pending)$/.exec(route);
 return method==='POST'&&match?{bookConversion:match[1],operation:'book-conversion/'+match[1],write:!['plan','pending'].includes(match[1]),limit:16384}:null;
}
// Stable identities let an interrupted conversion resume each record's own
// transfer instead of starting a second one.
export function conversionCommandId(...parts){
 const h=createHash('sha256').update(parts.join(':')).digest('hex');
 return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-'+((parseInt(h[16],16)&3)|8).toString(16)+h.slice(17,20)+'-'+h.slice(20,32);
}
const stateFile=(storage,notebookId)=>{if(!researchId(notebookId))throw new AppError('INVALID');return path.join(storage.root,folder,notebookId+'.obsv');};
function validState(value){
 return value&&value.version===1&&researchId(value.id)&&researchId(value.notebookId)&&researchId(value.projectId)&&phases.has(value.phase)&&typeof value.title==='string'&&Array.isArray(value.inventory)&&value.moved&&typeof value.moved==='object';
}
export async function readBookConversion(storage,notebookId){
 const file=stateFile(storage,notebookId);if(!await assertRegular(file,{missing:true}))return null;
 let value;try{value=JSON.parse(await storage.readFile(file,'utf8'));}catch(error){if(error instanceof SyntaxError)throw new AppError('FORMAT');throw error;}
 if(!validState(value)||value.notebookId!==notebookId)throw new AppError('FORMAT');return value;
}
async function writeBookConversion(storage,value){
 await privateDirectory(storage.root,folder);await storage.writeFile(stateFile(storage,value.notebookId),serialize(value));return value;
}
// While records are only being copied and verified, the destination lab book holds
// nothing current, so the directory leaves it out. From the verified report onward
// records are activated there one by one, and the lab book must be visible.
export async function convertingLabBooks(storage){
 const directory=path.join(storage.root,folder);if(!await assertRegular(directory,{directory:true,missing:true}))return new Set();
 const hidden=new Set();
 for await(const entry of await opendir(directory)){
  const id=entry.name.endsWith('.obsv')?entry.name.slice(0,-5):null;if(!researchId(id))continue;
  const value=await readBookConversion(storage,id);if(value?.phase==='moving')hidden.add(id);
 }
 return hidden;
}
const summary=value=>value&&{id:value.id,notebookId:value.notebookId,title:value.title,phase:value.phase,startedAt:value.startedAt,finishedAt:value.finishedAt??null,records:value.inventory.length,moved:Object.values(value.moved).filter(item=>item.phase==='complete').length,blocked:value.blocked??[],report:value.report??null};

async function members(storage,notebookId,signal){
 return storage.catalogue(async store=>{
  const snapshot=await store.snapshot(),rows=[];
  for await(const row of store.members(snapshot,{notebookIds:new Set([notebookId]),signal})){signal?.throwIfAborted();if(row.notebookId===notebookId)rows.push({id:row.id,revision:row.revision});}
  const fenced=[];for(const row of rows){const fence=await readRecordOwnerFence(store,row.id);if(fence)fenced.push({recordId:row.id,transferId:fence.id,direction:fence.direction,phase:fence.transfer.phase,targetLabBookId:fence.transfer.targetOwner?.labBookId??null});}
  return {namespaceId:snapshot.metadata.id,rows,fenced};
 });
}
async function ordinaryBook(storage,projectId,notebookId){
 const {metadata}=await storage.outline(),notebook=metadata.notebooks.find(n=>n.id===notebookId);
 if(!notebook||notebook.projectId!==projectId)throw new AppError('NOT_FOUND');return {metadata,notebook};
}

export class BookConversionApplication{
 constructor(application){this.application=application;}
 async run(client,selected,data,{check=async()=>{},signal,onProgress=()=>{}}={}){
  const app=this.application,projectId=selected.projectId,operation=selected.bookConversion;
  if(!researchId(projectId)||!data||typeof data!=='object'||Array.isArray(data)||!researchId(data.workspaceId)||!researchId(data.notebookId))throw new AppError('INVALID');
  const allowed={plan:['workspaceId','notebookId'],pending:['workspaceId','notebookId'],start:['workspaceId','notebookId','id','username','password'],resume:['workspaceId','notebookId'],return:['workspaceId','notebookId']}[operation];
  if(!allowed||Object.keys(data).some(key=>!allowed.includes(key)))throw new AppError('INVALID');
  const sourceOwner={projectId,labBookId:null,workspaceId:data.workspaceId},source=new RecordOwnerSession(app,client,sourceOwner,{check});
  try{return await app.tracked(()=>source.use(async(storage,checkSource)=>{
   const current=async()=>{signal?.throwIfAborted();await checkSource();};
   if(operation==='plan'||operation==='pending')return this.plan(storage,projectId,data.notebookId,signal);
   if(operation==='start')return this.start(storage,client,projectId,data,current);
   const lease=path.join(storage.root,folder,data.notebookId+'.lock');await privateDirectory(storage.root,folder);
   // The first pass ends with the verified report; the second pass then activates
   // each record in the lab book and retires it from the project, under the same lease.
   return trackProjectTransfer(stateFile(storage,data.notebookId),()=>withWriterLease(lease,async()=>{
    const returning=operation==='return',first=await this.move(storage,client,sourceOwner,data.notebookId,returning,{check:current,signal,onProgress});
    return !returning&&first.phase==='verified'?this.move(storage,client,sourceOwner,data.notebookId,false,{check:current,signal,onProgress}):first;
   }));
  }),projectId,null);}
  finally{await source.close();}
 }
 async plan(storage,projectId,notebookId,signal){
  const {notebook}=await ordinaryBook(storage,projectId,notebookId).catch(async error=>{if(error.code!=='NOT_FOUND')throw error;const value=await readBookConversion(storage,notebookId);if(value?.phase==='switched')return {notebook:{id:notebookId,title:value.title}};throw error;});
  const [inventory,labBook,conversion]=await Promise.all([members(storage,notebookId,signal).catch(error=>{if(error.code==='NOT_FOUND')return {rows:[],fenced:[]};throw error;}),new LabBookRegistry(storage).state(notebookId),readBookConversion(storage,notebookId)]);
  return {notebook:{id:notebook.id,title:notebook.title},records:inventory.rows.length,unfinished:inventory.fenced,labBook:labBook.state==='active',conversion:summary(conversion)};
 }
 async start(storage,client,projectId,data,check){
  if(!researchId(data.id)||typeof data.username!=='string'||typeof data.password!=='string')throw new AppError('INVALID');
  const lease=path.join(storage.root,folder,data.notebookId+'.lock');await privateDirectory(storage.root,folder);
  return withWriterLease(lease,async()=>{
   await check();const prior=await readBookConversion(storage,data.notebookId);
   if(prior&&prior.phase!=='returned'){if(prior.id!==data.id)throw new AppError('CONFLICT');return summary(prior);}
   const {notebook}=await ordinaryBook(storage,projectId,data.notebookId),inventory=await members(storage,data.notebookId);
   // A book already split between stores keeps its existing lab book; the
   // conversion only adds the records still held by the project.
   if((await new LabBookRegistry(storage).state(data.notebookId)).state!=='active'){
    const registry=await this.application.registry();
    await new LabBookCreation(storage,this.application.deviceStore,{publish:async entry=>{await check();await new LabBookDirectory(registry).register(projectId,entry);}})
     .create({id:data.id,book:structuredClone(notebook),username:data.username,password:data.password},{check});
   }
   await check();
   return summary(await writeBookConversion(storage,{version:1,id:data.id,projectId,notebookId:notebook.id,title:notebook.title,phase:'moving',startedAt:new Date().toISOString(),inventory:inventory.rows,moved:{}}));
  });
 }
 async move(storage,client,sourceOwner,notebookId,returning,{check,signal,onProgress}){
  const app=this.application;let state=await readBookConversion(storage,notebookId);
  if(!state)throw new AppError('NOT_FOUND');
  if(state.phase==='switched')return summary(state);
  const registry=new LabBookRegistry(storage);
  if(state.phase==='returned'){if((await registry.state(notebookId)).state!=='active')return summary(state);}
  if(returning){if(state.phase==='verified'||state.phase==='moving'){state={...state,phase:'returning'};await writeBookConversion(storage,state);}}
  else if(state.phase==='returning')throw new AppError('CONFLICT');
  const entry=await registry.locate(notebookId),labOwner={projectId:sourceOwner.projectId,labBookId:notebookId,workspaceId:entry.namespaceId};
  const target=new RecordOwnerSession(app,client,labOwner,{check});let labVault=null,result;
  try{result=await app.tracked(()=>target.use(async(labStorage,checkTarget)=>{
   const current=async()=>{await check();await checkTarget();};await current();
   if(returning)labVault=cloneVault(labStorage.vault);
   if(state.phase==='returned')return summary(state);
   const {RecordOwnerTransfer}=await import('./record-owner-transfer.js'),registry=await app.registry(),started=Date.now();
   const [fromStorage,toStorage,fromOwner,toOwner]=returning?[labStorage,storage,labOwner,sourceOwner]:[storage,labStorage,sourceOwner,labOwner];
   const engine=new RecordOwnerTransfer(fromStorage,toStorage,{registry,sourceOwner:fromOwner,targetOwner:toOwner,publication:app.publicationConversion});
   if(returning){
    // A record still on its way into the lab book is returned by cancelling its transfer.
    const pending=await members(storage,notebookId,signal);
    for(const item of pending.fenced)if(item.direction==='outgoing'&&item.targetLabBookId===notebookId&&item.phase!=='complete'){
     const source=new RecordOwnerTransfer(storage,labStorage,{registry,sourceOwner,targetOwner:labOwner,publication:app.publicationConversion});
     await source.cancel({workspaceId:sourceOwner.workspaceId,recordId:item.recordId,id:item.transferId},{signal,check:current});
    }
   }
   const command=row=>({id:conversionCommandId(state.id,returning?'return':'move',row.id,row.revision),workspaceId:fromOwner.workspaceId,recordId:row.id,sourceNotebookId:notebookId,expectedStorageRevision:row.revision,targetWorkspaceId:toOwner.workspaceId,targetNotebookId:notebookId});
   const save=async()=>writeBookConversion(storage,state);
   // Returning moves each record straight back; forward moves stop every record
   // after verification until the whole book is verified.
   const until=returning||state.phase!=='moving'?null:'verified';
   const moving=await members(fromStorage,notebookId,signal),blocked=[],total=moving.rows.length;let done=0;
   for(const row of moving.rows){
    await current();
    const fence=moving.fenced.find(item=>item.recordId===row.id);let result;
    if(fence&&fence.direction==='outgoing'){
     // A record already moving elsewhere is left for its own move to finish.
     if(!returning&&fence.targetLabBookId!==notebookId||returning&&fence.targetLabBookId!==null){blocked.push(row.id);continue;}
     result=await engine.resume({workspaceId:fromOwner.workspaceId,recordId:row.id,id:fence.transferId},{signal,check:current,until});
    }else if(fence){blocked.push(row.id);continue;}
    else result=await engine.start(command(row),{signal,check:current,until});
    state.moved[row.id]={transferId:result.id,phase:result.phase,direction:returning?'return':'move'};
    done++;onProgress({stage:returning?'returning-records':state.phase==='moving'?'verifying-records':'activating-records',done,total});
    if(done%25===0)await save();
   }
   state={...state,blocked};await save();
   if(blocked.length)return summary(state);
   if(returning){
    if((await members(fromStorage,notebookId,signal)).rows.length)return summary(state);
    state={...state,phase:'returned',finishedAt:new Date().toISOString()};await save();return summary(state);
   }
   if(state.phase==='moving'){
    // The verified report: every record of the book is verified in the lab book,
    // nothing has been activated or retired, and records removed or added while
    // the conversion ran are listed.
    const now=await members(fromStorage,notebookId,signal),pending=now.rows.filter(row=>state.moved[row.id]?.phase!=='verified');
    if(pending.length)return summary(state);
    const present=new Set(now.rows.map(row=>row.id));
    state={...state,phase:'verified',report:{verifiedAt:new Date().toISOString(),inventory:state.inventory.length,verified:now.rows.length,
     removed:state.inventory.filter(row=>!present.has(row.id)).map(row=>row.id),added:now.rows.filter(row=>!state.inventory.some(item=>item.id===row.id)).map(row=>row.id),elapsedMs:Date.now()-started}};
    await save();
    return summary(state);
   }
   const remaining=await members(fromStorage,notebookId,signal),arrived=await members(toStorage,notebookId,signal),present=new Set(arrived.rows.map(row=>row.id));
   if(remaining.rows.length)return summary(state);
   const missing=Object.entries(state.moved).filter(([id,item])=>item.direction==='move'&&!present.has(id)&&!state.report.removed.includes(id)).map(([id])=>id);
   state={...state,report:{...state.report,completedAt:new Date().toISOString(),arrived:arrived.rows.length,missing}};await save();
   if(missing.length)return summary(state);
   // Switching over removes the now empty ordinary book from the project. The
   // structure change refuses to remove a book that still holds any record.
   await current();
   const {etag}=await storage.outline();
   await new StructureCommands(storage).execute('structure',{etag,commandId:conversionCommandId(state.id,'switch'),response:'outline',change:{kind:'delete-notebook',value:{id:notebookId,records:'empty',destinationId:null,confirmed:true}}});
   state={...state,phase:'switched',finishedAt:new Date().toISOString()};await writeBookConversion(storage,state);
   return summary(state);
  }),labOwner.projectId,labOwner.labBookId);}
  finally{await target.close();}
  // An emptied lab book is removed so the book has a single home again.
  try{
   if(returning&&state.phase==='returned'&&labVault){
    await new LabBookDeletions(storage,notebookId).run(labVault,{id:conversionCommandId(state.id,'remove-lab-book'),expectedName:entry.directory,check,...app.publicationConversion?.deletionHooks()});
   }
  }finally{if(labVault)await clearVault(labVault);}
  return result;
 }
}
