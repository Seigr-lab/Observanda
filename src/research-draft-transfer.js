import {inspectTransferredDraft} from './record-draft-inspection.js';
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {ResearchDrafts} from './research-drafts.js';
import {RecordDraftChunks} from './record-draft-chunks.js';
import {researchDraftBase} from './research-draft-base.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {RECORD_DRAFT_CHUNK_BYTES as SIZE} from './web/record-draft-protocol.js';
import {retainDraftDocument} from './record-draft-document.js';
const exact=(v,fields)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===fields.length&&fields.every(k=>Object.hasOwn(v,k));
const revision=v=>v===null||revisionId(v);
const requireValue=v=>{if(!v)throw new AppError('INVALID');};
const file=id=>'.observanda/record-draft-transfers/'+id+'.json';

export class ResearchDraftTransfer{
 constructor(workspace){this.workspace=workspace;this.drafts=new ResearchDrafts(workspace);}
 async owner(workspaceId){if((await this.workspace.outline()).metadata.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');}
 async manifest(id){
  const raw=await this.workspace.readMetadata(file(id),8192);if(raw===null)return null;
  let value;try{value=JSON.parse(raw);}catch{throw new AppError('FORMAT');}
  if(!exact(value,['id','workspaceId','expectedRevision','content','receipt'])||value.id!==id||!researchId(value.workspaceId)||!revision(value.expectedRevision)||!new RecordDraftChunks(this.workspace,id).valid(value.content,{complete:false})||value.receipt!==null&&(!revisionId(value.receipt.revision)||typeof value.receipt.updatedAt!=='string'))throw new AppError('FORMAT');return value;
 }
 async current(id){return this.drafts.read(id,{expand:false,header:true});}
 async receipt(manifest){
  if((await this.current(manifest.id))?.revision!==manifest.receipt.revision)throw new AppError('DRAFT_CHANGED');return manifest.receipt;
 }
 async start(command){
  requireValue(exact(command,['id','workspaceId','expectedRevision','bytes','sha256'])&&researchId(command.id)&&researchId(command.workspaceId)&&revision(command.expectedRevision)&&Number.isSafeInteger(command.bytes)&&command.bytes>0&&revisionId(command.sha256));
  return this.workspace.withLock(async()=>{
   await this.owner(command.workspaceId);const previous=await this.manifest(command.id);
   const matching=previous&&previous.workspaceId===command.workspaceId&&previous.expectedRevision===command.expectedRevision&&previous.content.bytes===command.bytes&&previous.content.sha256===command.sha256;
   if(matching&&previous.receipt)return this.receipt(previous);
   const current=await this.current(command.id);if((current?.revision??null)!==command.expectedRevision)throw new AppError('DRAFT_CHANGED');
   if(matching)return {revision:null,receivedChunks:previous.content.root?.count??0};
   await this.workspace.writeMetadata(file(command.id),serialize({id:command.id,workspaceId:command.workspaceId,expectedRevision:command.expectedRevision,content:{bytes:command.bytes,sha256:command.sha256,root:null},receipt:null}));
   if(previous)await new RecordDraftChunks(this.workspace,command.id).release(previous.content.root,[current?.draft.content?.root??null]);return {revision:null,receivedChunks:0};
  });
 }
 async part(command){
  requireValue(exact(command,['id','workspaceId','transferHash','index','bytes','sha256'])&&researchId(command.id)&&researchId(command.workspaceId)&&revisionId(command.transferHash)&&Number.isSafeInteger(command.index)&&command.index>=0&&typeof command.bytes==='string'&&command.bytes.length<=Math.ceil(SIZE/3)*4&&revisionId(command.sha256));
  const bytes=Buffer.from(command.bytes,'base64');requireValue(bytes.toString('base64')===command.bytes&&digest(bytes)===command.sha256);
  return this.workspace.withLock(async()=>{
   await this.owner(command.workspaceId);const manifest=await this.manifest(command.id);
   if(!manifest||manifest.workspaceId!==command.workspaceId||manifest.content.sha256!==command.transferHash)throw new AppError('DRAFT_CHANGED');
   if(manifest.receipt)return this.receipt(manifest);
   const current=await this.current(command.id);if((current?.revision??null)!==manifest.expectedRevision)throw new AppError('DRAFT_CHANGED');
   const chunks=new RecordDraftChunks(this.workspace,command.id),content=await chunks.add(manifest.content,command.index,bytes);await this.workspace.writeMetadata(file(command.id),serialize({...manifest,content}));
   await chunks.release(manifest.content.root,[content.root,current?.draft.content?.root??null]);return {index:command.index};
  });
 }
 async #inspectFinish(command,{signal}={}){
  signal?.throwIfAborted();await this.owner(command.workspaceId);const manifest=await this.manifest(command.id);
  if(!manifest||manifest.workspaceId!==command.workspaceId||manifest.content.sha256!==command.transferHash)throw new AppError('DRAFT_CHANGED');
  if(manifest.receipt)return {receipt:await this.receipt(manifest)};
  requireValue(new RecordDraftChunks(this.workspace,command.id).valid(manifest.content));
  const prior=await this.current(command.id);if((prior?.revision??null)!==manifest.expectedRevision)throw new AppError('DRAFT_CHANGED');
  const {base,title,notebookId}=await inspectTransferredDraft(this.workspace,command.id,manifest.content,{signal,ownership:true});
  await researchDraftBase(this.workspace,command.workspaceId,{record:{id:base.recordId},baseRevision:base.revision,expectedRevision:base.revision},{read:false});
  signal?.throwIfAborted();return {manifest,base,title,notebookId};
 }
 async #commitFinish(command,inspected,{signal}={}){
  signal?.throwIfAborted();await this.owner(command.workspaceId);const manifest=await this.manifest(command.id);
  // Read-snapshot validation cannot authorize a replacement transfer or a draft
  // changed meanwhile. An identical concurrent finish returns its exact receipt.
  if(!manifest||manifest.workspaceId!==command.workspaceId||manifest.content.sha256!==command.transferHash||manifest.expectedRevision!==inspected.manifest.expectedRevision||serialize(manifest.content)!==serialize(inspected.manifest.content))throw new AppError('DRAFT_CHANGED');
  if(manifest.receipt)return this.receipt(manifest);
  const {base,title}=inspected,indexed=await this.workspace.storageKind()==='catalogue';
  if(indexed)await this.drafts.index.ensureLocked(command.workspaceId);
  const prior=await this.current(command.id);if((prior?.revision??null)!==manifest.expectedRevision)throw new AppError('DRAFT_CHANGED');
  // History may have been removed after inspection; do not publish an
  // unrecoverable checkpoint even when its transferred bytes are still valid.
  await researchDraftBase(this.workspace,command.workspaceId,{record:{id:base.recordId},baseRevision:base.revision,expectedRevision:base.revision},{read:false});
  signal?.throwIfAborted();
  const document=indexed?await retainDraftDocument(this.workspace,command.id,manifest.content,inspected,{signal}):null;
  const draft={formatVersion:document?4:3,id:command.id,workspaceId:command.workspaceId,updatedAt:new Date().toISOString(),count:1,titles:[title],base,content:manifest.content,...(document?{document}:{})};
  const raw=serialize(draft),receipt={revision:digest(raw),updatedAt:draft.updatedAt};
  await this.workspace.writeMetadata('.observanda/drafts/'+command.id+'.json',raw);
  if(indexed){if(prior)await this.drafts.index.removeLocked(prior.draft);await this.drafts.index.putLocked({draft,revision:receipt.revision},digest(serialize({text:raw})));}
  await this.workspace.writeMetadata(file(command.id),serialize({...manifest,receipt}));
  await new RecordDraftChunks(this.workspace,command.id).release(prior?.draft.content?.root??null,[manifest.content.root]);signal?.throwIfAborted();return receipt;
 }
 async finish(command,{signal}={}){
  requireValue(exact(command,['id','workspaceId','transferHash'])&&researchId(command.id)&&researchId(command.workspaceId)&&revisionId(command.transferHash));
  if(await this.workspace.storageKind()!=='catalogue'){
   // Legacy files have no read snapshot: retain their existing single-writer
   // protection while inspecting bytes that another writer could otherwise GC.
   return this.workspace.withLock(async()=>{const inspected=await this.#inspectFinish(command,{signal});return inspected.receipt??this.#commitFinish(command,inspected,{signal});});
  }
  const inspected=await this.workspace.catalogue(()=>this.#inspectFinish(command,{signal}));
  if(inspected.receipt)return inspected.receipt;
  return this.workspace.withLock(()=>this.#commitFinish(command,inspected,{signal}));
 }
 async readPart(command){
  requireValue(exact(command,['id','workspaceId','expectedRevision','index'])&&researchId(command.id)&&researchId(command.workspaceId)&&revisionId(command.expectedRevision)&&Number.isSafeInteger(command.index)&&command.index>=0);
  return this.workspace.catalogue(async()=>{
   await this.owner(command.workspaceId);const result=await this.current(command.id);
   if(result?.revision!==command.expectedRevision)throw new AppError('DRAFT_CHANGED');
   requireValue([3,4].includes(result.draft.formatVersion));const bytes=await new RecordDraftChunks(this.workspace,command.id).part(result.draft.content,command.index);return {bytes:bytes.toString('base64'),sha256:digest(bytes)};
  });
 }
 async readBase(command){
  requireValue(exact(command,['id','workspaceId','expectedRevision'])&&researchId(command.id)&&researchId(command.workspaceId)&&revisionId(command.expectedRevision));
  return this.workspace.catalogue(async()=>{
   await this.owner(command.workspaceId);const result=await this.current(command.id);
   if(result?.revision!==command.expectedRevision)throw new AppError('DRAFT_CHANGED');requireValue([3,4].includes(result.draft.formatVersion));
   const base=result.draft.base;return {base:await researchDraftBase(this.workspace,command.workspaceId,{record:{id:base.recordId},baseRevision:base.revision,expectedRevision:base.revision})};
  });
 }
}
