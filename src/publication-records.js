// Resolve sparse website consent against original sharing ranges. The saved
// index remains unchanged by draft choices or other websites' selections.
import {RecordPublicationIndex,publicationReadingKey} from './record-publication-index.js';
import {recordOrder} from './record-order.js';
import {RecordReadingIndex,readingKey} from './record-reading-index.js';
export async function* publicationRecords(store,snapshot,{metadata,selection,overrides,notebooks,order='position',after=null,backward=false,signal}){
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
