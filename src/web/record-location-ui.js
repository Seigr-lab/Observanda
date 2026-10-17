import {t} from './i18n/index.js';
import {revisionId} from './revision-model.js';
import {researchId} from './research-reference.js';
import {researchOwner} from './project-context.js';
import {locationName} from './workspace-structure.js';
import {operationProgress} from './operation-progress-ui.js';

export function recordLocationUI({state,api,esc,target,refresh,notify,choose,access=operation=>operation(),moved=async()=>{}}){
 const text=key=>t('recordContent','location'+key),dialog=document.createElement('dialog');dialog.className='record-writing';document.body.append(dialog);
 let session=null;const pending=new Map();let workspace=null;
 const context=()=>JSON.stringify([state.storage?.contextId,state.book?.id,state.selected,state.page]);
 const current=s=>session===s&&s.context===context()&&!state.access?.locked&&!state.storageUnavailable;
 const active=s=>current(s)&&dialog.open;
 const key=value=>JSON.stringify([state.storage?.contextId,value.workspaceId,value.recordId]);
 const phases=new Set(['copying','verified','activating','retiring','complete','cancelled']);
 const phaseText=phase=>text('Transfer'+phase[0].toUpperCase()+phase.slice(1));
 const commandStatus=s=>({workspaceId:s.workspaceId,recordId:s.recordId,...(s.transfer?.id||s.transferCommand?.id?{id:s.transfer?.id??s.transferCommand.id}:{})});
 const call=(s,operation,command,options={})=>api('/api/research/records/transfer/'+operation,command,{...options,adopt:false,owner:s.owner});
 function close(){session?.controller?.abort();session=null;dialog.close();dialog.innerHTML='';}
 function paint(){
  const s=session;if(!s)return;dialog.setAttribute('aria-label',text('Title'));
  const choices=s.notebooks.map(n=>'<option value="'+n.id+'"'+(n.id===s.destination?' selected':'')+'>'+esc(locationName(state.book,n.projectId)+' / '+n.title)+'</option>').join('');
  const locked=s.busy||s.checking||s.command||s.transferCommand||s.transfer,transfer=s.transfer;
  const selection=transfer||s.transferCommand?'<p>'+esc(transfer?phaseText(transfer.phase):text('TransferUnconfirmed'))+'</p>':s.target?'<p><strong>'+esc(s.target.label)+'</strong></p>':choices?'<label for="record-location-destination">'+esc(text('Destination'))+'</label><select id="record-location-destination" data-record-location required'+(locked?' disabled':'')+'><option value="">'+esc(text('Choose'))+'</option>'+choices+'</select>':'';
  const button=(attribute,label,disabled=false)=>'<button type="button" class="button" '+attribute+(disabled?' disabled':'')+'>'+esc(text(label))+'</button>';
  const submit=transfer?.phase==='complete'?button('data-location-open-result','TransferOpen',s.busy):transfer?button('data-location-resume','TransferResume',s.busy||!transfer.canResume):button('data-location-save',''+(s.command||s.transferCommand?'Retry':'Move'),s.busy||s.checking||s.statusFailed||s.stale||!s.target&&!choices&&!s.transferCommand);
  dialog.innerHTML='<h2 id="record-location-title">'+esc(text('Title'))+'</h2><p>'+esc(s.title)+'</p><p>'+esc(text('Help'))+'</p>'+selection+
   (choose&&!s.command&&!s.transferCommand&&!transfer?button('data-location-choose','TransferChoose',locked):'')+
   '<p role="alert">'+esc(s.error??'')+'</p>'+(s.checking?'<p role="status">'+esc(text('TransferChecking'))+'</p>':s.message?'<p role="status">'+esc(s.message)+'</p>':'')+
   (s.command||s.transferCommand||transfer&&transfer.phase!=='complete'?'<p role="status">'+esc(text(s.command?'Pending':'TransferPending'))+'</p>':'')+'<div data-location-progress></div>'+
   '<div class="dialog-actions">'+button('data-location-close','Close')+(s.stale?button('data-location-refresh','Refresh'):'')+(s.statusFailed||s.transferCommand||transfer&&transfer.phase!=='complete'?button('data-location-status','TransferCheck',s.busy||s.checking):'')+submit+(transfer?.canCancel?button('data-location-cancel','TransferCancel',s.busy):'')+'</div>';
 }
 function checkContext(){
  const next=state.access?.locked?null:JSON.stringify([state.storage?.contextId,state.book?.id]);if(workspace!==next){pending.clear();workspace=next;}
  if(session&&!current(session))close();
 }
 function validate(s,value){
  if(value===null)return null;
  const owner=value?.targetOwner,result=value?.result;
  if(!researchId(value?.id)||!phases.has(value.phase)||typeof value.canResume!=='boolean'||typeof value.canCancel!=='boolean'||!owner||!researchId(owner.workspaceId)||!['projectId','labBookId'].every(k=>owner[k]===null||researchId(owner[k]))||owner.labBookId!==null&&owner.projectId===null||!researchId(value.targetNotebookId)||(s.transfer?.id??s.transferCommand?.id)&&(value.id!==(s.transfer?.id??s.transferCommand?.id)))throw Error(text('Incomplete'));
  if(s.transferCommand&&['projectId','labBookId','workspaceId'].some(k=>owner[k]!==s.transferCommand['target'+k[0].toUpperCase()+k.slice(1)])||s.transferCommand&&value.targetNotebookId!==s.transferCommand.targetNotebookId)throw Error(text('Incomplete'));
  if(value.phase==='complete'&&(!result||result.recordId!==s.recordId||result.notebookId!==value.targetNotebookId||!['projectId','labBookId','workspaceId'].every(k=>result[k]===owner[k])||!revisionId(result.storageRevision)))throw Error(text('Incomplete'));
  return value;
 }
 function adoptStatus(s,value){
  s.transfer=validate(s,value);s.statusFailed=false;
  if(value?.phase==='cancelled'){pending.delete(key(s));s.transfer=null;s.transferCommand=null;s.target=null;s.message=text('TransferCancelled');}
  else if(value)pending.set(key(s),{transferCommand:s.transferCommand,transfer:value,target:s.target});
 }
 async function discover(s){
  s.controller?.abort();s.controller=new AbortController();const controller=s.controller;s.checking=true;s.statusFailed=false;s.error='';paint();
  try{const status=await api('/api/research/records/transfer/status',commandStatus(s),{adopt:false,owner:s.owner,signal:controller.signal});if(current(s)&&s.controller===controller)adoptStatus(s,status);}
  catch(error){if(current(s)&&s.controller===controller&&error.name!=='AbortError'){s.statusFailed=true;s.error=error.message??text('TransferFailed');}}
  finally{if(current(s)&&s.controller===controller){s.checking=false;paint();}}
 }
 function open(){
  checkContext();const value=target();if(!value||state.dirty)return;
  const retained=pending.get(key(value)),notebooks=state.book.notebooks.filter(n=>n.id!==value.sourceNotebookId||n.id===retained?.command?.notebookId);
  const s=session={...value,...retained,owner:researchOwner(state),context:context(),notebooks,destination:retained?.command?.notebookId??'',busy:false};paint();dialog.showModal();if(choose&&!s.command)void discover(s);
 }
 function chooseBook(s){
  if(!choose||s.busy||s.checking||s.command||s.transfer||s.transferCommand)return;
  dialog.close();s.choosing=true;
  const returnToMove=()=>{if(current(s)){s.choosing=false;paint();dialog.showModal();}};
  choose({heading:text('TransferChoose'),kind:'book-parents',filter:book=>researchId(book.namespaceId)&&book.namespaceId!==s.workspaceId,cancelled:returnToMove,selected:async(projectId,labBookId,legacy,book)=>{
   if(!current(s))return;
   if(legacy||!researchId(book?.namespaceId)){s.error=text('Incomplete');returnToMove();return;}
   s.target={projectId,labBookId,workspaceId:book.namespaceId,notebookId:labBookId,label:book.projectTitle+' / '+book.directory};s.destination='';s.error='';returnToMove();
  }});
 }
 async function openResult(s){
  if(!active(s)||s.transfer?.phase!=='complete')return;const result=s.transfer.result;
  try{await moved(result);pending.delete(key(s));if(current(s))close();notify(text('Saved'));}
  catch(error){if(active(s)){s.error=error.message??text('RefreshFailed');paint();}}
 }
 async function transfer(s,operation){
  if(operation==='start')s.transferCommand??={id:crypto.randomUUID(),workspaceId:s.workspaceId,recordId:s.recordId,sourceNotebookId:s.sourceNotebookId,expectedStorageRevision:s.expectedStorageRevision,targetProjectId:s.target.projectId,targetLabBookId:s.target.labBookId,targetWorkspaceId:s.target.workspaceId,targetNotebookId:s.target.notebookId};
  pending.set(key(s),{transferCommand:s.transferCommand,transfer:s.transfer,target:s.target});s.busy=true;s.error='';paint();
  const progress=operationProgress({host:dialog.querySelector('[data-location-progress]'),title:()=>text('Working'),stageText:stage=>{const phase=stage.replace(/^record-transfer-/,'');return phases.has(phase)?phaseText(phase):text('Working');},disableControls:false});
  try{
   const status=await access(()=>call(s,operation,operation==='start'?s.transferCommand:commandStatus(s),{onProgress:progress.update}));
   validate(s,status);if(status===null)throw Error(text('Incomplete'));
   if(current(s)){adoptStatus(s,status);if(status.phase==='complete'&&active(s))await openResult(s);}
  }catch(error){if(current(s)){s.error=error.name==='AbortError'?'':error.message??text('TransferFailed');if(error.operationNotStarted===true){pending.delete(key(s));s.transferCommand=null;}else if(error.code==='RECORD_CHANGED'&&!s.transfer){pending.delete(key(s));s.transferCommand=null;s.stale=true;}}}
  finally{progress.close();if(current(s)){s.busy=false;paint();}}
 }
 async function moveLocal(s){
  if(!s.command&&!dialog.querySelector('[data-record-location]').reportValidity())return;
  s.command??={workspaceId:s.workspaceId,recordId:s.recordId,sourceNotebookId:s.sourceNotebookId,notebookId:s.destination,expectedStorageRevision:s.expectedStorageRevision,commandId:crypto.randomUUID()};
  const requestKey=key(s),command=s.command;pending.set(requestKey,{command});s.busy=true;s.error='';paint();
  const progress=operationProgress({host:dialog.querySelector('[data-location-progress]'),title:()=>text('Working'),stageText:key=>t('recordSaveProgress',key),disableControls:false});
  try{
   const result=await api('/api/research/records/location',command,{adopt:false,owner:s.owner,onProgress:progress.update});
   if(result?.saved!==true||result.recordId!==command.recordId||result.notebookId!==command.notebookId||!revisionId(result.etag))throw Error(text('Incomplete'));
   pending.delete(requestKey);
   if(active(s)){close();try{await refresh();notify(text('Saved'));}catch{notify(text('RefreshFailed'),true);}}
  }catch(error){if(active(s)){s.error=error.message;if(['INVALID','MISSING','RECORD_CHANGED','WORKSPACE_CHANGED','FORMAT','INTAKE_COMPLETION'].includes(error.code)){pending.delete(requestKey);s.command=null;s.stale=true;}}}
  finally{progress.close();if(active(s)){s.busy=false;paint();}}
 }
 dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 dialog.addEventListener('change',event=>{if(event.target.matches('[data-record-location]')&&session&&!session.command)session.destination=event.target.value;});
 dialog.addEventListener('click',async event=>{
  if(event.target.closest('[data-location-close]')){close();return;}
  if(event.target.closest('[data-location-refresh]')){close();try{await refresh();}catch(error){notify(error.message,true);}return;}
  const s=session;if(!s||s.busy||s.checking||!active(s))return;
  if(event.target.closest('[data-location-status]'))return discover(s);
  if(event.target.closest('[data-location-open-result]'))return openResult(s);
  if(event.target.closest('[data-location-choose]')){chooseBook(s);return;}
  if(event.target.closest('[data-location-cancel]')&&s.transfer?.canCancel)return transfer(s,'cancel');
  if(event.target.closest('[data-location-resume]')&&s.transfer?.canResume)return transfer(s,'resume');
  if(!event.target.closest('[data-location-save]')||s.stale||s.statusFailed)return;
  if(s.target||s.transferCommand)return transfer(s,'start');
  await moveLocal(s);
 });
 return {open,checkContext,button:()=>'<button type="button" class="button" data-action="record-location-open">'+esc(text('Title'))+'</button>'};
}
