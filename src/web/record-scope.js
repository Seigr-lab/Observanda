import {researchId} from './research-reference.js';
import {revisionId} from './revision-model.js';

import {MAX_SELECTED_RECORDS} from './research-capacity.js';
import {t} from './i18n/index.js';

// An explicit selection is never a complete workspace. Keep this marker through
// saves, recovery and navigation. Metadata commands request their own response.
export const RECORD_SELECTION_PAGE=20;
export const validRecordScopeIds=ids=>Array.isArray(ids)&&ids.length>0&&ids.length<=MAX_SELECTED_RECORDS&&ids.every(researchId)&&new Set(ids).size===ids.length;
export const validRecordSelection=ids=>validRecordScopeIds(ids)&&ids.length<=RECORD_SELECTION_PAGE;
export function validateRecordScope(result,{workspaceId,ids}={}){
 const bad=()=>{throw {code:'WORKSPACE_READ_INVALID',message:t('recordSelection','invalid')};};
 const {book,etag,recordRevisions,recordScope:scope}=result??{};
 if(result?.recordPatch||result?.recordReceipt||result?.outline||!scope||!validRecordScopeIds(scope.ids)||!book||book.id!==workspaceId||!revisionId(etag)||!Array.isArray(book.entries)||!Array.isArray(book.notebooks)||book.notebooks.some(n=>!researchId(n?.id))||
  !recordRevisions||Array.isArray(recordRevisions)||typeof recordRevisions!=='object'||!scope.notebookCounts||Array.isArray(scope.notebookCounts)||typeof scope.notebookCounts!=='object'||!Number.isSafeInteger(scope.total)||scope.total<0||!Array.isArray(scope.missing)||
  !validRecordScopeIds(ids)||scope.ids.length!==ids.length||scope.ids.some((id,i)=>id!==ids[i]))bad();
 const found=new Set(),missing=new Set(scope.missing),names=new Set(book.notebooks.map(n=>n.id));
 if(names.size!==book.notebooks.length||missing.size!==scope.missing.length||scope.missing.some(id=>!scope.ids.includes(id))||Object.keys(recordRevisions).length!==book.entries.length)bad();
 for(const record of book.entries){
  if(!researchId(record?.id)||!scope.ids.includes(record.id)||found.has(record.id)||missing.has(record.id)||!names.has(record.notebookId)||!revisionId(recordRevisions[record.id]))bad();
  found.add(record.id);
 }
 if(scope.ids.some(id=>!found.has(id)&&!missing.has(id))||book.entries.length>scope.total||Object.keys(scope.notebookCounts).length!==names.size||
  [...names].some(id=>!Object.hasOwn(scope.notebookCounts,id)||!Number.isSafeInteger(scope.notebookCounts[id])||scope.notebookCounts[id]<0)||
  Object.values(scope.notebookCounts).reduce((a,b)=>a+b,0)!==scope.total)bad();
 return result;
}
