import {assertRecordOwnerRevisionVisible} from './record-owner-read-visibility.js';
// Record history projects existing encrypted snapshots; it does not create a
// second history store. Restoration changes only one record under the same lock.
import path from 'node:path';
import {AppError} from './errors.js';
import {assertRegular} from './storage.js';
import {upgradeNotebook,validateNotebook} from './model.js';
import {recordRevision,historicalBook} from './research.js';
import {ResearchMaterials} from './research-materials.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {retainedHistoryState} from './retained-record-history.js';
import {RecordHistoryDocuments} from './record-history-documents.js';

function validHistoryAnchor(anchor,{workspaceId,recordId,limit,head,retained}){
 if(!anchor||anchor.format!==2||anchor.indexFormat!==head.formatVersion||anchor.workspaceId!==workspaceId||anchor.recordId!==recordId||anchor.limit!==limit||!revisionId(anchor.snapshotId))return false;
 if(!Number.isSafeInteger(anchor.count)||anchor.count<1||anchor.count>head.count||!Number.isSafeInteger(anchor.offset)||anchor.offset<0)return false;
 if(anchor.retainedGeneration!==retained.generation||anchor.retainedCount!==retained.count||!Number.isSafeInteger(anchor.count+retained.count))return false;
 if(!Number.isSafeInteger(anchor.retainedSeen)||anchor.retainedSeen<0||anchor.retainedSeen>retained.count||!Number.isSafeInteger(anchor.retainedShown)||anchor.retainedShown<0||anchor.retainedShown>anchor.retainedSeen)return false;
 if(anchor.retainedSeen===0?anchor.retainedAfter!==null:typeof anchor.retainedAfter!=='string'||!anchor.retainedAfter.startsWith(retained.prefix))return false;
 return anchor.offset<anchor.count?anchor.retainedSeen===0:anchor.offset===anchor.count+anchor.retainedShown;
}

export class RecordHistory {
 constructor(workspace,media){this.workspace=workspace;this.media=media;this.materials=new ResearchMaterials(workspace);}
 async context({workspaceId,recordId}){
  if(!researchId(workspaceId)||!researchId(recordId))throw new AppError('INVALID');
  if(await this.workspace.storageKind()==='catalogue')return this.workspace.catalogue(async store=>{
   const manifest=await store.snapshot(),row=await store.member(manifest,recordId);
   if(manifest.metadata.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
   if(!row)throw new AppError('RECORD_CHANGED');
   const book=historicalBook(manifest.metadata,await store.record(row.id,row.revision));
   return {book,record:book.entries[0]};
  });
  const book=upgradeNotebook((await this.workspace.read()).book);
  if(book.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
  const record=book.entries.find(e=>e.id===recordId);
  if(!record)throw new AppError('RECORD_CHANGED');
  return {book,record};
 }
 async list(command){
  if(await this.workspace.storageKind()==='catalogue')return this.page(command);
  const {book,record}=await this.context(command),versions=new Map();
  const add=(value,source,current=false)=>{
   const revision=recordRevision(value);
   if(!versions.has(revision))versions.set(revision,{revision,source,current,title:value.title,status:value.status,updatedAt:value.updatedAt});
  };
  add(record,{kind:'current'},true);
  // Traverse one snapshot at a time; return only this record's distinct revisions.
  for await(const snapshot of this.workspace.revisionSnapshots()){
   if(snapshot.book.id!==book.id)throw new AppError('FORMAT');
   const value=upgradeNotebook(snapshot.book).entries.find(e=>e.id===record.id);
   if(value)add(value,{kind:'workspace',id:snapshot.id});
  }
  // Exact references can retain a revision outside the workspace save sequence.
  for(const relative of ['.observanda','.observanda/materials','.observanda/materials/records','.observanda/materials/records/'+record.id]){
   if(!await assertRegular(path.join(this.workspace.root,relative),{directory:true,missing:true}))return this.result(record,versions);
  }
  for await(const name of this.workspace.metadataNames('.observanda/materials/records/'+record.id)){
   const revision=name.replace(/\.json$/,'');
   if(!revisionId(revision)||name!==revision+'.json')continue;
   const value=await this.materials.read({kind:'record',id:record.id,revision});
   if(value.id!==record.id)throw new AppError('FORMAT');
   add(value,{kind:'retained',id:revision});
  }
  return this.result(record,versions);
 }
 async page(command){
  const {workspaceId,recordId,cursor=null,limit=20}=command;
  if(!researchId(workspaceId)||!researchId(recordId)||!Number.isSafeInteger(limit)||limit<1||limit>50||cursor!==null&&(typeof cursor!=='string'||cursor.length>4096))throw new AppError('INVALID');
  return this.workspace.catalogue(async store=>{
   const latest=await store.snapshot(),current=await store.member(latest,recordId);
   if(latest.metadata.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
   if(!current)throw new AppError('RECORD_CHANGED');
   const index=store.historyIndex(recordId),head=await index.head();await index.check(head);const retained=await retainedHistoryState(store,recordId);let anchor;
   if(cursor){try{anchor=store.decode('history-page',recordId,Buffer.from(cursor,'base64url'));}catch{throw new AppError('RECORD_HISTORY_CURSOR');}}
   else anchor={format:2,workspaceId,recordId,indexFormat:head.formatVersion,snapshotId:await store.head(),count:head.count,offset:0,limit,retainedGeneration:retained.generation,retainedCount:retained.count,retainedAfter:null,retainedSeen:0,retainedShown:0};
   if(!validHistoryAnchor(anchor,{workspaceId,recordId,limit,head,retained}))throw new AppError('RECORD_HISTORY_CURSOR');
   const manifest=await store.snapshot(anchor.snapshotId),row=await store.member(manifest,recordId);
   if(manifest.metadata.id!==workspaceId||!row)throw new AppError('RECORD_HISTORY_CURSOR');
   const currentItem=await index.lookup(head,'version',current.revision),anchorItem=await index.lookup(head,'version',row.revision);
   if(anchorItem.ordinal>=anchor.count)throw new AppError('CATALOGUE_DAMAGED');
   // Current version first, then earlier distinct revisions. Fetch only this
   // page's immutable summary rows; later saves cannot move its anchored order.
   if(anchor.offset>=anchor.count&&anchor.retainedSeen>=retained.count)throw new AppError('RECORD_HISTORY_CURSOR');
   const ordinals=[];
   for(let position=anchor.offset;position<Math.min(anchor.offset+limit,anchor.count);position++){
    if(position===0)ordinals.push(anchorItem.ordinal);
    else{let ordinal=anchor.count-position;if(ordinal<=anchorItem.ordinal)ordinal--;ordinals.push(ordinal);}
   }
   const currentView=await index.display(currentItem.item),versions=[];
   for(const item of await index.rows(head,ordinals)){
    const view=await index.display(item);await assertRecordOwnerRevisionVisible(store,recordId,view.revision,{code:'RECORD_HISTORY_MISSING'});versions.push({...view,source:{kind:'workspace',id:item.snapshotId},current:view.revision===currentView.revision});
   }
   const next={...anchor};let examined=0;
   // Continue in key order after the ordinary saved versions. Duplicate exact
   // references consume a bounded scan window, not an unbounded prefix pass.
   // A sparse window can have no new versions and still offer continuation.
   scan:while(anchor.offset+versions.length>=anchor.count&&next.retainedSeen<retained.count&&examined<128){
    const page=await store.objectIdPage(retained.prefix,{after:next.retainedAfter,limit:Math.min(32,128-examined)});
    if(!page.items.length)throw new AppError('CATALOGUE_DAMAGED');
    for(const id of page.items){
     examined++;const revision=id.slice(retained.prefix.length,-5),valid=id.endsWith('.json')&&revisionId(revision),known=valid?await index.lookup(head,'view',revision,{optional:true}):null;
     const extra=valid&&(!known||known.ordinal>=anchor.count);
     if(extra&&versions.length===limit)break scan;
     next.retainedAfter=id;next.retainedSeen++;
     if(!extra)continue;
     await assertRecordOwnerRevisionVisible(store,recordId,revision,{code:'RECORD_HISTORY_MISSING'});
     let value;try{value=JSON.parse((await store.object(id)).text);}catch{throw new AppError('CATALOGUE_DAMAGED');}
     if(value.id!==recordId||recordRevision(value)!==revision)throw new AppError('CATALOGUE_DAMAGED');
     versions.push({revision,title:value.title,status:value.status,updatedAt:value.updatedAt,source:{kind:'retained',id:revision},current:revision===currentView.revision});next.retainedShown++;
    }
   }
   const total=next.retainedSeen===retained.count?anchor.count+next.retainedShown:null;
   next.offset=anchor.offset+versions.length;const nextCursor=next.offset<anchor.count||next.retainedSeen<retained.count?store.encode('history-page',recordId,next).toString('base64url'):null;
   return {recordId,title:currentView.title,currentRevision:currentView.revision,versions,total,offset:anchor.offset,cursor:store.encode('history-page',recordId,anchor).toString('base64url'),nextCursor,changed:row.revision!==current.revision};
  });
 }
 result(record,versions){
  return {recordId:record.id,currentRevision:recordRevision(record),versions:[...versions.values()].sort((a,b)=>Number(b.current)-Number(a.current)||b.updatedAt.localeCompare(a.updatedAt)||a.revision.localeCompare(b.revision))};
 }
 async historical(command,book){
  const {source,revision,recordId}=command;
  if(!revisionId(revision)||!source||!['current','workspace','retained'].includes(source.kind))throw new AppError('INVALID');
  let value;
  if(source.kind==='current')value=book.entries.find(e=>e.id===recordId);
  else{
   if(!revisionId(source.id))throw new AppError('INVALID');
   if(source.kind==='workspace'){
    if(await this.workspace.storageKind()==='catalogue'){
     value=await this.workspace.catalogue(async store=>{
      await assertRecordOwnerRevisionVisible(store,recordId,revision,{code:'RECORD_HISTORY_MISSING'});
      const manifest=await store.recordSnapshot(source.id,recordId),row=await store.member(manifest,recordId);
      if(manifest.metadata.id!==book.id||!row)throw new AppError('RECORD_HISTORY_MISSING');
      return historicalBook(manifest.metadata,await store.record(row.id,row.revision)).entries[0];
     });
    }else{
    const previous=upgradeNotebook(await this.workspace.readRevision(source.id));
    if(previous.id!==book.id)throw new AppError('WORKSPACE_CHANGED');
    value=previous.entries.find(e=>e.id===recordId);
    }
   }else value=await this.materials.read({kind:'record',id:recordId,revision:source.id});
  }
  if(!value||value.id!==recordId||recordRevision(value)!==revision)throw new AppError('RECORD_HISTORY_MISSING');
  return value;
 }
 async read(command,{signal}={}){
  if(command.paged===true&&await this.workspace.storageKind()==='catalogue'){
   const result=await new RecordHistoryDocuments(this.workspace,this.media).read(command,{signal});if(result)return result;
  }
  const {book,record}=await this.context(command);
  return {record:await this.historical(command,book),current:record,currentRevision:recordRevision(record)};
 }
 async restore(command,{compact=false,recordIds=null,receipt=false}={}){
  if(typeof receipt!=='boolean')throw new AppError('INVALID');
  if(!researchId(command.workspaceId)||!researchId(command.recordId)||!revisionId(command.expectedRevision)||command.baseEtag!==undefined&&!revisionId(command.baseEtag))throw new AppError('INVALID');
  if(receipt&&await this.workspace.storageKind()==='catalogue'){
   const result=await new RecordHistoryDocuments(this.workspace,this.media).restore(command);if(result)return result;
  }
  const apply=async source=>{
   const {partialRecords,...value}=source,book=partialRecords?structuredClone(value):upgradeNotebook(value);
   if(book.id!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
   const index=book.entries.findIndex(e=>e.id===command.recordId),current=book.entries[index];
   if(!current||recordRevision(current)!==command.expectedRevision)throw new AppError('RECORD_CHANGED');
   const previous=await this.historical(command,book);
   if(recordRevision(current)===recordRevision(previous))return null;
   // Keep today's organisation. Old publication choices require a fresh review.
   const restored={...structuredClone(previous),notebookId:current.notebookId,createdAt:current.createdAt,updatedAt:current.updatedAt,share:false};
   // An earlier narrative must not erase later preparation/event/assessment
   // facts. Their corrections are appended explicitly in the attempt editor.
   if(current.attempt)restored.attempt=structuredClone(current.attempt);
   restored.attachments=restored.attachments.map(a=>({...a,share:false}));
   book.entries[index]=restored;if(!partialRecords)validateNotebook(book);
   for(const attachment of restored.attachments){
    const file=await this.media.get(attachment.id,{streamed:true});
    if(file.kind!==attachment.kind)throw new AppError('MEDIA_INVALID');
   }
   return book;
  };
  if(await this.workspace.storageKind()==='catalogue'){
   const eligible=await this.workspace.catalogue(async store=>[20,21].includes((await store.snapshot()).metadata.formatVersion));
   if(eligible)return this.workspace.updateRecords({workspaceId:command.workspaceId,changes:[{id:command.recordId}],...(command.baseEtag?{baseEtag:command.baseEtag}:{})},apply,{compact,recordIds});
  }
  return this.workspace.update(apply);
 }
}
