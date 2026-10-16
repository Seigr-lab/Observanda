import {starterRequestMatches} from './project-starter-receipts.js';
import {RecordStarterEditing} from './record-starter-editing.js';
import {RecordStarterSource} from './record-starter-source.js';
import {STARTER_ROOT} from './record-starters.js';
import {RecordDocument} from './record-document.js';
import {StarterValueBlocks,retainStarterDocument,validateStarterDocument} from './record-starter-documents.js';
import {requireStarterDocuments} from './catalogue-format.js';
import {packageDigest} from './record-starter-package.js';
import {starterKeys} from './web/record-starter-model.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {AppError} from './errors.js';
const root=STARTER_ROOT+'/captures',fail=()=>{throw new AppError('INVALID');};
export class RecordStarterCapture extends RecordStarterEditing{
 check(c,keys){if(!starterKeys(c,['workspaceId','id',...keys])||!researchId(c.workspaceId)||!researchId(c.id))fail();}
 async begin(c){
  this.check(c,['recordId','snapshotId','body']);if(!researchId(c.recordId)||!revisionId(c.snapshotId)||typeof c.body!=='boolean')fail();
  return this.workspace.withLock(async()=>{
   await this.context(c.workspaceId);const file=root+'/'+c.id+'.json',request=packageDigest(c),prior=await this.object(file);if(prior){if(!await starterRequestMatches(this.workspace,c,prior,'request',file))throw new AppError('STARTER_CHANGED');return {received:prior.received};}
   if(await this.object(STARTER_ROOT+'/headers/'+c.id+'.json'))throw new AppError('STARTER_CHANGED');
   const target={workspaceId:c.workspaceId,recordId:c.recordId,snapshotId:c.snapshotId},source=await new RecordStarterSource(this.workspace).prepare({...target,body:c.body,sections:[]});
   await this.workspace.catalogue(store=>requireStarterDocuments(store.db));const blocks=new StarterValueBlocks(this.workspace),document=new RecordDocument(blocks,await blocks.tree().retain(source.draft));
   await this.workspace.writeMetadata(file,JSON.stringify({request,target,root:document.root,received:0,last:-1}));return {received:0};
  });
 }
 async append(c){
  this.check(c,['index','sections']);if(!Number.isSafeInteger(c.index)||c.index<0||!Array.isArray(c.sections)||!c.sections.length||c.sections.length>20||c.sections.some(s=>!starterKeys(s,['id','body','position'])||!researchId(s.id)||typeof s.body!=='boolean'||!Number.isSafeInteger(s.position)||s.position<0))fail();
  return this.workspace.withLock(async()=>{
   await this.context(c.workspaceId);const file=root+'/'+c.id+'.json',state=await this.object(file),receiptFile=root+'/'+c.id+'/'+c.index+'.json',request=packageDigest(c),receipt=await this.object(receiptFile);if(receipt){if(!await starterRequestMatches(this.workspace,c,receipt,'request',receiptFile))throw new AppError('STARTER_CHANGED');return {received:receipt.received};}
   if(!state||state.finished||state.received!==c.index)throw new AppError('STARTER_CHANGED');
   if(c.sections.some((s,i)=>s.position<=(i?c.sections[i-1].position:state.last)))fail();
   const source=new RecordStarterSource(this.workspace);
   // Verify supplied positions against the pinned source before retaining any
   // values. Cross-page choices cannot silently change order or ownership.
   for(const item of c.sections){const page=await source.page({...state.target,offset:item.position});if(page.values[0]?.id!==item.id)throw new AppError('STARTER_CHANGED');}
   const prepared=await source.prepare({...state.target,body:false,sections:c.sections.map(({id,body})=>({id,body}))});
   let document=new RecordDocument(new StarterValueBlocks(this.workspace),state.root,{mutable:true});document=await document.splice(['sections'],await document.tree.arrayLength(document.root,['sections']),0,prepared.draft.sections);
   state.root=document.root;state.received+=c.sections.length;state.last=c.sections.at(-1).position;await this.workspace.writeMetadata(file,JSON.stringify(state));await this.workspace.writeMetadata(receiptFile,JSON.stringify({request,received:state.received}));return {received:state.received};
  });
 }
 async finish(c){
  this.check(c,['count']);if(!Number.isSafeInteger(c.count)||c.count<0)fail();
  return this.workspace.withLock(async()=>{
   await this.context(c.workspaceId);const file=root+'/'+c.id+'.json',state=await this.object(file);if(!state||state.received!==c.count)throw new AppError('STARTER_CHANGED');if(state.finished)return {header:await this.header(c.id)};
   const document=new RecordDocument(new StarterValueBlocks(this.workspace),state.root);await validateStarterDocument(document,{portable:false});const pointer=await retainStarterDocument(document),header={version:1,id:c.id,createdAt:new Date().toISOString(),status:'active',sequence:0,latest:null,draftHash:pointer.fingerprint,name:(await document.field(['name'])).value};
   await this.feed.ensureLocked();await this.workspace.writeMetadata(STARTER_ROOT+'/drafts/'+c.id+'.json',JSON.stringify(pointer));await this.workspace.writeMetadata(STARTER_ROOT+'/headers/'+c.id+'.json',JSON.stringify(header));await this.feed.putLocked(header);state.finished=true;await this.workspace.writeMetadata(file,JSON.stringify(state));return {header:{...header,revision:packageDigest(header)}};
  });
 }
}
