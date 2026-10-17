import {publicationWorkspace,retainedWebsitePin,validWebsitePin} from './publication-pin.js';
import {publicationRevisionCurrent} from './publication-freshness.js';
import {randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {researchId} from './web/research-reference.js';
import {PublicationJobs} from './publication-jobs.js';
import {publicationAnalysisState} from './publication-analysis-state.js';

const file=id=>{if(!researchId(id))throw new AppError('INVALID');return '.observanda/publication-rollback/'+id+'.json';};
const receiptIdentity=r=>r?{deploymentId:r.deploymentId??null,releaseId:r.releaseId,commit:r.commit??null,manifestHash:r.manifestHash}:null;
export class PublicationRollback{
 constructor(workspace,publisher,{sourceReader}={}){this.workspace=publicationWorkspace(workspace);this.publisher=publisher;this.sourceReader=sourceReader;}
 async review({id}){
  const candidate=await new PublicationJobs(this.workspace).read(id);if(!candidate)throw new AppError('NOT_FOUND');
  return this.workspace.withLock(async()=>{
   await this.workspace.lockWebsite();
   const saved=await this.publisher.read(),current=await this.workspace.currentOutline();if(!saved.configured)throw new AppError('PUBLISH_CONFIG');
   const source=await new PublicationJobs(this.workspace).source(candidate.jobId);if(source.workspaceId!==current.metadata.id)throw new AppError('WORKSPACE_CHANGED');
   const websitePin=await retainedWebsitePin(this.workspace,{etag:current.etag,websitePin:current.websitePin});
   const review={version:2,id:randomUUID(),workspaceId:current.metadata.id,workspaceEtag:current.etag,websitePin,reviewId:id,releaseId:candidate.id,configEtag:saved.etag,destinationKey:this.publisher.destinationKey(saved.config),previous:receiptIdentity(saved.receipt),createdAt:new Date().toISOString()};
   Object.assign(review,await publicationAnalysisState(this.workspace,candidate,{sourceReader:this.sourceReader,requireCurrent:false}));
   await this.workspace.writeMetadata(file(review.id),serialize(review));
   return {review,destination:saved.config,configEtag:saved.etag};
  });
 }
 async authorize(candidate,id){
  const raw=await this.workspace.readMetadata(file(id),16*1024*1024);if(!raw)throw new AppError('PUBLISH_STALE');
  const review=JSON.parse(raw),saved=await this.publisher.read(),current=await this.workspace.currentOutline();
  if(![1,2].includes(review.version)||review.version===2&&!validWebsitePin(review.websitePin)||review.id!==id||review.workspaceId!==current.metadata.id||!await publicationRevisionCurrent(this.workspace,review,{current})||review.reviewId!==candidate.reviewId||review.releaseId!==candidate.id||review.configEtag!==saved.etag||review.destinationKey!==this.publisher.destinationKey(saved.config)||digest(serialize(review.previous))!==digest(serialize(receiptIdentity(saved.receipt))))throw new AppError('PUBLISH_STALE');
  return review;
 }
 project(candidate,review){return {...candidate,...(review.sourceSnapshots?{sourceSnapshots:review.sourceSnapshots}:{}),analysisReviewId:digest(review.id),researchReview:{...candidate.researchReview,analysis:review.analysis}};}
}
