import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {withRecordDocument,RecordDocument} from './record-document.js';
import {recordReadingHeader,validHeaderWindows} from './record-reading-header.js';
import {digest} from './storage-format.js';
import {changedRecordFields} from './record-document-comparison.js';
import {copyRecordValue} from './record-document-copy.js';
import {RecordContainerBuilder} from './record-tree-values.js';
import {RecordMemberCollections} from './record-member-collections.js';
import {recordDocumentSummary} from './record-document-summary.js';
import {validateRecordDocument} from './record-document-validation.js';
import {validateDocumentSources} from './record-document-sources.js';
import {commitRecordDocument} from './record-document-commit.js';
import {resultAnchorId} from './record-result-document.js';

const target=command=>command&&researchId(command.workspaceId)&&researchId(command.recordId)&&revisionId(command.revision)&&command.source&&['current','workspace','retained'].includes(command.source.kind)&&(command.source.kind==='current'||revisionId(command.source.id));
const fields=['title','type','status','outcome','occurredOn','body','sections','template','tags','contributors','relations','figures','attachments','notebookId','share','attempt','results'];
export class RecordHistoryDocuments{
 constructor(workspace,media){this.workspace=workspace;this.media=media;}
 async context(store,command){
  const etag=await store.head(),snapshot=await store.snapshot(etag);if(snapshot.metadata.id!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
  const row=await store.member(snapshot,command.recordId);if(!row)throw new AppError('RECORD_CHANGED');
  if(snapshot.metadata.formatVersion!==21)return null;
  const history=store.historyIndex(row.id),head=await history.head(),current=(await history.display((await history.lookup(head,'version',row.revision)).item)).revision;
  let selected;
  if(command.source.kind==='retained'){
   if(command.source.id!==command.revision)throw new AppError('RECORD_HISTORY_MISSING');
   const found=await history.lookup(head,'view',command.revision,{optional:true});if(!found)return null;
   selected=await store.snapshot(found.item.snapshotId);
  }else selected=command.source.kind==='current'?snapshot:await store.snapshot(command.source.id);
  if(selected.metadata.id!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
  if(selected.metadata.formatVersion!==21)return null;
  const old=await store.member(selected,command.recordId);if(!old)throw new AppError('RECORD_HISTORY_MISSING');
  if((await history.display((await history.lookup(head,'version',old.revision)).item)).revision!==command.revision)throw new AppError('RECORD_HISTORY_MISSING');
  return {etag,snapshot,row,selected,old,current};
 }
 async read(command,{signal}={}){
  if(!target(command)||command.offset!==undefined&&(!Number.isSafeInteger(command.offset)||command.offset<0)||command.windows!==undefined&&!validHeaderWindows(command.windows)||command.resultFigure!==undefined&&!researchId(command.resultFigure)||command.anchor!==undefined&&!researchId(resultAnchorId(command.anchor)))throw new AppError('INVALID');
  return this.workspace.catalogue(async store=>{
   const context=await this.context(store,command);if(!context)return null;const {row,old,current}=context;
   return withRecordDocument(store,old.id,old.revision,earlier=>withRecordDocument(store,row.id,row.revision,async latest=>{
    const page=async(document,member)=>{
     const total=await document.tree.arrayLength(document.root,['sections']),offset=Math.min(command.offset??0,Math.max(0,total-1)),sections=await document.tree.page(document.root,['sections'],{offset,limit:4});
     const header=await recordReadingHeader(store,member,document,sections.values,{windows:command.windows,anchor:command.anchor,resultFigure:resultAnchorId(command.anchor)?undefined:command.resultFigure,signal});
     return {...header,sections,record:{...header.header,sections:sections.values}};
    };
    const changed=await changedRecordFields(earlier,latest,fields,{signal});
    const previous=await page(earlier,old),next=await page(latest,row);signal?.throwIfAborted();
    return {paged:true,record:previous.record,current:next.record,previous,next,changed,currentRevision:current};
   }));
  });
 }
 async restore(command){
  if(!target(command)||!revisionId(command.expectedRevision))throw new AppError('INVALID');
  return this.workspace.withLock(()=>this.workspace.catalogue(async store=>{
   const context=await this.context(store,command);if(!context)return null;const {etag,snapshot,row,old,current}=context;
   const receiptSlot='record-history-restore:'+digest(JSON.stringify([command.workspaceId,command.recordId,command.source,command.revision,command.expectedRevision]));
   const receipt=await store.object(receiptSlot);if(receipt)return receipt;
   if(current!==command.expectedRevision)throw new AppError('RECORD_CHANGED');
   if(current===command.revision)return {historyReceipt:true,etag,saved:true};
   return withRecordDocument(store,old.id,old.revision,source=>withRecordDocument(store,row.id,row.revision,async latest=>{
    let document=new RecordDocument(latest.blocks,await copyRecordValue(source,latest,source.root),{mutable:true});
    for(const name of ['notebookId','createdAt','updatedAt'])document=await document.replace([name],(await latest.field([name])).value);
    document=await document.replace(['share'],false);const attempt=await latest.reference(['attempt']);
    if(attempt){
     if(!await document.reference(['attempt']))document=await document.property([],'attempt',{});
     document=new RecordDocument(document.blocks,await document.replaceReference(document.root,['attempt'],await copyRecordValue(latest,document,attempt)),{mutable:true});
    }
    const attachments=new RecordContainerBuilder(document.blocks,'array');
    for await(const item of document.items(['attachments']))await attachments.add({value:await document.tree.retain({...await document.tree.read(item.value),share:false})});
    document=new RecordDocument(document.blocks,await document.replaceReference(document.root,['attachments'],await attachments.finish()),{mutable:true});
    const header=await validateRecordDocument(document,snapshot.metadata);await validateDocumentSources(store,snapshot,document,header,latest,this.media);
    const membership=new RecordMemberCollections(store);let member=row;
    for(const field of ['sections','contributors','relations','figures','attachments'])member=await membership.changed(member,field,document);
    member={...member,...await recordDocumentSummary(document,header,{revision:row.revision,memberBytes:row.bytes},{collections:member.collections})};
    const result=await commitRecordDocument(store,{etag,snapshot,row,document,member}),saved={historyReceipt:true,etag:result.etag,saved:true};
    await store.putObject(receiptSlot,saved);return saved;
   },{mutable:true}));
  }));
 }
}
