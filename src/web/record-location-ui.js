import {t} from './i18n/index.js';
import {revisionId} from './revision-model.js';
import {locationName} from './workspace-structure.js';
import {operationProgress} from './operation-progress-ui.js';

export function recordLocationUI({state,api,esc,target,refresh,notify}){
 const text=key=>t('recordContent','location'+key),dialog=document.createElement('dialog');dialog.className='record-writing';document.body.append(dialog);
 let session=null;const pending=new Map();let workspace=null;
 const context=()=>JSON.stringify([state.storage?.contextId,state.book?.id,state.selected,state.page]);
 const active=s=>session===s&&s.context===context()&&!state.access?.locked&&!state.storageUnavailable&&dialog.open;
 const key=value=>JSON.stringify([state.storage?.contextId,value.workspaceId,value.recordId]);
 function close(){session=null;dialog.close();dialog.innerHTML='';}
 function paint(){
  const s=session;if(!s)return;dialog.setAttribute('aria-label',text('Title'));
  const choices=s.notebooks.map(n=>'<option value="'+n.id+'"'+(n.id===s.destination?' selected':'')+'>'+esc(locationName(state.book,n.projectId)+' / '+n.title)+'</option>').join('');
  dialog.innerHTML='<h2 id="record-location-title">'+esc(text('Title'))+'</h2><p>'+esc(s.title)+'</p><p>'+esc(text('Help'))+'</p>'+
   '<label for="record-location-destination">'+esc(text('Destination'))+'</label><select id="record-location-destination" data-record-location required'+(s.busy||s.command?' disabled':'')+'><option value="">'+esc(text('Choose'))+'</option>'+choices+'</select>'+
   '<p role="alert">'+esc(s.error??'')+'</p>'+(s.command?'<p role="status">'+esc(text('Pending'))+'</p>':'')+'<div data-location-progress></div>'+
   '<div class="dialog-actions"><button type="button" class="button" data-location-close>'+esc(text('Close'))+'</button>'+(s.stale?'<button type="button" class="button" data-location-refresh>'+esc(text('Refresh'))+'</button>':'')+'<button type="button" class="button primary" data-location-save'+(s.busy||s.stale?' disabled':'')+'>'+esc(text(s.command?'Retry':'Move'))+'</button></div>';
 }
 function checkContext(){
  const next=state.access?.locked?null:JSON.stringify([state.storage?.contextId,state.book?.id]);if(workspace!==next){pending.clear();workspace=next;}
  if(session&&(session.context!==context()||state.access?.locked||state.storageUnavailable))close();
 }
 function open(){
  checkContext();const value=target();if(!value||state.dirty)return;
  const command=pending.get(key(value)),notebooks=state.book.notebooks.filter(n=>n.id!==value.sourceNotebookId||n.id===command?.notebookId);
  session={...value,context:context(),notebooks,destination:command?.notebookId??'',command,busy:false};paint();dialog.showModal();
 }
 dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 dialog.addEventListener('change',event=>{if(event.target.matches('[data-record-location]')&&session&&!session.command)session.destination=event.target.value;});
 dialog.addEventListener('click',async event=>{
  if(event.target.closest('[data-location-close]')){close();return;}
  if(event.target.closest('[data-location-refresh]')){close();try{await refresh();}catch(error){notify(error.message,true);}return;}
  const s=session;if(!event.target.closest('[data-location-save]')||!s||s.busy||s.stale||!active(s))return;
  if(!s.command&&!dialog.querySelector('[data-record-location]').reportValidity())return;
  s.command??={workspaceId:s.workspaceId,recordId:s.recordId,sourceNotebookId:s.sourceNotebookId,notebookId:s.destination,expectedStorageRevision:s.expectedStorageRevision,commandId:crypto.randomUUID()};
  const requestKey=key(s),command=s.command;pending.set(requestKey,command);s.busy=true;s.error='';paint();
  const progress=operationProgress({host:dialog.querySelector('[data-location-progress]'),title:()=>text('Working'),stageText:key=>t('recordSaveProgress',key),disableControls:false});
  try{
   const result=await api('/api/research/records/location',command,{adopt:false,onProgress:progress.update});
   if(result?.saved!==true||result.recordId!==command.recordId||result.notebookId!==command.notebookId||!revisionId(result.etag))throw Error(text('Incomplete'));
   pending.delete(requestKey);
   if(active(s)){close();try{await refresh();notify(text('Saved'));}catch{notify(text('RefreshFailed'),true);}}
  }catch(error){
   if(active(s)){
    s.error=error.message;
    if(['INVALID','MISSING','RECORD_CHANGED','WORKSPACE_CHANGED','FORMAT','INTAKE_COMPLETION'].includes(error.code)){pending.delete(requestKey);s.command=null;s.stale=true;}
   }
  }finally{progress.close();if(active(s)){s.busy=false;paint();}}
 });
 return {open,checkContext,button:()=>'<button type="button" class="button" data-action="record-location-open">'+esc(text('Title'))+'</button>'};
}
