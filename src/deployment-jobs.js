import {recordDeploymentInventory,prepareDeploymentInventory,assertDeploymentInventory} from './publication-live.js';
import {verifyPreparedInventory} from './publication-live-inventory.js';
import {randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {digest,serialize} from './storage.js';
import {researchId} from './web/research-reference.js';
import {PublicationJobs} from './publication-jobs.js';
import {AnalysisPublicationReview} from './analysis-publication-review.js';
import {MetadataFeed} from './metadata-feed.js';
import {enforcePublishingLimits} from './publishing.js';
import {deployGithub} from './github-deployment.js';
import {writeGithubOwnership} from './github-publication-plan.js';
import {PublicationRollback} from './publication-rollback.js';
import {deploymentUncertain} from './publication-deployment-state.js';
const file=id=>{if(!researchId(id))throw new AppError('INVALID');return '.observanda/deployments/'+id+'.json';};
export class DeploymentJobs{
 constructor(workspace,publisher,queue,{sourceReader,sourceAccess}={}){this.workspace=workspace;this.publisher=publisher;this.queue=queue;this.sourceReader=sourceReader;this.sourceAccess=sourceAccess;this.releases=new PublicationJobs(workspace);this.feed=new MetadataFeed(workspace,'.observanda/deployment-list');}
 async read(id){const raw=await this.workspace.readMetadata(file(id),16*1024*1024);if(raw===null)throw new AppError('NOT_FOUND');const d=JSON.parse(raw);if(d.version!==1||d.id!==id||!researchId(d.scope)||!d.intent||!d.journal||!['github','ssh'].includes(d.intent.config.kind))throw new AppError('JOB_DAMAGED');return d;}
 async start({id:reviewId,configEtag,reviewed,destinationReview,destinationReviewed,rollbackReview,rollbackConfirmed}){
  return this.queue.transaction(async()=>{
   let candidate=await this.releases.read(reviewId);const saved=await this.publisher.read(),current=await this.workspace.outline();
   if(!candidate||reviewed!==true||saved.etag!==configEtag||!saved.configured)throw new AppError('PUBLISH_STALE');
   if(rollbackReview){if(rollbackConfirmed!==true)throw new AppError('PUBLISH_STALE');const rollback=new PublicationRollback(this.workspace,this.publisher,{sourceReader:this.sourceReader});candidate=rollback.project(candidate,await rollback.authorize(candidate,rollbackReview));}
   else{if(candidate.configEtag!==configEtag)throw new AppError('PUBLISH_STALE');if(candidate.etag!==current.etag)throw new AppError('STALE');}
   await new AnalysisPublicationReview(this.workspace,{sourceReader:this.sourceReader}).assert(candidate);
   enforcePublishingLimits(candidate,saved.config);
   const key=this.publisher.destinationKey(saved.config),active=await this.workspace.readMetadata('.observanda/deployment-active/'+key+'.json',4096);
   if(active){
    const previous=await this.read(JSON.parse(active).id),job=await this.queue.read(previous.id);
    if(!job)throw new AppError('JOB_DAMAGED');
    const sameReview=previous.intent.reviewId===reviewId&&previous.intent.configEtag===configEtag&&(previous.intent.rollbackReview??null)===(rollbackReview??null)&&(previous.intent.plan?.id??null)===(destinationReview??null);
    if(sameReview){if(candidate.sourceGroups&&['queued','running'].includes(job.state))this.sourceAccess?.bind(job.id,this.sourceReader);return job;}
    if(['queued','running'].includes(job.state)||deploymentUncertain(previous.journal,previous.intent.config.kind))throw new AppError('PUBLISH_PENDING');
   }
   const plan=await this.publisher.readDestinationPlan(candidate,configEtag,{destinationReview,destinationReviewed});
   const id=randomUUID(),createdAt=new Date().toISOString(),intent={reviewId,releaseId:candidate.id,configEtag,config:saved.config,key,...(rollbackReview?{rollbackReview,analysisReviewId:candidate.analysisReviewId,analysis:candidate.researchReview.analysis,...(candidate.sourceSnapshots?{sourceSnapshots:candidate.sourceSnapshots}:{})}:{}),...(plan?{plan}: {})};
   const d={version:1,id,scope:current.metadata.id,createdAt,intent,journal:{createdAt}};
   await this.feed.ensureLocked();await this.workspace.writeMetadata(file(id),serialize(d));
   await this.workspace.writeMetadata('.observanda/deployment-list/'+id+'.json',serialize({id,createdAt}));await this.feed.putLocked(d);
   await this.workspace.writeMetadata('.observanda/deployment-active/'+key+'.json',serialize({id}));
   const job=await this.queue.enqueueLocked({id,type:'publication.deploy',scope:d.scope,input:{revision:digest(serialize(intent))}});
   if(candidate.sourceGroups)this.sourceAccess?.bind(id,this.sourceReader);return job;
  });
 }
 async control(id,action){
  const job=await this.queue.read(id);if(!job||job.type!=='publication.deploy')throw new AppError('NOT_FOUND');await this.queue.authorize(job);
  let revoke;
  try{if(action==='retry'){const d=await this.read(id),candidate=await this.releases.read(d.intent.reviewId);if(!candidate)throw new AppError('JOB_DAMAGED');if(candidate.sourceGroups)revoke=this.sourceAccess?.bind(id,this.sourceReader);}
   const next=await this.queue.control(id,action);if(action==='cancel')this.sourceAccess?.forget(id);return next;
  }catch(error){revoke?.();throw error;}
 }
 async authorize(job){await this.workspace.requireStorageKey();const d=await this.read(job.id);if(d.scope!==job.scope||digest(serialize(d.intent))!==job.input.revision)throw new AppError('JOB_CHANGED');}
 async held(job){
  await this.queue.held(job.id,job.lease.token);await this.authorize(job);
  const d=await this.read(job.id),active=JSON.parse(await this.workspace.readMetadata('.observanda/deployment-active/'+d.intent.key+'.json',4096));
  if(active.id!==job.id)throw new AppError('PUBLISH_STALE');return d;
 }
 async prepare(job,{signal,progress}){
  const d=await this.read(job.id);let candidate=await this.releases.read(d.intent.reviewId);if(!candidate||candidate.id!==d.intent.releaseId)throw new AppError('JOB_DAMAGED');
  if(d.intent.rollbackReview)candidate={...candidate,...(d.intent.sourceSnapshots?{sourceSnapshots:d.intent.sourceSnapshots}:{}),analysisReviewId:d.intent.analysisReviewId,researchReview:{...candidate.researchReview,analysis:d.intent.analysis}};
  const sourceReader=this.sourceReader??this.sourceAccess?.take(job.id);
  if(!d.journal.pushAttempted)await new AnalysisPublicationReview(this.workspace,{sourceReader}).assert(candidate,{signal});
  enforcePublishingLimits(candidate,d.intent.config);
  const guard=async()=>{signal.throwIfAborted();await this.workspace.catalogue(async()=>{await this.held(job);if((await this.publisher.read()).etag!==d.intent.configEtag)throw new AppError('PUBLISH_STALE');if(d.journal.liveInventory)await assertDeploymentInventory(this.workspace,d.intent.key,d.journal.liveInventory,d.journal.receipt);});};
  if(!d.journal.liveInventory){
   const removed=d.intent.config.kind==='github'?(d.journal.removed??d.intent.plan?.removed??[]).map(p=>d.intent.config.github.directory?p.slice(d.intent.config.github.directory.length+1):p):[];
   const prepared=await prepareDeploymentInventory(this.workspace,d.intent.key,candidate.files.keys(),{removed,guard,signal,write:operation=>this.queue.transaction(operation)});
   await this.queue.transaction(async()=>{await guard();await assertDeploymentInventory(this.workspace,d.intent.key,prepared);d.journal.liveInventory=prepared;await this.workspace.writeMetadata(file(job.id),serialize(d));});
  }else await verifyPreparedInventory(this.workspace,d.journal.liveInventory,{signal,files:candidate.files});
  const save=journal=>this.queue.transaction(async()=>{
   await this.held(job);d.journal=structuredClone(journal);await this.workspace.writeMetadata(file(job.id),serialize(d));
   if(journal.receipt){if(d.intent.config.kind==='github')await writeGithubOwnership(this.workspace,d.intent.key,journal);await recordDeploymentInventory(this.workspace,d.intent.key,journal.receipt,journal.liveInventory);const receipts=await this.publisher.readFile(this.publisher.receiptsFile,{});receipts[d.intent.key]={...journal.receipt,deploymentId:job.id};await this.workspace.writeMetadata('.observanda/publishing-receipts.json',serialize(receipts));}
  });
  const options={plan:d.intent.plan,journal:d.journal,guard,save,signal,progress};
  return d.intent.config.kind==='ssh'?this.publisher.ssh.deploy(d.intent.config.ssh,candidate,this.workspace.websiteId??d.scope,options):deployGithub(this.publisher,candidate,d.intent.config,options);
 }
 async commit(job,receipt){const d=await this.held(job);if(receipt.commit!==d.journal.receipt?.commit)throw new AppError('JOB_CHANGED');return {id:job.id,status:receipt.status};}
 summary(d){const j=d.journal;return {id:d.id,createdAt:d.createdAt,reviewId:d.intent.reviewId,releaseId:d.intent.releaseId,kind:d.intent.config.kind,destinationKey:d.intent.key,destination:d.intent.config.kind==='ssh'?`${d.intent.config.ssh.host} / ${d.intent.config.ssh.directory}/current`:`${d.intent.config.github.owner}/${d.intent.config.github.repository} / ${d.intent.config.github.branch}${d.intent.config.github.directory?' / '+d.intent.config.github.directory:''}`,uploaded:j.uploaded?.length??0,total:d.intent.config.kind==='ssh'?(j.total??0):new Set((j.entries??[]).map(entry=>entry.sha)).size,commit:j.commit??null,pushAttempted:!!j.pushAttempted,receipt:j.receipt??null};}
 async page(options){return this.workspace.catalogue(async()=>{const page=await this.feed.page(options),items=[];for(const row of page.items){const d=await this.read(row.id),job=await this.queue.read(row.id);if(!job)throw new AppError('JOB_DAMAGED');const verification=await this.workspace.readMetadata('.observanda/deployment-verifications/'+row.id+'.json',4096);items.push({...this.summary(d),verification:verification?JSON.parse(verification):null,job});}return {items,next:page.next};});}
}
export function deploymentJobDefinitions(workspace,publisher,queue,options={}){const service=()=>new DeploymentJobs(workspace,publisher,queue(),options);return {'publication.deploy':{authorize:job=>service().authorize(job),prepare:(job,options)=>service().prepare(job,options),commit:(job,receipt)=>service().commit(job,receipt)}};}
