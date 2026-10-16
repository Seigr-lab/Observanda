import {t,messageLanguage} from './i18n/index.js';

export function workspacePortabilityUI({state,api,esc,field,locationFields,showDialog}){
 const m=(key,values)=>esc(t('access',key,values));
 const region=()=>`data-i18n-region="access" lang="${messageLanguage('access')}"`;
 const controls=()=>`<div ${region()}><button class="button" data-action="storage-portable-dialog">${m('portableTitle')}</button><p class="muted">${m('relocationHint')}</p></div>`;
 function open(){
  showDialog(`<form id="storage-portable-form" data-no-draft ${region()}><h2 id="dialog-title">${m('portableTitle')}</h2><p>${m('portableHint')}</p>${locationFields('','portable-destination')}${state.access?.encrypted?`<p>${m('portableAccessHint')}</p>${field(m('username'),'<input name="username" maxlength="80" autocomplete="username">')}${field(m('password'),'<input name="password" type="password" maxlength="1024" autocomplete="current-password">')}<details><summary>${m('useRecovery')}</summary>${field(m('recovery'),'<input name="recovery" type="password" autocomplete="off" spellcheck="false">')}</details>`:''}<div class="dialog-actions"><button class="button" type="button" data-action="close-dialog">${m('cancel')}</button><button class="button primary" type="submit">${m('portableCreate')}</button></div></form>`);
 }
 async function submit(form,data){
  if(form.id==='storage-portable-form'){
   const result=await api('/api/storage/portable',{path:data.get('storagePath'),confirmed:true,username:data.get('username')??'',password:data.get('password')??'',recovery:data.get('recovery')??''});
   showDialog(`<section ${region()}><h2 id="dialog-title">${m('portableReady')}</h2><p class="storage-path">${esc(result.destination)}</p><p>${m('portableNext')}</p><p class="muted">${m('portableLocalSettings')}</p><div class="dialog-actions"><button class="button primary" data-action="close-dialog">${m('close')}</button></div></section>`);return true;
  }
  return false;
 }
 return {controls,open,submit};
}
