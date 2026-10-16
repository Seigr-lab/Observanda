import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {placedFigures} from './web/book-selectors.js';
import {MediaStore} from './media.js';
import {withRecordDocument} from './record-document.js';
import {selectedRecordValue} from './record-values.js';
import {RecordMemberCollections,memberCollectionCount} from './record-member-collections.js';
import {commitRecordDocument} from './record-document-commit.js';

const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys.sort().join();
// Association commands never delete media bytes. Earlier revisions and other
// records may still use the same original and prepared copy.
export class RecordMediaCommands{
 constructor(workspace){this.workspace=workspace;}
 async select(store,command){
  const etag=await store.head(),snapshot=await store.snapshot(etag);
  if(snapshot.metadata.id!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
  if(snapshot.metadata.formatVersion!==21)throw new AppError('FORMAT');
  const row=await store.member(snapshot,command.recordId);if(!row)throw new AppError('MISSING');
  const members=new RecordMemberCollections(store),index=await members.position(row,'attachments',command.mediaId);
  return {etag,snapshot,row,members,index};
 }
 async run(command){
  const extra=command?.action==='attach'?[]:command?.action==='remove'?['expectedRevision']:null;
  if(!extra||!exact(command,['workspaceId','recordId','mediaId','action',...extra])||![command.workspaceId,command.recordId,command.mediaId].every(researchId)||command.action==='remove'&&!revisionId(command.expectedRevision))throw new AppError('INVALID');
  const media=new MediaStore(this.workspace);
  // Verify a new prepared file before taking the writer lock. This streams its
  // bytes; long recordings do not block unrelated edits while being inspected.
  const needsFile=command.action==='attach'&&await this.workspace.catalogue(async store=>(await this.select(store,command)).index<0);
  const prepared=needsFile?await media.get(command.mediaId,{streamed:true,includeHeader:false}).catch(error=>{if(error.code==='ENOENT')throw new AppError('MISSING');throw error;}):null;
  return this.workspace.withLock(()=>this.workspace.catalogue(async store=>{
   const {etag,snapshot,row,members,index}=await this.select(store,command);
   const receipt=(version,member,position)=>({etag:version,saved:true,mediaId:command.mediaId,position,total:memberCollectionCount(member,'attachments')});
   if(command.action==='attach'&&index>=0||command.action==='remove'&&index<0)return receipt(etag,row,index);
   // An existing association was removed during preparation: ask the caller to
   // retry instead of accepting a file this command has not verified.
   if(command.action==='attach'){
    if(!prepared)throw new AppError('RECORD_CHANGED');
    const {metadata}=await media.metadata(command.mediaId);
    if(metadata.kind!==prepared.kind||metadata.bytes!==prepared.bytes.size||metadata.sha256!==prepared.bytes.sha256)throw new AppError('MEDIA_INVALID');
   }
   return withRecordDocument(store,row.id,row.revision,async original=>{
    let document,position=index;
    if(command.action==='attach'){
     position=memberCollectionCount(row,'attachments');
     document=await original.splice(['attachments'],position,0,[{id:command.mediaId,kind:prepared.kind,caption:'',alt:'',transcript:'',share:false}]);
    }else{
     const selected=await selectedRecordValue(original,'media:'+command.mediaId,{position:index});
     if(selected.revision!==command.expectedRevision)throw new AppError('RECORD_CHANGED');
     const inUse=body=>placedFigures({body}).has(command.mediaId);
     if(inUse((await original.field(['body'])).value))throw new AppError('MEDIA_IN_USE');
     for await(const item of original.items(['sections'])){
      if(inUse((await original.tree.selected(item.value,['body'])).value))throw new AppError('MEDIA_IN_USE');
     }
     document=await original.splice(['attachments'],index,1,[]);
    }
    const member=await members.changed(row,'attachments',document),saved=await commitRecordDocument(store,{etag,snapshot,row,document,member});
    return receipt(saved.etag,saved.member,position);
   },{mutable:true});
  }));
 }
}
