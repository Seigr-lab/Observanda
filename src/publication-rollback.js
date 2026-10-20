import {publicationWorkspace,retainedWebsitePin,validWebsitePin} from './publication-pin.js';
import {publicationRevisionCurrent} from './publication-freshness.js';
import {randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {researchId} from './web/research-reference.js';
import {PublicationDocumentBuilder} from './publication-document.js';
import {nativePublicationCandidate,publicationReviewOwner,publicationAnalysisReader} from './publication-retained-input.js';
import {PublicationJobs} from './publication-jobs.js';
import {AnalysisPublicationReview} from './analysis-publication-review.js';
import {publicationAnalysisState} from './publication-analysis-state.js';

const file=id=>{if(!researchId(id))throw new AppError('INVALID');return '.observanda/publication-rollback/'+id+'.json';};
const receiptIdentity=r=>r?{deploymentId:r.deploymentId??null,releaseId:r.releaseId,commit:r.commit??null,manifestHash:r.manifestHash}:null;
export class PublicationRollback{
 constructor(workspace,publisher,{sourceReader}={}){this.workspace=publicationWorkspace(workspace);this.publisher=publisher;this.sourceReader=sourceReader;}
 async review({id}){
  const candidate=await new PublicationJobs(this.workspace,{sourceReader:this.sourceReader}).read(id);if(!candidate)throw new AppError('NOT_FOUND');
  return this.workspace.withLock(async()=>{
   await this.workspace.lockWebsite();
   const saved=await this.publisher.read(),current=await this.workspace.currentOutline();if(!saved.configured)throw new AppError('PUBLISH_CONFIG');
   const source=await new PublicationJobs(this.workspace,{sourceReader:this.sourceReader}).source(candidate.jobId);if(source.workspaceId!==current.metadata.id)throw new AppError('WORKSPACE_CHANGED');
   const websitePin=await retainedWebsitePin(this.workspace,{etag:current.etag,websitePin:current.websitePin});
   const review={version:2,id:randomUUID(),workspaceId:current.metadata.id,workspaceEtag:current.etag,websitePin,reviewId:id,releaseId:candidate.id,configEtag:saved.etag,destinationKey:this.publisher.destinationKey(saved.config),previous:receiptIdentity(saved.receipt),createdAt:new Date().toISOString()};
   if(nativePublicationCandidate(candidate)){
    const owner=publicationReviewOwner(candidate),builder=new PublicationDocumentBuilder(this.workspace,{owner,expectedOwner:owner,collections:{analysisItems:{indexes:[]}}});
    Object.assign(review,await publicationAnalysisState(this.workspace,candidate,{sourceReader:this.sourceReader,requireCurrent:false,onItem:item=>builder.append('analysisItems',item.id,item)}));
    review.version=3;review.analysisDocument=await builder.finish({header:{version:1,analysis:review.analysis}});
   }else Object.assign(review,await publicationAnalysisState(this.workspace,candidate,{sourceReader:this.sourceReader,requireCurrent:false}));
   await this.workspace.writeMetadata(file(review.id),serialize(review));
   return {review,destination:saved.config,configEtag:saved.etag};
  });
 }
 async authorize(candidate,id){
  const raw=await this.workspace.readMetadata(file(id),16*1024*1024);if(!raw)throw new AppError('PUBLISH_STALE');
  const review=JSON.parse(raw),saved=await this.publisher.read(),current=await this.workspace.currentOutline();
  if(![1,2,3].includes(review.version)||review.version>=2&&!validWebsitePin(review.websitePin)||review.id!==id||review.workspaceId!==current.metadata.id||!await publicationRevisionCurrent(this.workspace,review,{current})||review.reviewId!==candidate.reviewId||review.releaseId!==candidate.id||review.configEtag!==saved.etag||review.destinationKey!==this.publisher.destinationKey(saved.config)||digest(serialize(review.previous))!==digest(serialize(receiptIdentity(saved.receipt))))throw new AppError('PUBLISH_STALE');
  if(nativePublicationCandidate(candidate)){if(review.version!==3)throw new AppError('PUBLISH_STALE');await publicationAnalysisReader(this.workspace,this.project(candidate,review));}
  return review;
 }
 project(candidate,review){return {...candidate,...(review.analysisDocument?{analysisDocument:review.analysisDocument}:{}),...(review.sourceSnapshots?{sourceSnapshots:review.sourceSnapshots}:{}),analysisReviewId:digest(review.id),researchReview:{...candidate.researchReview,analysis:review.analysis}};}
}


// Restore audits authenticate retained roots and decisions without consulting
// today's publisher configuration, source heads or foreign access grants.
export async function verifyRetainedPublicationRollback(workspace,candidate,review,{id=review?.id,signal}={}){
 const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),bad=()=>{throw new AppError('JOB_DAMAGED');};
 signal?.throwIfAborted();
 if(!candidate||!review||![1,2,3].includes(review.version)||!researchId(id)||review.id!==id||!researchId(review.workspaceId)||candidate.workspaceId!==undefined&&review.workspaceId!==candidate.workspaceId||!hash(review.workspaceEtag)||review.reviewId!==candidate.reviewId||review.releaseId!==candidate.id||typeof review.configEtag!=='string'||!hash(review.destinationKey)||!Number.isFinite(Date.parse(review.createdAt)))bad();
 if(review.version>=2&&(!validWebsitePin(review.websitePin)||review.websitePin.websiteId!==(candidate.websiteId??null)||review.websitePin.researchSnapshotId!==review.workspaceEtag))bad();
 if(!review.analysis||!hash(review.analysis.fingerprint)||review.version===3!==nativePublicationCandidate(candidate))bad();
 const projected=PublicationRollback.prototype.project(candidate,review);
 if(nativePublicationCandidate(candidate)){
  const analysis=await publicationAnalysisReader(workspace,projected,{signal}),groups=[];
  for await(const group of analysis.input.sourceGroups()){if(groups.length>=101)bad();groups.push(group.workspaceId);}
  const snapshots=review.sourceSnapshots??[];
  if(!Array.isArray(snapshots)||snapshots.length!==groups.length-1||snapshots.some((row,index)=>!researchId(row?.workspaceId)||!hash(row?.snapshotId)||!groups.slice(1).includes(row.workspaceId)||snapshots.slice(0,index).some(previous=>previous.workspaceId===row.workspaceId)))bad();
 }else if(!Array.isArray(review.analysis.items))bad();
 // Missing decisions are valid retained state. Publication assertion, unlike
 // storage verification, requires reviewed=true before allowing delivery.
 return new AnalysisPublicationReview(workspace).verify(projected,{signal});
}
