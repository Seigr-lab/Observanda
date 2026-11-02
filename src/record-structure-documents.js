// Hierarchy changes retain one record document at a time. Moving between books
// copies its blocks under the destination key before the single structure commit.
import {randomUUID} from 'node:crypto';
import {digest} from './storage-format.js';
import {AppError} from './errors.js';
import {RecordBlockStore} from './record-block-store.js';
import {RecordDocument,withRecordDocument,withdrawDocumentPublication} from './record-document.js';
import {copyRecordValue} from './record-document-copy.js';
import {validateRecordDocument} from './record-document-validation.js';
import {validateDocumentSources} from './record-document-sources.js';
import {retainStoredDocument} from './record-storage.js';
import {RecordQueryDocuments} from './record-query-documents.js';
import {RecordMemberCollections} from './record-member-collections.js';
import {SnapshotIndex} from './snapshot-index.js';
import {RunReadiness} from './run-readiness.js';
import {MediaStore} from './media.js';
import {operationStage,operationAdvance,operationItem} from './operation-progress.js';

export async function commitStructureDocuments(store,currentId,current,proposed,selected,targets,{removed=[],now=new Date().toISOString(),membershipRebuilt=false,metadataUnchanged=false,signal,onProgress=()=>{}}={}){
 if(proposed.id!==current.metadata.id||proposed.revision!==current.metadata.revision||proposed.createdAt!==current.metadata.createdAt)throw new AppError('CONFLICT');
 const index=new SnapshotIndex(store,{cacheSize:4096,cacheMembers:true}),before=[],after=[],removedIds=new Set(removed);
 if(removedIds.size!==removed.length)throw new AppError('INVALID');
 const metadata={...proposed,entries:[],revision:current.metadata.revision+1,updatedAt:now};
 const etag=digest('Observanda/catalogue-snapshot/'+randomUUID()),ordinal=(await store.db.get('SELECT MAX(ordinal)+1 AS n FROM snapshots')).n;
 const media=new MediaStore(store.workspace),membership=new RecordMemberCollections(store),query=new RecordQueryDocuments(store);
 for(const id of removedIds){const row=await index.get(current.membership,id);if(!row)throw new AppError('CONFLICT');before.push(row);}
 const total=selected.length??current.count;
 await operationStage('write-records',{total,unit:'records'},async()=>{
  let loaded=0;
  for await(const selectedRow of selected){
   signal?.throwIfAborted();onProgress({stage:'records',loaded:loaded++,total});signal?.throwIfAborted();
   const target=typeof targets==='function'?targets(selectedRow):targets.get(selectedRow.id);if(!target)continue;
   const row=await index.get(current.membership,selectedRow.id);
   if(!row||row.revision!==selectedRow.revision||removedIds.has(row.id))throw new AppError('CONFLICT');
   await withRecordDocument(store,row.id,row.revision,async original=>{
    const moved=row.notebookId!==target.notebookId,share=target.share&&(await original.field(['share'],{signal})).value;
    if(!moved&&target.share)return;
    let key;
    try{
     let document=original;
     if(moved){
      key=await store.scopeKey(target.notebookId,1,{create:true});
      const destination=new RecordDocument(new RecordBlockStore(store,target.notebookId,1,key),null,{mutable:true});
      document=new RecordDocument(destination.blocks,await copyRecordValue(original,destination,original.root,{signal}),{mutable:true});
      document=await document.replace(['notebookId'],target.notebookId,{signal});
     }
     if(!target.share)document=await withdrawDocumentPublication(document,{signal});
     if(document===original)return;
     document=await document.replace(['updatedAt'],now,{signal});
     const header=await validateRecordDocument(document,metadata,{signal});operationItem(header.title);
     await validateDocumentSources(store,{...current,metadata},document,header,original,media,{signal});
     await new RunReadiness(store.workspace).documentCompletion(original,document,header,metadata);
     const encoding=await document.encoding({signal}),updated=await membership.retain({...row,notebookId:target.notebookId,share,updatedAt:now,revision:encoding.revision,bytes:encoding.memberBytes,...await query.retainDocument(document,encoding.contentRevision,{previous:row,signal})});
     const fresh=await retainStoredDocument(store,document,encoding);
     await store.historyIndex(row.id).append({revision:encoding.revision,snapshotId:etag,view:{revision:encoding.contentRevision,title:header.title,status:header.status,updatedAt:now}},{fresh});
     before.push(row);after.push(updated);
    }finally{key?.fill(0);}
   },{mutable:true});
   operationAdvance();
  }
 });
 signal?.throwIfAborted();if(metadataUnchanged&&!before.length&&!after.length)return currentId;
 onProgress({stage:'indexing'});
 return store.finishRecordChanges(currentId,current,metadata,before,after,{removed,now,membershipRebuilt,bulk:true,index,etag,ordinal});
}
