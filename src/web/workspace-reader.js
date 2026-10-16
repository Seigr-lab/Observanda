// Complete snapshots and explicitly marked read-only outlines are distinct.
// Received pages never become record drafts or editable partial workspaces.
import {researchId} from './research-reference.js';
import {revisionId} from './revision-model.js';
import {MAX_BYTES,MAX_WORKSPACE_RECORDS} from './workspace-limits.js';
import {t} from './i18n/index.js';
const invalid=()=>{throw {code:'WORKSPACE_READ_INVALID',message:t('workspaceRead','invalid')};};
export function validateWorkspaceOutline(result,{workspaceId=result?.book?.id}={}){
 const {book,etag,notebookCounts:counts,total,recordRevisions}=result??{};
 if(result?.outline!==true||result.recordScope||result.recordPatch||!researchId(book?.id)||book.id!==workspaceId||!revisionId(etag)||!Array.isArray(book.entries)||book.entries.length||
  !Number.isSafeInteger(total)||total<0||!recordRevisions||typeof recordRevisions!=='object'||Array.isArray(recordRevisions)||Object.keys(recordRevisions).length||
  !counts||typeof counts!=='object'||Array.isArray(counts)||!Array.isArray(book.notebooks)||book.notebooks.some(n=>!researchId(n?.id)))invalid();
 const names=book.notebooks.map(n=>n.id);
 if(new Set(names).size!==names.length||Object.keys(counts).length!==names.length||names.some(id=>!Object.hasOwn(counts,id)||!Number.isSafeInteger(counts[id])||counts[id]<0)||
  Object.values(counts).reduce((sum,n)=>sum+n,0)!==total)invalid();
 return result;
}
export function workspaceReader(request){
 let snapshot=null,cursor=null,rows=[],ids=new Set(),positions=new Set(),bytesLoaded=0,busy=false;
 function reset(){snapshot=null;cursor=null;rows=[];ids=new Set();positions=new Set();bytesLoaded=0;}
 return {
  reset,
  async read({signal,onProgress=()=>{},metadataOnly=false,requireOutline=false}={}){
   if(busy)throw Error(t('workspaceRead','busy'));
   busy=true;
   try{
    signal?.throwIfAborted();
    if(!snapshot){
     const first=await request('/api/workspace/read/start',{}, {signal});
     signal?.throwIfAborted();
     if(!first||typeof first!=='object'||Array.isArray(first))invalid();
     if(Object.hasOwn(first,'book')){if(requireOutline)invalid();return first;}
     if(!researchId(first.metadata?.id)||!Array.isArray(first.metadata.entries)||first.metadata.entries.length||
      !revisionId(first.etag)||!Number.isSafeInteger(first.total)||first.total<0||
      !Number.isSafeInteger(first.totalBytes)||first.totalBytes<0||typeof first.cursor!=='string'||!first.cursor.length)invalid();
     snapshot=first;cursor=first.cursor;
    }
    if((metadataOnly||requireOutline)&&Object.hasOwn(snapshot,'notebookCounts')){
     return validateWorkspaceOutline({outline:true,book:snapshot.metadata,etag:snapshot.etag,recordRevisions:{},notebookCounts:snapshot.notebookCounts,total:snapshot.total});
    }
    if(requireOutline)invalid();
    if(snapshot.total>MAX_WORKSPACE_RECORDS||snapshot.totalBytes+new TextEncoder().encode(JSON.stringify(snapshot.metadata)).byteLength>MAX_BYTES)throw {code:'WORKSPACE_READ_LIMIT',message:t('errors','WORKSPACE_READ_LIMIT')};
    onProgress({loaded:rows.length,total:snapshot.total});
    while(cursor!==null){
     const page=await request('/api/workspace/read/page',{workspaceId:snapshot.metadata.id,cursor},{signal});
     signal?.throwIfAborted();
     if(!page||typeof page!=='object'||Array.isArray(page))invalid();
     if(page.workspaceId!==snapshot.metadata.id||page.etag!==snapshot.etag||page.total!==snapshot.total||
      page.totalBytes!==snapshot.totalBytes||page.offset!==rows.length||!Array.isArray(page.records)||page.records.length>20||
      page.loaded!==rows.length+page.records.length||page.loaded>snapshot.total||
      !Number.isSafeInteger(page.bytesLoaded)||page.bytesLoaded<bytesLoaded||page.bytesLoaded>snapshot.totalBytes||
      (page.nextCursor!==null&&(typeof page.nextCursor!=='string'||!page.nextCursor.length||page.nextCursor===cursor||!page.records.length||page.loaded>=snapshot.total))||
      (page.nextCursor===null&&(page.loaded!==snapshot.total||page.bytesLoaded!==snapshot.totalBytes)))invalid();
     const pageIds=new Set(),pagePositions=new Set();
     for(const row of page.records){
      if(!row||!researchId(row.record?.id)||!revisionId(row.revision)||!Number.isSafeInteger(row.position)||row.position<0||
       ids.has(row.record.id)||positions.has(row.position)||pageIds.has(row.record.id)||pagePositions.has(row.position))invalid();
      pageIds.add(row.record.id);pagePositions.add(row.position);
     }
     // Advance only after the entire response has passed validation.
     for(const row of page.records){ids.add(row.record.id);positions.add(row.position);rows.push(row);}
     cursor=page.nextCursor;bytesLoaded=page.bytesLoaded;
     onProgress({loaded:rows.length,total:snapshot.total});
    }
    signal?.throwIfAborted();
    const ordered=rows.toSorted((a,b)=>a.position-b.position),result={
     book:{...snapshot.metadata,entries:ordered.map(row=>row.record)},etag:snapshot.etag,
     recordRevisions:Object.fromEntries(ordered.map(row=>[row.record.id,row.revision]))};
    reset();return result;
   }catch(error){
    if(['WORKSPACE_READ_INVALID','WORKSPACE_READ_CURSOR','WORKSPACE_CHANGED','ACCESS_LOCKED','AUTH','CATALOGUE_DAMAGED'].includes(error.code))reset();
    throw error;
   }finally{busy=false;}
  }
 };
}
