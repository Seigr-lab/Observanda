import {RecordRecentIndex} from './record-recent-index.js';
import {AppError} from './errors.js';

// Unfiltered record cards use ordering ranges rather than a corpus scan.
// Other card types and filters retain their own exact selection semantics.
export async function dashboardRecent(store,snapshot,notebookIds,{workspaceId,etag,limit,anchor,encode,signal}){
 const backward=anchor.direction==='backward';
 const page=await new RecordRecentIndex(store).page(snapshot,notebookIds,{after:anchor.after,backward,signal});
 const records=[];let bytes=0;
 for await(const row of page.rows){
  signal?.throwIfAborted();
  if(records.length===limit)break;
  const record=await store.record(row.id,row.revision),size=Buffer.byteLength(JSON.stringify(record));
  if(records.length&&bytes+size>256*1024)break;
  records.push(record);bytes+=size;
 }
 if(backward)records.reverse();
 const offset=backward?anchor.offset-records.length:anchor.offset,next=offset+records.length;
 if(offset<0||next>page.total||anchor.offset&&!records.length)throw new AppError('RECORD_QUERY_CURSOR');
 const point=record=>({id:record.id,updatedAt:record.updatedAt,skip:0});
 signal?.throwIfAborted();
 return {workspaceId,etag,records,total:page.total,offset,cursor:encode(anchor),
  previousCursor:offset>0?encode({signature:anchor.signature,direction:'backward',offset,after:point(records[0])}):null,
  nextCursor:next<page.total&&records.length?encode({signature:anchor.signature,direction:'forward',offset:next,after:point(records.at(-1))}):null};
}
