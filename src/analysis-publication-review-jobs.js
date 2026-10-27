import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {researchId} from './web/research-reference.js';
import {PublicationJobs} from './publication-jobs.js';
import {PublicationRollback} from './publication-rollback.js';
import {AnalysisPublicationReview,validAnalysisReviewDecisions} from './analysis-publication-review.js';
import {publicationWorkspace,publicationResearchWorkspace} from './publication-pin.js';
import {jobSummary} from './jobs.js';
import {requirePublicationOperations} from './catalogue-format.js';
import {assertPublicationOperationFormat} from './publication-operation-format.js';

const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const type='publication.analysis-review';
const reviewKey=(id,rollbackReview)=>{if(!hash(id)||rollbackReview!==undefined&&!researchId(rollbackReview))throw new AppError('INVALID');return rollbackReview?digest(rollbackReview):id;};
const pointer=id=>'.observanda/publication-analysis-operations/'+id+'.json';
const terminal=state=>['completed','failed','cancelled','relocated'].includes(state);
export const analysisPublicationOperationSummary=job=>job?{...jobSummary(job),decisions:structuredClone(job.input.request.decisions)}:null;

// Decisions and their operation receipt commit together. A lost HTTP response
// only detaches its observer; it never changes the selected edition or inputs.
export class AnalysisPublicationReviewJobs{
 constructor(workspace,publisher,{sourceReader,sourceAccess}={}){this.workspace=publicationWorkspace(workspace);this.publisher=publisher;this.sourceReader=sourceReader;this.sourceAccess=sourceAccess;this.releases=new PublicationJobs(this.workspace,{sourceReader});}
 request(job){
  const value=job.input.request;
  if(job.type!==type||!value||Object.keys(value).sort().join()!=='decisions,id,key,releaseRevision,rollbackReview,version'||value.version!==1||!hash(value.id)||!hash(value.releaseRevision)||!hash(value.key)||value.rollbackReview!==null&&!researchId(value.rollbackReview)||value.key!==reviewKey(value.id,value.rollbackReview??undefined)||!validAnalysisReviewDecisions(value.decisions)||digest(serialize(value))!==job.input.revision)throw new AppError('JOB_DAMAGED');
  return value;
 }
 async authorize(job){
  await this.workspace.requireStorageKey();await assertPublicationOperationFormat(this.workspace);const request=this.request(job),candidate=await this.releases.stored(request.id);
  if(!candidate||(candidate.workspaceId??(await this.releases.source(candidate.jobId)).workspaceId)!==job.scope||digest(serialize(candidate))!==request.releaseRevision)throw new AppError('JOB_CHANGED');
  return candidate;
 }
 async start(data,queue){
  if(!data||Object.keys(data).some(key=>!['id','rollbackReview','decisions','commandId'].includes(key))||!researchId(data.commandId)||!validAnalysisReviewDecisions(data.decisions))throw new AppError('ANALYSIS_REVIEW');
  const key=reviewKey(data.id,data.rollbackReview),candidate=await this.releases.stored(data.id);if(!candidate)throw new AppError('NOT_FOUND');
  const request={version:1,id:data.id,key,releaseRevision:digest(serialize(candidate)),rollbackReview:data.rollbackReview??null,decisions:structuredClone(data.decisions)},input={request,revision:digest(serialize(request))},scope=candidate.workspaceId??(await this.releases.source(candidate.jobId)).workspaceId;
  let revoke;
  try{return await queue.transaction(async()=>{
   const previous=await queue.read(data.commandId);
   if(previous){if(previous.type!==type||previous.scope!==scope||previous.input.revision!==input.revision)throw new AppError('JOB_CHANGED');await this.authorize(previous);if(this.sourceReader&&!terminal(previous.state))revoke=this.sourceAccess?.bind(previous.id,this.sourceReader);return previous;}
   const pending=await this.current(data.id,data.rollbackReview,queue);if(pending&&!terminal(pending.state))throw new AppError('JOB_CHANGED');
   if(this.sourceReader)revoke=this.sourceAccess?.bind(data.commandId,this.sourceReader);
   await this.workspace.catalogue(store=>requirePublicationOperations(store.db));
   const job=await queue.enqueueLocked({id:data.commandId,type,scope,input});await this.workspace.writeMetadata(pointer(key),serialize({version:1,id:job.id,key}));return job;
  });}catch(error){revoke?.();throw error;}
 }
 async current(id,rollbackReview,queue){
  const key=reviewKey(id,rollbackReview),raw=await this.workspace.readMetadata(pointer(key),1024);if(raw===null)return null;
  let value;try{value=JSON.parse(raw);}catch{throw new AppError('JOB_DAMAGED');}
  if(!value||Object.keys(value).sort().join()!=='id,key,version'||value.version!==1||value.key!==key||!researchId(value.id))throw new AppError('JOB_DAMAGED');
  const job=await queue.read(value.id);if(!job||this.request(job).key!==key)throw new AppError('JOB_DAMAGED');await this.authorize(job);return job;
 }
 async candidate(job,{signal}={}){
  const request=this.request(job);await this.authorize(job);signal?.throwIfAborted();let candidate=await this.releases.read(request.id);if(!candidate)throw new AppError('NOT_FOUND');
  if(request.rollbackReview){const rollback=new PublicationRollback(this.workspace,this.publisher,{sourceReader:this.sourceReader});candidate=rollback.project(candidate,await rollback.authorize(candidate,request.rollbackReview));}
  return candidate;
 }
 async control(queue,id,action){return queue.transaction(async()=>{
  const job=await queue.read(id);if(!job||job.type!==type||!['cancel','retry'].includes(action))throw new AppError('NOT_FOUND');await this.authorize(job);
  const request=this.request(job);
  if(action==='retry'&&(await this.current(request.id,request.rollbackReview??undefined,queue))?.id!==id)throw new AppError('JOB_CHANGED');
  let revoke;this.sourceAccess?.forget(id);try{if(action==='retry'&&this.sourceReader)revoke=this.sourceAccess?.bind(id,this.sourceReader);return await queue.controlLocked(id,action);}catch(error){revoke?.();throw error;}
 });}
}

export function analysisPublicationReviewDefinitions(workspace,publisher,queue,{sourceAccess}={}){
 const operations=new AnalysisPublicationReviewJobs(workspace,publisher);
 return {[type]:{
  authorize:job=>operations.authorize(job),
  prepare:async(job,{signal,progress})=>{
   const sourceReader=sourceAccess?.take(job.id),service=new AnalysisPublicationReviewJobs(workspace,publisher,{sourceReader});
   await progress({stage:'checking-analysis-edition',done:0,total:0});return {candidate:await service.candidate(job,{signal}),sourceReader};
  },
  beforeComplete:async(job,prepared,{signal,progress})=>{
   let analysesChecked=0;
   const checkedHead=await publicationResearchWorkspace(workspace).catalogue(store=>store.head()),review=new AnalysisPublicationReview(workspace,{sourceReader:prepared.sourceReader});await review.fresh(prepared.candidate,{signal,onCheck:async source=>progress?.({stage:'checking-analysis-edition',done:0,total:0,analysesChecked:++analysesChecked,recordId:source.recordId})});signal?.throwIfAborted();return {...prepared,checkedHead};
  },
  commit:async(job,prepared)=>{if(await publicationResearchWorkspace(workspace).catalogue(store=>store.head())!==prepared.checkedHead)throw new AppError('ANALYSIS_REVIEW');return new AnalysisPublicationReview(workspace,{sourceReader:prepared.sourceReader}).save(prepared.candidate,operations.request(job).decisions,{checked:true,write:operation=>operation()});}
 }};
}

export async function verifyAnalysisPublicationOperations(workspace){
 const service=new AnalysisPublicationReviewJobs(workspace),queue={read:async id=>{const raw=await workspace.readMetadata('.observanda/jobs/'+id+'.json',1048576);return raw===null?null:JSON.parse(raw);}};
 for await(const name of workspace.metadataNames('.observanda/publication-analysis-operations')){
  if(!/^[a-f0-9]{64}\.json$/.test(name))throw new AppError('JOB_DAMAGED');
  const raw=await workspace.readMetadata('.observanda/publication-analysis-operations/'+name,1024);let value;try{value=JSON.parse(raw);}catch{throw new AppError('JOB_DAMAGED');}
  const job=value&&researchId(value.id)?await queue.read(value.id):null;if(!job||(job.input.websiteId??null)!==(workspace.websiteId??null)||service.request(job).key!==name.slice(0,-5))throw new AppError('JOB_DAMAGED');
  const request=service.request(job);await service.current(request.id,request.rollbackReview??undefined,queue);
 }
}
