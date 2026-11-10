import {AppError} from './errors.js';
import {exact} from './modules/validation.js';
import {jobSummary} from './jobs.js';
import {MetadataFeed} from './metadata-feed.js';
import {ResearchMaterials} from './research-materials.js';
import {validMaterialReference} from './web/material-reference.js';
import {researchId} from './web/research-reference.js';
import {revisionText} from './web/revision-model.js';
import {datasetExchangeSelection} from './dataset-exchange-table.js';
import {openDatasetExchangeAuthority,withDatasetExchangeAuthority} from './dataset-exchange-authority.js';
import {prepareExchangeFiles,exchangeArchive,removeExchangeAttempt,removeEarlierExchangeAttempts,validExchangeCandidate} from './dataset-exchange-files.js';

export const exchangeCandidateFile=id=>'.observanda/dataset-exchange-candidates/'+id+'.json';
const invalid=()=>{throw new AppError('INVALID');};
const commandShape=command=>exact(command,['recordId','ref','format','selection'])&&researchId(command.recordId)&&validMaterialReference(command.ref)&&command.ref.kind==='dataset'&&researchId(command.ref.workspaceId)&&['csv','tsv'].includes(command.format);
const receipt=(job,candidate)=>({kind:'dataset-exchange',id:job.id,format:candidate.format,sha256:candidate.files['dataset.jsonl'].sha256,bytes:candidate.files['dataset.jsonl'].size});
export async function readExchangeCandidate(workspace,job){
 const text=await workspace.readMetadata(exchangeCandidateFile(job.id),8192);
 if(text===null)return null;
 let saved;try{saved=JSON.parse(text);}catch{throw new AppError('MATERIAL_MISSING');}
 if(job.type!=='dataset.exchange'||job.state!=='completed'||!exact(saved,['recordId','available','candidate'])||saved.recordId!==job.scope||typeof saved.available!=='boolean'||!validExchangeCandidate(saved.candidate)||saved.candidate.format!==job.input.command.format||revisionText(receipt(job,saved.candidate))!==revisionText(job.result))throw new AppError('MATERIAL_MISSING');
 return saved;
}
export async function queueDatasetExchange(materials,service,command,id,{sourceAccess,check=async()=>{},signal,retry=false}={}){
 if(!commandShape(command)||!researchId(id)||!service.comparisonAccess)invalid();
 let rollback;
 try{return await withDatasetExchangeAuthority(materials,command,{signal,sourceAccess,check},async(doc,grants)=>{
  datasetExchangeSelection(doc,command.selection);await grants.checkSource(command.ref);
  const summary=await service.queue.transaction(async()=>{
   await grants.check();
   const previous=await service.queue.read(id);
   if(previous&&(previous.type!=='dataset.exchange'||previous.scope!==command.recordId||revisionText(previous.input.command)!==revisionText(command)))throw new AppError('JOB_CHANGED');
   if(retry&&(!previous||!['failed','cancelled'].includes(previous.state)))throw new AppError('JOB_CHANGED');
   if(previous&&!retry)return jobSummary(previous);
   // This closure belongs to the initiating client. A different claimant
   // cannot substitute its own unlocked project credentials.
   rollback=service.comparisonAccess.bind(command.ref.workspaceId,id,command,(workspace,options)=>openDatasetExchangeAuthority(materials.workspace===workspace?materials:new ResearchMaterials(workspace),command,{...options,sourceAccess,check}));
   const job=retry?await service.queue.controlLocked(id,'retry'):await service.queue.enqueueLocked({id,type:'dataset.exchange',scope:command.recordId,input:{command}});
   if(!retry){
    const feed=new MetadataFeed(materials.workspace,'.observanda/dataset-jobs/'+command.recordId);
    await feed.ensureLocked();await materials.workspace.writeMetadata(feed.source+'/'+id+'.json',JSON.stringify({id,createdAt:job.createdAt}));
    await feed.putLocked(job);
   }
   return jobSummary(job);
  });
  // The durable job owns this binding once the transaction commits, even if
  // the initiating window closes during its final permission check.
  rollback=undefined;
  return summary;
 });}catch(error){rollback?.();throw error;}
}

export function datasetExchangeJob(materials,queue,access){
 const {workspace}=materials,attempts=new Map();
 return {
  async authorize(job){
   const command=job.input?.command;
   if(!commandShape(command)||job.scope!==command.recordId)throw new AppError('JOB_CHANGED');
   await materials.assertOwner(job.scope,{write:true});
  },
  async prepare(job,{signal,progress}){
   const command=job.input.command,attempt=job.lease.token;
   if(!access)throw new AppError('ACCESS_LOCKED');
   const open=access.take(command.ref.workspaceId,job);
   return workspace.withCatalogueConnections(async()=>{
    const grants=await open(workspace,{signal}),context={grants,prepared:null};
    attempts.set(attempt,context);
    await removeEarlierExchangeAttempts(workspace,job.id,attempt,()=>queue().held(job.id,attempt));
    context.prepared=await prepareExchangeFiles(materials,grants.doc,command,{job:job.id,attempt,progress,...grants});
    return context.prepared;
   });
  },
  async commit(job,prepared){
   const context=attempts.get(job.lease.token);
   if(!context||context.prepared!==prepared||prepared.attempt!==job.lease.token)throw new AppError('JOB_CHANGED');
   await context.grants.check();
   await workspace.writeMetadata(exchangeCandidateFile(job.id),JSON.stringify({recordId:job.scope,candidate:prepared,available:true}));
   return receipt(job,prepared);
  },
  async discard(job){
   const attempt=job.lease.token,context=attempts.get(attempt);attempts.delete(attempt);
   try{
    const current=await queue().read(job.id);
    const saved=current?.state==='completed'?await workspace.readMetadata(exchangeCandidateFile(job.id),8192):null;
    if(!saved||JSON.parse(saved).candidate?.attempt!==attempt)await removeExchangeAttempt(workspace,job.id,attempt);
   }finally{await context?.grants.close();}
  }
 };
}

export async function datasetExchangeDelivery(materials,service,operation,data,{check=async()=>{},sourceAccess,download,signal}){
 if(!exact(data,['id','recordId'])||!researchId(data.id)||!researchId(data.recordId))invalid();
 const current=async()=>{
  await check();const job=await service.queue.read(data.id);
  if(job?.type!=='dataset.exchange'||job.scope!==data.recordId||job.state!=='completed')throw new AppError('NOT_FOUND');
  await service.queue.authorize(job);return job;
 };
 const job=await current(),workspace=materials.workspace;
 const candidate=async()=>{
  const saved=await readExchangeCandidate(workspace,job);
  if(!saved)throw new AppError('NOT_FOUND');
  return saved;
 };
 if(operation==='dataset-exchange-status'){
  try{return {available:(await candidate()).available};}
  catch(error){if(error.code==='NOT_FOUND')return {available:false};throw error;}
 }
 if(operation==='dataset-exchange-discard'){
  const saved=await service.queue.transaction(async()=>{
   await current();const entry=await candidate();
   if(entry.available)await workspace.writeMetadata(exchangeCandidateFile(job.id),JSON.stringify({...entry,available:false}));
   return entry;
  });
  await removeExchangeAttempt(workspace,job.id,saved.candidate.attempt);return {discarded:true};
 }
 if(operation!=='dataset-exchange-download'||typeof download!=='function')invalid();
 const saved=await candidate();if(!saved.available)throw new AppError('NOT_FOUND');
 return withDatasetExchangeAuthority(materials,job.input.command,{signal,check,sourceAccess,retained:true},async(doc,grants)=>{
  const stillAvailable=async()=>{
   await grants.check();
   if(!(await candidate()).available)throw new AppError('NOT_FOUND');
  };
  return download({chunks:exchangeArchive(workspace,job.id,saved.candidate,{...grants,check:stillAvailable}),contentType:'application/zip',name:(doc.title||'dataset')+'.zip'});
 });
}
