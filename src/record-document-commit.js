// Publish a validated owned-value edit through the ordinary record transaction.
// Domain callers establish the exact edit scope and optimistic guard first.
import {randomUUID} from 'node:crypto';
import {digest} from './storage-format.js';
import {validateRecordDocument} from './record-document-validation.js';
import {retainStoredDocument} from './record-storage.js';
import {RecordQueryDocuments} from './record-query-documents.js';
import {RecordMemberCollections} from './record-member-collections.js';
import {RunReadiness} from './run-readiness.js';
import {operationStage,operationAdvance} from './operation-progress.js';
import {withRecordDocument} from './record-document.js';

export async function commitRecordDocument(store,{etag,snapshot,row,document,summaries=[],member=row}){
 const now=new Date().toISOString();document=await document.replace(['updatedAt'],now);
 const readiness=new RunReadiness(store.workspace);
 // Identify collections by their stored subtree, so unchanged ones need no format inspection.
 const part=async(target,path)=>{const value=await target.tree.select(target.root,path);return JSON.stringify(value?value.inline?{inline:value.value}:{revision:value.revision}:null);};
 const paths=[['figures'],['sections'],['results','statements']],previousParts=new Map();
 const admit=async previous=>{
  if(previous)for(const path of paths)previousParts.set(path.join('/'),await part(previous,path));
  const header=await operationStage('validate-records',{},()=>validateRecordDocument(document,snapshot.metadata,{summaries,admitted:previous}));
  await readiness.documentCompletion(previous,document,header,snapshot.metadata);return header;
 };
 const header=row?await withRecordDocument(store,row.id,row.revision,admit):await admit(null);
 const encoding=await operationStage('write-record-blocks',{},()=>document.encoding()),current=await store.indexed(snapshot);
 const metadata={...current.metadata,revision:current.metadata.revision+1,updatedAt:now};
 const updated=await new RecordMemberCollections(store).retain({...member,...(!row?{position:current.nextPosition}:{}),type:header.type,share:header.share,occurredOn:header.occurredOn,revision:encoding.revision,updatedAt:now,bytes:encoding.memberBytes,...await operationStage('index-records',{},()=>new RecordQueryDocuments(store).retainDocument(document,encoding.contentRevision,{previous:row}))});
 const nextEtag=digest('Observanda/catalogue-snapshot/'+randomUUID()),ordinal=(await store.db.get('SELECT MAX(ordinal)+1 AS n FROM snapshots')).n;
 // One record and its history entry: report them as the counted "write records and history" stage.
 await operationStage('write-records',{total:1,unit:'records'},async()=>{
  const fresh=await retainStoredDocument(store,document,encoding,{unchanged:async path=>previousParts.has(path.join('/'))&&previousParts.get(path.join('/'))===await part(document,path)});
  await store.historyIndex(header.id).append({revision:encoding.revision,snapshotId:nextEtag,view:{revision:encoding.contentRevision,title:header.title,status:header.status,updatedAt:now}},{fresh,initialize:!row});
  operationAdvance();
 });
 await store.finishRecordChanges(etag,current,metadata,row?[row]:[],[updated],{etag:nextEtag,ordinal,nextPosition:current.nextPosition+(row?0:1)});
 return {etag:nextEtag,member:updated};
}
