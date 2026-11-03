import {AppError} from './errors.js';
import {libraryQuery,matchesQuery,compareLibraryRows,libraryMatchRank} from './website-file-library-query.js';
import {libraryStamp,checkLibraryStamp,scanEligibleWebsiteRows,indexedWebsiteRow} from './website-file-library.js';
import {feedRowShard,readFeedSource} from './website-feed-source.js';
import {siteHasPendingSources} from './website-feed-fence.js';
export {readFeedSource};

const fields=['search','searchField','filter','dateFrom','dateTo','dateKnowledge','recordType','status','tagMode','sort','projectId','notebookId','tags','locale'];
const defaults=libraryQuery();
export function normalizeFeedCriteria(criteria={}){
 if(!criteria||typeof criteria!=='object'||Array.isArray(criteria)||Object.keys(criteria).some(key=>!fields.includes(key)))throw new AppError('INVALID');
 const q=libraryQuery(criteria),normalized={};
 for(const key of fields){
  const value=key==='search'?criteria.search?.trim():q[key];
  if(Array.isArray(value)){if(value.length)normalized[key]=value;}
  else if(value!=null&&value!==''&&value!==defaults[key])normalized[key]=value;
 }
 return normalized;
}
function member(row,q){
 if(!row||!matchesQuery(row,q))return null;
 const result={id:row.id,revision:row.revision};
 if(q.sort.startsWith('title')||q.sort==='relevance')result.title=row.title;
 if(q.sort.startsWith('date')){result.dateFrom=row.dateFrom;result.dateTo=row.dateTo;}
 if(q.sort==='relevance')result.rank=libraryMatchRank(row,q);
 return result;
}
export function compareFeedMembers(a,b,criteria={}){
 return compareLibraryRows(a,b,criteria.sort??'default',criteria.locale??'en');
}
export function enumerateFeedMembers(store,criteria,{signal}={}){
 const q=libraryQuery(normalizeFeedCriteria(criteria));
 return store.scope(async scope=>{
  const stamp=await libraryStamp(store);if(await siteHasPendingSources(store,{sources:[],feeds:[{criteria,members:[]}]},stamp.pending))throw new AppError('CONFLICT');
  const result=[];let prefix,overlay;
  for await(const row of scanEligibleWebsiteRows(store,scope,stamp,{signal})){
   signal?.throwIfAborted();
   if(prefix!==row.id.slice(0,2)){prefix=row.id.slice(0,2);overlay=await feedRowShard(store,prefix,signal);}
   const live=overlay[row.id],selected=member(live?.baseRevision===row.revision?(live.row?{...row,...live.row}:null):row,q);
   if(selected)result.push(selected);
  }
  await checkLibraryStamp(store,stamp);
  return result.sort((a,b)=>compareLibraryRows(a,b,q.sort,q.locale));
 },{write:true,signal});
}
export async function feedMemberForSource(store,criteria,source,{signal}={}){
 if(!source?.visible||source.target!=='website')return null;
 const row=source.feedRow??await indexedWebsiteRow(store,source,{signal});
 return member(row,libraryQuery(normalizeFeedCriteria(criteria)));
}
