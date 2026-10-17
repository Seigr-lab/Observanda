import {editRecordCheckpoint} from './record-draft-edit-ui.js';
import {researchContext} from './project-context.js';
import {revisionId} from './revision-model.js';
import {t} from './i18n/index.js';

// Seeding and selected editing use the existing checkpoint/review owners.
// This controller keeps only one record header and the exact apply identity.
export function configurationRecordCreation({state,api,esc,field,render,onDirty,onSaved,onDiscard,editorOptions={}}){
 let session=null;
 const text=(key,args)=>t('configurationEditor',key,args);
 const active=()=>Boolean(session&&session.context===researchContext(state)&&session.command.workspaceId===state.book?.id&&session.command.recordId===state.selected&&state.page==='editor');
 const current=value=>session===value&&value.context===researchContext(state)&&value.command.workspaceId===state.book?.id;
 const invalid=()=>Error(text('invalid'));
 function changed(change){
  if(!active())return;if(change.field==='title'){const record=state.book.entries.find(record=>record.id===session.command.recordId);if(record)record.title=change.value.value;}
  onDirty();
 }
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
 async function initialize(value){
  if(value.initializing)return value.initializing;
  value.initializing=(async()=>{
   try{
    await prepare(value);if(!current(value)||value.editor)return;
    value.host??=document.createElement('section');value.error=null;bind();
    value.editor=await editRecordCheckpoint({...editorOptions,state,api,esc,field},{plan:value.plan,host:value.host,signal:value.controller.signal,onChange:changed,onSave:()=>save().catch(reason=>{value.error=reason;render();})});
    if(current(value))render();
   }catch(reason){if(current(value)){value.error=reason;render();}throw reason;}
   finally{value.initializing=null;}
  })();return value.initializing;
 }
 async function open(record,section){
  stop();
  const value={context:researchContext(state),command:{id:crypto.randomUUID(),workspaceId:state.book.id,notebookId:record.notebookId,recordId:record.id,configurationPin:section.configurationPin,sectionId:section.sectionId,record:structuredClone(record)},receipt:null,plan:null,applyPlan:null,saved:null,applyAttempted:false,host:null,editor:null,initializing:null,error:null,busy:false,controller:new AbortController()};
  session=value;onDirty();render();try{await initialize(value);}catch{}return value;
 }
 function stop(){const previous=session;session=null;previous?.controller.abort();previous?.editor?.destroy();previous?.host?.remove();}
 function view(){return '<div class="record-toolbar"><button class="button subtle back-button" data-action="back-to-records">'+esc(text('backToRecords'))+'</button></div><section class="editor-paper" data-configuration-record-host></section>'+(session?.error?'<p role="alert">'+esc(session.error.message)+'</p><button type="button" class="button" data-action="configuration-record-retry">'+esc(text('retry'))+'</button>':!session?.editor?'<p role="status">'+esc(text('startingRecord'))+'</p>':'');}
 function bind(){if(!active())return;const target=document.querySelector('[data-configuration-record-host]');if(target&&session.host&&!target.contains(session.host))target.append(session.host);}
 async function save(){
  const value=session;if(!active()||value.busy)return;
  value.busy=true;value.error=null;
  try{
   await initialize(value);value.editor.setBusy(true);
   if(!value.applyAttempted){await value.editor.flush();value.applyPlan=await prepare(value,{refresh:true});}
   if(!value.saved){value.applyAttempted=true;try{value.saved=await request(value,'/api/research/drafts/review/apply',{id:value.applyPlan.id,workspaceId:value.applyPlan.workspaceId,expectedRevision:value.applyPlan.revision});}catch(reason){if(['INVALID','RECORD_CHANGED','DRAFT_CHANGED','FORMAT'].includes(reason.code))value.applyAttempted=false;throw reason;}}
   const result=value.saved;if(!result?.recordDraftRecovered||result.recordId!==value.command.recordId||result.absent||!revisionId(result.etag))throw invalid();
   await onSaved(result,value.command.record);if(current(value))stop();
  }catch(reason){if(current(value)){value.error=reason;render();}throw reason;}
  finally{value.busy=false;if(current(value))value.editor?.setBusy(value.applyAttempted);}
 }
 async function discard(){
  const value=session;if(!value)return;
  if(value.applyAttempted){await save();return;}
  value.busy=true;value.editor?.setBusy(true);
  try{
   // An unknown seed acknowledgement is replayed, then its exact checkpoint is removed.
   if(value.initializing)await value.initializing.catch(()=>{});
   if(!value.receipt)await ensureReceipt(value);
   await request(value,'/api/research/drafts/remove',{id:value.command.id,workspaceId:value.command.workspaceId,expectedRevision:value.receipt.revision});
   stop();await onDiscard?.();
  }catch(reason){value.error=reason;value.busy=false;value.editor?.setBusy(false);render();throw reason;}
 }
 async function action(control){if(control.dataset.action!=='configuration-record-retry'||!active())return false;try{if(session.applyAttempted)await save();else await initialize(session);}catch{}return true;}
 return {open,active,view,bind,save,discard,stop,checkContext(){if(session&&(!active()||state.access?.locked||state.storageUnavailable))stop();},action,busy:()=>Boolean(session?.busy),recordId:()=>session?.command.recordId};
}
