import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {digest,serialize} from './storage-format.js';
import {withRecordDocument} from './record-document.js';
import {materialRecordSummary} from './material-record-summary.js';
import {recordSelectorPage} from './record-selector-page.js';
const natural=value=>Number.isSafeInteger(value)&&value>=0;
const cursorError=()=>{throw new AppError('WORKSPACE_READ_CURSOR');};
export class RecordSelectors{
 constructor(workspace){this.workspace=workspace;}
 async read(command,{signal}={}){
  const required=['workspaceId','recordId'],optional=['snapshotId','cursor','search'];
  if(!command||typeof command!=='object'||Array.isArray(command)||required.some(key=>!researchId(command[key]))||Object.keys(command).some(key=>![...required,...optional].includes(key))||command.snapshotId!==undefined&&!revisionId(command.snapshotId)||command.search!==undefined&&(typeof command.search!=='string'||command.search.length>160)||command.cursor!==undefined&&(typeof command.cursor!=='string'||!command.cursor||command.cursor.length>4096||!command.snapshotId))throw new AppError('INVALID');
  signal?.throwIfAborted();if(!this.workspace)throw new AppError('MISSING');
  return this.workspace.catalogue(async store=>{
   const currentId=await store.head(),current=await store.snapshot(currentId),etag=command.snapshotId??currentId,snapshot=command.snapshotId?await store.snapshot(etag):current;
   if(current.metadata.id!==command.workspaceId||snapshot.metadata.id!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
   if(snapshot.metadata.formatVersion!==21)throw new AppError('FORMAT');
   const row=await store.member(snapshot,command.recordId);if(!row)throw new AppError('MISSING');
   const request=digest(serialize({workspaceId:command.workspaceId,recordId:command.recordId,etag,search:command.search??''}));let position;
   if(command.cursor){
    let cursor;try{cursor=store.decode('record-selector-page',command.workspaceId,Buffer.from(command.cursor,'base64url'));}catch{cursorError();}
    if(!cursor||Object.keys(cursor).sort().join()!=='emitted,request,source,version,within'||cursor.version!==1||cursor.request!==request||![cursor.source,cursor.within,cursor.emitted].every(natural)||!cursor.source&&!cursor.within)cursorError();
    const {source,within,emitted}=cursor;position={source,within,emitted};
   }
   const page=await withRecordDocument(store,row.id,row.revision,document=>recordSelectorPage(document,{position,search:command.search,signal})),summary=await materialRecordSummary(store,row);
   signal?.throwIfAborted();return {workspaceId:command.workspaceId,recordId:row.id,etag,revision:summary.revision,...page,next:page.next?store.encode('record-selector-page',command.workspaceId,{version:1,request,...page.next}).toString('base64url'):null};
  });
 }
}
