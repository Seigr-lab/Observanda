// Selected writing values are independent optimistic edits. The command names
// an existing section identity, never an incomplete replacement for a record.
import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {sameJSONData} from './web/json-data-equality.js';
import {digest,serialize} from './storage-format.js';
import {withRecordDocument} from './record-document.js';
import {RecordMemberCollections} from './record-member-collections.js';
import {writingSectionValue,validWritingValue} from './web/record-writing-model.js';
import {commitRecordDocument} from './record-document-commit.js';

const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys.sort().join();
const target=command=>researchId(command.workspaceId)&&researchId(command.recordId)&&(command.sectionId===null||researchId(command.sectionId));
const fields=['workspaceId','recordId','sectionId'];
const content=(sectionId,value)=>sectionId===null?{body:value}:writingSectionValue(value);
export class RecordWriting{
 constructor(workspace){this.workspace=workspace;}
 async select(store,command){
  const etag=await store.head(),snapshot=await store.snapshot(etag);
  if(snapshot.metadata.id!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
  if(snapshot.metadata.formatVersion!==21)throw new AppError('FORMAT');
  const row=await store.member(snapshot,command.recordId);if(!row)throw new AppError('MISSING');
  const position=command.sectionId===null?null:await new RecordMemberCollections(store).position(row,'sections',command.sectionId);
  if(position===-1)throw new AppError('MISSING');
  return {etag,snapshot,row,path:position===null?['body']:['sections',String(position)]};
 }
 async read(command,{signal}={}){
  if(!exact(command,fields)||!target(command))throw new AppError('INVALID');signal?.throwIfAborted();
  return this.workspace.catalogue(async store=>{
   const {row,path,etag}=await this.select(store,command);
   return withRecordDocument(store,row.id,row.revision,async document=>{
    const selected=(await document.field(path,{signal})).value;
    if(command.sectionId!==null&&selected?.id!==command.sectionId)throw new AppError('CATALOGUE_DAMAGED');
    const value=content(command.sectionId,selected);
    return {...command,etag,storageRevision:row.revision,revision:digest(serialize(value)),value,recordTitle:(await document.field(['title'],{signal})).value};
   });
  });
 }
 async save(command){return this.workspace.withLock(()=>this.saveLocked(command));}
 async saveLocked(command){
  if(!exact(command,[...fields,'expectedRevision','value'])||!target(command)||!revisionId(command.expectedRevision)||!validWritingValue(command.value,command.sectionId))throw new AppError('INVALID');
  return this.workspace.catalogue(async store=>{
   const {row,path,etag,snapshot}=await this.select(store,command);
   return withRecordDocument(store,row.id,row.revision,async original=>{
    const selected=(await original.field(path)).value;
    if(command.sectionId!==null&&selected?.id!==command.sectionId)throw new AppError('CATALOGUE_DAMAGED');
    const previous=content(command.sectionId,selected),next=command.sectionId===null?command.value:writingSectionValue({...selected,...command.value});
    // Exact retries are safe after an unknown response. A competing change to
    // this value is never overwritten; edits to other sections can coexist.
    if(sameJSONData(previous,next))return {etag,revision:digest(serialize(previous)),saved:true};
    if(digest(serialize(previous))!==command.expectedRevision)throw new AppError('RECORD_CHANGED');
    const document=await original.replace(path,command.sectionId===null?next.body:{...selected,...next});
    const saved=await commitRecordDocument(store,{etag,snapshot,row,document});
    return {etag:saved.etag,revision:digest(serialize(next)),saved:true};
   },{mutable:true});
  });
 }
}
