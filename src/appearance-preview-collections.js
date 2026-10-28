import {appearanceCursorMetadata} from './appearance-preview-binding.js';
import {AppError} from './errors.js';
import {encodeAppearanceCursor,decodeAppearanceCursor} from './appearance-preview-cursor.js';
import {digest} from './storage-format.js';
import {revisionText} from './web/revision-model.js';
import {researchId} from './web/research-reference.js';
import {validRecordDate} from './web/record-date.js';

export function appearanceCollectionQuery(params){
 const key=params.get('collection'),cursor=params.get('cards');
 if(params.getAll('collection').length>1||params.getAll('cards').length>1||
  (key===null)!==(cursor===null)||key!==null&&(!/^(body|(?:section|layout|header|sidebar|footer):[a-zA-Z0-9_-]{1,80})$/.test(key)||!cursor||cursor.length>4096))throw new AppError('INVALID');
 params.delete('collection');params.delete('cards');return key===null?null:{key,cursor};
}

// Each collection continues independently in immutable date order. A request
// bounds both matching cards and sparse-filter work; the author's total limit
// (including zero for all records) remains a selection, not a resource policy.
export async function appearanceCollectionPage(records,{key,target,notebooks,filter={},cursor=null}){
 const {tag='',limit=0}=filter,{store}=records;
 const binding=digest(revisionText({snapshot:records.snapshotId,websiteId:records.websiteId,websitePin:records.websitePin,metadata:appearanceCursorMetadata(records.metadata),selection:records.selection,target,key,notebooks:[...notebooks].sort(),tag,limit}));
 let anchor={after:null,backward:false,matched:0};
 if(cursor){
  try{anchor=store.decode('appearance-card-page',records.metadata.id,decodeAppearanceCursor(cursor));}catch{throw new AppError('INVALID');}
  if(!anchor||Object.keys(anchor).sort().join()!=='after,backward,binding,matched'||anchor.binding!==binding||typeof anchor.backward!=='boolean'||
   !Number.isSafeInteger(anchor.matched)||anchor.matched<0||limit&&anchor.matched>limit||!researchId(anchor.after?.id)||!validRecordDate(anchor.after?.occurredOn))throw new AppError('INVALID');
 }
 const items=[];let scanned=0,first=null,last=null,more=false;
 const point=row=>({id:row.id,occurredOn:row.occurredOn});
 for await(const row of records.rows({notebooks,order:'date',after:anchor.after,backward:anchor.backward})){
  if(!anchor.backward&&limit&&anchor.matched+items.length===limit)break;
  if(items.length===24||scanned===256){more=true;break;}
  first??=point(row);last=point(row);scanned++;
  if(tag){const summary=await records.summary(row);if(!summary.tags.includes(tag))continue;}
  const {id,title,notebookId,occurredOn,status,tags,type,excerpt,hasBody,attachments}=await records.get(row.id);
  items.push({id,title,notebookId,occurredOn,status,tags,type,excerpt,hasBody,attachments});
 }
 const start=anchor.backward?anchor.matched-items.length:anchor.matched,end=start+items.length;
 if(start<0)throw new AppError('INVALID');
 const encode=(after,backward,matched)=>encodeAppearanceCursor(store.encode('appearance-card-page',records.metadata.id,{binding,after,backward,matched}));
 const previous=anchor.backward?more:anchor.after!==null,next=anchor.backward?anchor.after!==null:more;
 if(anchor.backward)items.reverse();
 const before=(anchor.backward?last:first)??anchor.after,after=(anchor.backward?first:last)??anchor.after;
 return {key,records:items,scanned,previousCursor:previous?encode(before,true,start):null,nextCursor:next?encode(after,false,end):null};
}
