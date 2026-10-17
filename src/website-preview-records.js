// Page-local draft overlay over an immutable catalogue. Only explicitly drawn
// cards, originals, neighbours and link destinations enter the projection.
import {recordReferenceNamespaces} from './research-reference-namespace.js';
import {AppError} from './errors.js';
import {SnapshotIndex} from './snapshot-index.js';
import {RecordReadingIndex,readingKey} from './record-reading-index.js';
import {validateRecordChanges} from './model.js';
import {recordRevision,historicalBook} from './research.js';
import {recordQueryDocument} from './web/record-query.js';
import {publicationCard} from './web/publication-card.js';
import {readingJourney} from './web/book-journeys.js';
export class WebsitePreviewRecords{
 constructor(store,snapshot,metadata,command,{signal,websiteId=null,metadataAdmitted=false}={}){
  Object.assign(this,{store,snapshot,metadata,command,signal,websiteId,metadataAdmitted,websitePin:snapshot.websitePin});
  this.index=new SnapshotIndex(store);this.reading=new RecordReadingIndex(store);
  this.deleted=new Set(command.removed.map(c=>c.id));this.changed=new Map(command.changes.map(c=>[c.id,structuredClone(c.record)]));
  this.originals=new Map(this.changed);this.rows=new Map();this.documents=new Map();this.descriptors=new Map();
 }
 async initialize(){
  let nextPosition=this.snapshot.nextPosition??this.snapshot.records.length;
  for(const change of [...this.command.changes,...this.command.removed]){
   this.signal?.throwIfAborted();const row=await this.store.member(this.snapshot,change.id),record=row?await this.store.record(row.id,row.revision):null;
   if((record?recordRevision(record):null)!==change.expectedRevision)throw new AppError('RECORD_CHANGED');
   if(change.record)this.rows.set(change.id,{id:change.id,notebookId:change.record.notebookId,occurredOn:change.record.occurredOn,position:row?.position??nextPosition++});
  }
  const edited=[...this.changed.values()];
  if(this.metadataAdmitted){if(edited.length||this.deleted.size||this.command.projects.length||Object.keys(this.command.metadata).length)throw new AppError('INVALID');}
  else await this.store.validateMetadata(this.snapshot,this.metadata,{removed:[...this.deleted],records:edited});
  validateRecordChanges(this.metadata,edited,(await this.index.validationRows(this.snapshot.membership,edited)).filter(row=>!this.deleted.has(row.id)));
 }
 async row(id){
  this.signal?.throwIfAborted();if(this.deleted.has(id))return null;
  if(!this.rows.has(id))this.rows.set(id,await this.store.member(this.snapshot,id));return this.rows.get(id);
 }
 async document(row,{cards=false}={}){
  if(this.changed.has(row.id))return {...recordQueryDocument(this.changed.get(row.id)),revision:recordRevision(this.changed.get(row.id)),...(cards?{publicationCard:publicationCard(this.changed.get(row.id))}:{})};
  if(!this.documents.has(row.id)||cards&&!this.documents.get(row.id).publicationCard){
   const [value]=await Array.fromAsync(this.store.queryDocuments([row],this.snapshot.metadata,{signal:this.signal,search:false,references:true,revisions:true,cardSources:true,cards}));
   return value;
  }
  return this.documents.get(row.id);
 }
 remember(row,value){
  this.rows.set(row.id,row);this.documents.set(row.id,value);
  const descriptor={id:value.id,title:value.title,notebookId:value.notebookId,occurredOn:value.occurredOn,tags:value.tags,type:value.template?.label??value.type,journey:readingJourney(value),revision:value.revision,position:row.position,
   attachments:(row.cardItems?.attachments??value.cardSources.files.map(file=>file.key.slice(value.id.length+1))).map(id=>({id})),relations:[],referencesSelected:false};
  this.descriptors.set(row.id,descriptor);return descriptor;
 }
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
  return this.originals.get(id);
 }
 async *dateRows(notebookIds,{after=null,backward=false,includeAfter=false}={}){
  const key=row=>readingKey(row,'date'),direction=backward?-1:1,boundary=after?key(after):null;
  const edited=[...this.rows.values()].filter(row=>row&&this.changed.has(row.id)&&notebookIds.has(row.notebookId)&&(boundary===null||(backward?key(row)<boundary:key(row)>boundary))).sort((a,b)=>(key(a)<key(b)?-1:key(a)>key(b)?1:0)*direction);
  if(includeAfter&&after){const row=await this.row(after.id);if(row&&notebookIds.has(row.notebookId)&&key(row)===boundary)yield row;}
  let at=0;
  for await(const row of this.reading.rows(this.snapshot,notebookIds,{signal:this.signal,after,backward})){
   while(at<edited.length&&(backward?key(edited[at])>key(row):key(edited[at])<key(row)))yield edited[at++];
   if(!this.deleted.has(row.id)&&!this.changed.has(row.id))yield row;
  }
  while(at<edited.length){this.signal?.throwIfAborted();yield edited[at++];}
 }
 async neighbours(id){
  const selected=await this.row(id);if(!selected)return;
  for(const backward of [true,false]){
   let found=null;
   for await(const row of this.reading.rows(this.snapshot,new Set([selected.notebookId]),{order:'position',after:selected,backward,signal:this.signal})){
    if(!this.deleted.has(row.id)&&!this.changed.has(row.id)){found=row;break;}
   }
   for(const row of this.rows.values())if(row&&this.changed.has(row.id)&&row.notebookId===selected.notebookId&&
    (backward?row.position<selected.position:row.position>selected.position)&&(!found||(backward?row.position>found.position:row.position<found.position)))found=row;
   if(found)await this.get(found.id);
  }
 }
 async counts(){
  const notebooks={};
  for(const notebook of this.metadata.notebooks){this.signal?.throwIfAborted();notebooks[notebook.id]=await this.index.scopedCount(this.snapshot.membership,notebook.id);}
  for(const id of new Set([...this.deleted,...this.changed.keys()])){
   const before=await this.store.member(this.snapshot,id);if(before&&Object.hasOwn(notebooks,before.notebookId))notebooks[before.notebookId]--;
   const after=this.changed.get(id);if(after)notebooks[after.notebookId]++;
  }
  return {total:Object.values(notebooks).reduce((a,b)=>a+b,0),notebooks};
 }
}
