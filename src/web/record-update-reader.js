import {researchId} from './research-reference.js';
import {revisionId} from './revision-model.js';
import {t} from './i18n/index.js';
import {MAX_BYTES,MAX_WORKSPACE_RECORDS} from './workspace-limits.js';
const invalid=()=>{throw {code:'WORKSPACE_READ_INVALID',message:t('recordUpdates','invalid')};};
const capacity=()=>{throw {code:'WORKSPACE_READ_LIMIT',message:t('errors','WORKSPACE_READ_LIMIT')};};
const integer=value=>Number.isSafeInteger(value)&&value>=0;
// This compatibility reader is for a client that already owns a complete saved
// base. Normal authoring uses selected-record reads. Until every received page
// is checked, no partial update reaches either the saved base or an open draft.
export function recordUpdateReader(request,initial){
 const first=initial?.recordUpdate;
 if(!first||initial.etag!==first.etag||!researchId(first.workspaceId)||!revisionId(first.etag)||!revisionId(first.baseEtag)||first.metadata?.id!==first.workspaceId||!Array.isArray(first.metadata.entries)||first.metadata.entries.length||!integer(first.count))invalid();
 const encoder=new TextEncoder(),size=value=>encoder.encode(JSON.stringify(value)).byteLength;
 const metadataBytes=size(first.metadata);
 if(first.count>MAX_WORKSPACE_RECORDS||metadataBytes>MAX_BYTES)capacity();
 let receivedBytes=metadataBytes;
 let cursor=null,started=false,busy=false,phase='changes',offset=0,records=[],removed=[],appended=[],order=null,revisions={},changedIds=new Set(),removedIds=new Set(),addedIds=new Set(),orderIds=new Set();
 function reset(){cursor=null;started=false;phase='changes';offset=0;records=[];removed=[];appended=[];order=null;revisions={};changedIds=new Set();removedIds=new Set();addedIds=new Set();orderIds=new Set();receivedBytes=metadataBytes;}
 function accept(value){
  if(!value||value.workspaceId!==first.workspaceId||value.etag!==first.etag||value.baseEtag!==first.baseEtag||value.count!==first.count)invalid();
  const page=value.page;
  if(!page||!['changes','order'].includes(page.phase)||!integer(page.offset)||!integer(page.loaded)||page.loaded<page.offset||
   !Array.isArray(page.records)||!Array.isArray(page.removed)||!Array.isArray(page.appended)||!Array.isArray(page.order)||
   page.nextCursor!==null&&(typeof page.nextCursor!=='string'||!page.nextCursor.length||page.nextCursor.length>4096||page.nextCursor===cursor))invalid();
  const changing=page.phase==='changes';
  if(changing&&phase!=='changes'||page.offset!==(page.phase===phase?offset:0))invalid();
  if(changing?(page.order.length||page.loaded-page.offset>20||page.records.length+page.removed.length>page.loaded-page.offset||page.appended.length>page.records.length):
   (page.records.length||page.removed.length||page.appended.length||page.order.length>128||page.loaded-page.offset!==page.order.length||page.loaded>first.count))invalid();
  const changes=new Set(),deletions=new Set(),adds=new Set(),ordering=new Set();
  for(const row of page.records){if(!researchId(row?.record?.id)||!revisionId(row?.revision)||changes.has(row.record.id)||changedIds.has(row.record.id)||removedIds.has(row.record.id))invalid();changes.add(row.record.id);}
  for(const id of page.removed){if(!researchId(id)||deletions.has(id)||removedIds.has(id)||changedIds.has(id)||changes.has(id))invalid();deletions.add(id);}
  for(const row of page.appended){if(!researchId(row?.id)||!integer(row?.position)||adds.has(row.id)||addedIds.has(row.id)||!changes.has(row.id))invalid();adds.add(row.id);}
  for(const id of page.order){if(!researchId(id)||ordering.has(id)||orderIds.has(id))invalid();ordering.add(id);}
  if(!changing&&page.nextCursor===null&&page.loaded!==first.count)invalid();
  if(changing&&page.nextCursor!==null&&page.loaded===page.offset)invalid();
  const addedBytes=page.records.reduce((n,row)=>n+size(row.record),0);
  if(receivedBytes+addedBytes>MAX_BYTES||changedIds.size+changes.size>MAX_WORKSPACE_RECORDS||removedIds.size+deletions.size>MAX_WORKSPACE_RECORDS)capacity();
  // All checks above precede mutations, so a lost/invalid page can be retried.
  receivedBytes+=addedBytes;
  for(const row of page.records){records.push(row.record);revisions[row.record.id]=row.revision;changedIds.add(row.record.id);}
  for(const id of page.removed){removed.push(id);removedIds.add(id);}
  for(const row of page.appended){appended.push(row);addedIds.add(row.id);}
  if(!changing){order??=[];order.push(...page.order);for(const id of page.order)orderIds.add(id);}
  cursor=page.nextCursor;phase=page.phase;offset=page.loaded;started=true;
 }
 return {reset,async read({signal,onProgress=()=>{}}={}){
  if(busy)throw Error(t('recordUpdates','busy'));busy=true;
  try{
   signal?.throwIfAborted();if(!started)accept(first);
   const progress=()=>onProgress({loaded:offset,total:phase==='order'?first.count:Math.max(first.count,offset)});progress();
   while(cursor!==null){const next=await request('/api/workspace/read/change-page',{workspaceId:first.workspaceId,cursor},{signal});signal?.throwIfAborted();accept(next);progress();}
   signal?.throwIfAborted();
   const result={etag:first.etag,recordPatch:{baseEtag:first.baseEtag,metadata:first.metadata,count:first.count,records,removed,appended:appended.sort((a,b)=>a.position-b.position).map(row=>row.id),order},recordRevisions:revisions};
   reset();return result;
  }catch(error){if(['WORKSPACE_READ_LIMIT','WORKSPACE_READ_INVALID','WORKSPACE_READ_CURSOR','WORKSPACE_CHANGED','ACCESS_LOCKED','AUTH','CATALOGUE_DAMAGED'].includes(error.code))reset();throw error;}
  finally{busy=false;}
 }};
}
