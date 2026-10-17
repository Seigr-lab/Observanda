import {recordReferenceNamespaces} from './research-reference-namespace.js';
import {projectWebsiteAttachmentChoices} from './website-selection-admission.js';
import {AppError} from './errors.js';
import {RecordPublicationIndex} from './record-publication-index.js';
import {publicationRecords} from './publication-records.js';
import {emptyWebsiteSelection,websiteRecordShare} from './web/website-selection.js';
import {publicationDescriptor} from './publication-record-descriptor.js';
import {historicalBook} from './research.js';

// One request, one immutable snapshot. Descriptors are retained only for items
// actually drawn or linked on the page; scanning a range does not cache it.
export class AppearancePreviewRecords{
 constructor(store,snapshot,{signal,snapshotId,websiteId=null}={}){
  Object.assign(this,{store,snapshot,signal,snapshotId,websiteId,websitePin:snapshot.websitePin});this.metadata=snapshot.metadata;
  this.selection=snapshot.websiteSelection??emptyWebsiteSelection();this.overrides=new Map();
  this.owners=new Map(this.metadata.notebooks.map(n=>[n.id,n.projectId]));
  this.notebooks=new Set(this.metadata.notebooks.filter(n=>this.metadata.projects.some(p=>p.id===n.projectId&&p.share)).map(n=>n.id));
  this.descriptors=new Map();this.originals=new Map();this.members=new Map();
 }
 async summary(row,options={}){return (await Array.fromAsync(this.store.queryDocuments([row],this.metadata,{search:false,signal:this.signal,...options})))[0];}
 async member(id){
  const row=await this.store.member(this.snapshot,id);
  return row&&!this.snapshot.indexVersion?{...row,position:this.snapshot.records.findIndex(value=>value.id===id)}:row;
 }
 async initialize(){
  for(const patch of this.selection.records){
   this.signal?.throwIfAborted();const row=await this.member(patch.id);
   if(!row)throw new AppError('RECORD_CHANGED');
   const [summary]=await Array.fromAsync(this.store.queryDocuments([row],this.metadata,{search:false,publication:true,signal:this.signal}));
   const attachments=projectWebsiteAttachmentChoices(patch.attachments,summary.publication.attachments,patch.attachments);
   this.overrides.set(patch.id,{row,patch:{...patch,attachments}});
  }
  const counts={};
  if(this.snapshot.publicationIndex){
   const index=new RecordPublicationIndex(this.store);
   for(const id of this.notebooks){
    this.signal?.throwIfAborted();const all=this.selection.includeProjects.includes(this.owners.get(id))||this.selection.defaultShare===true;
    counts[id]=0;
    for(const shared of all?[false,true]:this.selection.defaultShare===false?[]:[true]){
     const prefix='book:'+id+':share:'+Number(shared)+':';
     counts[id]+=await index.rank(this.snapshot.publicationIndex,prefix+'\uffff')-await index.rank(this.snapshot.publicationIndex,prefix);
    }
   }
   for(const {row,patch} of this.overrides.values()){
    const value=await index.describe(row);if(!this.notebooks.has(value.notebookId)||patch.share===null)continue;
    const before=this.selection.includeProjects.includes(this.owners.get(value.notebookId))?true:this.selection.defaultShare??value.share;
    counts[value.notebookId]+=Number(patch.share)-Number(before);
   }
  }else{
   for(const id of this.notebooks)counts[id]=0;
   for await(const row of this.rows())counts[row.notebookId]++;
  }
  this.counts={total:Object.values(counts).reduce((a,b)=>a+b,0),notebooks:counts};return this;
 }
 async visible(row){
  this.signal?.throwIfAborted();
  const value=row.notebookId===undefined||row.share===undefined?await new RecordPublicationIndex(this.store).describe(row):row;
  return this.notebooks.has(value.notebookId)&&websiteRecordShare(this.selection,value,this.owners.get(value.notebookId))?value:null;
 }
 async *rows({notebooks=this.notebooks,order='position',after=null,backward=false}={}){
  const rows=publicationRecords(this.store,this.snapshot,{metadata:this.metadata,selection:this.selection,overrides:this.overrides,notebooks,order,after:order==='position'?after?.position??null:after,backward,signal:this.signal});
  for await(const row of rows){const value=await this.visible(row);if(value&&notebooks.has(value.notebookId))yield value;}
 }
 async original(id){
  if(!this.originals.has(id)){
   const row=this.members.get(id)??await this.member(id);if(!row||!await this.visible(row))return null;
   const original=historicalBook(this.metadata,await this.store.record(id,row.revision)).entries[0];
   if(row.share!==undefined&&original.share!==row.share||row.notebookId!==undefined&&original.notebookId!==row.notebookId)throw new AppError('CATALOGUE_DAMAGED');
   const patch=this.overrides.get(id)?.patch;
   this.originals.set(id,{...original,share:true,attachments:original.attachments.map(a=>({...a,share:patch?.attachments.find(v=>v.id===a.id)?.share??a.share}))});
  }
  return this.originals.get(id);
 }
 async get(id,details=null){
  if(this.descriptors.has(id))return this.descriptors.get(id);
  const member=await this.member(id),row=member&&await this.visible(member);if(!row)return null;
  this.members.set(id,row);
  const [summary]=details?[details]:await Array.fromAsync(this.store.queryDocuments([row],this.metadata,{search:false,publicationDetails:true,signal:this.signal}));
  const descriptor=this.overrides.get(id)?.patch.attachments.length?publicationDescriptor(await this.original(id)):summary.publicationDescriptor;
  const result={...descriptor,position:row.position,referenceNamespaces:await recordReferenceNamespaces(this.store,{workspaceId:this.metadata.id,id})};this.descriptors.set(id,result);return result;
 }
 async neighbours(id){
  const selected=this.members.get(id);if(!selected)return;
  for(const backward of [true,false])for await(const row of this.rows({notebooks:new Set([selected.notebookId]),after:selected,backward})){
   await this.get(row.id);break;
  }
 }
}
