import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {PublicationJobs} from './publication-jobs.js';
import {PublicationRollback} from './publication-rollback.js';
import {publicationRevisionCurrent} from './publication-freshness.js';
import {githubArchiveBranch,githubPlanReview,admitGithubPlan} from './github-publication-plan.js';
import {researchId} from './web/research-reference.js';
import {jobSummary} from './jobs.js';
const pointer='.observanda/publishing-plan-operation.json',type='publication.destination-review';
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export class GithubPlanJobs{
 constructor(workspace,publisher,queue,{sourceReader,sourceAccess}={}){Object.assign(this,{workspace,publisher,queue,sourceReader,sourceAccess});}
 request(data){
  const request={id:data.id,configEtag:data.configEtag,replaceExisting:data.replaceExisting??false,archiveBranch:data.archiveBranch??null,rollbackReview:data.rollbackReview??null};
  if(!hash(request.id)||!hash(request.configEtag)||typeof request.replaceExisting!=='boolean'||request.archiveBranch!==null&&(!request.replaceExisting||!githubArchiveBranch(request.archiveBranch))||request.rollbackReview!==null&&!researchId(request.rollbackReview))throw new AppError('INVALID');return request;
 }
 async start(data){
  const request=this.request(data),revision=digest(serialize(request));if(data.commandId!==undefined&&!researchId(data.commandId))throw new AppError('INVALID');
  return this.queue.transaction(async()=>{
   const previous=data.commandId?await this.queue.read(data.commandId):null;
   if(previous){if(previous.type!==type||previous.input.revision!==revision)throw new AppError('JOB_CHANGED');await this.authorize(previous);if(this.sourceReader&&!['completed','cancelled','failed'].includes(previous.state))this.sourceAccess?.bind(previous.id,this.sourceReader);return previous;}
   const current=await this.current();
   if(current&&['queued','running'].includes(current.state)){
    if(current.input.revision!==revision)throw new AppError('PUBLISH_PENDING');
    if(this.sourceReader)this.sourceAccess?.bind(current.id,this.sourceReader);return current;
   }
   const job=await this.queue.enqueueLocked({...(data.commandId?{id:data.commandId}:{}),type,scope:(await this.workspace.outline()).metadata.id,input:{request,revision}});
   await this.workspace.writeMetadata(pointer,serialize({id:job.id}));if(this.sourceReader)this.sourceAccess?.bind(job.id,this.sourceReader);return job;
  });
 }
 async current(){const raw=await this.workspace.readMetadata(pointer,4096);return raw?this.queue.read(JSON.parse(raw).id):null;}
 async authorize(job){
  await this.workspace.requireStorageKey();const request=this.request(job.input.request),saved=await this.publisher.read();
  if(job.type!==type||digest(serialize(request))!==job.input.revision||job.scope!==(await this.workspace.outline()).metadata.id||saved.etag!==request.configEtag||saved.config.kind!=='github')throw new AppError('PUBLISH_STALE');
 }
 async prepare(job,{signal,progress}){
  await this.authorize(job);const request=job.input.request,sourceReader=this.sourceReader??this.sourceAccess?.take(job.id),candidate=await new PublicationJobs(this.workspace,{sourceReader}).read(request.id);
  if(!candidate)throw new AppError('PUBLISH_STALE');
  if(request.rollbackReview)await new PublicationRollback(this.workspace,this.publisher,{sourceReader}).authorize(candidate,request.rollbackReview);
  else if(candidate.configEtag!==request.configEtag||!await publicationRevisionCurrent(this.workspace,candidate))throw new AppError('PUBLISH_STALE');
  const held=async()=>{signal.throwIfAborted();await this.queue.held(job.id,job.lease.token);if((await this.current())?.id!==job.id)throw new AppError('PUBLISH_STALE');};
  const review=await this.publisher.reviewDestination(candidate,request.configEtag,{...request,signal,beforeCommit:held,onProgress:progress,write:operation=>this.queue.transaction(operation)});
  await held();return {id:review.id,configEtag:request.configEtag};
 }
 async operation({id,action='status',reviewId,configEtag,rollbackReview=null}){
  const job=await this.current();
  if(action==='current'){if(!job||job.input.request.id!==reviewId||job.input.request.configEtag!==configEtag||job.input.request.rollbackReview!==rollbackReview)return {job:null};return this.operation({id:job.id});}if(!job||job.id!==id)throw new AppError('PUBLISH_STALE');await this.authorize(job);
  if(action==='retry'||action==='cancel'){if(action==='retry'&&this.sourceReader)this.sourceAccess?.bind(id,this.sourceReader);return {job:jobSummary(await this.queue.control(id,action))};}
  if(action!=='status')throw new AppError('INVALID');
  const result={job:jobSummary(job)};
  if(job.state==='completed'){
   const saved=await this.publisher.read(),raw=await this.workspace.readMetadata('.observanda/publishing-plan/'+this.publisher.destinationKey(saved.config)+'.json',16*1024*1024),plan=raw?JSON.parse(raw):null;
   if(plan?.id!==job.result?.id||plan?.configEtag!==job.input.request.configEtag)throw new AppError('PUBLISH_STALE');result.plan=await githubPlanReview(this.workspace,admitGithubPlan(plan));
  }
  return result;
 }
}
export function githubPlanJobDefinitions(workspace,publisher,queue,services={}){const service=()=>new GithubPlanJobs(workspace,publisher,queue(),services);return {[type]:{authorize:job=>service().authorize(job),prepare:(job,options)=>service().prepare(job,options),commit:async(job,result)=>{await service().authorize(job);return result;}}};}
