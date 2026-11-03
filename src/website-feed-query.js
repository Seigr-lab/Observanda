import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {libraryQuery,matchesQuery,compareLibraryRows,libraryMatchRank} from './website-file-library-query.js';
import {libraryStamp,checkLibraryStamp,scanEligibleWebsiteRows,indexedWebsiteRow} from './website-file-library.js';
import {feedRowShard,readFeedSource,feedTemplateMetadata} from './website-feed-source.js';
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
export function enumerateFeedMembers(store,criteria,{signal,admittedRows}={}){
 const q=libraryQuery(normalizeFeedCriteria(criteria));
 return store.scope(async scope=>{
  const stamp=await libraryStamp(store);if(await siteHasPendingSources(store,{sources:[],feeds:[{criteria,members:[]}]},stamp.pending))throw new AppError('CONFLICT');
  const writer=admittedRows&&researchId(stamp.generation)?store.writerToken():null,result=[];let prefix,overlay;
  for await(const row of scanEligibleWebsiteRows(store,scope,stamp,{signal})){
   signal?.throwIfAborted();
   if(prefix!==row.id.slice(0,2)){prefix=row.id.slice(0,2);overlay=await feedRowShard(store,prefix,signal);}
   const live=overlay[row.id],current=live?.baseRevision===row.revision;
   if(current&&live.row!==null&&(live.row?.id!==row.id||typeof live.row.revision!=='string'||!/^[a-f0-9]{64}$/.test(live.row.revision)||typeof live.row.title!=='string'))throw new AppError('FORMAT');
   const effective=current?live.row&&{...row,...live.row}:row,selected=member(effective,q);
   if(!selected)continue;
   result.push(selected);
   // The site writer owns the scan and render under one fence snapshot. Carry
   // only the base projection. The renderer must still check both source heads
   // before it can distinguish a current row from a replayed index or tombstone.
   if(writer&&(!live||current))admittedRows.set(selected,{writer,base:feedTemplateMetadata(row)});
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
