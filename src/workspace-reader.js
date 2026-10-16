// Read immutable snapshot members in bounded pages. No read session writes or
// server-held transaction spans requests; the authenticated cursor pins its root.
import {AppError} from './errors.js';
import {SnapshotIndex} from './snapshot-index.js';
import {upgradeNotebook} from './model.js';
import {recordRevision,recordRevisions} from './research.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {validRecordSelection} from './web/record-scope.js';
import {recordUpdatePage} from './record-updates.js';
import {catalogueOutline,snapshotTotals} from './catalogue-outline.js';

export const WORKSPACE_PAGE_RECORDS=20;
export const WORKSPACE_PAGE_BYTES=256*1024;
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const cursorError=()=>{throw new AppError('WORKSPACE_READ_CURSOR');};
export class WorkspaceReader {
 constructor(workspace){this.workspace=workspace;}
 async version(command,{signal}={}){
  if(!command||Object.keys(command).join()!=='workspaceId'||!researchId(command.workspaceId))throw new AppError('INVALID');
  const {workspaceId}=command;
  signal?.throwIfAborted();
  if(!this.workspace)throw new AppError('MISSING');
  const {metadata,etag}=await this.workspace.outline();
  signal?.throwIfAborted();
  if(metadata.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
  return {workspaceId,etag};
 }
 async start({signal,snapshotId=null,workspaceId=null}={}){
  if(snapshotId!==null&&(!revisionId(snapshotId)||!researchId(workspaceId)))throw new AppError('INVALID');
  signal?.throwIfAborted();
  if(!this.workspace)return {book:null};
  try{
   const outline=await this.workspace.outline();
   if(await this.workspace.storageKind()==='catalogue'&&outline.metadata.formatVersion===21){
    const result=await this.workspace.catalogue(async store=>{
     const etag=snapshotId??await store.head(),snapshot=await store.snapshot(etag);
     if(workspaceId&&snapshot.metadata.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
     if(snapshot.metadata.id!==outline.metadata.id)throw new AppError('WORKSPACE_CHANGED');
     if(snapshot.metadata.formatVersion!==21)return null;
     signal?.throwIfAborted();
     const anchor={version:snapshot.indexVersion?1:2,workspaceId:snapshot.metadata.id,etag,after:null,offset:0,bytes:0};
     const counts=await catalogueOutline(store,snapshot,{signal});
     return {metadata:snapshot.metadata,etag,...counts,
      cursor:store.encode('workspace-page',anchor.workspaceId,anchor).toString('base64url')};
    });
    if(result)return result;
   }
   // A pinned request must never silently fall back to the latest snapshot.
   if(snapshotId!==null)throw new AppError('INVALID');
   // Older documents keep their established validation and upgrade path.
   const result=await this.workspace.read(),book=upgradeNotebook(result.book);
   signal?.throwIfAborted();return {...result,book,recordRevisions:recordRevisions(book)};
  }catch(error){if(error.code==='MISSING')return {book:null};throw error;}
 }
 async selection(command,{signal}={}){
  const snapshotId=command?.snapshotId??null;
  if(!command||Object.keys(command).sort().join()!==(Object.hasOwn(command,'snapshotId')?'ids,snapshotId,workspaceId':'ids,workspaceId')||!researchId(command.workspaceId)||!validRecordSelection(command.ids)||snapshotId!==null&&!revisionId(snapshotId))throw new AppError('INVALID');
  if(!this.workspace)throw new AppError('MISSING');
  return this.workspace.catalogue(async store=>{
   if((await store.snapshot()).metadata.id!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
   return store.recordSelection(command.ids,{signal,snapshotId,workspaceId:command.workspaceId});
  });
 }
 async labels(command,{signal}={}){
  if(!command||Object.keys(command).sort().join()!=='etag,ids,workspaceId'||!researchId(command.workspaceId)||!revisionId(command.etag)||!validRecordSelection(command.ids))throw new AppError('INVALID');
  signal?.throwIfAborted();if(!this.workspace)throw new AppError('MISSING');
  return this.workspace.catalogue(async store=>{
   if((await store.snapshot()).metadata.id!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
   const source=await store.snapshot(command.etag);
   if(source.metadata.id!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
   const records=[],missing=[];
   for(const id of command.ids){
    signal?.throwIfAborted();const row=await store.member(source,id);
    if(!row){missing.push(id);continue;}
    // The query document owns display labels. Do not retrieve original bodies
    // or return search text, fields or other unrelated record metadata.
    for await(const label of store.queryDocuments([row],source.metadata,{signal,search:false}))records.push({id:label.id,title:label.title,notebookId:label.notebookId});
   }
   signal?.throwIfAborted();return {workspaceId:command.workspaceId,etag:command.etag,records,missing};
  });
 }
 async changes(command,{signal}={}){
  if(!command||typeof command!=='object'||Array.isArray(command)||Object.keys(command).length!==2)throw new AppError('INVALID');
  const {workspaceId,baseEtag}=command;
  if(!researchId(workspaceId)||!revisionId(baseEtag))throw new AppError('INVALID');
  signal?.throwIfAborted();
  if(!this.workspace)throw new AppError('MISSING');
  if(await this.workspace.storageKind()==='catalogue'){
   const result=await this.workspace.catalogue(async store=>{
    const current=await store.snapshot();
    if(current.metadata.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
    if(current.metadata.formatVersion!==21)return null;
    const base=await store.snapshot(baseEtag);
    if(base.metadata.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
    if(base.metadata.formatVersion!==21)return null;
    signal?.throwIfAborted();
    const patch=await store.recordPatch(baseEtag,{signal});
    signal?.throwIfAborted();return patch;
   });
   if(result)return result;
  }
  const result=await this.workspace.read(),book=upgradeNotebook(result.book);
  if(book.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
  signal?.throwIfAborted();return {...result,book,recordRevisions:recordRevisions(book)};
 }
 async changePage(command,{signal}={}){
  if(!command||Object.keys(command).sort().join()!=='cursor,workspaceId'||!researchId(command.workspaceId)||typeof command.cursor!=='string'||!command.cursor.length||command.cursor.length>4096)throw new AppError('INVALID');
  signal?.throwIfAborted();if(!this.workspace)throw new AppError('MISSING');
  return this.workspace.catalogue(store=>recordUpdatePage(store,command,{signal}));
 }
 async page(command, {signal}={}){
  if(!command||typeof command!=='object'||Array.isArray(command)||Object.keys(command).length!==2)throw new AppError('INVALID');
  const {workspaceId,cursor}=command;
  if(!researchId(workspaceId)||typeof cursor!=='string'||!cursor.length||cursor.length>4096)throw new AppError('INVALID');
  signal?.throwIfAborted();
  if(!this.workspace)throw new AppError('MISSING');
  return this.workspace.catalogue(async store=>{
   let anchor;
   try{anchor=store.decode('workspace-page',workspaceId,Buffer.from(cursor,'base64url'));}catch(error){if(error.code==='ACCESS_LOCKED')throw error;cursorError();}
   if(!anchor||![1,2].includes(anchor.version)||anchor.workspaceId!==workspaceId||!revisionId(anchor.etag)||
    !Number.isSafeInteger(anchor.offset)||anchor.offset<0||!Number.isSafeInteger(anchor.bytes)||anchor.bytes<0||
    (anchor.after!==null&&(anchor.version===1?!researchId(anchor.after):!Number.isSafeInteger(anchor.after)||anchor.after<0||anchor.after+1!==anchor.offset))||(anchor.offset===0)!==(anchor.after===null))cursorError();
   const current=await store.snapshot();
   if(current.metadata.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
   const snapshot=await store.snapshot(anchor.etag);
   const {total,totalBytes}=snapshotTotals(snapshot),flat=anchor.version===2;
   if(snapshot.metadata.id!==workspaceId||snapshot.metadata.formatVersion!==21||(flat?snapshot.indexVersion!==undefined:snapshot.indexVersion!==1))cursorError();
   if(anchor.offset>total||anchor.bytes>totalBytes)cursorError();
   const records=[];let bytes=0,after=anchor.after,more=false;
   async function* rows(){
    if(!flat){yield* new SnapshotIndex(store).members(snapshot.membership,{after});return;}
    for(let position=anchor.offset;position<total;position++)yield {...snapshot.records[position],position};
   }
   for await(const row of rows()){
    signal?.throwIfAborted();
    // A valid record larger than the target travels alone, without truncation.
    if(records.length&&(records.length===WORKSPACE_PAGE_RECORDS||bytes+row.bytes>WORKSPACE_PAGE_BYTES)){more=true;break;}
    if(row.position>=(flat?total:snapshot.nextPosition))damaged();
    const record=await store.record(row.id,row.revision);
    signal?.throwIfAborted();
    const actualBytes=Buffer.byteLength(JSON.stringify(record,null,2).split('\n').map(line=>'    '+line).join('\n'));
    if(actualBytes!==row.bytes)damaged();
    records.push({record,revision:recordRevision(record),position:row.position});bytes+=row.bytes;after=flat?row.position:row.id;
   }
   const loaded=anchor.offset+records.length,bytesLoaded=anchor.bytes+bytes;
   if(loaded>total||bytesLoaded>totalBytes||more&&loaded>=total||
    !more&&(loaded!==total||bytesLoaded!==totalBytes))damaged();
   signal?.throwIfAborted();
   const nextCursor=more?store.encode('workspace-page',workspaceId,{...anchor,after,offset:loaded,bytes:bytesLoaded}).toString('base64url'):null;
   return {workspaceId,etag:anchor.etag,offset:anchor.offset,total,totalBytes,records,loaded,bytesLoaded,nextCursor};
  });
 }
}
