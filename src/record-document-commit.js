// Publish a validated owned-value edit through the ordinary record transaction.
// Domain callers establish the exact edit scope and optimistic guard first.
import {randomUUID} from 'node:crypto';
import {digest} from './storage-format.js';
import {validateRecordDocument} from './record-document-validation.js';
import {retainStoredDocument} from './record-storage.js';
import {RecordQueryDocuments} from './record-query-documents.js';
import {RecordMemberCollections} from './record-member-collections.js';
import {RunReadiness} from './run-readiness.js';
import {operationStage} from './operation-progress.js';
import {withRecordDocument} from './record-document.js';

export async function commitRecordDocument(store,{etag,snapshot,row,document,summaries=[],member=row}){
 const now=new Date().toISOString();document=await document.replace(['updatedAt'],now);
 const readiness=new RunReadiness(store.workspace);
 const admit=async previous=>{
  const header=await operationStage('validate-records',{},()=>validateRecordDocument(document,snapshot.metadata,{summaries,admitted:previous}));
  await readiness.documentCompletion(previous,document,header,snapshot.metadata);return header;
 };
 const header=row?await withRecordDocument(store,row.id,row.revision,admit):await admit(null);
 const encoding=await operationStage('write-record-blocks',{},()=>document.encoding()),current=await store.indexed(snapshot);
 const metadata={...current.metadata,revision:current.metadata.revision+1,updatedAt:now};
 const updated=await new RecordMemberCollections(store).retain({...member,...(!row?{position:current.nextPosition}:{}),type:header.type,share:header.share,occurredOn:header.occurredOn,revision:encoding.revision,updatedAt:now,bytes:encoding.memberBytes,...await operationStage('index-records',{},()=>new RecordQueryDocuments(store).retainDocument(document,encoding.contentRevision,{previous:row}))});
 const fresh=await operationStage('write-records',{},()=>retainStoredDocument(store,document,encoding));
 const nextEtag=digest('Observanda/catalogue-snapshot/'+randomUUID()),ordinal=(await store.db.get('SELECT MAX(ordinal)+1 AS n FROM snapshots')).n;
 await store.historyIndex(header.id).append({revision:encoding.revision,snapshotId:nextEtag,view:{revision:encoding.contentRevision,title:header.title,status:header.status,updatedAt:now}},{fresh,initialize:!row});
 await store.finishRecordChanges(etag,current,metadata,row?[row]:[],[updated],{etag:nextEtag,ordinal,nextPosition:current.nextPosition+(row?0:1)});
 return {etag:nextEtag,member:updated};
}
