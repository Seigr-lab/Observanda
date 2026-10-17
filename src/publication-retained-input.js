// Candidate envelopes retain exact source/analysis roots, never substitute the
// currently editable website or an empty array for an omitted collection.
import {AppError} from './errors.js';
import {PublicationDocument} from './publication-document.js';
import {openPublicationInput} from './publication-input-reader.js';
import {researchId} from './web/research-reference.js';
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const natural=value=>Number.isSafeInteger(value)&&value>=0;
const fail=()=>{throw new AppError('JOB_DAMAGED');};
export const nativePublicationCandidate=candidate=>candidate?.version===3;
export const publicationAnalysisCount=analysis=>analysis?.count??analysis?.items?.length??0;
export function publicationReviewOwner(candidate){
 if(!nativePublicationCandidate(candidate)||!researchId(candidate.workspaceId)||!researchId(candidate.jobId)||!researchId(candidate.attempt))fail();
 return {kind:'output',workspaceId:candidate.workspaceId,websiteId:candidate.websiteId??null,jobId:candidate.jobId,attemptId:candidate.attempt};
}
export async function publicationRetainedInput(workspace,candidate,{signal}={}){
 if(!nativePublicationCandidate(candidate)||!candidate.source||candidate.source.jobId!==candidate.jobId||!researchId(candidate.workspaceId))fail();
 return openPublicationInput(workspace,{version:6,id:candidate.source.jobId,workspaceId:candidate.workspaceId,websiteId:candidate.websiteId??null,metadata:{id:candidate.workspaceId},document:candidate.source.document,summary:candidate.summary,hasSources:candidate.hasSources},{signal});
}
export async function publicationAnalysisReader(workspace,candidate,{signal}={}){
 const expected=candidate.researchReview?.analysis;if(!expected||!hash(expected.fingerprint)||!natural(expected.count))fail();
 const input=await publicationRetainedInput(workspace,candidate,{signal});let document;
 if(candidate.analysisDocument){
  document=await PublicationDocument.open(workspace,candidate.analysisDocument,{owner:publicationReviewOwner(candidate),signal});const header=await document.header({signal});
  if(header.version!==1||header.analysis?.fingerprint!==expected.fingerprint||header.analysis?.count!==expected.count||document.collectionNames().join()!=='analysisItems')fail();
 }else{
  document=input.document;const header=await input.fullHeader();if(header.researchReview?.analysis?.fingerprint!==expected.fingerprint||header.researchReview?.analysis?.count!==expected.count)fail();
 }
 if(document.count('analysisItems')!==expected.count)fail();
 const validate=value=>{if(!value||!hash(value.id)||!researchId(value.recordId)||!Array.isArray(value.sample)||value.sample.length>20||!Number.isSafeInteger(value.changed)||value.changed<1)fail();return value;};
 return {
  count:expected.count,fingerprint:expected.fingerprint,input,document,
  async verify(){return document.verify({signal,onItem:async(name,{key,value})=>{if(name==='analysisItems'&&validate(value).id!==key)fail();}});},
  async get(id){const value=await document.get('analysisItems',id,{signal});if(value&&validate(value).id!==id)fail();return value;},
  async window(options={}){const page=await document.window('analysisItems',{...options,signal});return {...page,items:page.items.map(({key,value})=>{if(validate(value).id!==key)fail();return value;})};},
  async *items(){for await(const {key,value} of document.items('analysisItems',{signal})){if(validate(value).id!==key)fail();yield value;}}
 };
}
export async function publicationReferenceReviewWindow(workspace,candidate,options={}){
 if(!nativePublicationCandidate(candidate)){
  const items=candidate.researchReview?.references?.items??[],offset=options.offset??0,limit=options.limit??8;
  if(!natural(offset)||!Number.isSafeInteger(limit)||limit<1||limit>32)throw new AppError('INVALID');return {items:items.slice(offset,offset+limit),total:items.length,offset,next:offset+limit<items.length?String(offset+limit):null};
 }
 const input=await publicationRetainedInput(workspace,candidate,options),page=await input.window('referenceReviews',{...options,limit:options.limit??8});
 if(page.total!==candidate.researchReview?.references?.records)fail();return page;
}
