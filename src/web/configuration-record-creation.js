import {researchContext} from './project-context.js';
import {revisionId} from './revision-model.js';
import {t} from './i18n/index.js';

// A new record is a server draft until its first Save. It is seeded, prepared for review, and
// written on the record page like every saved record (record-content-ui.js reads it, and the
// page's edits are written into it through record-draft-transport.js). Save applies the
// draft and the record exists; Discard removes it and nothing was ever added.
export function configurationRecordCreation({state,api,esc,render,onDirty,onSaved,onDiscard,onOpened=()=>{}}){
 let session=null;
 const text=(key,args)=>t('configurationEditor',key,args);
 const active=()=>Boolean(session?.plan&&session.context===researchContext(state)&&session.command.workspaceId===state.book?.id&&session.command.recordId===state.selected&&state.page==='record-reader');
 const current=value=>session===value&&value.context===researchContext(state)&&value.command.workspaceId===state.book?.id;
 const invalid=()=>Error(text('invalid'));
 async function request(value,operation,data){
  if(!current(value))throw new DOMException('Record creation changed','AbortError');
  const result=await api(operation,data,{adopt:false});
  if(!current(value))throw new DOMException('Record creation changed','AbortError');return result;
 }
 async function ensureReceipt(value){
  if(!value.receipt){
   const receipt=await request(value,'/api/research/configurations/seed',value.command);
   if(receipt.draft?.id!==value.command.id||receipt.draft.workspaceId!==value.command.workspaceId||!revisionId(receipt.revision)||receipt.record?.id!==value.command.recordId)throw invalid();
   value.receipt=receipt;
  }
 }
 async function prepare(value,{refresh=false}={}){
  await ensureReceipt(value);
  const plan=!refresh&&value.plan||await request(value,'/api/research/drafts/review/prepare',{id:value.receipt.draft.id,workspaceId:value.command.workspaceId,expectedRevision:value.receipt.revision});
  if(plan.recordId!==value.command.recordId||plan.workspaceId!==value.command.workspaceId||plan.count!==0||!plan.newRecord||plan.storageRevision!==null||!revisionId(plan.id)||!revisionId(plan.revision))throw Error(t('recordDrafts','saveChanged'));
  value.plan??=plan;return plan;
 }
 // section is the lab book's record type (a configured template), or null for a built-in type.
 async function open(record,section=null){
  stop();
  const value={context:researchContext(state),command:{id:crypto.randomUUID(),workspaceId:state.book.id,notebookId:record.notebookId,recordId:record.id,configurationPin:section?.configurationPin??null,sectionId:section?.sectionId??null,record:structuredClone(record)},receipt:null,plan:null,applyPlan:null,saved:null,applyAttempted:false,error:null,busy:false,version:0};
  session=value;
  await prepare(value);if(!current(value))return null;
  onOpened(value.command.record);onDirty();render();return value;
 }
 function stop(){session=null;}
 // The draft the record page reads and writes, while it is the selected record.
 function draft(){return active()?{id:session.plan.id,workspaceId:session.plan.workspaceId,revision:session.plan.revision,recordId:session.command.recordId,version:session.version}:null;}
 // An edit was written into the draft: the page reads it again.
 function written(){if(session)session.version++;}
 function controls(){
  if(!active())return '';
  return '<button type="button" class="button primary" data-action="save"'+(session.busy?' disabled':'')+'>'+esc(text('saveRecord'))+'</button><button type="button" class="button" data-action="configuration-record-discard"'+(session.busy?' disabled':'')+'>'+esc(text('discardRecord'))+'</button>'+
   (session.error?'<p role="alert">'+esc(session.error.message)+'</p>':'')+(session.busy?'<p role="status">'+esc(text('savingRecord'))+'</p>':'');
 }
 async function save(){
  const value=session;if(!active()||value.busy)return;
  value.busy=true;value.error=null;render();
  try{
   if(!value.applyAttempted)value.applyPlan=await prepare(value,{refresh:true});
   if(!value.saved){value.applyAttempted=true;try{value.saved=await request(value,'/api/research/drafts/review/apply',{id:value.applyPlan.id,workspaceId:value.applyPlan.workspaceId,expectedRevision:value.applyPlan.revision});}catch(reason){if(['INVALID','RECORD_CHANGED','DRAFT_CHANGED','FORMAT'].includes(reason.code))value.applyAttempted=false;throw reason;}}
   const result=value.saved;if(!result?.recordDraftRecovered||result.recordId!==value.command.recordId||result.absent||!revisionId(result.etag))throw invalid();
   // The record exists now: the page reads it as a saved record, no longer from the draft.
   if(session===value)stop();await onSaved(result,value.command.record);
  }catch(reason){if(current(value)){value.error=reason;render();}throw reason;}
  finally{value.busy=false;if(session===value)render();}
 }
 async function discard(){
  const value=session;if(!value)return;
  if(value.applyAttempted){await save();return;}
  value.busy=true;render();
  try{
   if(!value.receipt)await ensureReceipt(value);
   await request(value,'/api/research/drafts/remove',{id:value.command.id,workspaceId:value.command.workspaceId,expectedRevision:value.receipt.revision});
   stop();await onDiscard?.();
  }catch(reason){value.error=reason;value.busy=false;render();throw reason;}
 }
 async function action(control){
  if(control.dataset.action!=='configuration-record-discard'||!active())return false;
  if(control.dataset.confirm!=='true'){control.dataset.confirm='true';control.textContent=text('confirmDiscardRecord');return true;}
  try{await discard();}catch{}return true;
 }
 return {open,active,draft,written,controls,save,discard,stop,checkContext(){if(session&&!session.busy&&(session.context!==researchContext(state)||state.access?.locked||state.storageUnavailable||session.command.workspaceId!==state.book?.id))stop();},action,draftId:()=>session?.plan?session.command.id:null,busy:()=>Boolean(session?.busy),recordId:()=>session?.command.recordId,title:()=>session?.command.record.title};
}
