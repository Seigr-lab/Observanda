import {t} from './i18n/index.js';
import {revisionId} from './revision-model.js';
import {operationProgress} from './operation-progress-ui.js';

// Keep the reviewed revision through uncertain replies. A refreshed reader
// must never silently retarget an already submitted removal to newer content.
export function recordRemovalUI({state,api,esc,target,onRemoved,refresh,notify}){
 const text=key=>t('recordAuthoring',key),dialog=document.createElement('dialog');dialog.className='record-writing';document.body.append(dialog);
 let session=null,workspace=null;const pending=new Map();
 const context=()=>JSON.stringify([state.storage?.contextId,state.book?.id,state.selected,state.page]);
 const key=value=>JSON.stringify([state.storage?.contextId,value.workspaceId,value.recordId]);
 const active=s=>session===s&&s.context===context()&&!state.access?.locked&&!state.storageUnavailable&&dialog.open;
 function close(){session=null;dialog.close();dialog.innerHTML='';}
 function paint(){
  const s=session;if(!s)return;dialog.setAttribute('aria-label',text('remove'));
  dialog.innerHTML='<h2>'+esc(text('remove'))+'</h2><p>'+esc(s.title)+'</p><p>'+esc(text('removeHelp'))+'</p><p role="alert">'+esc(s.error??'')+'</p>'+
   (s.command?'<p role="status">'+esc(text('removePending'))+'</p>':'')+'<div data-removal-progress></div><div class="dialog-actions">'+
   '<button type="button" class="button" data-removal-close>'+esc(text(s.command?'close':'cancel'))+'</button>'+
   (s.stale?'<button type="button" class="button" data-removal-refresh>'+esc(text('removeRefresh'))+'</button>':'')+
   '<button type="button" class="button danger" data-removal-submit'+(s.busy||s.stale?' disabled':'')+'>'+esc(text(s.command?'removeRetry':'remove'))+'</button></div>';
 }
 function checkContext(){
  const next=state.access?.locked?null:JSON.stringify([state.storage?.contextId,state.book?.id]);if(workspace!==next){pending.clear();workspace=next;}
  if(session&&(session.context!==context()||state.access?.locked||state.storageUnavailable))close();
 }
 function open(){
  checkContext();const value=target();if(!value||!revisionId(value.expectedRevision)||state.dirty)return;
  const retained=pending.get(key(value));session={...value,...retained,context:context(),busy:false};paint();dialog.showModal();
 }
 dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 dialog.addEventListener('click',async event=>{
  if(event.target.closest('[data-removal-close]')){close();return;}
  if(event.target.closest('[data-removal-refresh]')){close();try{if(!await refresh())notify(text('removeRefreshFailed'),true);}catch{notify(text('removeRefreshFailed'),true);}return;}
  const s=session;if(!event.target.closest('[data-removal-submit]')||!s||s.busy||s.stale||!active(s))return;
  s.command??={workspaceId:s.workspaceId,recordId:s.recordId,expectedRevision:s.expectedRevision};
  const requestKey=key(s),command=s.command;pending.set(requestKey,{command,title:s.title});s.busy=true;s.error='';paint();
  const progress=operationProgress({host:dialog.querySelector('[data-removal-progress]'),title:()=>text('removing'),stageText:key=>t('recordSaveProgress',key),disableControls:false});
  try{
   const result=await api('/api/research/records/remove',command,{adopt:false,onProgress:progress.update});
   if(!result?.recordScope?.missing?.includes(command.recordId)||result.book?.entries?.length!==0)throw Error(text('invalidRemoval'));
   pending.delete(requestKey);
   if(active(s)){close();onRemoved(result);notify(text('removed'));}
  }catch(error){
   if(active(s)){
    s.error=error.code==='RECORD_CHANGED'?text('removeConflict'):error.message;
    if(['INVALID','RECORD_CHANGED','WORKSPACE_CHANGED','FORMAT'].includes(error.code)){pending.delete(requestKey);s.command=null;s.stale=true;}
   }
  }finally{progress.close();if(active(s)){s.busy=false;paint();}}
 });
 return {open,checkContext,view:()=>'<button type="button" class="button danger" data-action="record-removal-open">'+esc(text('remove'))+'</button>'};
}
