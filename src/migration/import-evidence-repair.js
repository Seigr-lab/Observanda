import path from 'node:path';
import {AppError} from '../errors.js';
import {recordRevision} from '../research.js';
import {importHash,mappedId,hashValue} from './import-model.js';
import {attachImportedEvidence,importedArtifactId} from './import-evidence.js';

// An explicit, bounded repair of associations in an already applied batch.
// Stored evidence bytes and authored record revisions are never rewritten.
export class ImportEvidenceRepair{
 constructor(store,materials){this.store=store;this.materials=materials;}
 async plan(command,{signal}={}){
  const batch=await this.store.bound(command);if(batch.state!=='committed')throw new AppError('IMPORT_REVIEW');
  const start={index:command.index??0,file:command.file??0};
  if(!Number.isInteger(start.index)||start.index<0||start.index>=batch.count||!Number.isInteger(start.file)||start.file<0)throw new AppError('INVALID');
  const items=[];let index=start.index,fileIndex=start.file,rows=0;
  while(index<batch.count&&rows<20&&items.length<50){
   signal?.throwIfAborted();const row=await this.store.object(batch.id,index),record=row.prepared?.sourceRecord;
   if(!row.prepared||fileIndex>row.source.files.length)throw new AppError('IMPORT_DAMAGED');
   if(row.prepared.action==='exclude'){index++;fileIndex=0;rows++;continue;}
   const available=await this.store.workspace.catalogue(async c=>!!await c.member(await c.snapshot(),record.id));
   for(;fileIndex<row.source.files.length&&items.length<50;fileIndex++){
    const file=row.source.files[fileIndex],id=importedArtifactId(batch.workspaceId,record.id,file),head=await this.materials.current(id),name=path.posix.basename(file.path);
    const original=await this.store.read('originals/'+file.sha256);
    if(original.sha256!==file.sha256||original.bytes!==file.bytes)throw new AppError('IMPORT_DAMAGED');
    const matches=doc=>doc.kind==='artifact'&&doc.recordId===record.id&&doc.content.name===name&&doc.content.size===file.bytes&&doc.content.sha256===file.sha256;
    let existing=head;
    if(head){const doc=await this.materials.read(head);if(!matches(doc)||doc.content.sourcePath!==file.path)throw new AppError('IMPORT_COLLISION');}
    if(!existing){
     const legacy=await this.materials.current(mappedId(batch.workspaceId,'import-original',file.sha256));
     if(legacy){const doc=await this.materials.read(legacy);if(matches(doc)&&(doc.content.sourcePath===file.path||doc.content.sourcePath===undefined&&doc.content.provenance===batch.source.namespace+' / '+file.path))existing=legacy;}
    }
    items.push({index,file:fileIndex,path:file.path,name,bytes:file.bytes,sha256:file.sha256,storageId:original.storageId,recordId:record.id,title:record.title,available,acquisitionRevision:recordRevision(record),artifactId:id,existing:existing?{kind:existing.kind,id:existing.id,revision:existing.revision}:null});
   }
   if(fileIndex===row.source.files.length){index++;fileIndex=0;rows++;}
  }
  const next=index<batch.count?{index,file:fileIndex}:null;
  return {workspaceId:batch.workspaceId,id:batch.id,start,items,next,missing:new Set(items.filter(i=>!i.existing&&i.available).map(i=>i.artifactId)).size,review:importHash({batch:batch.review,start,items,next})};
 }
 async apply(command,{signal,onProgress=()=>{}}={}){
  if(!hashValue(command.review))throw new AppError('IMPORT_REVIEW');
  const receiptName='evidence-repairs/'+command.id+'/'+command.review;
  await this.store.bound(command);
  const receipt=await this.store.read(receiptName,{optional:true});if(receipt)return receipt;
  const plan=await this.store.workspace.catalogue(()=>this.plan(command,{signal}));if(plan.review!==command.review)throw new AppError('IMPORT_CHANGED');
  const verified=new Set();
  for(const item of plan.items.filter(i=>!i.existing&&i.available)){
   if(verified.has(item.sha256))continue;signal?.throwIfAborted();const content=await this.store.original(item.sha256,{signal});await content.verify();verified.add(item.sha256);
   await onProgress({phase:'verifying-originals',done:verified.size,total:plan.missing});
  }
  return this.store.locked(async()=>{
   signal?.throwIfAborted();const prior=await this.store.read(receiptName,{optional:true});if(prior)return prior;
   const current=await this.plan(command,{signal});if(current.review!==command.review)throw new AppError('IMPORT_CHANGED');
   const batch=await this.store.bound(command),associations=[],attached=new Set();
   for(const item of current.items.filter(i=>!i.existing&&i.available)){
    if(attached.has(item.artifactId))continue;attached.add(item.artifactId);
    signal?.throwIfAborted();const row=await this.store.object(batch.id,item.index);
    await attachImportedEvidence(this.store,this.materials,batch,{...row,source:{...row.source,files:[row.source.files[item.file]]}});
    const {kind,id,revision}=await this.materials.current(item.artifactId);associations.push({index:item.index,file:item.file,artifact:{kind,id,revision}});
   }
   const result={review:command.review,at:new Date().toISOString(),associations,repaired:associations.length,next:current.next};
   await this.store.write(receiptName,result);return result;
  });
 }
}
