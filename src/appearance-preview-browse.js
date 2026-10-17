import {AppError} from './errors.js';
import {encodeAppearanceCursor,decodeAppearanceCursor} from './appearance-preview-cursor.js';
import {digest,serialize} from './storage-format.js';
import {calendarDate,dateBounds,recordDateLabel} from './web/record-date.js';
import {BOOK_JOURNEYS,readingJourney} from './web/book-journeys.js';
import {bookText} from './web/book-messages.js';
import {matchesPublicRecord} from './web/public-browse-query.js';

const fields=['q','tag','journey','type','from','to'];
export function appearanceBrowseQuery(query=''){
 const params=new URLSearchParams(query),filters=Object.fromEntries(fields.map(key=>[key,(params.get(key)??'').trim()]));
 if([...params.keys()].some(key=>![...fields,'cursor'].includes(key)||params.getAll(key).length!==1)||
  Object.values(filters).some(value=>value.length>512)||['from','to'].some(key=>filters[key]&&!calendarDate(filters[key]))||
  filters.journey&&!BOOK_JOURNEYS.includes(filters.journey)||(params.get('cursor')?.length??0)>4096)throw new AppError('INVALID');
 const cursor=params.get('cursor')||null,canonical=new URLSearchParams();
 for(const key of fields)if(filters[key])canonical.set(key,filters[key]);
 return {filters,cursor,query:canonical.toString()};
}

// Limit work per request, not the public corpus or its matching results. A
// sparse filter can continue after a window with no matches. Cursor payloads
// are authenticated and tied to the saved website selection and filters.
export async function appearanceBrowsePage(records,query){
 const {filters,cursor,query:filterQuery}=appearanceBrowseQuery(query),{store,metadata}=records;
 const identity=metadata.id,binding=digest(serialize({snapshot:records.snapshotId,websiteId:records.websiteId,websitePin:records.websitePin,metadata,selection:records.selection,filters}));
 let anchor={after:null,backward:false};
 if(cursor){
  try{anchor=store.decode('appearance-browse-page',identity,decodeAppearanceCursor(cursor));}catch{throw new AppError('INVALID');}
  if(!anchor||Object.keys(anchor).sort().join()!=='after,backward,binding'||anchor.binding!==binding||
   !Number.isSafeInteger(anchor.after)||anchor.after<0||typeof anchor.backward!=='boolean')throw new AppError('INVALID');
 }
 const items=[];let scanned=0,first=null,last=null,more=false;
 if(!(filters.from&&filters.to&&filters.from>filters.to))for await(const row of records.rows({after:anchor.after===null?null:{position:anchor.after},backward:anchor.backward})){
  if(items.length===40||scanned===256){more=true;break;}
  first??=row.position;last=row.position;scanned++;
  const summary=await records.summary(row);
  const item={id:summary.id,title:summary.title,notebookId:summary.notebookId,type:summary.template?.label??summary.type,journey:readingJourney(summary),tags:summary.tags,occurredOn:summary.occurredOn};
  const bounds=dateBounds(item.occurredOn),text=item.title+bookText(item.journey)+' · '+recordDateLabel(item.occurredOn)+(item.tags.length?item.tags.join(' · '):'');
  if(matchesPublicRecord({...item,text,start:bounds?.from??'',end:bounds?.to??''},filters))items.push(item);
 }
 const encode=(after,backward)=>encodeAppearanceCursor(store.encode('appearance-browse-page',identity,{binding,after,backward}));
 const before=first===null?anchor.after:first,after=last===null?anchor.after:last;
 const prior=anchor.after!==null&&before!==null?encode(before,!anchor.backward):null,next=more?encode(after,anchor.backward):null;
 if(anchor.backward)items.reverse();
 return {records:items,filters,query:filterQuery,total:records.counts.total,scanned,
  previousCursor:anchor.backward?next:prior,nextCursor:anchor.backward?prior:next};
}
