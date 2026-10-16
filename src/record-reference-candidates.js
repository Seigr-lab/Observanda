import {RecordSearchIndex} from './record-search-index.js';
import {recordReferenceNamespaces} from './research-reference-namespace.js';

// Merge each book's authenticated postings in saved record order. One frontier
// per book and the index's bounded cache survive between emitted candidates.
export async function* recordReferenceCandidates({store,snapshot,notebooks,workspaceId,signal,fallback,search=''},id,{after=null,backward=false}={}){
 if(snapshot.searchIndex?.version!==2){yield* fallback({after,backward});return;}
 const needle=search.trim().toLocaleLowerCase(),index=new RecordSearchIndex(store),frontiers=[],namespaces=await recordReferenceNamespaces(store,{workspaceId,id});let last=null;
 try{
  for(const notebook of notebooks)for(const namespace of namespaces){
   signal?.throwIfAborted();const iterator=index.candidates(snapshot.searchIndex,[notebook],needle,{signal,relatedTo:{workspaceId:namespace,id},after,backward});
   const next=await iterator.next();if(!next.done)frontiers.push({iterator,row:next.value});
  }
  while(frontiers.length){
   signal?.throwIfAborted();let chosen=0;
   for(let i=1;i<frontiers.length;i++)if((frontiers[i].row.position-frontiers[chosen].row.position)*(backward?-1:1)<0)chosen=i;
   const current=frontiers[chosen];if(current.row.position!==last){yield current.row;last=current.row.position;}
   const next=await current.iterator.next();if(next.done)frontiers.splice(chosen,1);else current.row=next.value;
  }
 }finally{for(const {iterator} of frontiers)await iterator.return();}
}
