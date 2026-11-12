import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {ObjectIndex} from './object-index.js';
import {PdfDocumentStore,validatePdfCommand} from './pdf-document-store.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {describePdfDocumentFont} from './pdf-document-fonts.js';
import {PdfDocumentImages} from './pdf-document-images.js';
import {PdfPrintProfiles} from './pdf-print-profiles.js';
import {customFontId} from './web/font-catalogue.js';

const pending='pdf-settings:pending:',body='pdf-settings:value:',discarded='pdf-settings:discarded:';
const fail=code=>{throw new AppError(code);};
const fingerprint=({id,expectedRevision,operation})=>digest(serialize({id,expectedRevision,operation}));
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
function settings(command){
 validatePdfCommand(command);
 if(command.operation.type!=='header')fail('INVALID');
}
function selected(value){
 if(!exact(value,['id','documentId','revision'])||!researchId(value.id)||!researchId(value.documentId)||!revisionId(value.revision))fail('INVALID');
}
function validRow(row,id){
 return exact(row,['id','documentId','baseRevision','revision','name','updatedAt'])&&row.id===id&&researchId(id)&&researchId(row.documentId)&&
  revisionId(row.baseRevision)&&revisionId(row.revision)&&typeof row.name==='string'&&row.name.length<=240&&typeof row.updatedAt==='string'&&Number.isFinite(Date.parse(row.updatedAt));
}

// The PDF owner's transaction keeps a pending header until its normal
// document command or an explicit discard commits. Section content never
// enters settings recovery. Listing reads only bounded, encrypted summaries.
export class PdfSettingsRecovery{
 constructor(store){this.store=store;this.documents=new PdfDocumentStore(store);}
 async summary(row,{checked=false}={}){
  if(!validRow(row,row?.id))fail('CATALOGUE_DAMAGED');
  const head=await this.documents.head(row.documentId,{removed:true});
  const state=head.removed?'missing':head.revision!==row.baseRevision?'conflict':checked?'ready':'unchecked';
  return {surface:'document',id:row.id,owner:{workspaceId:this.store.namespaceId,projectId:this.store.workspace?.projectId??null,documentId:row.documentId},
   documentKey:row.documentId,revision:row.revision,baseRevision:row.baseRevision,updatedAt:row.updatedAt,...(!head.removed?{title:row.name}:{}),
   state,capabilities:{recover:state==='ready',compare:!head.removed,discard:true}};
 }
 async readRow(reference){
  selected(reference);
  const row=await this.store.object(pending+reference.id);
  if(!row)fail('DRAFT_CHANGED');
  if(!validRow(row,reference.id))fail('CATALOGUE_DAMAGED');
  if(row.documentId!==reference.documentId||row.revision!==reference.revision)fail('DRAFT_CHANGED');
  return row;
 }
 async read(reference,signal){
  const row=await this.readRow(reference),summary=await this.summary(row,{checked:true});
  if(!summary.capabilities.compare)return {summary};
  const command=await this.store.object(body+row.id);
  if(!command)fail('CATALOGUE_DAMAGED');
  settings(command);
  if(command.id!==row.documentId||command.commandId!==row.id||command.expectedRevision!==row.baseRevision||fingerprint(command)!==row.revision)fail('CATALOGUE_DAMAGED');
  const current=await this.documents.open(row.documentId);
  const proposed=command.operation.header;
  try{
   for(const pin of proposed.fonts??[])await describePdfDocumentFont(this.store,row.documentId,pin,{signal});
   if(customFontId(proposed.layout.font)&&!(proposed.fonts??[]).some(pin=>pin.id===proposed.layout.font))fail('FONT_MISSING');
   if(proposed.printCondition?.profile)await new PdfPrintProfiles(this.store,row.documentId).descriptor(proposed.printCondition.profile);
   const artwork=proposed.press?.artwork?.image;
   if(artwork)await new PdfDocumentImages(this.store,row.documentId).descriptor(artwork.asset);
  }catch(error){
   if(!['FONT_MISSING','NOT_FOUND'].includes(error.code))throw error;
   return {summary:{...summary,state:'missing-media',capabilities:{recover:false,compare:false,discard:true}}};
  }
  return {summary,proposed,current:current.header};
 }
 async list({cursor=null,limit=15}={},signal){
  if(cursor!==null&&!researchId(cursor)||!Number.isInteger(limit)||limit<1||limit>20)fail('INVALID');
  const index=new ObjectIndex(this.store),head=await index.head(),items=[];
  for await(const entry of index.entries(head,pending,cursor?pending+cursor:null)){
   signal?.throwIfAborted();
   if(items.length===limit)return {items,next:items.at(-1).id};
   const row=await this.store.objectValue(entry.id,entry);
   if(!validRow(row,entry.id.slice(pending.length)))fail('CATALOGUE_DAMAGED');
   items.push(await this.summary(row));
  }
  return {items,next:null};
 }
 async prepare(command){
  settings(command);
  const revision=fingerprint(command),id=command.commandId,documentId=command.id;
  const receipt=await this.store.object('pdf:command:'+documentId+':'+id);
  if(receipt){
   // Confirm the immutable saved revision through the same replay check as
   // ordinary Save before acknowledging a retry whose reply was lost.
   const confirmed=await this.documents.change(command);
   return {saved:true,revision:confirmed.revision};
  }
  if(await this.store.object(discarded+id))fail('DRAFT_CHANGED');
  const prior=await this.store.object(pending+id);
  if(prior){
   if(!validRow(prior,id))fail('CATALOGUE_DAMAGED');
   if(prior.revision!==revision||prior.documentId!==documentId)fail('MODULE_REPLAY');
   return {saved:false,summary:await this.summary(prior)};
  }
  const original=await this.documents.open(documentId,{revision:command.expectedRevision});
  const row={id,documentId,revision,baseRevision:command.expectedRevision,name:original.header.name,updatedAt:new Date().toISOString()};
  await this.store.putObject(body+id,command);
  await this.store.putObject(pending+id,row);
  return {saved:false,summary:await this.summary(row)};
 }
 async discard(reference){
  selected(reference);
  const tombstone=await this.store.object(discarded+reference.id);
  if(tombstone){
   if(tombstone.documentId!==reference.documentId||tombstone.revision!==reference.revision)fail('DRAFT_CHANGED');
   return {discarded:true};
  }
  await this.readRow(reference);
  await this.store.putObject(discarded+reference.id,{documentId:reference.documentId,revision:reference.revision});
  await this.remove(reference.id);return {discarded:true};
 }
 async remove(id){
  await this.store.deleteObject(body+id);
  await this.store.deleteObject(pending+id);
 }
 async apply(command,change,{prepared}){
  settings(command);
  const revision=fingerprint(command),id=command.commandId;
  const row=await this.store.object(pending+id);
  if(!row){
   if(await this.store.object(discarded+id))fail('DRAFT_CHANGED');
   if(prepared&&!await this.store.object('pdf:command:'+command.id+':'+id))fail('DRAFT_CHANGED');
   return change();
  }
  if(!validRow(row,id))fail('CATALOGUE_DAMAGED');
  if(row.documentId!==command.id||row.revision!==revision)fail('MODULE_REPLAY');
  const result=await change();
  await this.remove(id);
  return result;
 }
}
