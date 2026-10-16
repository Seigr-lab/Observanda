import {workspaceRenamePanel} from './workspace-rename-ui.js';
import {t} from './i18n/index.js';
import {messageLanguage} from './i18n/index.js';
import {messageText} from './i18n/dom.js';
import {accessHelpButton} from './help/access-entry.js';
import {collaborationIdentityRecoveryButton} from './collaboration-identity-ui.js';

// Rendering owner for setup/access forms. Storage commands stay in storage-ui.
export function workspaceAccessViews({state,esc,field,showDialog}){
 const m=(key)=>messageText('access',key,esc);
 const region=()=>`data-i18n-region="access" lang="${messageLanguage('access')}"`;
 function locationFields(value,id='storage-path',{label=m('folder'),name='storagePath'}={}){
  return `${field(label,`<input id="${id}" name="${esc(name)}" value="${esc(value)}" required autocomplete="off" spellcheck="false">`)}<div class="inline-actions"><button type="button" class="button" data-action="storage-browse" data-target="${id}">${m(state.storage?.folderPicker?.mode==='server'?'browseServer':'chooseFolder')}</button><button type="button" class="button" data-action="storage-check" data-target="${id}">${m('checkFolder')}</button></div><p class="muted storage-check-result" role="status"></p>`;
 }
 function preferencesPanel(s){
  return `<section class="panel" ${region()}><h2>${m('preferences')}</h2><p class="storage-path">${s?.preferencesFile?esc(s.preferencesFile):m('sessionOnly')}</p><p>${m('remembered')}</p><button class="button" data-action="storage-reset-dialog">${m('reset')}</button></section>`;
 }
 function lockView(){
  const current=state.access?.version===3;
  const username=state.access?.usernameRequired?field(m('username'),`<input name="username" maxlength="80" ${current?'':'required'} autocomplete="username">`):'';
  const password=!current||state.access.passwordAvailable?username+field(m('password'),`<input name="password" type="password" ${current?'':'required'} maxlength="1024" autocomplete="current-password">`):'';
  return `<main id="main" class="access-screen" ${region()}><section class="panel"><span class="scope-kicker">Observanda</span><h1>${m('unlock')}</h1><form id="storage-unlock-form">${current&&state.access.deviceAuthorized?`<p>${m('authorized')}</p>`:''}${password}${current&&state.access.recoveryAvailable?`<details><summary>${m('useRecovery')}</summary>${field(m('recovery'),'<input name="recovery" type="password" autocomplete="off" spellcheck="false">')}</details>`:''}<button class="button primary" type="submit">${m('unlock')}</button>${current?'':`<p class="muted">${m('passwordHint')}</p>`}</form>${current&&state.access.deviceAvailable?`<button class="button" data-action="security-identity">${m('deviceRequest')}</button>`:''}${state.access?.deviceAvailable?collaborationIdentityRecoveryButton(esc):''}${accessHelpButton(esc)}</section></main>`;
 }
 function unavailable(){
  if(state.storage?.rename)return `<main id="main" class="access-screen workspace-launcher">${workspaceRenamePanel(state.storage,esc)}<section class="panel"><div class="workspace-launch-actions"><button class="button" data-action="storage-workspaces">${esc(t('workspaceDeletion','workspaces'))}</button><button class="button" data-action="storage-open-dialog">${m('openWorkspace')}</button></div></section></main>`;
  return `<main id="main" class="access-screen workspace-launcher" ${region()}><section class="panel"><h1>${m('chooseWorkspace')}</h1>${state.storage?.movedTo?`<p>${m('moveInterrupted')}</p><p class="storage-path">${esc(state.storage.movedTo)}</p><button class="button primary" data-action="storage-open-recent" data-path="${esc(state.storage.movedTo)}">${m('openMovedWorkspace')}</button>`:''}${state.storage?.unavailableReason==='workspace-deleting'?`<p>${esc(t('workspaceDeletion','pendingHint'))}</p>`:''}<div class="workspace-launch-actions"><button class="button" data-action="storage-workspaces">${esc(t('workspaceDeletion','workspaces'))}</button><button class="button primary" data-action="storage-new">${m('newWorkspace')}</button><button class="button" data-action="storage-open-dialog">${m('openWorkspace')}</button></div><details class="previous-workspace" ${state.storage?.root?'':'hidden'}><summary>${m('previousLocation')}</summary><p class="storage-path">${esc(state.storage?.root??'')}</p><p>${m(state.storage?.unavailableReason==='workspace-moved'?'moveInterrupted':state.storage?.unavailableReason==='database-missing'?'missingDatabase':state.storage?.unavailableReason==='record-missing'?'missingRecord':'missingFolder')}</p><button class="button" data-action="storage-retry">${m('retry')}</button>${preferencesPanel(state.storage)}</details>${accessHelpButton(esc,'reconnect')}</section></main>`;
 }
 function chooseDialog(mode,location=''){
  showDialog(`<form id="storage-${mode}-form" ${region()}><h2 id="dialog-title">${m(mode==='copy'?'copyTitle':'openTitle')}</h2>${mode==='open'?`<p>${m('openHint')}</p>`:''}${locationFields(location,'destination-path')}${mode==='copy'?`<p class="muted">${m('copyHint')}</p>`:`${field(m('workspaceUsername'),'<input name="username" maxlength="80" autocomplete="username">')}${field(m('workspacePassword'),'<input name="password" type="password" maxlength="1024" autocomplete="current-password">')}<details><summary>${m('useRecovery')}</summary>${field(m('recovery'),'<input name="recovery" type="password" autocomplete="off" spellcheck="false">')}</details>`}<div class="dialog-actions">${accessHelpButton(esc,'reconnect')}<button type="button" class="button" data-action="close-dialog">${m('cancel')}</button><button class="button primary" type="submit">${m(mode==='copy'?'reviewCopy':'openWorkspace')}</button></div></form>`);
 }
 function resetDialog(prefs){
  showDialog(`<form id="storage-reset-form" data-etag="${esc(prefs.etag)}" ${region()}><h2 id="dialog-title">${m('reset')}</h2><p>${m('resetHint')}</p><p class="storage-path">${prefs.file?esc(prefs.file):m('sessionOnly')}</p><p>${m('resetBackup')}</p><div class="dialog-actions"><button type="button" class="button" data-action="close-dialog">${m('cancel')}</button><button type="submit" class="button primary">${m('resetConfirm')}</button></div></form>`);
 }
 return {locationFields,preferencesPanel,lockView,unavailable,chooseDialog,resetDialog};
}
