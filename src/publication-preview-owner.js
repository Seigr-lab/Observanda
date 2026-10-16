import {publicationOwnerId} from './publication-owner-identities.js';
import {AppError} from './errors.js';
import {RecordPublicationIndex} from './record-publication-index.js';
import {publicationRecords} from './publication-records.js';
import {SnapshotIndex} from './snapshot-index.js';
import {selectedPublicationRows} from './publication-source.js';
import {publicationSourceContext} from './web/publication-sources-model.js';
import {publicationOwnerProjection,publicationPageRecord} from './publication-owner-projection.js';
import {publicationDescriptor} from './publication-record-descriptor.js';
import {recordRevision} from './research.js';
import {recordReferenceNamespaces} from './research-reference-namespace.js';
import {validateEditionRecord} from './publication-selection.js';
import {defaultEditionRecord,selectEditionRecord} from './web/publication-selection.js';
import {websiteRecordShare} from './web/website-selection.js';
import {recordReferenceCandidates} from './record-reference-candidates.js';
import {RecordReadingIndex} from './record-reading-index.js';
import {revisionPageId,exactPublicationRecord} from './publication-revisions.js';
import {readingKey} from './record-reading-index.js';

// One selected namespace, pinned to one immutable snapshot. No catalogue or
// credential escapes a reader callback; only admitted page-sized derivatives do.
export class PublicationPreviewOwner{
 constructor(source,reader,identities,{signal}={}){
  Object.assign(this,{source:structuredClone(source),reader,identities,signal});
  this.rows=new Map();this.descriptors=new Map();this.originals=new Map();this.choices=new Map((source.edition?.records??[]).map(choice=>[choice.id,choice]));
  this.history=new Map((source.edition?.history??[]).filter(choice=>choice.include).map(choice=>[this.id('record',revisionPageId(source.workspaceId,choice.id,choice.revision)),structuredClone(choice)]));
 }
 async initialize({counts=false}={}){
  const {value}=await this.reader.use(this.source.workspaceId,undefined,async(store,snapshot,pinned)=>{
   const context=publicationSourceContext(snapshot.metadata,this.source,pinned.owner);
   return {...context,snapshotId:pinned.snapshotId,owner:{...pinned.owner,projectNamespaceId:pinned.projectNamespaceId},...(counts?{notebookCounts:await this.countValues(store,snapshot,context.metadata)}:{})};
  });
  Object.assign(this,value);
  this.projected=publicationOwnerProjection({metadata:this.metadata,records:[]},this.owner,this.identities).metadata;
  return this;
 }
 async use(consume){
  this.signal?.throwIfAborted();
  const {value}=await this.reader.use(this.source.workspaceId,this.snapshotId,(store,snapshot,pinned)=>{
   if(snapshot.metadata.id!==this.source.workspaceId||pinned.snapshotId!==this.snapshotId)throw new AppError('WORKSPACE_CHANGED');
   return consume(store,snapshot,pinned);
  });return value;
 }
 id(kind,id){return publicationOwnerId(this.identities.workspaceId,this.source.workspaceId,kind,id);}
 projectedRow(row){return {...row,id:this.id('record',row.id),recordId:row.id,notebookId:this.id('notebook',row.notebookId),workspaceId:this.source.workspaceId};}
 options(extra={}){return {metadata:this.metadata,selection:this.source.selection,signal:this.signal,...extra};}
 included(id){return this.choices.get(id)?.include!==false;}
 async admit(store,snapshot,row){
  if(!row||!this.included(row.id))return null;
  const [summary]=await Array.fromAsync(store.queryDocuments([row],snapshot.metadata,{signal:this.signal,search:false,publication:true}));
  const project=this.metadata.notebooks.find(book=>book.id===summary.notebookId)?.projectId;
  if(!this.metadata.projects.some(value=>value.id===project&&value.share)||!websiteRecordShare(this.source.selection,summary,project))return null;
  const patch=this.source.selection.records.find(value=>value.id===row.id);
  if(patch?.attachments.some(value=>!summary.publication.attachments.some(attachment=>attachment.id===value.id)))throw new AppError('INVALID');
  return {row,summary,patch};
 }
 async find(publicId,{recordId}={}){
  if(this.history.has(publicId)){await this.describeHistory(publicId);return this.rows.get(publicId);}
  return this.use(async(store,snapshot)=>{
   if(recordId){const item=await this.admit(store,snapshot,await store.member(snapshot,recordId));return item&&this.id('record',recordId)===publicId?this.projectedRow(item.row):null;}
   if(snapshot.publicationIndex?.version===3){const item=await this.admit(store,snapshot,await new RecordPublicationIndex(store).record(snapshot,publicId));return item?this.projectedRow(item.row):null;}
   for await(const {row} of selectedPublicationRows(store,snapshot,this.options()))if(this.included(row.id)&&this.id('record',row.id)===publicId)return this.projectedRow(row);
   return null;
  });
 }
 // Public identities change tie order. Keep just the next window in that exact
 // order rather than sorting or retaining the source corpus in memory.
 async window(notebooks,{after=null,backward=false,limit=128}={}){
  if(!Number.isInteger(limit)||limit<1||limit>257)throw new AppError('INVALID');
  return this.use(async(store,snapshot)=>{
   if(snapshot.publicationIndex?.version===3){
    const selected=new Set(this.metadata.notebooks.filter(book=>this.metadata.projects.some(project=>project.id===book.projectId&&project.share)&&notebooks.has(this.id('notebook',book.id))).map(book=>book.id)),values=[];
    for await(const row of publicationRecords(store,snapshot,{...this.options(),notebooks:selected,overrides:await this.overrides(store,snapshot),order:'publication',after,backward})){
     if(this.included(row.id))values.push(this.projectedRow(row));if(values.length===limit)break;
    }
    return values;
   }
   const values=[],counts={},boundary=after?readingKey(after,'date'):null;
   const compare=(a,b)=>(readingKey(a,'date')<readingKey(b,'date')?-1:readingKey(a,'date')>readingKey(b,'date')?1:0)*(backward?-1:1);
   for await(const {row:original} of selectedPublicationRows(store,snapshot,this.options())){
    if(!this.included(original.id))continue;
    const row=this.projectedRow(original);counts[row.notebookId]=(counts[row.notebookId]??0)+1;
    if(!notebooks.has(row.notebookId)||boundary!==null&&(backward?readingKey(row,'date')>=boundary:readingKey(row,'date')<=boundary))continue;
    if(values.length===limit&&compare(row,values.at(-1))>=0)continue;
    const index=values.findIndex(value=>compare(row,value)<0);values.splice(index<0?values.length:index,0,row);if(values.length>limit)values.pop();
   }
   this.notebookCounts=counts;return values;
  });
 }
 async overrides(store,snapshot){
  if(this.selectedOverrides)return this.selectedOverrides;
  const values=new Map();
  for(const patch of this.source.selection.records){
   this.signal?.throwIfAborted();const row=await store.member(snapshot,patch.id);if(!row)throw new AppError('RECORD_CHANGED');
   const [summary]=await Array.fromAsync(store.queryDocuments([row],snapshot.metadata,{signal:this.signal,search:false,publication:true}));
   if(patch.attachments.some(value=>!summary.publication.attachments.some(attachment=>attachment.id===value.id)))throw new AppError('INVALID');
   values.set(row.id,{row,patch});
  }
  this.selectedOverrides=values;return values;
 }
 // A canvas always displays counts. Capture them during its initial owner
 // admission, while selectors that do not need counts remain lazy.
 async countValues(store,snapshot,metadata=this.metadata){
  const counts={},index=new SnapshotIndex(store),all=new Set(this.source.selection.includeProjects),books=new Map(metadata.notebooks.map(book=>[book.id,book]));
  for(const book of metadata.notebooks)if(metadata.projects.some(project=>project.id===book.projectId&&project.share))counts[this.id('notebook',book.id)]=all.has(book.projectId)?await index.scopedCount(snapshot.membership,book.id):0;
  const overrides=await this.overrides(store,snapshot),ids=new Set([...overrides.keys(),...this.choices.keys()]);
  for(const id of ids){
   const row=overrides.get(id)?.row??await store.member(snapshot,id);if(!row)throw new AppError('RECORD_CHANGED');
   const book=books.get(row.notebookId),mapped=book&&this.id('notebook',book.id);if(!Object.hasOwn(counts,mapped))continue;
   const before=all.has(book.projectId),share=overrides.get(id)?.patch.share??before,after=share&&this.included(id);counts[mapped]+=Number(after)-Number(before);
  }
  return counts;
 }
 async counts(){
  this.notebookCounts??=await this.use((store,snapshot)=>this.countValues(store,snapshot));
  return Object.fromEntries(this.projected.notebooks.map(book=>[book.id,this.notebookCounts[book.id]??0]));
 }
 async neighbours(row){
  return this.use(async(store,snapshot)=>{
   const selected=await store.member(snapshot,row.recordId);if(!selected)return [];
   const result=[],reading=new RecordReadingIndex(store),notebooks=new Set([selected.notebookId]);
   for(const backward of [true,false])for await(const candidate of reading.rows(snapshot,notebooks,{order:'position',after:selected,backward,signal:this.signal})){
    if(await this.admit(store,snapshot,candidate)){result.push(this.projectedRow(candidate));break;}
   }
   return result;
  });
 }
 async referenceRows(target,{after=null,backward=false,limit=257}={}){
  return this.use(async(store,snapshot)=>{
   const notebooks=new Set(this.metadata.notebooks.filter(book=>this.metadata.projects.some(project=>project.id===book.projectId&&project.share)).map(book=>book.id));
   const reading=new RecordReadingIndex(store),rows=[];
   for await(const candidate of recordReferenceCandidates({store,snapshot,notebooks,workspaceId:target.workspaceId,signal:this.signal,fallback:anchor=>reading.rows(snapshot,notebooks,{order:'position',signal:this.signal,after:anchor.after===null?null:{position:anchor.after},backward:anchor.backward})},target.id,{after,backward})){
    rows.push(this.projectedRow(candidate));if(rows.length===limit)break;
   }
   return rows;
  });
 }
 async selected(store,snapshot,row){
  const raw=await store.record(row.recordId,row.revision),revision=recordRevision(raw),patch=this.source.selection.records.find(choice=>choice.id===raw.id);
  if(raw.id!==row.recordId||raw.notebookId!==this.metadata.notebooks.find(book=>this.id('notebook',book.id)===row.notebookId)?.id)throw new AppError('CATALOGUE_DAMAGED');
  const choice=this.choices.get(raw.id);validateEditionRecord(raw,choice);
  const shared={...raw,share:true,attachments:raw.attachments.map(attachment=>({...attachment,share:patch?.attachments.find(value=>value.id===attachment.id)?.share??attachment.share}))};
  const selected=selectEditionRecord(shared,choice??defaultEditionRecord(shared,revision));
  if(!selected.share)throw new AppError('NOT_FOUND');
  return {selected,revision};
 }
 async describe(row){
  if(row.historical)return this.describeHistory(row.id);
  if(this.descriptors.has(row.id))return this.descriptors.get(row.id);
  return this.use(async(store,snapshot)=>{
   // Recheck consent within the pinned owner, even for a supplied row.
   const admitted=await this.admit(store,snapshot,await store.member(snapshot,row.recordId));
   if(!admitted||!this.included(row.recordId)||this.id('record',row.recordId)!==row.id)throw new AppError('NOT_FOUND');
   row=this.projectedRow(admitted.row);
   let descriptor,selected;
   if(this.choices.has(row.recordId)||admitted.patch?.attachments.length){
    const value=await this.selected(store,snapshot,row);selected=value.selected;
    descriptor={...publicationDescriptor(selected,this.metadata),revision:value.revision};
   }else{
    const [value]=await Array.fromAsync(store.queryDocuments([admitted.row],snapshot.metadata,{signal:this.signal,search:false,publicationDetails:true}));
    descriptor=value.publicationDescriptor;
   }
   descriptor={...descriptor,referenceNamespaces:await recordReferenceNamespaces(store,{workspaceId:this.source.workspaceId,id:row.recordId})};
   const projected=publicationOwnerProjection({metadata:this.metadata,records:[descriptor]},this.owner,this.identities).records[0];
   Object.assign(projected,{position:row.position,referencesSelected:false});
   this.rows.set(row.id,row);
   this.descriptors.set(row.id,projected);
   if(selected)this.originals.set(row.id,publicationPageRecord(selected,projected));
   return projected;
  });
 }
 async describeHistory(id){
  if(this.descriptors.has(id))return this.descriptors.get(id);
  const choice=this.history.get(id);if(!choice)throw new AppError('NOT_FOUND');
  return this.use(async(store,snapshot,pinned)=>{
   const storage=new Proxy(pinned.storage,{get(target,key){if(key==='catalogue')return operation=>operation(store);const value=target[key];return typeof value==='function'?value.bind(target):value;}});
   const raw=await exactPublicationRecord(storage,{workspaceId:this.source.workspaceId,kind:'record',id:choice.id,revision:choice.revision});validateEditionRecord(raw,choice);
   if(!this.metadata.notebooks.some(book=>book.id===raw.notebookId&&this.metadata.projects.some(project=>project.id===book.projectId&&project.share)))throw new AppError('INVALID');
   const selected=selectEditionRecord(raw,choice),pageId=revisionPageId(this.source.workspaceId,raw.id,choice.revision),namespaces=await recordReferenceNamespaces(store,{workspaceId:this.source.workspaceId,id:raw.id});
   const descriptor={...publicationDescriptor(selected,this.metadata),id:pageId,recordId:raw.id,revision:choice.revision,historical:true,referenceNamespaces:namespaces};
   const projected=publicationOwnerProjection({metadata:this.metadata,records:[descriptor]},this.owner,this.identities).records[0],member=await store.member(snapshot,raw.id);
   const row={id,recordId:raw.id,workspaceId:this.source.workspaceId,notebookId:projected.notebookId,revision:choice.revision,occurredOn:raw.occurredOn,position:member?.position??snapshot.nextPosition??0,historical:true};
   Object.assign(projected,{position:row.position,referencesSelected:false});this.rows.set(id,row);this.descriptors.set(id,projected);this.originals.set(id,publicationPageRecord(selected,projected));return projected;
  });
 }
 async historicalTarget(target){
  const choice=[...this.history.entries()].find(([,choice])=>choice.id===target.id&&choice.revision===target.revision);if(!choice)return null;
  const descriptor=await this.describeHistory(choice[0]);return descriptor.referenceNamespaces.includes(target.workspaceId)?this.rows.get(choice[0]):null;
 }
 async original(row){
  const descriptor=await this.describe(row);
  if(!this.originals.has(row.id))await this.use(async(store,snapshot)=>{
   const {selected,revision}=await this.selected(store,snapshot,this.rows.get(row.id));
   if(revision!==descriptor.revision)throw new AppError('RECORD_CHANGED');
   this.originals.set(row.id,publicationPageRecord(selected,descriptor));
  });
  return this.originals.get(row.id);
 }
}
