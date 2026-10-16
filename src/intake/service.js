import {projectIntakeTarget} from '../project-intake-origin.js';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {AppError} from '../errors.js';
import {ResearchMaterials} from '../research-materials.js';
import {ResearchRecords} from '../research.js';
import {MetadataFeed} from '../metadata-feed.js';
import {withWorkspaceMetadataBatch} from '../metadata-batch.js';
import {jobSummary} from '../jobs.js';
import {researchId} from '../web/research-reference.js';
import {revisionId} from '../web/revision-model.js';
import {validateRecordChanges} from '../model.js';
import {SnapshotIndex} from '../snapshot-index.js';
import {recordReplacementBase,validateReplacementAttempt,replacementCompletion} from '../record-replacement-bases.js';
import {validateFigureSources} from '../figure-provenance.js';
import {validateResultSources} from '../result-statements.js';
import {analysisMethodReferences} from '../web/analysis-model.js';
import {RunReadiness} from '../run-readiness.js';
import {runEvidenceRevision} from '../run-receipts.js';
import {MediaStore} from '../media.js';
import {intakeHash,intakePreview,validateIntake} from './contract.js';
import {inspectIntake} from './source.js';
const prefix='.observanda/intake/';
export class LocalIntake{
 constructor(workspace,queue){this.workspace=workspace;this.queue=queue;this.materials=new ResearchMaterials(workspace);}
 async preparedContent(proposal,prepared){const {intakePreparedContent}=await import('../project-intake-content.js');return intakePreparedContent(this.workspace,proposal,prepared);}
 records(){return new ResearchRecords(this.workspace,new MediaStore(this.workspace));}
 file(id){if(!researchId(id))throw new AppError('INTAKE_INVALID');return prefix+'proposals/'+id+'.json';}
 async write(value){await this.workspace.writeMetadata(this.file(value.id),JSON.stringify(value));}
 async read(id,{optional=false}={}){
  const raw=await this.workspace.readMetadata(this.file(id),8*1024*1024);if(raw===null){if(optional)return null;throw new AppError('NOT_FOUND');}
  let value;try{value=JSON.parse(raw);validateIntake(value.manifest);}catch{throw new AppError('CATALOGUE_DAMAGED');}
  if(value.id!==id||value.version!==1||value.pin!==intakeHash(value.manifest))throw new AppError('CATALOGUE_DAMAGED');return value;
 }
 feed(recordId){if(!researchId(recordId))throw new AppError('INTAKE_INVALID');return new MetadataFeed(this.workspace,prefix+'by-record/'+recordId);}
 async executionManifest(manifest){return projectIntakeTarget(this.workspace,manifest);}
 async bind(command,{checkRevision=true,fullRecord=false}={}){
  const {workspaceId,recordId,expectedRevision}=await this.executionManifest(command);
  if(!researchId(workspaceId)||!researchId(recordId))throw new AppError('INTAKE_INVALID');
  if(!fullRecord){
   const record=await this.materials.recordSummary(recordId);if(record.workspaceId!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
   if(checkRevision&&record.revision!==expectedRevision)throw new AppError('RECORD_CHANGED');return {record,revision:record.revision};
  }
  return this.workspace.catalogue(async store=>{
   const snapshot=await store.snapshot();if(snapshot.metadata.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
   const row=await store.member(snapshot,recordId),record=await recordReplacementBase(store,row);if(!record)throw new AppError('MATERIAL_INVALID');
   if(checkRevision&&record.revision!==expectedRevision)throw new AppError('RECORD_CHANGED');
   return {book:{...snapshot.metadata,entries:[],replacementBases:new Map([[recordId,record]])},record,revision:record.revision};
  });
 }
 async validateTargets(manifest){
  manifest=await this.executionManifest(manifest);await this.materials.assertOwner(manifest.recordId,{write:true});
  const bound=await this.bind(manifest,{fullRecord:!!manifest.record});
  for(const f of manifest.files)if(await this.materials.current(f.id))throw new AppError('MATERIAL_CHANGED');
  const refs=[];
  for(const a of manifest.analyses){
   const current=await this.materials.current(a.id);
   if((current?.revision??null)!==a.expectedRevision||current&&(current.recordId!==manifest.recordId||current.kind!=='analysis'))throw new AppError('MATERIAL_CHANGED');
   refs.push(...a.inputs,...a.outputs,...(a.method?analysisMethodReferences(a.method):[]));for(const r of refs.splice(0))if(!r.file)await this.materials.checkReference(r);
  }
  if(manifest.record){
   if(manifest.record.notebookId!==bound.record.notebookId)throw new AppError('INTAKE_INVALID');
   await this.records().prepare({...bound.book,partialRecords:true},{workspaceId:manifest.workspaceId,changes:[{id:manifest.recordId,expectedRevision:manifest.expectedRevision,record:manifest.record}]});
   await this.workspace.catalogue(async store=>{
    const current=await store.indexed(await store.snapshot()),row=await store.member(current,manifest.recordId);
    if((await recordReplacementBase(store,row))?.revision!==manifest.expectedRevision)throw new AppError('RECORD_CHANGED');
    validateRecordChanges(current.metadata,[manifest.record],await new SnapshotIndex(store).validationRows(current.membership,[manifest.record]));
    await validateReplacementAttempt(store,row,manifest.record,current.metadata);
    await replacementCompletion(store,row,manifest.record,current.metadata,{persist:false});
   });
   if(manifest.record.results)await validateResultSources(this.workspace,manifest.record);
   await validateFigureSources(this.workspace,manifest.record);
  }
  return bound;
 }
 async preview({source,workspaceId,recordId,expectedPin},{signal,progress}={}){
  const report=await inspectIntake(source,{signal,expectedPin,progress});
  if(report.manifest.workspaceId!==workspaceId||report.manifest.recordId!==recordId)throw new AppError('INTAKE_TARGET');
  await this.validateTargets(report.manifest);return intakePreview(report.manifest,report.pin);
 }
 async stage(command,options={}){
  const {source,workspaceId,recordId,id,expectedPin}=command;
  if(!revisionId(expectedPin))throw new AppError('INTAKE_INVALID');
  const prior=await this.read(id,{optional:true});
  if(prior){const target=await this.executionManifest(prior.manifest);await this.bind(target,{checkRevision:false});if(prior.pin!==expectedPin||target.workspaceId!==workspaceId||target.recordId!==recordId)throw new AppError('INTAKE_CHANGED');return this.status({workspaceId,recordId,id});}
  const report=await inspectIntake(source,{...options,expectedPin});
  if(report.manifest.workspaceId!==workspaceId||report.manifest.recordId!==recordId||report.manifest.id!==id)throw new AppError('INTAKE_TARGET');
  const relative=path.relative(this.workspace.root,report.root);if(!relative||!relative.startsWith('..')&&!path.isAbsolute(relative))throw new AppError('INTAKE_INVALID');
  await this.queue.transaction(()=>withWorkspaceMetadataBatch(this.workspace,async()=>{
   const existing=await this.read(id,{optional:true});if(existing){if(existing.pin!==expectedPin)throw new AppError('INTAKE_CHANGED');return;}
   await this.validateTargets(report.manifest);
   const proposal={version:1,id,manifest:report.manifest,pin:report.pin,source:report.root,createdAt:new Date().toISOString(),state:'staging',stageJob:randomUUID(),applyJob:randomUUID(),prepared:[],receipt:null};
   await this.write(proposal);const feed=this.feed(recordId);await feed.putLocked(proposal);await this.workspace.writeMetadata(feed.marker,JSON.stringify({version:1}));
   await this.queue.enqueueLocked({id:proposal.stageJob,type:'intake.stage',scope:recordId,input:{id,size:report.manifest.files.reduce((n,f)=>n+f.size,0)}});
  }));return this.status({workspaceId,recordId,id});
 }
 async bound(command){
  const proposal=await this.read(command.id);
  const target=await this.executionManifest(proposal.manifest);
  if(target.workspaceId!==command.workspaceId||target.recordId!==command.recordId)throw new AppError('INTAKE_TARGET');
  await this.bind(proposal.manifest,{checkRevision:false});return proposal;
 }
 async status(command){
  return this.workspace.catalogue(async()=>{
   const p=await this.bound(command),job=await this.queue.read(p.state==='staging'?p.stageJob:p.applyJob);
   return {...intakePreview(p.manifest,p.pin),state:p.state,createdAt:p.createdAt,stagedFiles:p.prepared.length,receipt:p.receipt,job:jobSummary(job)};
  });
 }
 async list(command){
  return this.materials.readSnapshot(async()=>{
   const {revision}=await this.bind(command,{checkRevision:false}),page=await this.feed(command.recordId).page({cursor:command.cursor??null});
   return {...page,recordRevision:revision,items:await Promise.all(page.items.map(item=>this.status({...command,id:item.id})))};
  });
 }
 async apply(command){
  await this.queue.transaction(async()=>{
   const p=await this.bound(command);if(command.expectedPin!==p.pin)throw new AppError('INTAKE_CHANGED');
   if(p.receipt)return;if(p.state!=='prepared'&&p.state!=='applying')throw new AppError('INTAKE_NOT_READY');
   await this.validateTargets(p.manifest);
   p.state='applying';await this.write(p);await this.queue.enqueueLocked({id:p.applyJob,type:'intake.apply',scope:p.manifest.recordId,input:{id:p.id,size:p.manifest.files.reduce((n,f)=>n+f.size,0)}});
  });return this.status(command);
 }
 async control(command,action){
  const p=await this.bound(command);if(p.receipt)return this.status(command);
  await this.queue.control(p.state==='staging'?p.stageJob:p.applyJob,action);return this.status(command);
 }
 async commit(p){
  const manifest=await this.executionManifest(p.manifest);
  const {record}=await this.validateTargets(p.manifest),acquisition=await this.materials.retainCurrentRecordLocked(record.id),files=[];
  if(p.prepared.length!==p.manifest.files.length)throw new AppError('INTAKE_NOT_READY');
  for(const f of p.manifest.files){
   const prepared=p.prepared.find(v=>v.id===f.id);if(!prepared||prepared.sha256!==f.sha256||prepared.size!==f.size)throw new AppError('CATALOGUE_DAMAGED');
   files.push(await this.materials.commit({kind:'artifact',id:f.id,recordId:record.id,title:path.posix.basename(f.path),content:{name:path.posix.basename(f.path),size:f.size,sha256:f.sha256,storageId:prepared.storageId,provenance:f.provenance,acquisition,inputs:[]}}));
  }
  const resolve=r=>r.file?files.find(f=>f.id===r.file):r,analyses=[];
  for(const a of p.manifest.analyses){const {toolSha256,...command}=a;analyses.push(await this.materials.analysisLocked({...command,recordId:record.id,inputs:a.inputs.map(resolve),outputs:a.outputs.map(resolve),toolSha256}));}
  if(p.manifest.record)await this.records().saveLocked({workspaceId:manifest.workspaceId,changes:[{id:record.id,expectedRevision:p.manifest.expectedRevision,record:p.manifest.record}]},{receipt:true});
  const {revision}=await this.bind(p.manifest,{checkRevision:false}),receipt={version:1,id:p.id,pin:p.pin,workspaceId:manifest.workspaceId,recordId:record.id,priorRevision:p.manifest.expectedRevision,recordRevision:revision,source:p.manifest.source,verification:p.manifest.verification,files,analyses,committedAt:new Date().toISOString()};
  await new RunReadiness(this.workspace).appendLocked(record.id,{id:p.id,kind:'validation',recordRevision:receipt.recordRevision,evidenceRevision:await runEvidenceRevision(this.workspace,record.id),source:p.manifest.source,verification:p.manifest.verification,intakeId:p.id,pin:p.pin,recordedAt:receipt.committedAt,declared:true});
  p.receipt=receipt;p.state='completed';await this.write(p);return receipt;
 }
}
