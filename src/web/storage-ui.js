import {workspaceRenamePanel} from './workspace-rename-ui.js';
import {workspaceManagementUI} from './workspace-management-ui.js';
import {workspaceDeletionUI} from './workspace-deletion-ui.js';
import {securityUI} from './security-ui.js';
import {collaborationIdentityUI} from './collaboration-identity-ui.js';
import {workspaceAccessViews} from './workspace-access-views.js';
import {t} from './i18n/index.js';
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
  const hint=()=>'<p class="muted">Use an empty folder on this computer, an external drive, or a connected network/NAS share.</p>'+portability.controls()+'<button class="button" data-action="storage-writer-recovery">'+esc(t('writerRecovery','title'))+'</button>';
  function view(){if(state.storage?.rename)return `<h1>Storage &amp; access</h1>${workspaceRenamePanel(state.storage,esc)}`;state.storageBusy=activity.storageBusy();if(state.storageBusy)return `<h1>Storage &amp; access</h1><div data-owned-activity></div>`;const s=state.storage,encrypted=state.access?.encrypted;return `<div class="page-heading"><div><h1>Storage &amp; access</h1><p class="subtitle">Workspace files, encryption and access settings.</p></div></div><div class="storage-grid"><section class="panel"><h2>Workspace storage</h2><p>${esc(s.database?.message??'')}</p><p>Records, module data, drafts, settings and evidence manifests are encrypted in PostgreSQL. Original evidence files, prepared media and access keys remain in the workspace folder. Use Copy workspace to include both in a verified backup.</p><p class="storage-path">${esc(s.root)}</p><div class="inline-actions"><button class="button" data-action="storage-copy-path">Copy path</button><button class="button" data-action="storage-open-dialog">Open another workspace</button><button class="button" data-action="storage-copy-dialog">Copy workspace to another folder</button><button class="button" data-action="storage-move-dialog">${esc(t('access','moveTitle'))}</button></div>${database.panel()}${hint()}${transfers.pending()}<details><summary>Files and locations</summary><dl class="storage-map">${s.locations.map(item=>`<dt>${esc(item.label)}</dt><dd>${esc(item.path)}</dd>`).join('')}</dl><p class="muted">Application: <span class="storage-path">${esc(s.applicationRoot)}</span></p></details><p class="muted">Website previews stay in memory. Downloaded websites and result sheets are readable exports.</p></section><section class="panel"><h2>${encrypted?'Encrypted workspace':'Files are not encrypted'}</h2>${encrypted?`<p>Records, history, laboratory data and private settings are encrypted in PostgreSQL; original attachments and prepared media are encrypted in the workspace folder.</p><p class="muted">Storage paths and file sizes remain visible. Configure a separate recovery key before relying on one device.</p><form id="storage-access-form">${field('Username (optional)',`<input name="username" maxlength="80" autocomplete="username" value="${esc(state.access?.username??'')}">`)}${state.access.version!==3&&state.access.passwordAvailable?field('Current password','<input name="currentPassword" type="password" required autocomplete="current-password">'):''}${field('Workspace password',`<input name="password" type="password" ${state.access.version===3&&state.access.deviceAvailable?'':'required'} minlength="12" maxlength="1024" autocomplete="new-password">`)}${field('Confirm password','<input name="confirmPassword" type="password" maxlength="1024" autocomplete="new-password">')}<p class="muted">Password changes keep data encrypted and sign out other sessions. Other authorized devices retain access. Setting a password removes passwordless access for this device.${state.access.version===3&&state.access.deviceAvailable?' Leave both new password fields blank to use this device instead.':''}</p><div class="inline-actions"><button class="button primary" type="submit">Save access settings</button><button class="button" type="button" data-action="storage-lock">Lock workspace</button></div></form>${state.access.version!==3?'<button class="button" data-action="storage-encrypt-dialog">Create encrypted copy with sharing &amp; recovery</button>':''}`:`<p>${state.access?.protected?'This workspace has an earlier app sign-in password. Its files are still readable outside Observanda.':'Anyone with access to this folder can read its contents.'}</p><p>Create an encrypted copy to protect all records, revisions and attachments. The original remains in place for you to manage after verification.</p><button class="button primary" data-action="storage-encrypt-dialog">Create encrypted copy</button>`}</section>${state.access?.version===3?security.panel():''}${state.access?.deviceAvailable?collaboration.panel():''}${preferencesPanel(s)}<section class="panel">${deletion.button()}</section></div>`;}
  async function ready(){if(isUploading()){notify('Wait for the media upload to finish.',true);return false;}if(state.publishing?.dirty){notify('Save or discard the publishing destination edits first.',true);return false;}await save();return !state.dirty;}
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
    if(name==='storage-encrypt-dialog'){if(!await ready())return true;state.encryptionPlan=null;showDialog(`<form id="storage-encrypt-form"><h2 id="dialog-title">${state.access.encrypted?'Create private successor':'Create encrypted copy'}</h2>${locationFields('','encrypted-destination')}${field('Workspace password',`<input name="password" type="password" ${state.access.deviceAvailable?'':'required'} minlength="12" maxlength="1024" autocomplete="new-password">`)}${field('Confirm password','<input name="confirmPassword" type="password" maxlength="1024" autocomplete="new-password">')}<p>All research files and history will be encrypted with a new key in the new folder. Existing device grants and recovery keys will not carry over. The original stays unchanged and accessible to its existing members.</p><p class="muted">Use at least 12 characters for a password. Where device protection is available, leave it blank to authorize this device. Configure recovery in the new workspace.</p><div data-encryption-review></div><div class="dialog-actions"><button class="button" type="button" data-action="close-dialog">Cancel</button><button class="button primary" type="submit">Review encrypted copy</button></div></form>`);return true;}
    if(name==='storage-copy-path'){await navigator.clipboard.writeText(state.storage.root);notify('Workspace path copied.');return true;}
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
      await resetInterface();await switched();notify('App preferences reset.');return true;
    }
    if(form.id==='storage-encrypt-form'){
      if(data.get('password')!==data.get('confirmPassword')){notify('The passwords do not match.',true);return true;}
      if(!state.encryptionPlan||state.encryptionPlan.destination!==data.get('storagePath')){
        const plan=await api('/api/storage/copy/preview',{path:data.get('storagePath')});state.encryptionPlan=plan;form.elements.storagePath.value=plan.destination;
        form.querySelector('[data-encryption-review]').innerHTML=`<p role="status">Ready to encrypt ${plan.files} files (${(plan.bytes/1024/1024).toFixed(2)} MB). The original stays in place.</p>`;
        form.querySelector('[type="submit"]').textContent='Encrypt and use this copy';return true;
      }
      state.storage=await transferWorkspace({api,state,destination:state.encryptionPlan.destination,route:'/api/storage/encrypt',data:{id:state.encryptionPlan.id,password:data.get('password'),reviewed:true}});state.encryptionPlan=null;await switched();notify('Encrypted copy verified and opened. The original remains in its previous folder.');return true;
    }
    if(form.id==='storage-access-form'){
      if(data.get('password')!==data.get('confirmPassword')){notify('The passwords do not match.',true);return true;}
      state.access=await api('/api/access/change',{username:data.get('username'),password:data.get('password'),currentPassword:data.get('currentPassword')??''});render();notify('Access settings saved.');return true;
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
