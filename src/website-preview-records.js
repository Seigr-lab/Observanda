import {assertPublicationPreviewPermissions} from './publication-permission-admission.js';
// Page-local draft overlay over an immutable catalogue. Only explicitly drawn
// cards, originals, neighbours and link destinations enter the projection.
import {sourceRecordAllowed,sourcePublicationRecord} from './web/source-publication-permissions.js';
import {websiteRecordShare,emptyWebsiteSelection} from './web/website-selection.js';
import {publicationDescriptor} from './publication-record-descriptor.js';
import {RecordPublicationIndex} from './record-publication-index.js';
import {recordReferenceNamespaces} from './research-reference-namespace.js';
import {AppError} from './errors.js';
import {SnapshotIndex} from './snapshot-index.js';
import {RecordReadingIndex,readingKey} from './record-reading-index.js';
import {validateRecordChanges} from './model.js';
import {recordRevision,historicalBook} from './research.js';
import {recordQueryDocument} from './web/record-query.js';
export class WebsitePreviewRecords{
 constructor(store,snapshot,metadata,command,{signal,websiteId=null,metadataAdmitted=false,designTarget=null}={}){
  Object.assign(this,{store,snapshot,metadata,command,signal,websiteId,metadataAdmitted,designTarget,websitePin:snapshot.websitePin});
  this.index=new SnapshotIndex(store);this.reading=new RecordReadingIndex(store);
  this.deleted=new Set(command.removed.map(c=>c.id));this.changed=new Map(command.changes.map(c=>[c.id,structuredClone(c.record)]));
  this.sourceRevisions=new Map();this.selection=command.selection??snapshot.websiteSelection??emptyWebsiteSelection();
  this.originals=new Map(this.changed);this.rows=new Map();this.documents=new Map();this.descriptors=new Map();
  this.visibility=new Map();
 }
 async initialize(){
  await assertPublicationPreviewPermissions(this.store,this.command.baseEtag,this.metadata,null,{signal:this.signal});
  let nextPosition=this.snapshot.nextPosition??this.snapshot.records.length;
  for(const change of [...this.command.changes,...this.command.removed]){
   this.signal?.throwIfAborted();const row=await this.store.member(this.snapshot,change.id),record=row?await this.store.record(row.id,row.revision):null;
   if((record?recordRevision(record):null)!==change.expectedRevision)throw new AppError('RECORD_CHANGED');
   if(change.record){const edited=this.changed.get(change.id);edited.share=record?.share===true&&edited.share===true;edited.sections=edited.sections.map(section=>record?.sections.some(prior=>prior.id===section.id&&prior.share===false)?{...section,share:false}:section);edited.attachments=edited.attachments.map(item=>({...item,share:item.share===true&&record?.attachments.some(prior=>prior.id===item.id&&prior.share===true)}));}
   if(change.record)this.rows.set(change.id,{id:change.id,notebookId:change.record.notebookId,occurredOn:change.record.occurredOn,position:row?.position??nextPosition++});
  }
  const edited=[...this.changed.values()];
  if(this.metadataAdmitted){if(edited.length||this.deleted.size||this.command.projects.length||Object.keys(this.command.metadata).length)throw new AppError('INVALID');}
  else await this.store.validateMetadata(this.snapshot,this.metadata,{removed:[...this.deleted],records:edited});
  validateRecordChanges(this.metadata,edited,(await this.index.validationRows(this.snapshot.membership,edited)).filter(row=>!this.deleted.has(row.id)));
 }
 async row(id){
  this.signal?.throwIfAborted();if(this.deleted.has(id))return null;
  if(!this.rows.has(id))this.rows.set(id,await this.store.member(this.snapshot,id));const row=this.rows.get(id);return row&&await this.visible(row)?row:null;
 }
 async visible(row){
  this.signal?.throwIfAborted();
  // A preview owns one immutable snapshot, metadata and selection. Navigation,
  // original loading and link resolution can ask about the same row repeatedly.
  // Reuse only its permission decision, with a bounded per-preview lifetime.
  if(this.visibility.has(row.id))return this.visibility.get(row.id);
  const value=this.changed.get(row.id)??this.documents.get(row.id)??(await Array.fromAsync(this.store.queryDocuments([row],this.snapshot.metadata,{signal:this.signal,search:false})))[0];
  const book=this.metadata.notebooks.find(book=>book.id===value.notebookId);
  // The selected local page may be styled before it is included in this site.
  // Source consent still applies, and this page-only preview is never exportable.
  const allowed=sourceRecordAllowed(value,this.metadata)&&(this.designTarget==='entry:'+row.id||websiteRecordShare(this.selection,value,book?.projectId));
  if(this.visibility.size>=64)this.visibility.delete(this.visibility.keys().next().value);
  this.visibility.set(row.id,allowed);return allowed;
 }
 async document(row,{cards=false}={}){
  this.signal?.throwIfAborted();let value=this.documents.get(row.id);
  if(this.changed.has(row.id)){const record=this.changed.get(row.id);value={...recordQueryDocument(record),revision:recordRevision(record),publicationDescriptor:publicationDescriptor(record)};}
  else if(!value)[value]=await Array.fromAsync(this.store.queryDocuments([row],this.snapshot.metadata,{signal:this.signal,search:false,references:true,revisions:true,publicationDetails:true}));
  if(this.selection.records.find(choice=>choice.id===row.id)?.attachments.length)value.publicationDescriptor={...publicationDescriptor(await this.original(row.id)),revision:value.revision};
  await assertPublicationPreviewPermissions(this.store,this.command.baseEtag,this.metadata,value.publicationDescriptor,{signal:this.signal});
  return {...value,...(cards?{publicationCard:value.publicationDescriptor}:{})};
 }
 remember(row,value){
  this.rows.set(row.id,row);this.documents.set(row.id,value);
  const descriptor={...value.publicationDescriptor,position:row.position,referencesSelected:false};
  this.descriptors.set(row.id,descriptor);return descriptor;
 }
 revision(record){return this.sourceRevisions.get(record.id)??this.descriptors.get(record.id)?.revision??recordRevision(record);}
 async get(id){
  let descriptor=this.descriptors.get(id);
  if(!descriptor){const row=await this.row(id);if(!row)return null;descriptor=this.remember(row,await this.document(row));}
  descriptor.referenceNamespaces??=await recordReferenceNamespaces(this.store,{workspaceId:this.metadata.id,id});return descriptor;
 }
 async original(id){
  const row=await this.row(id);if(!row)return null;
  if(!this.originals.has(id)){
   const record=historicalBook(this.metadata,await this.store.record(row.id,row.revision)).entries[0];
   const validation=(await this.index.validationRows(this.snapshot.membership,[record,...this.changed.values()])).filter(row=>!this.deleted.has(row.id));
   validateRecordChanges(this.metadata,[record,...this.changed.values()],validation);this.originals.set(id,record);
  }
  const original=this.originals.get(id);this.sourceRevisions.set(id,recordRevision(original));
  const patch=this.selection.records.find(choice=>choice.id===id);
  return sourcePublicationRecord({...original,attachments:original.attachments.map(item=>({...item,share:item.share===true&&(patch?.attachments.find(choice=>choice.id===item.id)?.share??item.share)}))});
 }
 async *dateRows(notebookIds,{after=null,backward=false,includeAfter=false}={}){
  const key=row=>readingKey(row,'date'),direction=backward?-1:1,boundary=after?key(after):null;
  const edited=[...this.rows.values()].filter(row=>row&&this.changed.has(row.id)&&notebookIds.has(row.notebookId)&&(boundary===null||(backward?key(row)<boundary:key(row)>boundary))).sort((a,b)=>(key(a)<key(b)?-1:key(a)>key(b)?1:0)*direction);
  if(includeAfter&&after){const row=await this.row(after.id);if(row&&notebookIds.has(row.notebookId)&&key(row)===boundary&&await this.visible(row))yield row;}
  let at=0;
  for await(const row of this.reading.rows(this.snapshot,notebookIds,{signal:this.signal,after,backward})){
   while(at<edited.length&&(backward?key(edited[at])>key(row):key(edited[at])<key(row))){const next=edited[at++];if(await this.visible(next))yield next;}
   if(!this.deleted.has(row.id)&&!this.changed.has(row.id)&&await this.visible(row))yield row;
  }
  while(at<edited.length){this.signal?.throwIfAborted();const row=edited[at++];if(await this.visible(row))yield row;}
 }
 async neighbours(id){
  const selected=await this.row(id);if(!selected)return;
  for(const backward of [true,false]){
   let found=null;
   for await(const row of this.reading.rows(this.snapshot,new Set([selected.notebookId]),{order:'position',after:selected,backward,signal:this.signal})){
    if(!this.deleted.has(row.id)&&!this.changed.has(row.id)&&await this.visible(row)){found=row;break;}
   }
   for(const row of this.rows.values())if(row&&this.changed.has(row.id)&&row.notebookId===selected.notebookId&&
    (backward?row.position<selected.position:row.position>selected.position)&&(!found||(backward?row.position>found.position:row.position<found.position)))found=row;
   if(found&&await this.visible(found))await this.get(found.id);
  }
 }
 async counts(){
  const notebooks={},index=new RecordPublicationIndex(this.store),all=notebook=>this.selection.includeProjects.includes(notebook.projectId)||this.selection.defaultShare!==false;
  for(const notebook of this.metadata.notebooks){this.signal?.throwIfAborted();notebooks[notebook.id]=notebook.share!==false&&all(notebook)&&this.snapshot.publicationIndex?await index.sharedCount(this.snapshot,notebook.id):0;}
  if(!this.snapshot.publicationIndex){for await(const row of this.dateRows(new Set(Object.keys(notebooks))))notebooks[row.notebookId]++;}
  else for(const id of new Set([...this.deleted,...this.changed.keys(),...this.selection.records.map(row=>row.id)])){
   this.signal?.throwIfAborted();
   const before=await this.store.member(this.snapshot,id),prior=before?await index.describe(before):null;
   const notebook=prior&&this.metadata.notebooks.find(book=>book.id===prior.notebookId);
   if(prior?.share&&notebook&&notebook.share!==false&&all(notebook))notebooks[prior.notebookId]--;
   // Counts need the authenticated member's consent and ownership fields,
   // not a document read or a retained row for every selected record.
   const after=this.deleted.has(id)?null:this.changed.get(id)??prior,owner=after&&this.metadata.notebooks.find(book=>book.id===after.notebookId);
   if(after&&sourceRecordAllowed(after,this.metadata)&&websiteRecordShare(this.selection,after,owner?.projectId))notebooks[after.notebookId]++;
  }
  return {total:Object.values(notebooks).reduce((a,b)=>a+b,0),notebooks};
 }
}
