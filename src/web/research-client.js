// Record-only commands allow independent concurrent edits. Mixed authoring
// changes use workspace-edits.js and retain the exact workspace revision guard.
import {draftWorkspace,sameWorkspace,sameValue as equal} from './workspace-snapshot.js';
export function recordSaveRequest(before,after,revisions){
  if(!before||before.id!==after.id)return null;
  for(const key of new Set([...Object.keys(before),...Object.keys(after)])){
    if(key!=='entries'&&!equal(before[key],after[key]))return null;
  }
  const existing=new Set(before.entries.map(record=>record.id));
  const kept=after.entries.filter(record=>existing.has(record.id));
  if(kept.length!==before.entries.length||kept.some((record,i)=>record.id!==before.entries[i].id))return null;
  const previous=new Map(before.entries.map(record=>[record.id,record]));
  const changes=after.entries.filter(record=>!equal(record,previous.get(record.id))).map(record=>({
    id:record.id,expectedRevision:revisions[record.id]??(previous.has(record.id)?undefined:null),record
  }));
  if(!changes.length||changes.some(change=>change.expectedRevision===undefined))return null;
  return {workspaceId:after.id,changes};
}

// The caller owns an immutable saved snapshot; inspect() reports whether the
// live workspace differs from it.
export function recordDraftTracker(){
  let before=null,revisions={};
  function reset(book,heads={}){before=book;revisions=heads;}
  function inspect(book){return Boolean(recordSaveRequest(before,book,revisions))||!sameWorkspace(before,book);}
  return {reset,inspect};
}

// Rebase only edits made while the request was running. Adopt other records and
// settings returned by the server, retaining the active draft and its timestamps.
export function retainPendingEdits(submitted,draft,saved){
  const result=draftWorkspace(saved);
  for(const key of Object.keys(draft)){
    if(!['entries','revision','updatedAt'].includes(key)&&!equal(draft[key],submitted[key]))result[key]=structuredClone(draft[key]);
  }
  const submittedRecords=new Map(submitted.entries.map(record=>[record.id,record]));
  const currentIds=new Set(draft.entries.map(record=>record.id));
  result.entries=result.entries.filter(record=>!submittedRecords.has(record.id)||currentIds.has(record.id));
  for(const record of draft.entries){
    if(equal(record,submittedRecords.get(record.id)))continue;
    const index=result.entries.findIndex(item=>item.id===record.id),stored=result.entries[index],pending=structuredClone(record);
    if(stored){pending.createdAt=stored.createdAt;pending.updatedAt=stored.updatedAt;result.entries[index]=pending;}
    else result.entries.push(pending);
  }
  return result;
}
