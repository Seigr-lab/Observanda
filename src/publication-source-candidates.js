import {RecordSearchIndex} from './record-search-index.js';
import {publicationRecords} from './publication-records.js';

// Ordered owner-local candidates, shared by page and media discovery. Search
// continuations seek index positions and keep one frontier per selected book.
export async function* publicationSourceCandidates(store,snapshot,owner,{after=null,backward=false,search='',signal}={}){
 const metadata=owner.metadata,notebooks=new Set(metadata.notebooks.filter(book=>metadata.projects.some(project=>project.id===book.projectId&&project.share)).map(book=>book.id));
 const history=[...owner.history.keys()],boundary=after,reverse=backward,needle=search.trim().toLocaleLowerCase(),historyBase=snapshot.nextPosition;
 async function* current(){
  if(!reverse&&boundary!==null&&boundary>=historyBase)return;
  const position=boundary===null||boundary>=historyBase?null:boundary;
  const overrides=await owner.overrides(store,snapshot);
  if(needle&&snapshot.searchIndex){
   const index=new RecordSearchIndex(store),lanes=[];
   for(const notebookId of notebooks){const iterator=index.candidates(snapshot.searchIndex,new Set([notebookId]),needle,{signal,after:position,backward:reverse})[Symbol.asyncIterator]();lanes.push({iterator,next:await iterator.next()});}
   try{for(;;){const available=lanes.filter(lane=>!lane.next.done).sort((a,b)=>(a.next.value.position-b.next.value.position)*(reverse?-1:1)),lane=available[0];if(!lane)break;const row=lane.next.value;if(owner.included(row.id))yield {key:row.position,row};lane.next=await lane.iterator.next();}}
   finally{for(const lane of lanes)await lane.iterator.return?.();}
  }else for await(const row of publicationRecords(store,snapshot,{...owner.options(),notebooks,overrides,after:position,backward:reverse}))if(owner.included(row.id))yield {key:row.position,row};
 }
 async function* historical(){
  for(let step=0;step<history.length;step++){
   const index=reverse?history.length-1-step:step,key=historyBase+index;
   if(boundary!==null&&(reverse?key>=boundary:key<=boundary))continue;
   yield {key,historical:history[index]};
  }
 }
 if(reverse){yield* historical();yield* current();}else{yield* current();yield* historical();}
}
