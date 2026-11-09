import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {CheckpointIndex,validCheckpointTime} from './checkpoint-index.js';
import {exact} from './modules/validation.js';
import {ResearchMaterials} from './research-materials.js';
import {scientificEditKinds,scientificEditReferences,validScientificEdit} from './scientific-edit-state.js';
import {researchId} from './web/research-reference.js';
import {revisionId,revisionText} from './web/revision-model.js';
import {materialReferenceKey,validMaterialReference} from './web/material-reference.js';
import {MAX_RECORD_COMMAND_BYTES} from './web/research-capacity.js';
import {workspaceReferenceNamespaceMatches} from './research-reference-namespace.js';
import {DurableJobs,jobSummary} from './jobs.js';
import {LocalIntake} from './intake/service.js';
import {readRecordOwnerAuditMetadata} from './record-owner-audit-metadata.js';

const source='.observanda/scientific-edit-drafts';
const order='.observanda/scientific-edit-draft-list';
const fail=code=>{throw new AppError(code);};
const file=id=>source+'/'+id+'.json';
const receiptFile=(id,revision)=>'.observanda/scientific-edit-receipts/'+id+'/'+revision+'.json';
export const scientificEditFiles={draft:file,receipt:receiptFile};
const hash=value=>digest(serialize(value));
const intake=kind=>kind==='local-intake'||kind==='evidence-intake';
function validBase(base,kind){
 if(!scientificEditKinds.includes(kind))return false;
 if(intake(kind))return base===null;
 if(!validMaterialReference(base))return false;
 if(kind==='schema'||kind==='plot')return base.kind==='dataset';
 if(kind==='cusum'||kind==='spectrum')return ['dataset','analysis'].includes(base.kind);
 return base.kind==='analysis';
}
const label=draft=>draft.kind+':'+(draft.base?.id??draft.recordId);
const scoped=command=>researchId(command?.workspaceId)&&researchId(command.recordId);
const selected=command=>scoped(command)&&researchId(command.id)&&revisionId(command.expectedRevision);
const selectedKeys=['workspaceId','recordId','id','expectedRevision'];
const tags=['format','id','workspaceId','recordId','kind','base','recordRevision','parentRevision','value','updatedAt','discarded'];
export function validScientificEnvelope(draft,id){
 return exact(draft,tags)&&draft.format===1&&draft.id===id&&scoped(draft)&&revisionId(draft.recordRevision)&&(draft.parentRevision===null||revisionId(draft.parentRevision))&&validBase(draft.base,draft.kind)&&validCheckpointTime(draft.updatedAt)&&typeof draft.discarded==='boolean'&&(draft.discarded?draft.value===null:validScientificEdit(draft.kind,draft.value));
}
function indexed({draft,revision},sourceRevision){
 if(draft.discarded)return null;
 return {id:draft.id,workspaceId:draft.workspaceId,recordId:draft.recordId,kind:draft.kind,documentKey:label(draft),baseRevision:draft.base?.revision??draft.recordRevision,revision,sourceRevision,updatedAt:draft.updatedAt};
}
function validIndex(value){
 return scoped(value)&&researchId(value.id)&&scientificEditKinds.includes(value.kind)&&typeof value.documentKey==='string'&&revisionId(value.baseRevision)&&revisionId(value.revision)&&revisionId(value.sourceRevision)&&validCheckpointTime(value.updatedAt);
}
export class ScientificEditDrafts{
 constructor(materials,{sourceAccess,check=async()=>{},signal}={}){
  this.materials=materials;this.workspace=materials.workspace;this.sourceAccess=sourceAccess;this.check=check;this.signal=signal;
  this.index=new CheckpointIndex(this.workspace,id=>this.raw(id),{source,order,cursorKind:'scientific-edit-page',scopeOf:value=>value.recordId,summary:indexed,validSummary:validIndex});
  this.ownerIndex=new CheckpointIndex(this.workspace,id=>this.raw(id),{source,order:order+'-by-owner',cursorKind:'scientific-edit-owner-page',summary:indexed,validSummary:validIndex});
 }
 async resolveOwner(workspaceId){
  const {metadata}=await this.workspace.catalogue(store=>store.snapshot());if(metadata.id!==workspaceId)fail('WORKSPACE_CHANGED');
  const labBookId=this.workspace.labBookId??null;
  const projectId=labBookId?metadata.notebooks.find(book=>book.id===labBookId)?.projectId:this.workspace.projectId??null;
  if(labBookId&&(!researchId(projectId)||!metadata.projects.some(project=>project.id===projectId)))fail('CATALOGUE_DAMAGED');
  this.selectedOwner={workspaceId,projectId,labBookId};
 }
 async authority(command){
  if(!scoped(command))fail('INVALID');
  this.signal?.throwIfAborted();await this.check();
  await this.resolveOwner(command.workspaceId);
  const summary=await this.materials.recordSummary(command.recordId);
  if(summary.workspaceId!==command.workspaceId)fail('WORKSPACE_CHANGED');
  // Recovery content is private to the current record owner, including
  // during handover while the old record can still be read as history.
  await this.materials.assertOwner(command.recordId,{write:true});
  return summary;
 }
 async raw(id){
  if(!researchId(id))fail('INVALID');
  const text=await this.workspace.readMetadata(file(id),MAX_RECORD_COMMAND_BYTES);
  if(text===null)return null;
  let draft;try{draft=JSON.parse(text);}catch{fail('CATALOGUE_DAMAGED');}
  if(!validScientificEnvelope(draft,id))fail('CATALOGUE_DAMAGED');
  return {draft,revision:digest(text)};
 }
 async original(command){
  const found=await this.raw(command.id);
  if(found&&(found.draft.recordId!==command.recordId||found.draft.workspaceId!==command.workspaceId))fail('DRAFT_CHANGED');
  if(found){
   const sourceRevision=hash({text:serialize(found.draft)});
   await this.index.verifySelected(found,sourceRevision);
   await this.ownerIndex.verifySelected(found,sourceRevision);
  }
  return found;
 }
 async authorizePins(draft,consume){
  const {materials,workspace,signal,sourceAccess}=this;let access=null,currentBase=true;
  const read=async(target,ref,isBase)=>{
   if(ref.kind==='record')await target.checkReference(ref,{signal});
   else{
    const [summary]=(await target.describeReferences({items:[ref]})).items;
    if(!summary||summary.unavailable)fail('ACCESS_LOCKED');
   }
   if(isBase){const current=ref.kind==='record'?await target.recordSummary(ref.id):await target.current(ref.id);currentBase=current?.revision===ref.revision;}
  };
  try{
   for(const ref of scientificEditReferences(draft.base,draft.value)){
    signal?.throwIfAborted();const isBase=draft.base&&materialReferenceKey(ref)===materialReferenceKey(draft.base);
    const external=await materials.externalReference(ref);
    if(external||!await workspaceReferenceNamespaceMatches(workspace,ref)){
     if(!sourceAccess)fail('ACCESS_LOCKED');
     access??=await sourceAccess(workspace,{signal});await access.use(external??ref,(storage,canonical)=>read(new ResearchMaterials(storage),canonical,isBase));
    }else await read(materials,ref,isBase);
   }
   await access?.verify();await this.check();signal?.throwIfAborted();
   const result=await consume(currentBase);
   await access?.verify();await this.check();signal?.throwIfAborted();
   return result;
  }finally{await access?.close();}
 }
 public(summary,state='unchecked'){
  const {id,documentKey,revision,baseRevision,updatedAt,kind}=summary;
  return {surface:'science',id,owner:{...this.selectedOwner,recordId:summary.recordId},documentKey,revision,baseRevision,updatedAt,kind,state,capabilities:{recover:state==='available',compare:false,discard:true}};
 }
 async receipt(command){
  const raw=await this.workspace.readMetadata(receiptFile(command.id,command.expectedRevision),2048);
  if(raw===null)return null;
  let saved;try{saved=JSON.parse(raw);}catch{fail('CATALOGUE_DAMAGED');}
  const common=['workspaceId','recordId','id','checkpoint','intent'];
  const material=exact(saved,[...common,'ref'])&&validMaterialReference(saved.ref);
  const job=exact(saved,[...common,'jobId','jobType'])&&researchId(saved.jobId)&&['dataset.prepare','figure.calculate'].includes(saved.jobType);
  if(!(material||job)||saved.id!==command.id||saved.recordId!==command.recordId||saved.workspaceId!==command.workspaceId||saved.checkpoint!==command.expectedRevision||!revisionId(saved.intent))fail('CATALOGUE_DAMAGED');
  return saved;
 }
 async outcome({kind,value,recordId,workspaceId}){
  // Opening a recovery item reads an existing command receipt. Constructing
  // this queue never starts a worker or admits another job.
  const queue=new DurableJobs(this.workspace,{});
  if(kind==='local-intake'&&value.proposal){
   const intake=new LocalIntake(this.workspace,queue),proposal=await intake.read(value.proposal.id,{optional:true});
   if(!proposal)return null;
   const target=await intake.executionManifest(proposal.manifest);
   if(target.workspaceId!==workspaceId||target.recordId!==recordId||value.proposal.pin!==proposal.pin)fail('DRAFT_CHANGED');
   return {proposal:proposal.id};
  }
  if(kind==='evidence-intake'&&value.intent){
   const {id,...intent}=value.intent;let batch;
   try{batch=await this.materials.intakes.read(id);}catch(error){if(error.code==='NOT_FOUND')return null;throw error;}
   if(batch.command.recordId!==recordId||Object.keys(batch.command).length!==Object.keys(intent).length||Object.entries(batch.command).some(([key,entry])=>intent[key]!==entry))fail('DRAFT_CHANGED');
   return {batch:id};
  }
  return null;
 }
 async recordAdmission(checkpoint,operation,command,job){
  // The queue calls this before releasing its writer. A retained command and
  // its exact checkpoint receipt succeed or roll back together.
  if(!exact(checkpoint,selectedKeys)||!selected(checkpoint))fail('INVALID');
  await this.authority(checkpoint);
  const found=await this.original(checkpoint);
  if(!found||found.draft.discarded||found.revision!==checkpoint.expectedRevision||job.scope!==checkpoint.recordId||command.recordId!==checkpoint.recordId)fail('DRAFT_CHANGED');
  const {kind,value,base}=found.draft;
  const analysis=kind==='cusum'||kind==='spectrum';
  const intent=digest(revisionText(command));
  if(kind==='plot'?operation!=='plot':operation!=='dataset')fail('DRAFT_CHANGED');
  if(analysis){
   const intended={recordId:checkpoint.recordId,title:value.title,id:value.identity.id,expectedRevision:value.identity.expectedRevision,[kind]:value.recipe};
   if(job.id!==value.identity.jobId||intent!==digest(revisionText(intended)))fail('DRAFT_CHANGED');
  }else{
   const binding=kind==='plot'?'dataset':'baseDataset';
   if(!['schema','plot'].includes(kind)||job.id!==value.intent?.id||intent!==value.intent.key||!validMaterialReference(command[binding])||materialReferenceKey(base)!==materialReferenceKey(command[binding]))fail('DRAFT_CHANGED');
  }
  return this.authorizePins(found.draft,async current=>{
   const existing=await this.receipt(checkpoint);
   if(existing){if(existing.intent!==intent||existing.jobId!==job.id||existing.jobType!==job.type)fail('DRAFT_CHANGED');return;}
   if(!current)fail('MATERIAL_CHANGED');
   await this.workspace.writeMetadata(receiptFile(checkpoint.id,found.revision),serialize({id:checkpoint.id,workspaceId:checkpoint.workspaceId,recordId:checkpoint.recordId,checkpoint:found.revision,intent,jobId:job.id,jobType:job.type}));
  });
 }
 async retainedOutcome(checkpoint,found,receipt){
  const summary=this.public(indexed(found,null),'retained');
  if(receipt.ref){
   await this.materials.checkReference(receipt.ref);return {summary,result:receipt.ref};
  }
  const queue=new DurableJobs(this.workspace,{});
  let job=await queue.read(receipt.jobId),archived=false;
  if(!job){
   const origin=await readRecordOwnerAuditMetadata(this.workspace,queue.file(receipt.jobId),{recordId:checkpoint.recordId});
   if(origin){
    try{job=JSON.parse(origin.text);}catch{fail('CATALOGUE_DAMAGED');}
    if(!['completed','failed','cancelled'].includes(job?.state))fail('CATALOGUE_DAMAGED');
    archived=true;
   }
  }
  if(!job||job.scope!==checkpoint.recordId||job.type!==receipt.jobType||job.state==='relocated')fail('DRAFT_CHANGED');
  if(job.result)await this.materials.checkReference(job.result);
  return {summary,job:jobSummary(job),...(archived?{archived:true}:{})};
 }
 async retain(checkpoint,operation,data,apply){
  if(!exact(checkpoint,selectedKeys)||!selected(checkpoint))fail('INVALID');
  return this.workspace.withLock(async()=>{
   await this.authority(checkpoint);
   const found=await this.original(checkpoint),intent=digest(revisionText({operation,data}));
   if(!found||found.draft.discarded||found.revision!==checkpoint.expectedRevision)fail('DRAFT_CHANGED');
   const {draft}=found,kind=operation==='calculation-graph-change'?'graph-node':data.collection==='inputs'?'uncertainty-input':'uncertainty-covariance';
   if(draft.kind!==kind||draft.value.command!==intent||data.offset!==draft.value.index||!validMaterialReference(data.ref)||materialReferenceKey(data.ref)!==materialReferenceKey(draft.base))fail('DRAFT_CHANGED');
   return this.authorizePins(draft,async current=>{
    const receipt=await this.receipt(checkpoint);
    if(receipt){if(receipt.intent!==intent)fail('DRAFT_CHANGED');return receipt.ref;}
    if(!current)fail('MATERIAL_CHANGED');
    const original=await this.materials.read(data.ref);
    if(original.recordId!==checkpoint.recordId)fail('DRAFT_CHANGED');
    const ref=await apply();
    await this.workspace.writeMetadata(receiptFile(draft.id,found.revision),serialize({id:draft.id,workspaceId:draft.workspaceId,recordId:draft.recordId,checkpoint:found.revision,intent,ref}));
    return ref;
   });
  });
 }
 async list(command){
  if(!scoped(command)||Object.keys(command).some(key=>!['workspaceId','recordId','limit','cursor'].includes(key)))fail('INVALID');
  const {workspaceId,recordId,limit=10,cursor=null}=command;
  if(!Number.isSafeInteger(limit)||limit<1||limit>20||cursor!==null&&(typeof cursor!=='string'||!cursor.length||cursor.length>4096))fail('INVALID');
  return this.workspace.catalogue(async()=>{
   await this.authority(command);const page=await this.index.page(workspaceId,{scope:recordId,limit,cursor},{signal:this.signal});
   await this.check();return {items:page.drafts.map(item=>this.public({...item,workspaceId})),next:page.nextCursor};
  });
 }
 async browse(command){
  const {workspaceId,cursor=null,limit=10}=command??{};
  if(!researchId(workspaceId)||Object.keys(command).some(key=>!['workspaceId','limit','cursor'].includes(key))||!Number.isSafeInteger(limit)||limit<1||limit>20||cursor!==null&&(typeof cursor!=='string'||!cursor.length||cursor.length>4096))fail('INVALID');
  return this.workspace.catalogue(async()=>{
   await this.check();await this.resolveOwner(workspaceId);const page=await this.ownerIndex.page(workspaceId,{limit,cursor},{signal:this.signal}),items=[];
   for(const summary of page.drafts){
    try{await this.materials.assertOwner(summary.recordId,{write:true});}catch(error){if(['MATERIAL_INVALID','RECORD_TRANSFER_BUSY','RECORD_RELOCATED','PROJECT_RELOCATED'].includes(error.code))continue;throw error;}
    items.push(this.public({...summary,workspaceId}));
   }
   await this.check();return {items,next:page.nextCursor};
  });
 }
 async read(command){
  if(!exact(command,selectedKeys)||!selected(command))fail('INVALID');
  return this.workspace.catalogue(async()=>{
   const record=await this.authority(command),found=await this.original(command);
   if(!found||found.draft.discarded||found.revision!==command.expectedRevision)fail('DRAFT_CHANGED');
   return this.authorizePins(found.draft,async current=>{
    const receipt=await this.receipt(command);
    if(receipt)return this.retainedOutcome(command,found,receipt);
    const outcome=await this.outcome(found.draft);
    if(outcome)return {summary:this.public(indexed(found,null),'retained'),...outcome};
    const state=current&&(found.draft.base||record.revision===found.draft.recordRevision)?'available':'conflict';
    const summary=this.public(indexed(found,null),state);
    if(state==='conflict')return {summary};
    return {summary,base:found.draft.base,value:found.draft.value};
   });
  });
 }
 async store(draft,previous){
  const text=serialize(draft);if(Buffer.byteLength(text)>MAX_RECORD_COMMAND_BYTES)fail('DRAFT_SIZE_LIMIT');
  const saved={draft,revision:digest(text)};
  const indices=[this.index,this.ownerIndex];
  for(const index of indices){
   await index.ensureLocked(draft.workspaceId,{signal:this.signal});
   if(previous&&!previous.draft.discarded)await index.removeLocked(previous.draft);
  }
  await this.workspace.writeMetadata(file(draft.id),text);
  const sourceRevision=hash({text});for(const index of indices)await index.putLocked(saved,sourceRevision);return saved;
 }
 async *forTransfer(workspaceId,recordId,{signal}={}){
  let cursor=null;
  do{
   const page=await this.index.page(workspaceId,{scope:recordId,limit:20,cursor},{signal});
   for(const item of page.drafts){
    signal?.throwIfAborted();
    const found=await this.original({workspaceId,recordId,id:item.id});
    if(!found||found.revision!==item.revision||found.draft.discarded)fail('CATALOGUE_DAMAGED');
    yield found;
   }
   cursor=page.nextCursor;
  }while(cursor);
 }
 async write(command){
  if(!exact(command,[...selectedKeys,'kind','base','value'])||!scoped(command)||!researchId(command.id)||command.expectedRevision!==null&&!revisionId(command.expectedRevision)||!validBase(command.base,command.kind)||!validScientificEdit(command.kind,command.value))fail('INVALID');
  if(command.kind==='evidence-intake'&&command.value.intent&&command.value.intent.recordId!==command.recordId)fail('INVALID');
  return this.workspace.withLock(async()=>{
   const record=await this.authority(command),previous=await this.original(command);
   const {id,workspaceId,recordId,kind,base,value}=command;
   if(previous&&(previous.draft.discarded||previous.draft.kind!==kind||hash(previous.draft.base)!==hash(base)))fail('DRAFT_CHANGED');
   const draft={format:1,id,workspaceId,recordId,kind,base,recordRevision:previous?.draft.recordRevision??record.revision,parentRevision:command.expectedRevision,value,updatedAt:new Date().toISOString(),discarded:false};
   return this.authorizePins(draft,async current=>{
    if(!current||!base&&record.revision!==draft.recordRevision)fail('MATERIAL_CHANGED');
    if(previous&&[previous.revision,previous.draft.parentRevision].includes(command.expectedRevision)&&hash(value)===hash(previous.draft.value))return this.public(indexed(previous,null),'available');
    if((previous?.revision??null)!==command.expectedRevision)fail('DRAFT_CHANGED');
    return this.public(indexed(await this.store(draft,previous),null),'available');
   });
  });
 }
 async discard(command){
  if(!exact(command,selectedKeys)||!selected(command))fail('INVALID');
  return this.workspace.withLock(async()=>{
   await this.authority(command);const previous=await this.original(command);
   if(previous?.draft.discarded&&previous.draft.parentRevision===command.expectedRevision)return {discarded:true};
   if(!previous||previous.draft.discarded||previous.revision!==command.expectedRevision)fail('DRAFT_CHANGED');
   // A tombstone prevents a delayed initial checkpoint from resurrecting work
   // the user discarded. Retain the acknowledgement identity, not the content.
   await this.store({...previous.draft,value:null,updatedAt:new Date().toISOString(),parentRevision:previous.revision,discarded:true},previous);
   await this.check();return {discarded:true};
  });
 }
}
