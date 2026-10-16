import {AppError} from './errors.js';
import {publicationAnalysisState} from './publication-analysis-state.js';
import {analysisTextValue} from './web/analysis-model.js';
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const validDecisions=(decisions,expected)=>Array.isArray(decisions)&&decisions.length===expected.length&&new Set(decisions.map(d=>d?.id)).size===expected.length&&decisions.every(d=>d&&Object.keys(d).sort().join()==='id,reason'&&expected.some(e=>e.id===d.id)&&analysisTextValue(d.reason,4000,true));
// A review decision belongs to a pinned edition and the dependency heads seen
// at its preparation. A later input change requires a fresh edition/review.
export class AnalysisPublicationReview{
 constructor(workspace,{sourceReader}={}){this.workspace=workspace;this.sourceReader=sourceReader;}
 file(id){if(!hash(id))throw new AppError('INVALID');return '.observanda/analysis-edition-reviews/'+id+'.json';}
 async read(candidate){const raw=await this.workspace.readMetadata(this.file(candidate.analysisReviewId??candidate.reviewId),1024*1024);if(raw===null)return null;let value;try{value=JSON.parse(raw);}catch{throw new AppError('CATALOGUE_DAMAGED');}if(value?.version!==1||value.reviewId!==(candidate.analysisReviewId??candidate.reviewId)||value.fingerprint!==candidate.researchReview?.analysis?.fingerprint||!validDecisions(value.decisions,candidate.researchReview?.analysis?.items??[])||!Number.isFinite(Date.parse(value.recordedAt)))throw new AppError('CATALOGUE_DAMAGED');return value;}
 async status(candidate){const a=candidate.researchReview?.analysis;if(!a?.items.length)return {reviewed:true,decisions:[]};const saved=await this.read(candidate);return {reviewed:!!saved,decisions:saved?.decisions??[]};}
 async fresh(candidate,{signal}={}){const expected=candidate.researchReview?.analysis;if(!expected)return;const {analysis:current}=await publicationAnalysisState(this.workspace,candidate,{sourceReader:this.sourceReader,signal});if(current.fingerprint!==expected.fingerprint)throw new AppError('ANALYSIS_REVIEW');}
 async save(candidate,decisions){return this.workspace.withLock(async()=>{
  await this.fresh(candidate);const expected=candidate.researchReview?.analysis?.items??[];
  if(!validDecisions(decisions,expected))throw new AppError('ANALYSIS_REVIEW');
  const value={version:1,reviewId:candidate.analysisReviewId??candidate.reviewId,fingerprint:candidate.researchReview.analysis.fingerprint,recordedAt:new Date().toISOString(),decisions},raw=JSON.stringify(value);
  if(Buffer.byteLength(raw)>1024*1024)throw new AppError('ANALYSIS_LIMIT');await this.workspace.writeMetadata(this.file(candidate.analysisReviewId??candidate.reviewId),raw);return {reviewed:true,decisions};
 });}
 async assert(candidate,options){await this.fresh(candidate,options);if(!(await this.status(candidate)).reviewed)throw new AppError('ANALYSIS_REVIEW');}
}
