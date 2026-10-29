import {RecordReadingIndex,readingKey} from './record-reading-index.js';
import {RecordFacetIndex} from './record-facet-index.js';
import {recordBrowse} from './web/record-query.js';
import {AppError} from './errors.js';
const point=value=>value?{id:value.id,title:value.title,occurredOn:value.occurredOn}:null;
export function indexedRecordDateQuery(query,{selection,relatedTo,runOf}={}){
 const b=recordBrowse(query.browse);return !selection&&!relatedTo&&!runOf&&query.filter==='all'&&!query.search.trim()&&b.sort==='date-desc'&&!b.journey&&b.dateKnowledge==='all'&&!b.tags.trim()&&!b.from&&!b.to&&b.domain==='all'&&b.status==='all';
}
export async function recordDatePage(store,snapshot,notebooks,anchor,{signal}={}){
 if(!snapshot.facetIndex||!snapshot.readingIndex)return null;
 const index=new RecordReadingIndex(store),head=snapshot.readingIndex,after=anchor.offset?anchor.after:null;let skipped=0,total=0;
 for(const id of notebooks){
  signal?.throwIfAborted();const start='date:'+id+':',lower=await index.rank(head,start),upper=await index.rank(head,start+'\uffff');total+=upper-lower;
  if(after)skipped+=await index.rank(head,start+readingKey(after,'date')+'\0')-lower;
 }
 if(skipped!==anchor.offset||anchor.offset>0&&anchor.offset>=total)throw new AppError('RECORD_QUERY_CURSOR');
 const facts=await new RecordFacetIndex(store).summary(snapshot,notebooks,{signal});if(facts.total!==total)throw new AppError('CATALOGUE_DAMAGED');
 async function* selected(){let count=0;for await(const row of index.rows(snapshot,notebooks,{after,signal})){yield row;if(++count===anchor.limit)return;}}
 const found=[];for await(const value of store.queryDocuments(selected(),snapshot.metadata,{signal,search:false})){const {searchText,referenceTargets,cardSources,...summary}=value;void searchText;void referenceTargets;void cardSources;found.push(summary);}
 if(found.length!==Math.min(anchor.limit,total-anchor.offset))throw new AppError('CATALOGUE_DAMAGED');
 let previousAfter=null;
 if(anchor.offset>anchor.limit){
  let member,count=0;for await(const row of index.rows(snapshot,notebooks,{after,backward:true,signal})){member=row;if(++count===anchor.limit)break;}
  if(count!==anchor.limit)throw new AppError('CATALOGUE_DAMAGED');
  for await(const value of store.queryDocuments([member],snapshot.metadata,{signal,search:false}))previousAfter=point(value);
  if(!previousAfter)throw new AppError('CATALOGUE_DAMAGED');
 }
 return {...facts,records:found,after:point(found.at(-1)),previousAfter};
}
