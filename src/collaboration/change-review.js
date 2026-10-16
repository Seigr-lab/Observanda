import {randomUUID} from 'node:crypto';
import {AppError} from '../errors.js';
import {exact,uuid} from '../modules/validation.js';
import {identityHash} from './identity.js';
import {ExchangeParts} from './exchange-parts.js';
import {packageSelection,packageRecords,admitParts} from './research-package.js';
import {validateResearchPackage} from './package-validation.js';
import {ResearchMaterials} from '../research-materials.js';
import {ResearchRecords,recordRevision} from '../research.js';
import {MediaStore} from '../media.js';
import {reconcileWebsiteMembership} from '../website-membership.js';
import {receiptPath,matchesWorkingCopy,requireNewEdition,updatedStructure,retainWorkingBase} from './working-copy.js';
import {reviewFonts} from './review-fonts.js';
import {customFontId} from '../web/font-catalogue.js';

const valid=(condition,code='COLLABORATION_PACKAGE')=>{if(!condition)throw new AppError(code);};
const reviewPath=id=>'.observanda/collaboration/reviews/'+id+'.json';
const headPath=id=>'.observanda/materials/objects/'+id+'/head.json';
async function packageHeads(parts){const heads=new Map();for await(const item of parts.items())if(item.kind==='metadata'&&item.name.endsWith('/head.json')){const head=await parts.value('metadata',item.name);heads.set(head.id,head);}return heads;}
function evidence(heads,recordId){return [...heads.values()].filter(h=>h.recordId===recordId).map(h=>({id:h.id,revision:h.revision})).sort((a,b)=>a.id.localeCompare(b.id));}
const stamp=(record,heads)=>identityHash({revision:record?.revision??null,heads});

export class ChangeReview{
 constructor(exchange){this.exchange=exchange;this.workspace=exchange.workspace;}
 async inputs(id,{baseId}={}){
  const parts=new ExchangeParts(this.workspace,id),head=await parts.open(),selection=await packageSelection(parts);valid(head.direction==='incoming');
  let working=null;
  if(selection.kind==='changes')await this.exchange.currentGrant(selection,{write:true});
  else{
   working=await this.exchange.working();valid(matchesWorkingCopy(working,selection),'COLLABORATION_DENIED');
   valid(selection.recipient.identity.id===(await this.exchange.identity.signer.public()).id,'COLLABORATION_DENIED');
  }
  const base=new ExchangeParts(this.workspace,selection.kind==='changes'?selection.baseId:baseId??working.selection.id);await base.open();return {parts,base,selection,working};
 }
 async review(id){
  const {parts}=await this.inputs(id);await validateResearchPackage(parts);
  return this.workspace.withLock(async()=>{
   const {base,selection,working}=await this.inputs(id),prior=await this.workspace.readMetadata(receiptPath(selection.id),16*1024*1024);if(prior)return {receipt:JSON.parse(prior)};
   if(working){requireNewEdition(working,selection);updatedStructure((await this.workspace.outline()).metadata,working.selection,selection);}
   const before=await packageRecords(base),after=await packageRecords(parts),baseHeads=await packageHeads(base),afterHeads=await packageHeads(parts),currentHeads=new Map();
   for await(const head of new ResearchMaterials(this.workspace).headEntries())currentHeads.set(head.id,head);
   const rows=[];
   await this.workspace.catalogue(async store=>{
    const snapshot=await store.snapshot();
    for(const recordId of new Set([...before.keys(),...after.keys()])){
     const previous=before.get(recordId),incoming=after.get(recordId),beforeStamp=stamp(previous,evidence(baseHeads,recordId)),afterStamp=stamp(incoming,evidence(afterHeads,recordId));if(beforeStamp===afterStamp)continue;
     const member=await store.member(snapshot,recordId),record=member?await store.record(recordId,member.revision):null;
     // An ID newly created by a collaborator may never overwrite an existing
     // record elsewhere in the owner's workspace, even with a review choice.
     valid(!record||selection.metadata.notebooks.some(n=>n.id===record.notebookId)||working?.selection.metadata.notebooks.some(n=>n.id===record.notebookId),'COLLABORATION_DENIED');
     const current=record?{revision:recordRevision(record)}:null,currentStamp=stamp(current,evidence(currentHeads,recordId));
     rows.push({id:recordId,title:incoming?.title??previous?.title,kind:incoming?previous?'changed':'added':'removed',conflict:currentStamp!==beforeStamp&&currentStamp!==afterStamp,currentStamp,incomingRevision:incoming?.revision??null,baseRevision:previous?.revision??null,currentRevision:current?.revision??null,evidence:evidence(afterHeads,recordId).length});
    }
   });
   const structure=working?{title:working.selection.metadata.title===selection.metadata.title?null:{before:working.selection.metadata.title,after:selection.metadata.title},books:[...new Set([...working.selection.metadata.notebooks,...selection.metadata.notebooks].map(n=>n.id))].map(id=>({before:working.selection.metadata.notebooks.find(n=>n.id===id)??null,after:selection.metadata.notebooks.find(n=>n.id===id)??null})).filter(row=>identityHash(row.before)!==identityHash(row.after))}:null;
   const review={id:randomUUID(),packageId:id,exchangeId:selection.id,kind:selection.kind,baseId:base.id,createdAt:new Date().toISOString(),structure,rows},raw=JSON.stringify(review);valid(Buffer.byteLength(raw)<=16*1024*1024,'LIMIT');await this.workspace.writeMetadata(reviewPath(review.id),raw);return review;
  });
 }
 async record(reviewId,recordId,version){
  valid(uuid(reviewId)&&uuid(recordId)&&['base','incoming','current'].includes(version),'INVALID');
  const raw=await this.workspace.readMetadata(reviewPath(reviewId),16*1024*1024);valid(raw);const review=JSON.parse(raw),{base,parts,selection}=await this.inputs(review.packageId,{baseId:review.baseId});valid(review.rows.some(r=>r.id===recordId));
  if(version==='current')return this.workspace.catalogue(async store=>{const member=await store.member(await store.snapshot(),recordId),record=member?await store.record(recordId,member.revision):null,books=[...selection.metadata.notebooks,...(selection.kind==='offer'?(await packageSelection(base)).metadata.notebooks:[])];valid(!record||books.some(n=>n.id===record.notebookId),'COLLABORATION_DENIED');return record;});
  const source=version==='base'?base:parts;return await source.descriptor('record',recordId)?source.value('record',recordId):null;
 }
 async materials(reviewId,recordId,version){
  await this.record(reviewId,recordId,version);
  const review=JSON.parse(await this.workspace.readMetadata(reviewPath(reviewId),16*1024*1024)),{base,parts}=await this.inputs(review.packageId,{baseId:review.baseId}),source=version==='base'?base:parts,materials=new ResearchMaterials(this.workspace),heads=version==='current'?await materials.heads():[...(await packageHeads(source)).values()],items=[];
  for(const head of heads)if(head.recordId===recordId){
   const doc=version==='current'?await materials.read(head):await source.value('metadata','.observanda/materials/objects/'+head.id+'/'+head.revision+'.json');
   items.push({id:head.id,kind:head.kind,title:head.title,revision:head.revision,...(head.kind==='artifact'?{name:doc.content.name,size:doc.content.size,sha256:doc.content.sha256,sourcePath:doc.content.sourcePath??null,sourcePurpose:doc.content.sourcePurpose??null}: {})});
  }
  return items;
 }
 async file(reviewId,recordId,version,kind,id){
  valid(['media','artifact','font'].includes(kind)&&(kind==='font'?customFontId(id):uuid(id)),'INVALID');const record=await this.record(reviewId,recordId,version);
  const review=JSON.parse(await this.workspace.readMetadata(reviewPath(reviewId),16*1024*1024)),{base,parts}=await this.inputs(review.packageId,{baseId:review.baseId}),source=version==='base'?base:parts;
  if(kind==='font'){const font=await reviewFonts(this.workspace,version==='current'?null:source,record).get(id);return {content:font.bytes,mime:'font/'+font.faces[0].file.split('.').at(-1),name:font.faces[0].file};}
  if(kind==='media'){
   valid(record?.attachments.some(a=>a.id===id),'NOT_FOUND');
   if(version==='current'){const media=await new MediaStore(this.workspace).get(id,{streamed:true});return {content:media.bytes,mime:media.mime,name:id+'.'+media.extension};}
   for await(const item of source.items())if(item.kind==='original'&&item.name.startsWith('.observanda/media/'+id+'/')&&/public\.(png|wav|mp4)$/.test(item.name))return {content:source.content(item),mime:item.name.endsWith('.png')?'image/png':item.name.endsWith('.wav')?'audio/wav':'video/mp4',name:id+'.'+item.name.split('.').at(-1)};
  }else{
   const materials=new ResearchMaterials(this.workspace),head=version==='current'?await materials.current(id):await source.value('metadata',headPath(id));valid(head?.recordId===recordId&&head.kind==='artifact','NOT_FOUND');
   if(version==='current'){const {doc,content}=await materials.artifact(head);return {content,mime:'application/octet-stream',name:doc.content.name};}
   const doc=await source.value('metadata','.observanda/materials/objects/'+id+'/'+head.revision+'.json'),folder='.observanda/materials/originals/'+(doc.content.originalId??id)+'/',name=folder+(doc.content.storageId?doc.content.storageId+'.original':'original'),item=await source.descriptor('original',name);valid(item,'NOT_FOUND');
   return {content:source.content(item),mime:'application/octet-stream',name:doc.content.name};
  }
  throw new AppError('NOT_FOUND');
 }
 async fonts(reviewId,recordId,version){
  const record=await this.record(reviewId,recordId,version),review=JSON.parse(await this.workspace.readMetadata(reviewPath(reviewId),16*1024*1024)),{base,parts}=await this.inputs(review.packageId,{baseId:review.baseId});
  return reviewFonts(this.workspace,version==='current'?null:version==='base'?base:parts,record).list();
 }
 async apply({reviewId,choices}){
  valid(uuid(reviewId)&&Array.isArray(choices)&&choices.length<=100000&&new Set(choices.map(c=>c.id)).size===choices.length&&choices.every(c=>exact(c,['id','choice'])&&uuid(c.id)&&['incoming','current'].includes(c.choice)),'INVALID');
  let stagedBase=null;
  return this.workspace.withLock(async()=>{
   const raw=await this.workspace.readMetadata(reviewPath(reviewId),16*1024*1024);valid(raw);const review=JSON.parse(raw),{parts,selection,working}=await this.inputs(review.packageId,{baseId:review.baseId}),prior=await this.workspace.readMetadata(receiptPath(selection.id),16*1024*1024);
   const requestHash=identityHash({reviewId,choices});if(prior){const receipt=JSON.parse(prior);valid(receipt.requestHash===requestHash,'CONFLICT');return {...receipt,replayed:true};}
   if(working){valid(review.baseId===working.selection.id,'STALE');requireNewEdition(working,selection);}
   valid(choices.length===review.rows.length&&choices.every(c=>review.rows.some(r=>r.id===c.id)),'INVALID');
   const chosen=new Set(choices.filter(c=>c.choice==='incoming').map(c=>c.id)),heads=await packageHeads(parts),materials=new ResearchMaterials(this.workspace),currentHeads=new Map();
   for await(const head of materials.headEntries())currentHeads.set(head.id,head);
   await this.workspace.catalogue(async store=>{
    const head=await store.head(),snapshot=await store.indexed(await store.snapshot(head));
    for(const row of review.rows){const member=await store.member(snapshot,row.id),record=member?await store.record(row.id,member.revision):null;valid(stamp(record?{revision:recordRevision(record)}:null,evidence(currentHeads,row.id))===row.currentStamp,'RECORD_CHANGED');}
    // Immutable history remains available for exact links, including retained
    // incoming variants the reviewer elects not to make current.
    if(chosen.size){await admitParts(this.workspace,parts,{heads:false});await materials.index.ensureLocked();}
    for(const old of currentHeads.values())if(chosen.has(old.recordId)&&!heads.has(old.id)){await this.workspace.removeMetadata(headPath(old.id));await materials.index.removeHead(old);}
    for(const incoming of heads.values())if(chosen.has(incoming.recordId)){
     const current=currentHeads.get(incoming.id);valid(!current||current.recordId===incoming.recordId&&current.kind===incoming.kind);
     await this.workspace.writeMetadata(headPath(incoming.id),JSON.stringify(incoming));await materials.index.changed(incoming,await materials.read(incoming));
    }
    const removed=review.rows.filter(r=>chosen.has(r.id)&&r.kind==='removed').map(r=>r.id),retainedBookIds=new Set();
    if(working)for await(const member of store.members(snapshot))if(!removed.includes(member.id))retainedBookIds.add(member.notebookId);
    const metadata=working?updatedStructure(snapshot.metadata,working.selection,selection,{retainedBookIds}):structuredClone(snapshot.metadata),service=new ResearchRecords(this.workspace,new MediaStore(this.workspace));
    metadata.branding=metadata.branding.filter(b=>!removed.some(id=>b.target==='entry:'+id));metadata.website.layouts=metadata.website.layouts.filter(l=>!removed.some(id=>l.target==='entry:'+id));
    await reconcileWebsiteMembership(metadata,id=>removed.includes(id)?null:store.member(snapshot,id));
    async function* changed(){
     for(const row of review.rows)if(chosen.has(row.id)&&row.kind!=='removed'){
      const record=await parts.value('record',row.id),member=await store.member(snapshot,row.id),previous=member?await store.record(row.id,member.revision):null;
      record.share=previous?.share??false;for(const attachment of record.attachments)attachment.share=previous?.attachments.find(a=>a.id===attachment.id)?.share??false;
      await service.prepare({...metadata,entries:previous?[previous]:[],partialRecords:true},{workspaceId:metadata.id,changes:[{id:record.id,expectedRevision:previous?recordRevision(previous):null,record}]});yield record;
     }
    }
    await store.validateMetadata(snapshot,metadata,{removed});
    if(chosen.size||working)await store.commitChanges(head,snapshot,metadata,changed(),{removed});
    if(chosen.size||working)await store.verifySnapshot(await store.head(),metadata.id,{stableSnapshot:true,once:(_identity,check)=>check()},snapshot);
   });
   if(working){stagedBase=new ExchangeParts(this.workspace,selection.id);await retainWorkingBase(this.workspace,parts,selection);}
   const receipt={id:selection.id,reviewId,requestHash,acceptedAt:new Date().toISOString(),accepted:choices.filter(c=>c.choice==='incoming').map(c=>c.id),kept:choices.filter(c=>c.choice==='current').map(c=>c.id)};await this.workspace.writeMetadata(receiptPath(selection.id),JSON.stringify(receipt));return receipt;
  }).catch(async error=>{await stagedBase?.discardUncommitted();throw error;});
 }
}
