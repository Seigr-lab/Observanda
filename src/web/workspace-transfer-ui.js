import {t,messageLanguage} from './i18n/index.js';
import {transferWorkspace} from './workspace-transfer.js';
export function workspaceTransferUI({state,api,esc,locationFields,showDialog,switched,notify}){
 const text=(key,args)=>t('access',key,args),m=(key,args)=>esc(text(key,args));
 const region=()=>`data-i18n-region="access" lang="${messageLanguage('access')}"`;
 const paths=value=>`<dl class="storage-map"><dt>${m('copyFrom')}</dt><dd>${esc(value.source)}</dd><dt>${m('copyTo')}</dt><dd>${esc(value.destination)}</dd></dl>`;
 const actions=(label)=>`<div class="dialog-actions"><button class="button" type="button" data-action="close-dialog">${m('cancel')}</button><button class="button primary" type="submit">${m(label)}</button></div>`;
 const error='<p data-transfer-error role="alert"></p>';
 function open(mode){
  showDialog(`<form id="storage-${mode}-form" data-no-draft ${region()}><h2 id="dialog-title">${m(mode==='move'?'moveTitle':'copyTitle')}</h2><p>${m('copyFrom')}: <span class="storage-path">${esc(state.storage.root)}</span></p>${locationFields('','destination-path')}<p>${m(mode==='move'?'moveHint':'copyHint')}</p><p>${m(mode==='move'?'moveBehavior':'copyBehavior')}</p>${error}${actions(mode==='move'?'moveConfirm':'copyConfirm')}</form>`);
 }
 function pending(){
  const move=state.storage?.move;if(!move||move.phase==='complete')return '';
  return `<section class="panel"><h2>${m('moveCleanupTitle')}</h2><p>${m('moveCleanupHint')}</p>${paths(move)}${move.error?`<p role="alert">${esc(move.error.message)}</p>`:''}<button class="button" data-action="storage-move-finish-dialog">${m('finishMove')}</button></section>`;
 }
 function openFinish(){const move=state.storage.move;showDialog(`<form id="storage-move-finish"><h2 id="dialog-title">${m('moveCleanupTitle')}</h2><p>${m('moveCleanupHint')}</p>${paths(move)}${move.error?`<p role="alert">${move.error.code==='CONFLICT'?m('moveSourceChanged'):esc(move.error.message)}</p>`:''}${error}${actions('finishMove')}</form>`);}
 async function submit(form,data){
  if(!['storage-copy-form','storage-move-form','storage-move-finish'].includes(form.id))return false;
  try{
   form.querySelector('[data-transfer-error]').textContent='';
   const finish=form.id==='storage-move-finish',moving=finish||form.id==='storage-move-form';
   // Resolve a typed or picked path without inventorying the source or asking
   // for another confirmation. The transfer performs its own locked checks.
   const destination=finish?state.storage.root:(await api('/api/storage/check',{path:data.get('storagePath'),purpose:moving?'move':'copy'})).root;
   state.storage=await transferWorkspace({api,state,destination,route:finish?'/api/storage/move/finish':`/api/storage/${moving?'move':'copy'}`,data:finish?{reviewed:true}:{path:destination,confirmed:true}});
   await switched();
   if(moving&&state.storage.move?.phase!=='complete')openFinish();else notify(text(moving?'moveDone':'copyDone'));
  }catch(failure){const target=form.querySelector('[data-transfer-error]');if(target?.isConnected)target.textContent=failure.message;else throw failure;}
  return true;
 }
 return {open,submit,pending,openFinish};
}
