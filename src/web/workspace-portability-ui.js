import {language,t,messageLanguage} from './i18n/index.js';

export function workspacePortabilityUI({state,api,esc,field,locationFields,showDialog}){
 const m=(key,values)=>esc(t('access',key,values));
 const region=()=>`data-i18n-region="access" lang="${messageLanguage('access')}"`;
 const controls=()=>`<div ${region()}><div class="inline-actions"><button class="button" data-action="storage-portable-dialog">${m('portableTitle')}</button><button class="button" data-action="storage-portable-status">${m('backupStatus')}</button></div><p class="muted">${m('relocationHint')}</p></div>`;
 const date=value=>new Date(value).toLocaleString(language());
 function showHistory({backup,verification,failedCheck,restoration}){
  const parts=[`<section ${region()}><h2 id="dialog-title">${m('backupStatus')}</h2>`];
  if(backup){
   parts.push(`<p class="storage-path">${esc(backup.destination)}</p>`);
   if(backup.completedAt)parts.push(`<p>${m('portableCompleted',{date:date(backup.completedAt)})}</p>`);
   parts.push(`<p>${m('portableCoverage',{count:backup.projects})}</p>`);
   if(failedCheck?.id===backup.id)parts.push(`<p class="module-error">${m('backupCheckFailed',{date:date(failedCheck.at)})}</p>`);
   if(verification?.id===backup.id){
    parts.push(`<p>${m('backupVerified',{date:date(verification.verifiedAt),count:verification.inventory.files})}</p>`);
   }else if(failedCheck?.id!==backup.id)parts.push(`<p>${m('backupUnchecked')}</p>`);
   if(backup.inventory)parts.push(`<p>${m('backupReconnect')}</p><button class="button" data-action="storage-portable-verify" data-copy-id="${esc(backup.id)}">${m('backupVerify')}</button>`);
   else parts.push(`<p>${m('backupNewCopy')}</p>`);
  }else parts.push(`<p>${m('backupNone')}</p>`);
  if(restoration)parts.push(`<p>${m('backupRestored',{date:date(restoration.restoredAt),count:restoration.inventory.files})}</p><p class="storage-path">${esc(restoration.destination)}</p>`);
  parts.push(`<button class="button" data-action="storage-portable-restore" data-source="${esc(backup?.destination??'')}">${m('backupRestore')}</button>`);
  parts.push(`<div class="dialog-actions"><button class="button primary" data-action="close-dialog">${m('close')}</button></div></section>`);showDialog(parts.join(''));
 }
 async function history(button){
  if(button.dataset.action==='storage-portable-status'){showHistory(await api('/api/storage/portable/status',{}));return;}
  button.disabled=true;
  try{
   const result=await api('/api/storage/portable/verify',{id:button.dataset.copyId});
   if(button.isConnected)showHistory(result);
  }catch(error){
   if(button.isConnected)showHistory(await api('/api/storage/portable/status',{}));
   throw error;
  }finally{if(button.isConnected)button.disabled=false;}
 }
 function openRestore(source=''){
  showDialog(`<form id="storage-portable-restore-form" data-no-draft ${region()}><h2 id="dialog-title">${m('backupRestore')}</h2><p>${m('restoreHint')}</p>${locationFields(source,'restore-source',{name:'source',check:false,label:m('restoreSource')})}${locationFields('','restore-destination',{name:'destination',check:false,label:m('restoreDestination')})}${field(m('username'),'<input name="username" maxlength="80" autocomplete="username">')}${field(m('password'),'<input name="password" type="password" maxlength="1024" autocomplete="current-password">')}<details><summary>${m('useRecovery')}</summary>${field(m('recovery'),'<input name="recovery" type="password" autocomplete="off" spellcheck="false">')}</details><div data-restore-review aria-live="polite"></div><div class="dialog-actions"><button class="button" type="button" data-action="close-dialog">${m('cancel')}</button><button class="button primary" type="submit">${m('restoreReview')}</button></div></form>`);
 }
 async function restore(form,data){
  if(!form.closest('dialog')?.open)return;
  const args=Object.fromEntries(['source','destination','username','password','recovery'].map(key=>[key,data.get(key)??'']));
  const token=form.dataset.reviewToken;
  if(!token||args.source!==form.dataset.source||args.destination!==form.dataset.destination){
   const result=await api('/api/workspaces/portable-restore/review',args);
   if(!form.closest('dialog')?.open||form.elements.source.value!==args.source||form.elements.destination.value!==args.destination)return;
   Object.assign(form.dataset,{reviewToken:result.token,source:args.source,destination:args.destination});
   form.querySelector('[data-restore-review]').innerHTML=`<p>${m('restoreSummary',{files:result.receipt.inventory.files,projects:result.receipt.projects})}</p><p class="storage-path">${esc(result.destination)}</p>`;
   form.querySelector('[type=submit]').textContent=t('access','restoreConfirm');
   form.oninput=event=>{
    if(event.target.name!=='source'&&event.target.name!=='destination')return;
    delete form.dataset.reviewToken;
    form.querySelector('[data-restore-review]').replaceChildren();
    form.querySelector('[type=submit]').textContent=t('access','restoreReview');
   };
   return;
  }
  const result=await api('/api/workspaces/portable-restore/apply',{...args,token});
  if(!form.closest('dialog')?.open)return;
  showDialog(`<section ${region()}><h2 id="dialog-title">${m('restoreReady')}</h2><p>${m('backupRestored',{date:date(result.restoredAt),count:result.inventory.files})}</p><p class="storage-path">${esc(result.destination)}</p><p>${m('restoreNext')}</p><div class="dialog-actions"><button class="button" data-action="close-dialog">${m('close')}</button><button class="button primary" data-action="storage-open-recent" data-path="${esc(result.destination)}">${m('openWorkspace')}</button></div></section>`);
 }
 function open(){
  showDialog(`<form id="storage-portable-form" data-no-draft ${region()}><h2 id="dialog-title">${m('portableTitle')}</h2><p>${m('portableHint')}</p>${locationFields('','portable-destination')}${state.access?.encrypted?`<p>${m('portableAccessHint')}</p>${field(m('username'),'<input name="username" maxlength="80" autocomplete="username">')}${field(m('password'),'<input name="password" type="password" maxlength="1024" autocomplete="current-password">')}<details><summary>${m('useRecovery')}</summary>${field(m('recovery'),'<input name="recovery" type="password" autocomplete="off" spellcheck="false">')}</details>`:''}<div class="dialog-actions"><button class="button" type="button" data-action="close-dialog">${m('cancel')}</button><button class="button primary" type="submit">${m('portableCreate')}</button></div></form>`);
 }
 async function submit(form,data){
  if(form.id==='storage-portable-restore-form'){await restore(form,data);return true;}
  if(form.id==='storage-portable-form'){
   const result=await api('/api/storage/portable',{path:data.get('storagePath'),confirmed:true,username:data.get('username')??'',password:data.get('password')??'',recovery:data.get('recovery')??''});
   const receipt=result.receipt;
   const completion=receipt.completedAt?`<p>${m('portableCompleted',{date:new Date(receipt.completedAt).toLocaleString(language())})}</p>`:'';
   showDialog(`<section ${region()}><h2 id="dialog-title">${m('portableReady')}</h2><p class="storage-path">${esc(result.destination)}</p>${completion}<p>${m('portableCoverage',{count:receipt.projects})}</p><p>${m('portableNext')}</p><p class="muted">${m('portableLocalSettings')}</p><div class="dialog-actions"><button class="button primary" data-action="close-dialog">${m('close')}</button></div></section>`);return true;
  }
  return false;
 }
 return {controls,open,openRestore,submit,history};
}
