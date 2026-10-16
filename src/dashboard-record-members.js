import {researchCardFields,researchCardKey} from './web/research-card-items.js';
import {labRecordProvider,labDataRecord} from './web/laboratory/data-scope.js';
import {recordQueryMatcher} from './web/record-query.js';
import {matchesRecordType} from './web/record-model.js';
import {RecordMemberCollections,memberCollectionCount} from './record-member-collections.js';

// Membership and filter projections select records before any card body is read.
export async function* dashboardRecordMembers(store,snapshot,{provider,ids,filters:c,key,signal}){
 const field=researchCardFields[provider],lab=labRecordProvider(provider),metadata=snapshot.metadata;
 const search=lab&&typeof c.search==='string'?c.search:'',matches=recordQueryMatcher();
 const selectedRecord=key&&provider!=='figures'?key.split(':')[0]:null;
 const rows=selectedRecord?[(await store.member(snapshot,selectedRecord))].filter(Boolean):store.searchMembers(snapshot,ids,search,{signal});
 for await(const row of rows){
  signal?.throwIfAborted();if(!ids.has(row.notebookId))continue;
  const legacy=row.updatedAt===undefined||field&&memberCollectionCount(row,field)===null?await store.record(row.id,row.revision):null;
  if(lab||c.recordType!=='all'||c.status!=='all'||c.tag){
   const [doc]=await Array.fromAsync(store.queryDocuments([row],metadata,{signal,search:false,matching:search}));
   if(!doc||lab&&(!labDataRecord(doc,lab.profile)||!matches(doc)))continue;
   if(!matchesRecordType(doc,c.recordType)||c.status!=='all'&&doc.status!==c.status||c.tag&&!doc.tags.includes(c.tag))continue;
  }
  let quantity=field?memberCollectionCount(row,field)??legacy[field].length:1;
  if(field&&key){
   const found=row.collections?await new RecordMemberCollections(store).position(row,field,key.split(':').at(-1))>=0:
    (field==='sections'?row.sections:row.cardItems?.[field]??legacy[field].map(item=>item.id)).some(id=>researchCardKey(provider,row.id,id)===key);
   quantity=Number(found);
  }
  if(quantity)yield {id:row.id,revision:row.revision,notebookId:row.notebookId,bytes:row.bytes,updatedAt:row.updatedAt??legacy.updatedAt,quantity};
 }
}
