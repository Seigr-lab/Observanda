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

// The caller owns an immutable saved snapshot. Record editors explicitly mark
// their changed identity; metadata/structural editors use inspect(). This keeps
// keystrokes and recovery checkpoints from traversing unrelated record bodies.
export function recordDraftTracker(){
  let before=null,revisions={},previous=new Map(),changes=new Map(),recordOnly=true,changed=false;
  function reset(book,heads={}){
    before=book;revisions=heads;previous=new Map(book?.entries.map(record=>[record.id,record])??[]);
    changes.clear();recordOnly=true;changed=false;
  }
  function inspect(book){
    const request=recordSaveRequest(before,book,revisions);
    changes=new Map(request?.changes.map(change=>[change.id,change.record])??[]);
    changed=Boolean(request)||!sameWorkspace(before,book);recordOnly=Boolean(request)||!changed;
    return changed;
  }
  function updateRecord(book,id){
    if(!before||book.id!==before.id||!recordOnly)return inspect(book);
    const record=book.entries.find(item=>item.id===id);
    if(!record||!previous.has(id)&&!changes.has(id))return inspect(book);
    if(equal(record,previous.get(id)))changes.delete(id);else changes.set(id,record);
    changed=changes.size>0;return changed;
  }
  function command(){
    if(!before||!recordOnly||!changes.size)return null;
    const edits=[...changes].map(([id,record])=>({id,expectedRevision:revisions[id]??(previous.has(id)?undefined:null),record}));
    if(edits.some(edit=>edit.expectedRevision===undefined))return null;
    return {workspaceId:before.id,changes:edits};
  }
  function checkpoint(bases){
    const request=command();
    return request?.changes.map(change=>({base:bases[change.id]??null,record:structuredClone(change.record),expectedRevision:change.expectedRevision}))??null;
  }
  function submission(book){
    const request=command();
    if(!request)return {book:draftWorkspace(book),command:null};
    const detached=structuredClone(request),sent=new Map(detached.changes.map(change=>[change.id,change.record]));
    const {entries,...metadata}=book;
    // Unchanged bodies belong to the saved snapshot, never the live editor.
    // A later edit while saving must not mutate this submitted comparison base.
    return {command:detached,book:{...structuredClone(metadata),entries:entries.map(record=>sent.get(record.id)??previous.get(record.id))}};
  }
  return {reset,inspect,updateRecord,command,checkpoint,submission};
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
