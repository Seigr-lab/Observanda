import {RecordReadingIndex,readingKey} from './record-reading-index.js';
import {RecordFacetIndex} from './record-facet-index.js';
import {AppError} from './errors.js';

// Consume each owner's small window while its read snapshot is open. No live
// iterator or authorization result is retained across independent owners.
export async function recordDateWindow(store,snapshot,notebooks,{offset,after,limit,workspaceId,signal}){
 if(!snapshot.readingIndex||!snapshot.facetIndex)return null;
 const index=new RecordReadingIndex(store),head=snapshot.readingIndex,boundary=offset?after:null,includeEqual=boundary?workspaceId<=boundary.owner.workspaceId:true;let total=0,skipped=0;
 for(const id of notebooks){
  signal?.throwIfAborted();const start='date:'+id+':',lower=await index.rank(head,start),upper=await index.rank(head,start+'\uffff');total+=upper-lower;
  if(boundary)skipped+=await index.rank(head,start+readingKey(boundary,'date')+(includeEqual?'\0':''))-lower;
 }
 const facts=await new RecordFacetIndex(store).summary(snapshot,notebooks,{signal});if(facts.total!==total)throw new AppError('CATALOGUE_DAMAGED');
 async function* selected(){let count=0;for await(const row of index.rows(snapshot,notebooks,{after:boundary,inclusive:!includeEqual,signal})){yield row;if(++count===limit)return;}}
 const records=[];for await(const record of store.queryDocuments(selected(),snapshot.metadata,{search:false,signal}))records.push(record);
 const preceding=[];
 if(offset>limit)for await(const row of index.rows(snapshot,notebooks,{after:boundary,backward:true,inclusive:includeEqual,signal})){
  // Date comparison needs no title decoding for a previous-page boundary.
  preceding.push({id:row.id,title:'',occurredOn:row.occurredOn,owner:{workspaceId}});if(preceding.length===limit+1)break;
 }
 return {...facts,skipped,records,preceding};
}
