import {writingSectionValue,validWritingValue} from './web/record-writing-model.js';
import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {digest,serialize} from './storage-format.js';
import {withRecordDocument} from './record-document.js';
import {RecordMemberCollections,memberCollectionCount,memberStructureRevision} from './record-member-collections.js';
import {SnapshotIndex} from './snapshot-index.js';
import {commitRecordDocument} from './record-document-commit.js';
import {sameJSONData} from './web/json-data-equality.js';

const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===keys.sort().join();
export const writingValueRevision=section=>digest(serialize(writingSectionValue(section)));
export class RecordSectionCommands{
 constructor(workspace){this.workspace=workspace;}
 async run(command){
  if(command?.action==='append-private')return this.appendPrivate(command);
  const fields=['workspaceId','recordId','action','sectionId','expectedStructureRevision'];
  const extra={insert:['beforeId','value'],remove:['expectedValueRevision'],move:['position']}[command?.action];
  if(!extra||!exact(command,[...fields,...extra])||![command.workspaceId,command.recordId,command.sectionId].every(researchId)||!revisionId(command.expectedStructureRevision)||command.action==='insert'&&(command.beforeId!==null&&!researchId(command.beforeId)||!validWritingValue(command.value,command.sectionId))||command.action==='remove'&&!revisionId(command.expectedValueRevision)||command.action==='move'&&(!Number.isSafeInteger(command.position)||command.position<0))throw new AppError('INVALID');
  return this.workspace.withLock(()=>this.workspace.catalogue(async store=>{
   const etag=await store.head(),snapshot=await store.snapshot(etag);
   if(snapshot.metadata.id!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
   if(snapshot.metadata.formatVersion!==21)throw new AppError('FORMAT');
   const row=await store.member(snapshot,command.recordId);if(!row)throw new AppError('MISSING');
   const items=new RecordMemberCollections(store),index=await items.position(row,'sections',command.sectionId),total=memberCollectionCount(row,'sections');
   const receipt=(version,member)=>({etag:version,saved:true,sectionId:command.sectionId,structureRevision:memberStructureRevision(member)});
   if(command.action==='remove'&&index<0)return receipt(etag,row);
   return withRecordDocument(store,row.id,row.revision,async original=>{
    const section=index<0?null:(await original.field(['sections',String(index)])).value;
    if(section&&section.id!==command.sectionId)throw new AppError('CATALOGUE_DAMAGED');
    if(command.action==='insert'&&section){
     if(sameJSONData(writingSectionValue(section),command.value))return receipt(etag,row);
     throw new AppError('RECORD_CHANGED');
    }
    if(command.action!=='insert'&&index<0)throw new AppError('MISSING');
    if(command.action==='move'&&command.position>=total)throw new AppError('INVALID');
    let before=command.action==='move'?command.position+(command.position>index?1:0):command.action==='remove'?null:command.beforeId===null?total:await items.position(row,'sections',command.beforeId);
    if(before===-1)throw new AppError('RECORD_CHANGED');
    if(command.action==='move'&&(before===index||before===index+1))return receipt(etag,row);
    if(memberStructureRevision(row)!==command.expectedStructureRevision)throw new AppError('RECORD_CHANGED');
    let document,summaries=[];
    if(command.action==='insert'){
     const value={id:command.sectionId,...command.value};
     summaries=await new SnapshotIndex(store).validationRows(snapshot.membership,[{id:row.id,type:row.type,sections:[value],relations:[]}]);
     if(summaries.some(other=>other.id!==row.id&&(other.id===value.id||other.sections.includes(value.id))))throw new AppError('INVALID');
     document=await original.splice(['sections'],before,0,[value]);
    }else{
     if(command.action==='remove'&&writingValueRevision(section)!==command.expectedValueRevision)throw new AppError('RECORD_CHANGED');
     document=await original.splice(['sections'],index,1,[]);
     if(command.action==='move'){if(index<before)before--;document=await document.splice(['sections'],before,0,[section]);}
    }
    const member=await items.changed(row,'sections',document),saved=await commitRecordDocument(store,{etag,snapshot,row,document,member,summaries});
    return receipt(saved.etag,saved.member);
   },{mutable:true});
  }));
 }
 // An oversized paste becomes new private sections in one record revision. The
 // caller retains their IDs across retries after an uncertain network response.
 async appendPrivate(command){
  const {workspaceId,recordId,expectedRevision,sections}=command;
  if(!exact(command,['action','workspaceId','recordId','expectedRevision','sections'])||
     !researchId(workspaceId)||!researchId(recordId)||!revisionId(expectedRevision)||
     !Array.isArray(sections)||!sections.length)throw new AppError('INVALID');
  const ids=new Set(),values=[];
  for(const section of sections){
   if(!exact(section,['id','title','body'])||!researchId(section.id)||ids.has(section.id)||
      typeof section.title!=='string'||!section.title.trim()||
      !validWritingValue({title:section.title,body:section.body},section.id))throw new AppError('INVALID');
   ids.add(section.id);values.push({...section,share:false,sharePdf:false});
  }
  return this.workspace.withLock(()=>this.workspace.catalogue(async store=>{
   const etag=await store.head(),snapshot=await store.snapshot(etag);
   if(snapshot.metadata.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
   if(snapshot.metadata.formatVersion!==21)throw new AppError('FORMAT');
   const row=await store.member(snapshot,recordId);if(!row)throw new AppError('MISSING');
   const items=new RecordMemberCollections(store);
   const receipt=(etag,member)=>({etag,saved:true,sectionIds:[...ids],storageRevision:member.revision});
   return withRecordDocument(store,row.id,row.revision,async original=>{
    if(row.revision!==expectedRevision){
     // Only an exact, contiguous replay may acknowledge an earlier commit.
     const start=await items.position(row,'sections',values[0].id);
     if(start<0||start+values.length>memberCollectionCount(row,'sections'))throw new AppError('RECORD_CHANGED');
     for(const [offset,value] of values.entries()){
      const saved=await original.field(['sections',String(start+offset)]);
      if(!sameJSONData(saved.value,value))throw new AppError('RECORD_CHANGED');
     }
     return receipt(etag,row);
    }
    const summaries=await new SnapshotIndex(store).validationRows(snapshot.membership,[{id:row.id,type:row.type,sections:values,relations:[]}]);
    if(summaries.some(other=>ids.has(other.id)||other.sections.some(id=>ids.has(id))))throw new AppError('INVALID');
    const document=await original.splice(['sections'],memberCollectionCount(row,'sections'),0,values);
    const member=await items.changed(row,'sections',document);
    const saved=await commitRecordDocument(store,{etag,snapshot,row,document,member,summaries});
    return receipt(saved.etag,saved.member);
   },{mutable:true});
  }));
 }
}
