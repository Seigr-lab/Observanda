import {workspaceRenamePanel} from './workspace-rename-ui.js';
import {workspaceManagementUI} from './workspace-management-ui.js';
import {workspaceDeletionUI} from './workspace-deletion-ui.js';
import {securityUI} from './security-ui.js';
import {collaborationIdentityUI} from './collaboration-identity-ui.js';
import {workspaceAccessViews} from './workspace-access-views.js';
import {t} from './i18n/index.js';
import './i18n/catalogues/workspaceSecurity.js';
import sourceMessages from './locales/en/workspaceSecurity.json' with {type:'json'};
import errorMessages from './locales/en/errors.json' with {type:'json'};
const tr=(key,args)=>t('workspaceSecurity',key,args);
const locationKeys=['locationResearch','locationRevisions','locationCatalogue','locationArchive','locationMedia','locationResources','locationModuleHistory','locationModuleRecovery','locationLaboratory','locationLabHistory','locationPublishing','locationReceipts','locationGrants','locationDashboard','locationDescriptor'];
const sourceLocations=new Map(locationKeys.map(key=>[sourceMessages[key],key]));
const locationLabel=value=>sourceLocations.has(value)?tr(sourceLocations.get(value)):value;
const databaseMessage=database=>database?.ready?tr('databaseConnected'):Object.hasOwn(errorMessages,database?.code)?t('errors',database.code):database?.message??'';
import {folderPickerUI} from './folder-picker-ui.js';
import {transferWorkspace} from './workspace-transfer.js';
import {workspacePortabilityUI} from './workspace-portability-ui.js';
import {workspaceTransferUI} from './workspace-transfer-ui.js';
import {workspaceDatabaseUI} from './workspace-database-ui.js';
export function storageUI({state,api,activity,writerRecovery,esc,field,save,render,showDialog,notify,reload,resetInterface,isUploading,accessOwners=operation=>operation()}){
  const security=securityUI({state,api,esc,field,showDialog,notify});
  const collaboration=collaborationIdentityUI({state,api,esc,field,showDialog,notify,lock:async()=>{if(!state.access?.locked&&!await ready())return false;await api('/api/access/lock',{});state.access.locked=true;render();return true;}});
  const folders=folderPickerUI({api,esc,field,showDialog,capabilities:()=>state.storage?.folderPicker});
  const {locationFields,preferencesPanel,lockView,unavailable,chooseDialog,resetDialog}=workspaceAccessViews({state,esc,field,showDialog});
  const portability=workspacePortabilityUI({state,api,esc,field,locationFields,showDialog});
  const transfers=workspaceTransferUI({state,api,esc,locationFields,showDialog,switched,notify});
  const deletion=workspaceDeletionUI({api,accessOwners,esc,field,showDialog,ready,switched,refreshWorkspaces:async({form})=>{const dialog=document.getElementById('dialog');if(dialog?.contains(form))dialog.close();await workspaces.refresh();},notify});
  const workspaces=workspaceManagementUI({state,api,esc,deletion,render});
  const database=workspaceDatabaseUI({state,esc});
  const hint=()=>'<p class="muted">'+esc(tr('storageHint'))+'</p>'+portability.controls()+'<button class="button" data-action="storage-writer-recovery">'+esc(t('writerRecovery','title'))+'</button>';
  function view(){if(state.storage?.rename)return `<h1>${esc(tr('storageTitle'))}</h1>${workspaceRenamePanel(state.storage,esc)}`;state.storageBusy=activity.storageBusy();if(state.storageBusy)return `<h1>${esc(tr('storageTitle'))}</h1><div data-owned-activity></div>`;const s=state.storage,encrypted=state.access?.encrypted;return `<div class="page-heading"><div><h1>${esc(tr('storageTitle'))}</h1><p class="subtitle">${esc(tr('storageSubtitle'))}</p></div></div><div class="storage-grid"><section class="panel"><h2>${esc(tr('workspaceStorage'))}</h2><p>${esc(databaseMessage(s.database))}</p><p>${esc(tr('storageDataHelp'))}</p><p class="storage-path">${esc(s.root)}</p><div class="inline-actions"><button class="button" data-action="storage-copy-path">${esc(tr('copyPath'))}</button><button class="button" data-action="storage-open-dialog">${esc(tr('openAnother'))}</button><button class="button" data-action="storage-copy-dialog">${esc(t('access','copyTitle'))}</button><button class="button" data-action="storage-move-dialog">${esc(t('access','moveTitle'))}</button></div>${database.panel()}${hint()}${transfers.pending()}<details><summary>${esc(tr('filesLocations'))}</summary><dl class="storage-map">${s.locations.map(item=>`<dt>${esc(locationLabel(item.label))}</dt><dd>${esc(item.path)}</dd>`).join('')}</dl><p class="muted"><span class="storage-path">${esc(tr('applicationPath',{path:s.applicationRoot}))}</span></p></details><p class="muted">${esc(tr('readableExports'))}</p></section><section class="panel"><h2>${esc(encrypted?tr('encryptedWorkspace'):tr('unencryptedFiles'))}</h2>${encrypted?`<p>${esc(tr('encryptedDataHelp'))}</p><p class="muted">${esc(tr('visiblePathsHelp'))}</p><form id="storage-access-form">${field(esc(tr('usernameOptional')),`<input name="username" maxlength="80" autocomplete="username" value="${esc(state.access?.username??'')}">`)}${state.access.version!==3&&state.access.passwordAvailable?field(esc(tr('currentPassword')),'<input name="currentPassword" type="password" required autocomplete="current-password">'):''}${field(esc(tr('workspacePassword')),`<input name="password" type="password" ${state.access.version===3&&state.access.deviceAvailable?'':'required'} minlength="12" maxlength="1024" autocomplete="new-password">`)}${field(esc(t('access','confirmPassword')),'<input name="confirmPassword" type="password" maxlength="1024" autocomplete="new-password">')}<p class="muted">${esc(tr('passwordChanges'))}${state.access.version===3&&state.access.deviceAvailable?' '+esc(tr('deviceBlank')):''}</p><div class="inline-actions"><button class="button primary" type="submit">${esc(tr('saveAccess'))}</button><button class="button" type="button" data-action="storage-lock">${esc(tr('lockWorkspace'))}</button></div></form>${state.access.version!==3?'<button class="button" data-action="storage-encrypt-dialog">'+esc(tr('encryptedCopySharing'))+'</button>':''}`:`<p>${esc(state.access?.protected?tr('legacyPassword'):tr('readableFolder'))}</p><p>${esc(tr('encryptedCopyHelp'))}</p><button class="button primary" data-action="storage-encrypt-dialog">${esc(tr('encryptedCopy'))}</button>`}</section>${state.access?.version===3?security.panel():''}${state.access?.deviceAvailable?collaboration.panel():''}${preferencesPanel(s)}<section class="panel">${deletion.button()}</section></div>`;}
  async function ready(){if(isUploading()){notify(tr('waitUpload'),true);return false;}if(state.publishing?.dirty){notify(tr('savePublishing'),true);return false;}await save();return !state.dirty;}
  async function action(button){const name=button.dataset.action;
    if(name==='storage-rename-resume'){try{state.storage=await api('/api/storage/rename/resume',{id:state.storage.rename.id});await switched();}catch(error){await refreshRename();throw error;}return true;}
    if(name==='storage-writer-recovery'){await writerRecovery.check({force:true});return true;}
    if(await deletion.action(button))return true;
    if(name==='storage-portable-dialog'){if(await ready())portability.open();return true;}
    if(await collaboration.action(button))return true;
    if(await security.action(button))return true;
    if(name==='storage-reset-dialog'){
      const prefs=await api('/api/preferences');
      resetDialog(prefs);return true;
    }
    if(await workspaces.action(button))return true;
    if(name==='storage-open-recent'){if(await ready())chooseDialog('open',button.dataset.path);return true;}
    if(name==='storage-new'){if(!await ready())return true;document.querySelector('#dialog').close();state.newWorkspace=true;render();window.scrollTo(0,0);return true;}
    if(name==='storage-cancel-new'){state.newWorkspace=false;render();return true;}

    if(name==='storage'){
      const originPage=state.page,originRoute=location.hash;
      const observation=await activity?.refresh();
      if(state.page!==originPage||location.hash!==originRoute)return true;
      if(observation?.busy&&(!observation.readable||observation.operations.some(entry=>entry.kind.startsWith('/api/storage/')&&['running','queued'].includes(entry.state)))){state.storageBusy=true;state.page='storage';render();return true;}
      state.storageBusy=false;
      const [storage,access]=await Promise.all([api('/api/storage'),api('/api/access/status')]);
      const mediaPolicy=storage.rename?state.mediaPolicy:await api('/api/media-policy');
      // A completed request must not take the user back from a newer route.
      if(state.page!==originPage||location.hash!==originRoute)return true;
      Object.assign(state,{storage,access,mediaPolicy,page:'storage'});render();return true;
    }
    if(name==='activity-show'){activity.open();return true;}
    if(name==='storage-encrypt-dialog'){if(!await ready())return true;state.encryptionPlan=null;showDialog(`<form id="storage-encrypt-form"><h2 id="dialog-title">${esc(state.access.encrypted?tr('privateSuccessor'):tr('encryptedCopy'))}</h2>${locationFields('','encrypted-destination')}${field(esc(tr('workspacePassword')),`<input name="password" type="password" ${state.access.deviceAvailable?'':'required'} minlength="12" maxlength="1024" autocomplete="new-password">`)}${field(esc(t('access','confirmPassword')),'<input name="confirmPassword" type="password" maxlength="1024" autocomplete="new-password">')}<p>${esc(tr('encryptHelp'))}</p><p class="muted">${esc(tr('encryptPasswordHelp'))}</p><div data-encryption-review></div><div class="dialog-actions"><button class="button" type="button" data-action="close-dialog">${esc(t('access','cancel'))}</button><button class="button primary" type="submit">${esc(tr('reviewEncrypted'))}</button></div></form>`);return true;}
    if(name==='storage-copy-path'){await navigator.clipboard.writeText(state.storage.root);notify(tr('pathCopied'));return true;}
    if(name==='storage-retry'){await reload();return true;}
    if(name==='storage-lock'){if(!await ready())return true;await api('/api/access/lock',{});state.access.locked=true;render();return true;}
    if(name==='storage-open-dialog'){if(await ready())chooseDialog('open');return true;}
    if(name==='storage-copy-dialog'||name==='storage-move-dialog'){if(await ready())transfers.open(name==='storage-move-dialog'?'move':'copy');return true;}
    if(name==='storage-move-finish-dialog'){if(await ready())transfers.openFinish();return true;}
    if(await folders.action(button))return true;
    if(name==='storage-check'){
      const field=document.getElementById(button.dataset.target),form=field.closest('form'),creating=field.name==='storageParent';
      const result=await api('/api/storage/check',creating?{storageParent:field.value,name:form.elements.title.value}:{path:field.value,...(['storage-copy-form','storage-move-form'].includes(form.id)?{purpose:form.id==='storage-move-form'?'move':'copy'}:{})});
      if(!creating)field.value=result.root;
      field.closest('form').querySelector('.storage-check-result').textContent=result.resume?t('access',result.kind==='move'?'moveResumeReady':'copyResumeReady'):t('access','checkReady')+' '+t('access',result.kind==='workspace'?'checkWorkspace':result.kind==='occupied'?'checkOccupied':'checkEmpty');return true;
    }
    return false;
  }
  async function submit(form,data){
    if(await collaboration.submit(form,data))return true;
    if(await security.submit(form,data))return true;
    if(!form.id.startsWith('storage-'))return false;
    if(await folders.submit(form,data))return true;
    if(form.id==='storage-unlock-form'){await api('/api/access/unlock',{username:data.get('username')??'',password:data.get('password')??'',recovery:data.get('recovery')??''});state.access=await api('/api/access/status');if(state.book&&state.dirty)render();else await reload();notify(t('access','unlocked'));return true;}
    if(await deletion.submit(form,data))return true;
    if(!await ready())return true;
    if(await portability.submit(form,data))return true;
    if(await transfers.submit(form,data))return true;
    if(form.id==='storage-reset-form'){
      const result=await api('/api/preferences/reset',{confirmed:true,etag:form.dataset.etag});
      state.storage=result.storage;state.access=null;state.storageUnavailable=false;
      await resetInterface();await switched();notify(tr('preferencesReset'));return true;
    }
    if(form.id==='storage-encrypt-form'){
      if(data.get('password')!==data.get('confirmPassword')){notify(tr('passwordMismatch'),true);return true;}
      if(!state.encryptionPlan||state.encryptionPlan.destination!==data.get('storagePath')){
        const plan=await api('/api/storage/copy/preview',{path:data.get('storagePath')});state.encryptionPlan=plan;form.elements.storagePath.value=plan.destination;
        form.querySelector('[data-encryption-review]').innerHTML=`<p role="status">${esc(tr('encryptReady',{count:plan.files,megabytes:(plan.bytes/1024/1024).toFixed(2)}))}</p>`;
        form.querySelector('[type="submit"]').textContent=tr('encryptUse');return true;
      }
      state.storage=await transferWorkspace({api,state,destination:state.encryptionPlan.destination,route:'/api/storage/encrypt',data:{id:state.encryptionPlan.id,password:data.get('password'),reviewed:true}});state.encryptionPlan=null;await switched();notify(tr('encryptedOpened'));return true;
    }
    if(form.id==='storage-access-form'){
      if(data.get('password')!==data.get('confirmPassword')){notify(tr('passwordMismatch'),true);return true;}
      state.access=await api('/api/access/change',{username:data.get('username'),password:data.get('password'),currentPassword:data.get('currentPassword')??''});render();notify(tr('accessSaved'));return true;
    }
    if(form.id==='storage-open-form'){
      state.storage=await api('/api/storage/open',{path:data.get('storagePath'),username:data.get('username'),password:data.get('password')??'',recovery:data.get('recovery')??''});await switched();return true;
    }
    return false;
  }
  async function switched(){state.newWorkspace=false;state.book=null;state.etag=null;state.dirty=false;state.preview=null;state.laboratory=null;state.labTab='samples';state.labSearch='';state.publishing=null;state.publishOutcome=null;state.designSource='auto';state.designPage=null;state.designResult=null;state.selected=null;state.project=null;state.notebook='all';state.search='';state.filter='all';state.recordBrowse=null;state.page='workspace';history.replaceState(null,'','#/workspace');await reload();document.querySelector('#dialog').close();}
  async function refreshRename(){try{state.storage=await api('/api/storage');if(state.storage.rename){state.dirty=false;render();}}catch{ /* Retain the operation's original error when recovery metadata is unavailable. */ }}
  async function rename(name){if(!await ready())return false;try{state.storage=await accessOwners(()=>api('/api/storage/rename',{name,etag:state.etag}));await switched();state.page='preferences';history.replaceState(null,'','#/preferences');render();return true;}catch(error){await refreshRename();throw error;}}
  return {rename,recoveryPanel:()=>workspaceRenamePanel(state.storage,esc),workspaces,locationFields,view,lockView,unavailable,action,submit,input:el=>{if(el.closest('#security-grant-form')){security.input(el).catch(e=>notify(e.message,true));return true;}return folders.input(el);}};
}
