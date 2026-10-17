import {readRecordOwnerMetadata,readRecordOwnerAuditMetadata} from './record-owner-audit-metadata.js';
// Corrections change current association discovery, never immutable evidence.
// Reviewed commands, old heads and reasons are retained with the same workspace
// transaction as the replacement association and discovery indexes.
import {randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {digest} from './storage-format.js';
import {revisionText,revisionId} from './web/revision-model.js';
import {validMaterialReference} from './web/material-reference.js';
import {researchId} from './web/research-reference.js';
import {validEvidencePath,evidencePurposes} from './web/evidence-files.js';
import {MetadataFeed} from './metadata-feed.js';
import {materialHeadVisible} from './material-visibility.js';
import {associateOriginalLocked} from './evidence-associations.js';
const root='.observanda/materials/corrections';
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const ref=v=>exact(v,['kind','id','revision',...(v?.workspaceId===undefined?[]:['workspaceId'])])&&v.kind==='artifact'&&validMaterialReference(v);
const text=(v,max,required=false)=>typeof v==='string'&&v.length<=max&&(!required||v.trim())&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(v);
const fingerprint=value=>digest(revisionText(value));
const reference=head=>head?{kind:head.kind,id:head.id,revision:head.revision}:null;
const fail=(code='EVIDENCE_CORRECTION_INVALID')=>{throw new AppError(code);};
export class EvidenceCorrections{
 constructor(materials){this.materials=materials;this.workspace=materials.workspace;}
 feed(recordId){return new MetadataFeed(this.workspace,root+'/records/'+recordId);}
 async json(file){const raw=await readRecordOwnerMetadata(this.workspace,file,64*1024);if(raw===null)return null;try{return JSON.parse(raw);}catch{fail('CATALOGUE_DAMAGED');}}
 async state(id){const state=await this.json(root+'/state/'+id+'.json');if(state&&(!exact(state,['version','lastEvent','retired'])||state.version!==1||!researchId(state.lastEvent)||state.retired!==null&&!ref(state.retired)))fail('CATALOGUE_DAMAGED');return state;}
 async isRetired(id){return Boolean((await this.state(id))?.retired);}
 validate(command){
  if(!exact(command,['recordId','ref','action','reason','metadata','replacementRecordId'])||!researchId(command.recordId)||!ref(command.ref)||!['metadata','retire','reassign','restore'].includes(command.action)||!text(command.reason,2000,true))fail();
  const m=command.metadata;
  if(command.action==='metadata'){
   if(!exact(m,['title','provenance','sourcePath','sourcePurpose'])||!text(m.title,300,true)||!text(m.provenance,10000)||m.sourcePath!==''&&!validEvidencePath(m.sourcePath)||m.sourcePurpose!==''&&!evidencePurposes.includes(m.sourcePurpose))fail();
  }else if(m!==null)fail();
  if(command.action==='reassign'){if(!researchId(command.replacementRecordId)||command.replacementRecordId===command.recordId)fail();}
  else if(command.replacementRecordId!==null)fail();
 }
 async plan(command){
  if(await this.workspace.storageKind()!=='catalogue')fail('FORMAT');
  this.validate(command);await this.materials.assertOwner(command.recordId);
  const doc=await this.materials.read(command.ref);if(doc.recordId!==command.recordId)fail();
  if(command.metadata?.sourcePath&&command.metadata.sourcePath.split('/').at(-1)!==doc.content.name)fail();
  const current=await this.materials.current(doc.id),state=await this.state(doc.id);
  if(command.action==='restore'){
   if(current||!state?.retired||fingerprint(reference(state.retired))!==fingerprint(reference(command.ref)))fail('MATERIAL_CHANGED');
  }else if(!current||current.revision!==command.ref.revision||state?.retired)fail('MATERIAL_CHANGED');
  let replacement=null;
  if(command.replacementRecordId){const owner=await this.materials.recordSummary(command.replacementRecordId);replacement={id:command.replacementRecordId,title:owner.title};}
  const review=fingerprint({command,previous:state?.lastEvent??null});
  return {review,command:structuredClone(command),title:doc.title,recordId:doc.recordId,file:{name:doc.content.name,size:doc.content.size,sha256:doc.content.sha256},replacement,previousEvent:state?.lastEvent??null};
 }
 preview(command){command=structuredClone(command);return this.materials.readSnapshot(()=>this.plan(command));}
 apply({command,review}={}){
  this.validate(command);if(!revisionId(review))fail();command=structuredClone(command);
  return this.workspace.withLock(async()=>{
   const receiptFile=root+'/receipts/'+review+'.json',receipt=await this.json(receiptFile);
   if(receipt){const event=await this.event(receipt.id);if(event.review!==review||fingerprint(event.command)!==fingerprint(command))fail('MATERIAL_CHANGED');return event;}
   const plan=await this.plan(command);if(plan.review!==review)fail('MATERIAL_CHANGED');
   const doc=await this.materials.read(command.ref),before=await this.materials.current(doc.id);await this.materials.index.ensureLocked();
   let after=before,replacement=null;
   if(command.action==='metadata'){
    const {title,provenance,sourcePath,sourcePurpose}=command.metadata,content={...doc.content,provenance};
    if(sourcePath&&sourcePath.split('/').at(-1)!==content.name)fail();
    for(const [key,value] of Object.entries({sourcePath,sourcePurpose})){if(value)content[key]=value;else delete content[key];}
    const result=await this.materials.commit({kind:'artifact',id:doc.id,recordId:doc.recordId,title,content,expectedRevision:command.ref.revision});after=await this.materials.current(result.id);
   }else if(command.action==='restore'){
    const previous=await this.event(plan.previousEvent);after=previous.before;
    if(await readRecordOwnerAuditMetadata(this.workspace,root+'/events/'+previous.id+'.json',{recordId:doc.recordId})){const {stagedBatch,ownerTransfer,...plain}=after;void stagedBatch;void ownerTransfer;after=plain;}
    if(!after||fingerprint(reference(after))!==fingerprint(reference(command.ref)))fail('CATALOGUE_DAMAGED');
    await this.materials.put(this.materials.metadataFile('objects/'+doc.id+'/head.json'),after);await this.materials.index.changed(after,doc);
   }else{
    if(command.action==='reassign')replacement=await associateOriginalLocked(this.materials,{recordId:command.replacementRecordId,ref:command.ref});
    await this.materials.index.removeHead(before);await this.workspace.removeMetadata(this.materials.relative(this.materials.metadataFile('objects/'+doc.id+'/head.json')));after=null;
   }
   const event={version:1,id:randomUUID(),createdAt:new Date().toISOString(),review,command,before,after,replacement,previousEvent:plan.previousEvent};
   await this.workspace.writeMetadata(root+'/events/'+event.id+'.json',JSON.stringify(event));
   await this.workspace.writeMetadata(receiptFile,JSON.stringify({id:event.id}));
   await this.workspace.writeMetadata(root+'/state/'+doc.id+'.json',JSON.stringify({version:1,lastEvent:event.id,retired:after?null:command.ref}));
   const feed=this.feed(doc.recordId);await feed.ensureLocked();await this.workspace.writeMetadata(feed.source+'/'+event.id+'.json',JSON.stringify({id:event.id,createdAt:event.createdAt,action:command.action,title:doc.title,ref:command.ref}));await feed.putLocked(event);
   return event;
  });
 }
 async event(id){
  if(!researchId(id))fail();const event=await this.json(root+'/events/'+id+'.json');
  try{
   if(!exact(event,['version','id','createdAt','review','command','before','after','replacement','previousEvent'])||event.id!==id||event.version!==1||!revisionId(event.review)||!Number.isFinite(Date.parse(event.createdAt))||new Date(event.createdAt).toISOString()!==event.createdAt||event.previousEvent!==null&&!researchId(event.previousEvent))throw Error();
   this.validate(event.command);
   const {action,ref:source,recordId}=event.command;
   for(const head of [event.before,event.after].filter(Boolean))if(!ref(reference(head))||head.id!==source.id||head.recordId!==recordId)throw Error();
   if(action==='restore'){
    if(event.before!==null||fingerprint(reference(event.after))!==fingerprint(reference(source))||!event.previousEvent)throw Error();
   }else if(fingerprint(reference(event.before))!==fingerprint(reference(source)))throw Error();
   if(action==='metadata'){if(!event.after||event.after.revision===source.revision)throw Error();}
   else if(action!=='restore'&&event.after!==null)throw Error();
   if(action==='reassign'){if(!ref(event.replacement))throw Error();}else if(event.replacement!==null)throw Error();
   if(fingerprint({command:event.command,previous:event.previousEvent})!==event.review)throw Error();
  }catch{fail('CATALOGUE_DAMAGED');}
  return event;
 }
 async status(source){if(!ref(source))fail();return this.materials.readSnapshot(async()=>{const doc=await this.materials.read(source),state=await this.state(source.id),current=await this.materials.current(source.id);return {recordId:doc.recordId,current:reference(current),retired:state?.retired??null,lastEvent:state?.lastEvent??null};});}
 async history({recordId,cursor=null,limit=20}){
  await this.materials.assertOwner(recordId);const feed=this.feed(recordId),page=await feed.page({cursor,limit});
  const items=[];for(const pointer of page.items){const event=await this.event(pointer.id);if(event.command.recordId!==recordId)fail('CATALOGUE_DAMAGED');items.push({id:event.id,createdAt:event.createdAt,action:event.command.action,reason:event.command.reason,ref:event.command.ref,title:(await this.materials.read(event.command.ref)).title,replacement:event.replacement});}
  return {items,next:page.next};
 }
 async verify(check){
  for await(const name of this.workspace.metadataNames(root+'/events')){
   if(!/^[a-f0-9-]{36}\.json$/.test(name))fail('CATALOGUE_DAMAGED');const event=await this.event(name.slice(0,-5));
   const receipt=await this.json(root+'/receipts/'+event.review+'.json');if(receipt?.id!==event.id)fail('CATALOGUE_DAMAGED');
   const source=await this.materials.read(event.command.ref);if(source.recordId!==event.command.recordId)fail('CATALOGUE_DAMAGED');
   if(event.previousEvent){const previous=await this.event(event.previousEvent);if(previous.command.ref.id!==source.id||previous.id===event.id)fail('CATALOGUE_DAMAGED');}
   for(const head of [event.before,event.after].filter(Boolean)){
    const doc=await this.materials.read(head),expected={...reference(head),recordId:doc.recordId,title:doc.title,createdAt:doc.createdAt,...this.materials.referenceSet(doc.content),figureHash:null,figureId:null,...(head.stagedBatch===undefined?{}:{stagedBatch:head.stagedBatch}),...(head.ownerTransfer===undefined?{}:{ownerTransfer:head.ownerTransfer})};
    if(!await materialHeadVisible(this.workspace,head))fail('CATALOGUE_DAMAGED');
    if(fingerprint(head)!==fingerprint(expected))fail('CATALOGUE_DAMAGED');
   }
   if(event.replacement&&(await this.materials.read(event.replacement)).recordId!==event.command.replacementRecordId)fail('CATALOGUE_DAMAGED');
   for(const value of [event.command.ref,reference(event.before),reference(event.after),event.replacement].filter(Boolean))await check(value);
   const feed=this.feed(event.command.recordId),pointer=await this.json(feed.order+'/'+feed.key(event));if(pointer?.id!==event.id||pointer.createdAt!==event.createdAt)fail('CATALOGUE_DAMAGED');
  }
  for await(const name of this.workspace.metadataNames(root+'/state')){
   const id=name.slice(0,-5);if(!researchId(id)||!name.endsWith('.json'))fail('CATALOGUE_DAMAGED');const state=await this.state(id),event=await this.event(state.lastEvent);
   if(event.command.ref.id!==id||fingerprint(state.retired)!==fingerprint(event.after?null:event.command.ref)||state.retired&&await this.materials.current(id))fail('CATALOGUE_DAMAGED');
  }
 }
}
