// Prepared exports belong to their record until explicitly discarded. Their
// short-lived download files are separate from the immutable transfer audit.
import path from 'node:path';
import {lstat} from 'node:fs/promises';
import {AppError} from './errors.js';
import {MetadataFeed} from './metadata-feed.js';
import {DurableJobs} from './jobs.js';
import {digest,serialize} from './storage-format.js';
import {privateDirectory} from './storage.js';
import {recordOwnerAuditPartKey} from './record-owner-audit-metadata.js';
import {readRecordOwnerPreviousTransfer,withRecordOwnerTransferWrite} from './record-owner-transfer-state.js';
import {journalRecordOwnerMutations,retainRecordOwnerResource} from './record-owner-resources.js';
import {exchangeCandidateFile,readExchangeCandidate} from './dataset-exchange-jobs.js';
import {preparedExchangeMembers,removeExchangeAttempt} from './dataset-exchange-files.js';

const prefix=id=>'record-owner-prepared-exchange:'+id+':';
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const conflict=()=>{throw new AppError('RECORD_TRANSFER_EXISTS');};
const same=(left,right)=>serialize(left)===serialize(right);

export async function stageRecordOwnerExchange(source,target,transfer,job,{write,signal,check,checkpoint}){
 if(job.type!=='dataset.exchange'||job.state!=='completed')return;
 if(job.scope!==transfer.command.recordId||job.input.command.recordId!==job.scope)damaged();
 const saved=await readExchangeCandidate(source,job);
 if(!saved)damaged();
 const slot=prefix(transfer.id)+job.id,proof={version:1,recordId:job.scope,jobId:job.id,transferId:transfer.id,saved};
 const staged=await target.catalogue(store=>store.object(slot));
 if(staged){if(!same(staged,proof))damaged();return;}
 const inputs=[...preparedExchangeMembers(source,job.id,saved.candidate)];
 const outputs=[...preparedExchangeMembers(target,job.id,saved.candidate)];
 if(saved.available){
  for(const [index,{content,relative}] of outputs.entries()){
   signal?.throwIfAborted();await check();
   await privateDirectory(target.root,path.posix.dirname(relative));
   const existing=await lstat(content.file).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
   if(existing&&(!existing.isFile()||existing.nlink!==1))conflict();
   const resource={kind:'file',relative,bytes:content.size,sha256:content.sha256};
   await write(store=>retainRecordOwnerResource(store,resource,{present:existing!==null,receipt:transfer}));
   if(!existing)await inputs[index].content.copyTo(target,content.file,{signal,check,resume:true});
   await checkpoint('dataset-export-file',{jobId:job.id,completed:index+1,total:outputs.length});
  }
 }
 await write(async store=>{
  const rawJob=await source.readMetadata('.observanda/jobs/'+job.id+'.json',1048576);
  if(!rawJob||!same(JSON.parse(rawJob),job))damaged();
  const audit=await store.object(recordOwnerAuditPartKey(transfer.id,'.observanda/jobs/'+job.id+'.json'));
  // Reused immutable aliases may point at a previous completed transfer.
  if(audit&&audit.text!==rawJob)damaged();
  const feed=new MetadataFeed(target,'.observanda/dataset-jobs/'+job.scope),summary=JSON.stringify({id:job.id,createdAt:job.createdAt});
  const candidate=exchangeCandidateFile(job.id);
  const paths=new Map([['.observanda/jobs/'+job.id+'.json',rawJob],[feed.source+'/'+job.id+'.json',summary],[feed.order+'/'+feed.key(job),summary],[candidate,JSON.stringify(saved)]]);
  // The existing native marker may cover more jobs than this transfer.
  // Leave its generation to the feed owner if it has not been initialized.
  const changes=[];
  for(const [relative,text] of paths){
   const key='metadata:'+relative,before=await store.object(key);
   if(before&&before.text!==text){
    if(relative!==candidate||!await readRecordOwnerPreviousTransfer(store,transfer))conflict();
    const earlier=await readExchangeCandidate(target,job);
    if(!earlier||!same(earlier.candidate,saved.candidate)||earlier.available)conflict();
   }
   changes.push({address:{kind:'object',key},before,after:{text}});
  }
  const resource={kind:'object',key:slot,revision:digest(serialize(proof))};
  await retainRecordOwnerResource(store,resource,{present:false,receipt:transfer});
  await store.putObject(slot,proof);
  await journalRecordOwnerMutations(store,transfer,changes,{dependencies:[resource],chain:{kind:'object',key:'metadata:'+candidate}});
  for(const [relative,text] of paths)await target.writeMetadata(relative,text);
 });
}

async function* destinationExchanges(source,target,transfer,{signal,check}){
 const jobs=new DurableJobs(source,{});
 const start=prefix(transfer.id);
 let after=null;
 do{
  const page=await target.catalogue(store=>store.objectIdPage(start,{after,limit:32,signal}));
  for(const key of page.items){
   signal?.throwIfAborted();await check();
   const proof=await target.catalogue(store=>store.object(key)),job=await jobs.read(key.slice(start.length));
   if(!job||proof?.transferId!==transfer.id||proof.jobId!==job.id||proof.recordId!==job.scope||job.scope!==transfer.command.recordId)damaged();
   // A user may already have removed a prepared download on the new owner.
   // That leaves the immutable receipt intact and must not resurrect a file.
   const destination=await readExchangeCandidate(target,job);
   if(!destination||!same(destination.candidate,proof.saved.candidate))damaged();
   yield {proof,job,destination};
  }
  after=page.next;
 }while(after);
}

async function verifyMembers(target,job,destination,{signal,check}){
 if(destination.available)for(const {content} of preparedExchangeMembers(target,job.id,destination.candidate)){
  // Require complete authenticated bytes at the final location, including
  // when resuming a transaction that previously wrote its staging receipt.
  for await(const bytes of content.readStaged({signal})){await check();}
 }
}

export async function verifyRecordOwnerExchanges(source,target,transfer,options){
 for await(const {proof,job,destination} of destinationExchanges(source,target,transfer,options)){
  if(proof.saved.available!==destination.available)damaged();
  await verifyMembers(target,job,destination,options);
 }
}

export async function retireRecordOwnerExchanges(source,target,transfer,{signal,check,checkpoint,reopened=false}){
 for await(const {proof,job,destination} of destinationExchanges(source,target,transfer,{signal,check})){
   if(reopened)await verifyMembers(target,job,destination,{signal,check});
   await source.withLock(()=>source.catalogue(store=>withRecordOwnerTransferWrite(store,transfer,async()=>{
    const current=await readExchangeCandidate(source,job);
    if(!current||!same(current.candidate,destination.candidate))damaged();
    if(current.available)await source.writeMetadata(exchangeCandidateFile(job.id),JSON.stringify({...current,available:false}));
   })));
   await removeExchangeAttempt(source,job.id,proof.saved.candidate.attempt);
   await checkpoint('dataset-export-retired',{jobId:job.id});
 }
}
