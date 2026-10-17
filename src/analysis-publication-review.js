import {AppError} from './errors.js';
import {publicationAnalysisState} from './publication-analysis-state.js';
import {PublicationDocument,PublicationDocumentBuilder} from './publication-document.js';
import {assertPublicationDocumentStorage} from './publication-document-storage.js';
import {nativePublicationCandidate,publicationAnalysisReader,publicationReviewOwner,publicationReferenceReviewWindow} from './publication-retained-input.js';
import {analysisTextValue} from './web/analysis-model.js';
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const validDecision=d=>d&&Object.keys(d).sort().join()==='id,reason'&&hash(d.id)&&analysisTextValue(d.reason,4000,true);
const validDecisions=(decisions,expected)=>Array.isArray(decisions)&&decisions.length===expected.length&&new Set(decisions.map(d=>d?.id)).size===expected.length&&decisions.every(d=>d&&Object.keys(d).sort().join()==='id,reason'&&expected.some(e=>e.id===d.id)&&analysisTextValue(d.reason,4000,true));
// A review decision belongs to a pinned edition and the dependency heads seen
// at its preparation. A later input change requires a fresh edition/review.
export class AnalysisPublicationReview{
 constructor(workspace,{sourceReader}={}){this.workspace=workspace;this.sourceReader=sourceReader;}
 file(id){if(!hash(id))throw new AppError('INVALID');return '.observanda/analysis-edition-reviews/'+id+'.json';}
 async read(candidate){if(nativePublicationCandidate(candidate))return (await this.nativeState(candidate,await publicationAnalysisReader(this.workspace,candidate))).receipt;const raw=await this.workspace.readMetadata(this.file(candidate.analysisReviewId??candidate.reviewId),1024*1024);if(raw===null)return null;let value;try{value=JSON.parse(raw);}catch{throw new AppError('CATALOGUE_DAMAGED');}if(value?.version!==1||value.reviewId!==(candidate.analysisReviewId??candidate.reviewId)||value.fingerprint!==candidate.researchReview?.analysis?.fingerprint||!validDecisions(value.decisions,candidate.researchReview?.analysis?.items??[])||!Number.isFinite(Date.parse(value.recordedAt)))throw new AppError('CATALOGUE_DAMAGED');return value;}
 async status(candidate){if(nativePublicationCandidate(candidate)){const expected=await publicationAnalysisReader(this.workspace,candidate),state=await this.nativeState(candidate,expected);return {reviewed:state.count===expected.count,decided:state.count,total:expected.count,decisions:[],window:await this.window(candidate)};}const a=candidate.researchReview?.analysis;if(!a?.items.length)return {reviewed:true,decisions:[]};const saved=await this.read(candidate);return {reviewed:!!saved,decisions:saved?.decisions??[]};}
 async fresh(candidate,{signal}={}){const expected=candidate.researchReview?.analysis;if(!expected)return;const {analysis:current}=await publicationAnalysisState(this.workspace,candidate,{sourceReader:this.sourceReader,signal});if(current.fingerprint!==expected.fingerprint)throw new AppError('ANALYSIS_REVIEW');}
 async save(candidate,decisions,options={}){if(nativePublicationCandidate(candidate))return this.saveNative(candidate,decisions,options);return this.workspace.withLock(async()=>{
  await this.fresh(candidate);const expected=candidate.researchReview?.analysis?.items??[];
  if(!validDecisions(decisions,expected))throw new AppError('ANALYSIS_REVIEW');
  const value={version:1,reviewId:candidate.analysisReviewId??candidate.reviewId,fingerprint:candidate.researchReview.analysis.fingerprint,recordedAt:new Date().toISOString(),decisions},raw=JSON.stringify(value);
  if(Buffer.byteLength(raw)>1024*1024)throw new AppError('ANALYSIS_LIMIT');await this.workspace.writeMetadata(this.file(candidate.analysisReviewId??candidate.reviewId),raw);return {reviewed:true,decisions};
 });}
 async assert(candidate,options){await this.fresh(candidate,options);const state=nativePublicationCandidate(candidate)?await this.verify(candidate,options):await this.status(candidate);if(!state.reviewed)throw new AppError('ANALYSIS_REVIEW');}
 async nativeState(candidate,expected,{signal}={}){
  signal?.throwIfAborted();const reviewId=candidate.analysisReviewId??candidate.reviewId,raw=await this.workspace.readMetadata(this.file(reviewId),65536);
  if(raw===null)return {receipt:null,document:null,count:0};let receipt;try{receipt=JSON.parse(raw);}catch{throw new AppError('CATALOGUE_DAMAGED');}
  if(!receipt||Object.keys(receipt).sort().join()!=='document,fingerprint,recordedAt,reviewId,version'||receipt.version!==2||receipt.reviewId!==reviewId||receipt.fingerprint!==expected.fingerprint||!Number.isFinite(Date.parse(receipt.recordedAt)))throw new AppError('CATALOGUE_DAMAGED');
  const document=await PublicationDocument.open(this.workspace,receipt.document,{owner:publicationReviewOwner(candidate),signal}),header=await document.header({signal});
  if(document.collectionNames().join()!=='decisions'||Object.keys(document.collection('decisions').indexes).length||document.count('decisions')>expected.count||header.version!==1||header.reviewId!==reviewId||header.fingerprint!==expected.fingerprint||header.count!==expected.count)throw new AppError('CATALOGUE_DAMAGED');
  return {receipt,document,count:document.count('decisions')};
 }
 async window(candidate,{offset=0,cursor=null,limit=4,signal}={}){
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>32)throw new AppError('INVALID');
  if(!nativePublicationCandidate(candidate)){
   if(cursor!==null){offset=Number(cursor);if(!Number.isSafeInteger(offset)||offset<0)throw new AppError('INVALID');}
   const rows=candidate.researchReview?.analysis?.items??[],status=await this.status(candidate),items=rows.slice(offset,offset+limit).map(row=>({...row,recordTitle:candidate.entries?.find(entry=>entry.id===row.recordId)?.title??'',decision:status.decisions.find(decision=>decision.id===row.id)??null}));return {items,total:rows.length,offset,next:offset+items.length<rows.length?String(offset+items.length):null,reviewed:status.reviewed,decided:status.decisions.length};
  }
  const expected=await publicationAnalysisReader(this.workspace,candidate,{signal}),state=await this.nativeState(candidate,expected,{signal}),page=await expected.window({offset,cursor,limit}),items=[];
  for(const row of page.items){
   signal?.throwIfAborted();const decision=state.document?await state.document.get('decisions',row.id,{signal}):null;if(decision&&(!validDecision(decision)||decision.id!==row.id))throw new AppError('CATALOGUE_DAMAGED');
   const record=await expected.input.get('records',row.recordId);items.push({...row,recordTitle:record?.title??'',decision});
  }
  return {...page,items,reviewed:state.count===expected.count,decided:state.count};
 }
 references(candidate,options={}){return publicationReferenceReviewWindow(this.workspace,candidate,options);}
 async saveNative(candidate,decisions,{signal}={}){
  signal?.throwIfAborted();
  if(!Array.isArray(decisions)||decisions.length>32||decisions.some(decision=>!validDecision(decision))||new Set(decisions.map(decision=>decision.id)).size!==decisions.length)throw new AppError('ANALYSIS_REVIEW');
  const owned=decisions.map(decision=>({...decision}));await this.fresh(candidate,{signal});signal?.throwIfAborted();
  return this.workspace.withLock(async()=>{
   const expected=await publicationAnalysisReader(this.workspace,candidate,{signal}),state=await this.nativeState(candidate,expected,{signal}),reviewId=candidate.analysisReviewId??candidate.reviewId;
   if(!owned.length&&expected.count)throw new AppError('ANALYSIS_REVIEW');
   for(const decision of owned)if(!await expected.get(decision.id))throw new AppError('ANALYSIS_REVIEW');
   await assertPublicationDocumentStorage(this.workspace,{signal});
   const owner=publicationReviewOwner(candidate),builder=state.document?await PublicationDocumentBuilder.open(this.workspace,state.receipt.document,{owner,signal}):new PublicationDocumentBuilder(this.workspace,{owner,expectedOwner:owner,collections:{decisions:{indexes:[]}},signal});
   for(const decision of owned)await builder.upsert('decisions',decision.id,decision,{signal});
   const document=await builder.finish({header:{version:1,reviewId,fingerprint:expected.fingerprint,count:expected.count},signal}),receipt={version:2,reviewId,fingerprint:expected.fingerprint,recordedAt:new Date().toISOString(),document};
   signal?.throwIfAborted();await this.workspace.writeMetadata(this.file(reviewId),JSON.stringify(receipt));signal?.throwIfAborted();
   return {reviewed:builder.count('decisions')===expected.count,decided:builder.count('decisions'),total:expected.count,decisions:owned};
  });
 }
 async verify(candidate,{signal}={}){
  if(!nativePublicationCandidate(candidate))return this.status(candidate);
  const expected=await publicationAnalysisReader(this.workspace,candidate,{signal}),state=await this.nativeState(candidate,expected,{signal});
  if(candidate.analysisDocument)await expected.verify();
  if(state.document)await state.document.verify({signal,onItem:async(name,{key,value})=>{if(name!=='decisions'||!validDecision(value)||value.id!==key||!await expected.get(key))throw new AppError('CATALOGUE_DAMAGED');}});
  return {reviewed:state.count===expected.count,decided:state.count,total:expected.count,decisions:[]};
 }

}
