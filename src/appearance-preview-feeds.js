import {AppError} from './errors.js';
import {encodeAppearanceCursor,decodeAppearanceCursor} from './appearance-preview-cursor.js';
import {digest,serialize} from './storage-format.js';
import {compareRecordDates} from './web/record-date.js';
import {compareKey} from './web/query-order.js';

const point=row=>({id:row.id,occurredOn:row.occurredOn});
const compare=(a,b)=>compareRecordDates(a,b,{descending:true})||compareKey(a.id,b.id);
const fold=value=>value.trim().toLocaleLowerCase('en');
export function appearanceFeedQuery(params){
 const names=['feed','feedSearch','feedTag','feedType','feedOrder'],key=params.get('feed');
 if(names.some(name=>params.getAll(name).length>1)||!key&&names.slice(1).some(name=>params.has(name)))throw new AppError('INVALID');
 if(key!==null&&!/^(?:section|layout|header|sidebar|footer):[a-zA-Z0-9_-]{1,80}$/.test(key))throw new AppError('INVALID');
 const query={key,search:params.get('feedSearch')??'',tag:params.get('feedTag')??'',type:params.get('feedType')??'',order:params.get('feedOrder')??''};
 if(['search','tag','type'].some(name=>query[name].length>512)||!['','newest','oldest'].includes(query.order))throw new AppError('INVALID');
 names.forEach(name=>params.delete(name));return key===null?null:query;
}
export function appearanceFeedParameters(query){
 const params=new URLSearchParams();if(query){params.set('feed',query.key);for(const name of ['search','tag','type','order'])if(query[name])params.set('feed'+name[0].toUpperCase()+name.slice(1),query[name]);}return params;
}

// The same authored selection as static export, read in indexed date order.
// Only one displayed feed view is retained in memory. Every cursor is bound to
// its immutable source, author settings and visitor query; no live edits leak in.
export async function appearanceFeedPage(records,{key,target,notebooks,filter={},feed,visitor=null,cursor=null}){
 const query={key,search:'',tag:'',type:'',order:feed.order};
 if(visitor){if(feed.visitorFilters)for(const name of ['search','tag','type'])query[name]=visitor[name];if(feed.visitorOrder&&visitor.order)query.order=visitor.order;}
 const {store}=records,binding=digest(serialize({snapshot:records.snapshotId,metadata:records.metadata,websiteId:records.websiteId,selection:records.selection,target,key,notebooks:[...notebooks].sort(),filter,feed,query}));
 let anchor=null,backward=false,boundary=null;
 if(cursor){
  let value;try{value=store.decode('appearance-feed-page',records.metadata.id,decodeAppearanceCursor(cursor));}catch{throw new AppError('INVALID');}
  if(value?.binding!==binding||typeof value.backward!=='boolean'||!value.anchor)throw new AppError('INVALID');
  ({anchor,backward,boundary}=value);
 }
 const summary=row=>records.summary(row);
 // Author selection precedes visitor filtering and ordering. A retained
 // boundary prevents reversing a limited feed from choosing different records.
 if(filter.limit&&!cursor){
  let count=0;
  for await(const row of records.rows({notebooks,order:'date',backward:feed.order==='oldest'})){
   if(filter.tag&&!(await summary(row)).tags.includes(filter.tag))continue;
   boundary=point(row);if(++count===filter.limit)break;
  }
 }
 const reversed=query.order==='oldest',items=[];let more=false,scanned=0;
 for await(const row of records.rows({notebooks,order:'date',after:anchor,backward:reversed!==backward})){
  records.signal?.throwIfAborted();
  if(boundary&&(feed.order==='oldest'?compare(row,boundary)<0:compare(row,boundary)>0))continue;
  scanned++;const value=await summary(row);
  if(filter.tag&&!value.tags.includes(filter.tag)||query.search&&!fold(value.title).includes(fold(query.search))||query.tag&&!value.tags.some(tag=>fold(tag)===fold(query.tag))||query.type&&fold(value.template?.label??value.type)!==fold(query.type))continue;
  if(items.length===feed.pageSize){more=true;break;}
  const {id,title,notebookId,occurredOn,status,tags,type,excerpt,hasBody,attachments}=await records.get(row.id);
  items.push({id,title,notebookId,occurredOn,status,tags,type,excerpt,hasBody,attachments});
 }
 if(backward)items.reverse();
 const encode=(value,direction)=>encodeAppearanceCursor(store.encode('appearance-feed-page',records.metadata.id,{binding,anchor:point(value),backward:direction,boundary}));
 const previous=backward?more:anchor!==null,next=backward?anchor!==null:more;
 return {key,records:items,scanned,visitor:query,previousCursor:previous?encode(items[0]??anchor,true):null,nextCursor:next?encode(items.at(-1)??anchor,false):null};
}
