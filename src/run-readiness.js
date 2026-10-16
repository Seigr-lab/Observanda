import {projectRunRequestMatches} from './project-run-receipt-origin.js';
// Completion evidence is private metadata linked to an exact record revision.
// It summarizes existing owners and never creates a second narrative record.
import {randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {ResearchMaterials} from './research-materials.js';
import {recordRevision} from './research.js';
import {currentAttemptItems} from './web/attempt-model.js';
import {researchId} from './web/research-reference.js';
import {analysisDependencyState} from './analysis-dependencies.js';
import {intakeHash} from './intake/contract.js';
import {Reviews} from './reviews.js';
import {readReviewSummary} from './review-summaries.js';
import {receiptKinds,evidenceDigest,runEvidenceRevision,applicableReceipt,declaredReceipt,publicationReceipt,receiptEditions} from './run-receipts.js';
import {documentRevision,sameDocumentContent} from './record-document-revision.js';
import {materialRecordSummary} from './material-record-summary.js';
import {withRecordDocument} from './record-document.js';
import {RunReceiptStore} from './run-receipt-store.js';
import {attemptDocumentReadiness} from './record-attempt-document.js';
const prefix='.observanda/run-readiness/';
export class RunReadiness{
 constructor(workspace){this.workspace=workspace;this.materials=new ResearchMaterials(workspace);}
 async json(name,fallback){const raw=await this.workspace.readMetadata(prefix+name+'.json',1024*1024);if(raw===null)return fallback;try{return JSON.parse(raw);}catch{throw new AppError('CATALOGUE_DAMAGED');}}
 async target(command,{attempt=false,signal}={}){
  if(!researchId(command.recordId)||!researchId(command.workspaceId))throw new AppError('INTAKE_INVALID');
  signal?.throwIfAborted();
  if(await this.workspace.storageKind()==='catalogue')return this.workspace.catalogue(async store=>{
   const snapshot=await store.snapshot();if(snapshot.metadata.id!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
   const row=await store.member(snapshot,command.recordId);if(!row)throw new AppError('MATERIAL_INVALID');
   const summary=await materialRecordSummary(store,row),record={id:row.id};
   if(attempt)record.unresolvedCriteria=await withRecordDocument(store,row.id,row.revision,document=>attemptDocumentReadiness(document,{signal}));
   return {record,revision:summary.revision,projectId:snapshot.metadata.notebooks.find(n=>n.id===row.notebookId)?.projectId};
  });
  const book=await this.materials.owner(command.recordId);if(book.id!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
  const record=book.entries[0],revision=recordRevision(record),projectId=book.notebooks.find(n=>n.id===record.notebookId)?.projectId;
  return {book,record,revision,projectId};
 }
 receiptStore(recordId){return new RunReceiptStore(this.workspace,recordId);}
 async receiptPage(recordId,options){return this.receiptStore(recordId).page(options);}
 async appendLocked(recordId,receipt){return this.receiptStore(recordId).appendLocked(receipt);}
 async link(command){return this.workspace.withLock(async()=>{
  const {record,revision}=await this.target(command);
  if(!researchId(command.id)||!receiptKinds.includes(command.kind))throw new AppError('INTAKE_INVALID');
  const prior=await this.receiptStore(record.id).getLocked(command.id),request=intakeHash(command);
  if(prior){if(!await projectRunRequestMatches(this.workspace,command,prior))throw new AppError('INTAKE_CHANGED');return prior;}
  if(command.expectedRevision!==revision)throw new AppError('RECORD_CHANGED');
  await this.materials.index.ensureLocked();const evidenceRevision=await runEvidenceRevision(this.workspace,record.id);
  if(command.expectedEvidenceRevision!==undefined&&command.expectedEvidenceRevision!==evidenceRevision)throw new AppError('INTAKE_CHANGED');
  const receipt={id:command.id,kind:command.kind,recordRevision:revision,evidenceRevision,request,recordedAt:new Date().toISOString()};
  if(command.kind==='publication'){
   receipt.publication=await publicationReceipt(this.workspace,command,record.id,revision);
  }else Object.assign(receipt,declaredReceipt(command));
  await this.materials.retainCurrentRecordLocked(record.id);return this.appendLocked(record.id,receipt);
 });}
 async editions(command,options){return this.materials.readSnapshot(async()=>{const {record,revision}=await this.target(command,options);if(command.expectedRevision!==revision)throw new AppError('RECORD_CHANGED');return receiptEditions(this.workspace,command,record.id,revision,options);});}
 async policy(projectId){if(!researchId(projectId))throw new AppError('INTAKE_INVALID');return this.json('projects/'+projectId,{version:1,required:[]});}
 async setPolicy(command){return this.workspace.withLock(async()=>{
  const {projectId}=await this.target(command),current=await this.policy(projectId);
  if(command.expectedProjectId!==undefined&&command.expectedProjectId!==projectId)throw new AppError('RECORD_CHANGED');
  if(command.expectedPolicy!==intakeHash(current))throw new AppError('CONFLICT');
  if(!Array.isArray(command.required)||new Set(command.required).size!==command.required.length||command.required.some(k=>!receiptKinds.includes(k)))throw new AppError('INTAKE_INVALID');
  const value={version:1,required:command.required};await this.workspace.writeMetadata(prefix+'projects/'+projectId+'.json',JSON.stringify(value));return {...value,etag:intakeHash(value)};
 });}
 async view(command,{signal}={}){
  await this.materials.index.ensure();await this.target(command,{signal});await this.receiptStore(command.recordId).ensure();
  return this.workspace.catalogue(async()=>{
   const {record,revision,projectId}=await this.target(command,{attempt:true,signal}),receiptStore=this.receiptStore(record.id),receiptPage=await receiptStore.page({cursor:command.receiptCursor??null,signal}),policy=await this.policy(projectId);
   const completion=await this.json('completed/'+record.id,null),basis=completion?.revision===revision?completion.basis:revision;
   const digest=evidenceDigest(),counts={artifacts:0,analyses:0,staleAnalyses:0,pendingReviews:0,changedReviews:0},issues=[];let cursor=null;
   do{
    signal?.throwIfAborted();const page=await this.materials.list({recordId:record.id,cursor,limit:20,signal});cursor=page.next;
    const sources=[];for(const item of page.items){digest.add(item);if(item.kind==='artifact')counts.artifacts++;if(item.kind==='analysis'){counts.analyses++;sources.push({recordId:record.id,label:item.title,analysis:{kind:item.kind,id:item.id,revision:item.revision}});}}
    const state=await analysisDependencyState(this.materials,sources,{signal});counts.staleAnalyses+=state.items.length;for(const item of state.items)if(issues.length<100)issues.push({kind:'stale-analysis',id:item.analysis.id,label:item.label});
   }while(cursor);
   const preparation=record.attempt?.preparations.at(-1),assessments=currentAttemptItems(record.attempt?.assessments??[]);
   const unresolved=record.unresolvedCriteria??(preparation?.criteria??[]).filter(c=>!assessments.some(a=>a.preparationId===preparation.id&&a.criterionId===c.id&&['met','not-met'].includes(a.outcome)));
   const reviews=new Reviews(this.workspace),index=await reviews.index();
   for(const id of index.ids){
    signal?.throwIfAborted();const summary=await readReviewSummary(this.workspace,id,key=>reviews.packet(key),{cache:false});
    if(summary.direction!=='outgoing')continue;
    const selected=summary.records.find(r=>r.id===record.id);if(!selected)continue;
    if(selected.revision!==basis&&selected.revision!==revision){counts.changedReviews++;continue;}
    if(!summary.decisions.some(d=>d.id===record.id&&['reviewed','witnessed'].includes(d.decision)))counts.pendingReviews++;
   }
   const evidenceRevision=digest.finish(),valid=await receiptStore.matching(policy.required,[basis,revision],evidenceRevision,{signal}),missing=policy.required.filter(k=>!valid.has(k));
   const {metadata}=await this.workspace.outline();
   return {version:1,recordId:record.id,revision,evidenceRevision,projectId,websites:[{id:null,name:metadata.website.title||metadata.title},...(metadata.websites??[]).map(({id,name})=>({id,name}))],policy:{...policy,etag:intakeHash(policy)},missing,counts,unresolved:unresolved.map(c=>({id:c.id,label:c.label})),issues,receiptPage:{next:receiptPage.next,total:receiptPage.total},receipts:receiptPage.items.map(r=>({...r,current:applicableReceipt(r,[basis,revision],evidenceRevision),evidenceChanged:r.evidenceRevision!==evidenceRevision}))};
  });
 }
 // Invoked by the shared record commit, so GUI/API/import cannot bypass policy.
 async documentCompletion(previous,document,header,metadata,{persist=true}={}){
  if(header.status!=='completed')return;
  const projectId=metadata.notebooks.find(n=>n.id===header.notebookId)?.projectId,policy=await this.policy(projectId);if(!policy.required.length)return;
  if(!previous||!await sameDocumentContent(previous,document,{omit:['status','updatedAt']}))throw new AppError('INTAKE_COMPLETION');
  if((await previous.field(['status'])).value==='completed')return;
  await this.materials.index.ensureLocked();const basis=await documentRevision(previous),evidenceRevision=await runEvidenceRevision(this.workspace,header.id),valid=await this.receiptStore(header.id).matchingLocked(policy.required,[basis],evidenceRevision);
  if(policy.required.some(kind=>!valid.has(kind)))throw new AppError('INTAKE_COMPLETION');
  if(persist)await this.workspace.writeMetadata(prefix+'completed/'+header.id+'.json',JSON.stringify({id:randomUUID(),basis,revision:await documentRevision(document),at:new Date().toISOString()}));
 }
 async completion(previous,record,metadata,{persist=true}={}){
  if(record.status!=='completed')return;
  const projectId=metadata.notebooks.find(n=>n.id===record.notebookId)?.projectId,policy=await this.policy(projectId);if(!policy.required.length)return;
  const withoutStatus=r=>{if(!r)return null;const {status,updatedAt,...rest}=r;void status;void updatedAt;return rest;};
  if(previous?.status==='completed'&&intakeHash(withoutStatus(previous))===intakeHash(withoutStatus(record)))return;
  // Completion is its own action after saving the work which receipts describe.
  if(!previous||intakeHash(withoutStatus(previous))!==intakeHash(withoutStatus(record)))throw new AppError('INTAKE_COMPLETION');
  await this.materials.index.ensureLocked();const basis=recordRevision(previous),evidenceRevision=await runEvidenceRevision(this.workspace,record.id),valid=await this.receiptStore(record.id).matchingLocked(policy.required,[basis],evidenceRevision);
  if(policy.required.some(kind=>!valid.has(kind)))throw new AppError('INTAKE_COMPLETION');
  if(persist)await this.workspace.writeMetadata(prefix+'completed/'+record.id+'.json',JSON.stringify({id:randomUUID(),basis,revision:recordRevision(record),at:new Date().toISOString()}));
 }
}
