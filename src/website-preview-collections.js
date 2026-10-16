import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {readingKey} from './record-reading-index.js';
import {appearanceCollectionQuery} from './appearance-preview-collections.js';
import {appearanceFeedQuery} from './appearance-preview-feeds.js';
import {researchId} from './web/research-reference.js';
import {validRecordDate} from './web/record-date.js';

const point=row=>({id:row.id,occurredOn:row.occurredOn});
const validPoint=value=>value===null||value&&Object.keys(value).sort().join()==='id,occurredOn'&&researchId(value.id)&&validRecordDate(value.occurredOn);
const fold=value=>value.trim().toLocaleLowerCase('en');
export function websiteCollectionRequests(values){
 if(!Array.isArray(values))throw new AppError('INVALID');const requests=new Map();
 for(const value of values){
  if(!value||Object.keys(value).sort().join()!=='definition,key,query'||typeof value.query!=='string'||value.query.length>8192||typeof value.definition!=='string'||!/^[a-f0-9]{64}$/.test(value.definition))throw new AppError('INVALID');
  const params=new URLSearchParams(value.query),collection=appearanceCollectionQuery(params),visitor=appearanceFeedQuery(params);
  if(params.size||!(collection??visitor)||collection&&visitor&&collection.key!==visitor.key||value.key!==(collection??visitor).key||requests.has(value.key))throw new AppError('INVALID');
  requests.set(value.key,{...value,collection,visitor});
 }
 return requests;
}

// A canvas collection is a window over a pinned source and its explicit edits.
// Author selection and visitor selection are separate. Neither changes records.
export async function websiteCollectionPage(records,{key,target,notebooks,filter={},feed=null,request=null}){
 const {store,metadata,command,signal}=records,{tag='',limit=0}=filter;
 const settings=feed?{pageSize:feed.pageSize,order:feed.order,visitorFilters:feed.visitorFilters,visitorOrder:feed.visitorOrder}:null;
 const definition=digest(serialize({key,target,notebooks:[...notebooks].sort(),tag,limit,settings}));
 if(request?.definition!==definition)request=null;
 const query=feed?{key,search:'',tag:'',type:'',order:feed.order}:null;
 if(request?.visitor&&feed){if(feed.visitorFilters)for(const name of ['search','tag','type'])query[name]=request.visitor[name];if(feed.visitorOrder&&request.visitor.order)query.order=request.visitor.order;}
 const binding=digest(serialize({workspaceId:metadata.id,websiteId:records.websiteId,snapshot:command.baseEtag,changes:command.changes,removed:command.removed,definition,query}));
 const cursor=request?.collection?.cursor;let state={after:null,backward:false,matched:0,boundary:null};
 if(cursor){
  try{state=store.decode('website-collection-page',metadata.id,Buffer.from(cursor,'base64url'));}catch{throw new AppError('INVALID');}
  if(!state||Object.keys(state).sort().join()!=='after,backward,binding,boundary,matched'||state.binding!==binding||typeof state.backward!=='boolean'||!validPoint(state.after)||!state.after||!validPoint(state.boundary)||!Number.isSafeInteger(state.matched)||state.matched<0||!feed&&limit&&state.matched>limit)throw new AppError('INVALID');
 }
 const reversed=query?.order==='oldest',authorReversed=feed?.order==='oldest';
 // Find the authored selection's last row once when a visitor can reverse it.
 // Values stream through this scan; they never become retained canvas cards.
 if(feed&&limit&&!cursor&&(reversed!==authorReversed||query.search||query.tag||query.type)){
  let count=0;
  for await(const row of records.dateRows(notebooks,{backward:authorReversed})){
   signal?.throwIfAborted();if(tag&&!(await records.document(row)).tags.includes(tag))continue;
   state.boundary=point(row);if(++count===limit)break;
  }
 }
 const boundary=state.boundary?readingKey(state.boundary,'date'):null;
 const initialReverse=!state.after&&boundary!==null&&reversed!==authorReversed;
 const after=state.after??(initialReverse?state.boundary:null),backward=reversed!==state.backward;
 const items=[],size=feed?.pageSize??24;let first=null,last=null,scanned=0,more=false;
 for await(const row of records.dateRows(notebooks,{after,backward,includeAfter:initialReverse})){
  if(boundary===null&&!state.backward&&limit&&state.matched+items.length===limit)break;
  if(boundary!==null&&(authorReversed?readingKey(row,'date')<boundary:readingKey(row,'date')>boundary))break;
  if(items.length===size||scanned===256){more=true;break;}
  signal?.throwIfAborted();first??=point(row);last=point(row);scanned++;
  const value=await records.document(row,{cards:true});
  if(tag&&!value.tags.includes(tag)||query?.search&&!fold(value.title).includes(fold(query.search))||query?.tag&&!value.tags.some(tag=>fold(tag)===fold(query.tag))||query?.type&&fold(value.template?.label??value.type)!==fold(query.type))continue;
  records.remember(row,value);items.push(value.publicationCard);
 }
 const start=state.backward?state.matched-items.length:state.matched,end=start+items.length;if(start<0)throw new AppError('INVALID');
 const encode=(after,backward,matched)=>store.encode('website-collection-page',metadata.id,{binding,after,backward,matched,boundary:state.boundary}).toString('base64url');
 const previous=state.backward?more:state.after!==null,next=state.backward?state.after!==null:more;
 if(state.backward)items.reverse();
 return {key,definition,records:items,scanned,...(query?{visitor:query}:{}),previousCursor:previous?encode((state.backward?last:first)??state.after,true,start):null,nextCursor:next?encode((state.backward?first:last)??state.after,false,end):null};
}
