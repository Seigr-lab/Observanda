import {validRecordScopeIds,validateRecordScope,RECORD_SELECTION_PAGE} from './record-scope.js';
import {revisionId} from './revision-model.js';
import {researchId} from './research-reference.js';
import {MAX_METADATA_BYTES,MAX_SELECTED_RECORD_BYTES,MAX_SELECTED_RECORDS} from './research-capacity.js';
import {t} from './i18n/index.js';
const failure=key=>({code:'WORKSPACE_READ_INVALID',message:t('recordSelection',key)});
export function validateRecordReceipt(result,workspaceId){
 const receipt=result?.recordReceipt;
 if(!result||Object.keys(result).join()!=='recordReceipt'||!receipt||Object.keys(receipt).sort().join()!=='etag,workspaceId'||receipt.workspaceId!==workspaceId||!revisionId(receipt.etag))throw failure('invalid');
 return receipt;
}
// Each request is bounded. All batches share one immutable snapshot, and only a
// complete selection can reach the editor. An interrupted batch is retryable.
export function recordSelectionReader(request,{workspaceId,ids,snapshotId=null}){
 if(Array.isArray(ids)&&ids.length>MAX_SELECTED_RECORDS)throw failure('limit');
 if(!researchId(workspaceId)||!validRecordScopeIds(ids)||snapshotId!==null&&!revisionId(snapshotId))throw failure('invalid');
 ids=[...ids];
 let etag=snapshotId,first=null,signature=null,offset=0,entries=[],missing=[],revisions={},bytes=0,busy=false;
 const encoder=new TextEncoder(),size=value=>encoder.encode(JSON.stringify(value)).byteLength;
 function reset(){etag=snapshotId;first=null;signature=null;offset=0;entries=[];missing=[];revisions={};bytes=0;}
 return {reset,async read({signal,onProgress=()=>{}}={}){
  if(busy)throw Error(t('recordSelection','busy'));busy=true;
  try{
   signal?.throwIfAborted();onProgress({loaded:offset,total:ids.length});
   while(offset<ids.length){
    const batch=ids.slice(offset,offset+RECORD_SELECTION_PAGE);
    const page=await request('/api/workspace/read/selection',{workspaceId,ids:batch,...(etag?{snapshotId:etag}:{})},{signal});
    signal?.throwIfAborted();validateRecordScope(page,{workspaceId,ids:batch});
    if(etag&&page.etag!==etag)throw failure('invalid');
    const metadata={...page.book,entries:[]},nextSignature=JSON.stringify([metadata,page.recordScope.notebookCounts,page.recordScope.total]);
    if(signature!==null&&signature!==nextSignature)throw failure('invalid');
    const added=page.book.entries.reduce((n,record)=>n+size(record),0);
    if(size(metadata)>MAX_METADATA_BYTES||bytes+added>MAX_SELECTED_RECORD_BYTES)throw failure('limit');
    if(!first){first={book:metadata,notebookCounts:page.recordScope.notebookCounts,total:page.recordScope.total};signature=nextSignature;bytes=0;etag=page.etag;}
    entries.push(...page.book.entries);missing.push(...page.recordScope.missing);Object.assign(revisions,page.recordRevisions);bytes+=added;offset+=batch.length;
    onProgress({loaded:offset,total:ids.length});
   }
   signal?.throwIfAborted();
   const result={book:{...first.book,entries},etag,recordRevisions:revisions,recordScope:{ids:[...ids],missing,notebookCounts:first.notebookCounts,total:first.total}};
   validateRecordScope(result,{workspaceId,ids});reset();return result;
  }catch(error){
   if(['RECORD_SELECTION_LIMIT','WORKSPACE_READ_INVALID','WORKSPACE_CHANGED','ACCESS_LOCKED','AUTH','CATALOGUE_DAMAGED'].includes(error.code))reset();
   throw error;
  }finally{busy=false;}
 }};
}
