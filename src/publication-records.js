import {sourceSelectionReader,sourceRecordChoice,sourceRecordOrder} from './website-source-selections.js';
// Resolve sparse website consent against original sharing ranges. The saved
// index remains unchanged by draft choices or other websites' selections.
import {RecordPublicationIndex,publicationReadingKey} from './record-publication-index.js';
import {recordOrder} from './record-order.js';
import {RecordReadingIndex,readingKey} from './record-reading-index.js';
export async function* publicationRecords(store,snapshot,{metadata,selection,overrides,notebooks,order='position',after=null,backward=false,recordId=null,signal}){
 if(sourceSelectionReader(selection)){
  const index=new RecordPublicationIndex(store),reader=sourceSelectionReader(selection),ordered=await sourceRecordOrder(selection,store,snapshot,{order,signal}),key=row=>order==='publication'?publicationReadingKey(row,metadata.id):readingKey(row,order),boundary=after===null?null:order==='publication'?readingKey(after,'date'):key(order==='position'?{position:after}:after);
  const notebooksById=new Map(metadata.notebooks.map(book=>[book.id,book])),scopes=new Map([...notebooks].filter(id=>selection.includeProjects.includes(notebooksById.get(id)?.projectId)||selection.defaultShare!==false).map(id=>[id,'shared']));
  async function* explicit(){for await(const row of ordered.items({after:boundary,backward,recordId}))if(notebooks.has(row.notebookId)&&row.share===true)yield row;}
  if(recordId!==null){
   let row=await ordered.get(recordId);if(!row){const member=await store.member(snapshot,recordId);if(!member)return;row=await index.describe(member.position===undefined&&Array.isArray(snapshot.records)?{...member,position:snapshot.records.findIndex(value=>value.id===member.id)}:member,order!=='position');}const choice=await sourceRecordChoice(selection,recordId),at=key(row);
   if(row.share===true&&notebooks.has(row.notebookId)&&(choice?.share??scopes.has(row.notebookId))&&(boundary===null||(backward?at<boundary:at>boundary)))yield row;return;
  }
  const extra=explicit()[Symbol.asyncIterator]();let next=await extra.next();
  try{
   if(scopes.size){
    // Older immutable database snapshots have no publication index. Reuse the
    // selection's bounded scratch index, including public-identity date ties;
    // forward-only recordOrder cannot serve reverse or dated continuations.
    const rows=snapshot.publicationIndex?index.rows(snapshot,scopes,{order,after,backward,signal}):(await reader.order(snapshot,async function*(){
     for await(const member of store.members(snapshot,{signal})){
      signal?.throwIfAborted();const row=await index.describe(member,order!=='position');if(row.share===true)yield row;
     }
    },{order:'shared:'+order,keyOf:key})).items({after:boundary,backward});
    for await(const row of rows){
     signal?.throwIfAborted();if(!scopes.has(row.notebookId)||recordId!==null&&row.id!==recordId)continue;
     while(!next.done&&(key(next.value)<key(row)?-1:key(next.value)>key(row)?1:0)*(backward?-1:1)<0){yield next.value;next=await extra.next();}
     if(!next.done&&next.value.id===row.id)next=await extra.next();
     if((await sourceRecordChoice(selection,row.id))?.share!==false)yield row;
    }
   }
   while(!next.done){yield next.value;next=await extra.next();}
  }finally{await extra.return?.();}
  return;
 }
 if(!snapshot.publicationIndex){
  const rows=order==='position'&&!backward?recordOrder(store,snapshot,{after,signal}):new RecordReadingIndex(store).rows(snapshot,notebooks,{order,after:order==='position'&&after!==null?{position:after}:after,backward,signal});
  for await(const row of rows)if(row.notebookId===undefined||notebooks.has(row.notebookId))yield row;
  return;
 }
 const scopes=new Map(),owners=new Map(metadata.notebooks.map(n=>[n.id,n.projectId]));
 for(const id of notebooks){
  const all=selection.includeProjects.includes(owners.get(id))||selection.defaultShare===true;
  if(all||selection.defaultShare!==false)scopes.set(id,'shared');
 }
 const index=new RecordPublicationIndex(store),included=[],key=row=>order==='publication'?publicationReadingKey(row,metadata.id):readingKey(row,order),boundary=after===null?null:order==='publication'?readingKey(after,'date'):key(order==='position'?{position:after}:after),compare=(a,b)=>(key(a)<key(b)?-1:key(a)>key(b)?1:0)*(backward?-1:1);
 for(const {row,patch} of overrides.values())if(patch.share===true){
  signal?.throwIfAborted();const value=await index.describe(row,order!=='position'),at=key(value);
  if(value.share===true&&notebooks.has(value.notebookId)&&(boundary===null||(backward?at<boundary:at>boundary)))included.push(value);
 }
 included.sort(compare);
 let at=0;
 for await(const row of index.rows(snapshot,scopes,{order,after,backward,signal})){
  signal?.throwIfAborted();
  while(at<included.length&&compare(included[at],row)<0)yield included[at++];
  if(at<included.length&&included[at].id===row.id)at++;
  if(overrides.get(row.id)?.patch.share!==false)yield row;
 }
 while(at<included.length){signal?.throwIfAborted();yield included[at++];}
}
