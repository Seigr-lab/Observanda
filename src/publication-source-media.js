import {sourceRecordIncluded,sourceRecordChoice,sourceSelectionRevision} from './website-source-selections.js';
import {memberCollectionCount} from './record-member-collections.js';
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {validPublicationSources} from './web/publication-sources-model.js';
import {PublicationPreviewOwner} from './publication-preview-owner.js';
import {PublicationOwnerIdentities} from './publication-owner-identities.js';
import {publicationSourceCandidates} from './publication-source-candidates.js';
import {withRecordDocument} from './record-document.js';

const invalid=()=>{throw new AppError('INVALID');},cursorError=()=>{throw new AppError('PUBLICATION_SELECTION_CURSOR');};
// Media choices read attachment fields, never record prose. Retained edition
// choices use their authenticated derivative, with only one original at a time.
export async function publicationSourceMedia(store,snapshot,pinned,host,query,{signal}={}){
 const {source,search,cursor,backward}=query;
 if(Object.keys(query).sort().join()!=='backward,cursor,search,snapshotId,source,workspaceId'||!validPublicationSources([source])||source.workspaceId!==snapshot.metadata.id||typeof search!=='string'||search.length>512||typeof backward!=='boolean'||cursor!==null&&(typeof cursor!=='string'||!cursor.length||cursor.length>4096))invalid();
 const namespace=source.workspaceId,identity=digest(serialize({version:1,host:host.workspaceId,snapshotId:pinned.snapshotId,source:sourceSelectionRevision(source),search}));
 let anchor={identity,point:null,backward};if(cursor){try{anchor=store.decode('publication-source-media',namespace,Buffer.from(cursor,'base64url'));}catch{cursorError();}}
 if(anchor?.identity!==identity||typeof anchor.backward!=='boolean'||anchor.point!==null&&(!Number.isSafeInteger(anchor.point?.record)||anchor.point.record<0||!Number.isSafeInteger(anchor.point?.attachment)||anchor.point.attachment< -1))cursorError();
 const encode=(point,backward)=>store.encode('publication-source-media',namespace,{identity,point,backward}).toString('base64url');
 const reader={use:async(_id,_revision,consume)=>({value:await consume(store,snapshot,pinned)})};
 const owner=await new PublicationPreviewOwner(source,reader,new PublicationOwnerIdentities(host.workspaceId),{signal}).initialize(),reverse=anchor.backward,needle=search.trim().toLocaleLowerCase();
 const after=anchor.point?(reverse?anchor.point.record+1:anchor.point.record?anchor.point.record-1:null):null,items=[];
 let first=null,last=null,records=0,attachments=0,more=false;
 for await(const candidate of publicationSourceCandidates(store,snapshot,owner,{after,backward:reverse,signal})){
  signal?.throwIfAborted();if(records===128||attachments===256||items.length===12){more=true;break;}records++;
  const patch=await sourceRecordChoice(owner.source.selection,candidate.row?.id);
  let recordId,title,notebookId,selected=null;
  if(candidate.historical){
   const descriptor=await owner.describeHistory(candidate.historical);selected=owner.originals.get(candidate.historical);recordId=descriptor.id;title=descriptor.title;notebookId=descriptor.notebookId;
  }else{
   const [summary]=await Array.fromAsync(store.queryDocuments([candidate.row],snapshot.metadata,{signal,search:false,publication:true}));
   const book=owner.metadata.notebooks.find(book=>book.id===summary.notebookId),project=owner.metadata.projects.find(project=>project.id===book?.projectId);
   if(!project?.share||!await sourceRecordIncluded(owner.source.selection,summary,project.id)){first??={record:candidate.key,attachment:0};last={record:candidate.key,attachment:0};continue;}
   recordId=owner.id('record',summary.id);title=summary.title;notebookId=owner.id('notebook',summary.notebookId);
   if(await owner.choices.has(summary.id))selected=(await owner.selected(store,snapshot,owner.projectedRow(candidate.row))).selected;
  }
  const visit=async(count,read)=>{
   let index=anchor.point?.record===candidate.key?anchor.point.attachment+(reverse?-1:1):reverse?count-1:0;
   if(!count){first??={record:candidate.key,attachment:-1};last={record:candidate.key,attachment:-1};}
   for(;index>=0&&index<count;index+=reverse?-1:1){
    signal?.throwIfAborted();if(attachments===256||items.length===12){more=true;break;}attachments++;
    const point={record:candidate.key,attachment:index};first??=point;last=point;
    const attachment=await read(index),shared=attachment.share===true&&(selected?true:patch?.attachments.find(choice=>choice.id===attachment.id)?.share??true);
    if(!shared)continue;
    const publicId=candidate.historical?attachment.id:owner.id('media',attachment.id),sourceId=candidate.historical?Object.entries(owner.descriptors.get(candidate.historical).mediaIdentities).find(([,value])=>value===publicId)?.[0]:attachment.id;
    if(!sourceId)throw new AppError('CATALOGUE_DAMAGED');
    const asset={id:publicId,kind:attachment.kind,caption:attachment.caption??'',alt:attachment.alt??'',share:true},label=title+' / '+(asset.caption||asset.alt||asset.kind);
    if(needle&&!label.toLocaleLowerCase().includes(needle))continue;
    items.push({key:recordId+':'+publicId,label,entryId:recordId,asset,sourceAttachmentId:sourceId,owner:pinned.owner,record:{id:recordId,title,notebookId}});
   }
  };
  if(selected)await visit(selected.attachments.length,async index=>selected.attachments[index]);
  else await withRecordDocument(store,candidate.row.id,candidate.row.revision,async document=>visit(memberCollectionCount(candidate.row,'attachments')??await document.tree.arrayLength(document.root,['attachments']),async index=>{
   const result={};for(const field of ['id','kind','caption','alt','share'])result[field]=(await document.field(['attachments',String(index),field],{signal})).value;return result;
  }));
  if(candidate.historical){owner.originals.delete(candidate.historical);owner.descriptors.delete(candidate.historical);owner.rows.delete(candidate.historical);}
  if(more)break;
 }
 if(reverse)items.reverse();const start=reverse?last:first,end=reverse?first:last;
 return {workspaceId:namespace,snapshotId:pinned.snapshotId,items,previousCursor:(reverse?more:anchor.point!==null)&&start?encode(start,true):null,nextCursor:(reverse?anchor.point!==null:more)&&end?encode(end,false):null};
}
