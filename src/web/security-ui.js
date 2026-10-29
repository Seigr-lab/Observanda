import './i18n/catalogues/workspaceSecurity.js';
import {t} from './i18n/index.js';
export function securityUI({state,api,esc,field,showDialog,notify}){
 const text=(key,args)=>esc(t('workspaceSecurity',key,args));
 let access=null,identity=null,recovery=null;
 document.querySelector('#dialog')?.addEventListener('close',()=>{recovery=null;const secret=document.querySelector('[data-recovery-secret]');if(secret){secret.value='';secret.textContent='';}});
 const fingerprint=id=>id.match(/.{1,8}/g).join(' ');
 function download(name,text){const url=URL.createObjectURL(new Blob([text],{type:'application/octet-stream'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 function panel(){return `<section class="panel"><h2>${text('sharingRecovery')}</h2><p>${text('sharingHelp')}</p><div class="inline-actions"><button class="button primary" data-action="security-manage">${text('manageAccess')}</button>`+(state.access.deviceAvailable?'<button class="button" data-action="security-identity">'+esc(t('access','deviceRequest'))+'</button>':'')+'</div></section>';}
 function present(title,body,actions='',formId=''){
  const tag=formId?'form':'section';
  showDialog('<'+tag+(formId?' id="'+formId+'"':'')+' class="security-dialog"><header class="security-heading"><h2 id="dialog-title" tabindex="-1" autofocus>'+esc(title)+'</h2><button type="button" class="button" data-action="close-dialog">'+esc(t('access','close'))+'</button></header><div class="security-body">'+body+'</div>'+(actions?'<footer class="security-actions">'+actions+'</footer>':'')+'</'+tag+'>');
  const dialog=document.querySelector('#dialog');dialog.scrollTop=0;
  dialog.querySelector('#dialog-title').focus({preventScroll:true});
 }
 function requestView(){
  present(t('access','requestTitle'),'<p>'+esc(t('access','requestHint'))+'</p><p class="security-fingerprint">'+esc(fingerprint(identity.id))+'</p>'+field(t('access','publicRequest'),'<textarea rows="4" readonly spellcheck="false">'+esc(JSON.stringify(identity))+'</textarea>')+'<p class="muted">'+esc(t('access','requestPrivate'))+'</p>','<button type="button" class="button primary" data-action="security-download-request">'+esc(t('access','downloadRequest'))+'</button>');
 }
 function manageView(){
  const count=access.devices.length;
  present(t('workspaceSecurity','workspaceAccess'),'<p class="security-summary"><strong>'+esc(state.book?.title??t('workspaceSecurity','thisWorkspace'))+'</strong><span>'+text('deviceCount',{count})+`</span></p><p>${text('memberAccess')}</p><div class="security-devices">`+access.devices.map((device,i)=>'<details><summary>'+esc(device.id===identity?.id?t('workspaceSecurity','thisDevice'):t('workspaceSecurity','authorizedDevice',{number:i+1}))+'</summary><p class="security-fingerprint">'+esc(fingerprint(device.id))+'</p></details>').join('')+'</div>'+(identity&&!access.devices.some(d=>d.id===identity.id)?`<button class="button" data-action="security-authorize-self">${text('authorizeSelf')}</button>`:'')+
   `<details class="security-section"><summary>${text('addDevice')}</summary><form id="security-grant-form">`+field(t('workspaceSecurity','recipientRequest'),`<textarea name="request" required rows="3" spellcheck="false" placeholder="${text('pasteRequest')}"></textarea>`)+field(t('workspaceSecurity','openRequest'),'<input type="file" accept=".observanda-device,application/json" data-security-request>')+`<p class="security-fingerprint" data-recipient-fingerprint aria-live="polite"></p><label class="security-confirm"><input type="checkbox" name="verified" required> ${text('verifiedGrant')}</label><button class="button primary" type="submit">${text('grantAccess')}</button></form></details>`+
   `<section class="security-section"><h3>${text('recovery')}</h3><p>`+(access.recoveryAvailable?t('workspaceSecurity','recoveryConfigured'):t('workspaceSecurity','recoveryCreateHelp'))+'</p><button class="button" data-action="security-recovery-review">'+(access.recoveryAvailable?t('workspaceSecurity','replaceRecovery'):t('workspaceSecurity','createRecovery'))+'</button></section>'+
   `<details class="security-section"><summary>${text('differentGroup')}</summary><p>${text('successorHelp')}</p><button class="button" data-action="storage-encrypt-dialog">${text('privateSuccessor')}</button></details>`);
 }
 function parseRequest(form){try{const value=JSON.parse(form.elements.request.value);if(value.format!=='observanda-device-v1'||!/^[a-f0-9]{64}$/.test(value.id)||typeof value.publicKey!=='string')return null;return value;}catch{return null;}}
 async function input(el){
  const form=el.closest('#security-grant-form');if(!form)return false;
  if(el.matches('[data-security-request]')){const file=el.files[0];if(file){if(file.size>4096){notify(t('workspaceSecurity','requestTooLarge'),true);return true;}form.elements.request.value=await file.text();}}
  if(el.name==='request'||el.matches('[data-security-request]')){const recipient=parseRequest(form);form.elements.verified.checked=false;form.querySelector('[data-recipient-fingerprint]').textContent=recipient?t('workspaceSecurity','recipientFingerprint',{fingerprint:fingerprint(recipient.id)}):t('workspaceSecurity','validRequest');}
  return true;
 }
 async function action(button){
  const name=button.dataset.action;
  if(name==='security-identity'){identity=await api('/api/security/device',{});requestView();return true;}
  if(name==='security-download-request'){download('device.observanda-device',JSON.stringify(identity,null,2));return true;}
  if(name==='security-manage'){access=await api('/api/security/workspace');identity=null;if(state.access.deviceAvailable)try{identity=await api('/api/security/device',{});}catch(error){notify(error.message,true);}manageView();return true;}
  if(name==='security-authorize-self'){
   access=await api('/api/security/workspace',{action:'grant',etag:access.etag,identity,verifiedFingerprint:identity.id,confirmed:true});state.access=await api('/api/access/status');manageView();notify(t('workspaceSecurity','selfAuthorized'));return true;
  }
  if(name==='security-recovery-review'){present(t('workspaceSecurity',access.recoveryAvailable?'replaceRecovery':'createRecovery'),`<p>${text('recoveryPower')}</p>`+(access.recoveryAvailable?`<p>${text('oldRecovery')}</p>`:''),`<button class="button" data-action="security-manage" type="button">${text('cancel')}</button><button class="button primary" type="submit">${text('generateRecovery')}</button>`,'security-recovery-form');return true;}
  if(name==='security-download-recovery'){if(recovery)download('workspace-recovery.txt',t('workspaceSecurity','recoveryDocument',{workspace:access.vaultId,key:recovery}));return true;}
  if(name==='security-recovery-done'){recovery=null;document.querySelector('#dialog').close();return true;}
  return false;
 }
 async function submit(form,data){
  if(form.id==='security-grant-form'){
   const recipient=parseRequest(form);if(!recipient||data.get('verified')!=='on'){notify(t('workspaceSecurity','verifyRecipient'),true);return true;}
   access=await api('/api/security/workspace',{action:'grant',etag:access.etag,identity:recipient,verifiedFingerprint:recipient.id,confirmed:true});state.access=await api('/api/access/status');manageView();notify(t('workspaceSecurity','deviceAuthorized'));return true;
  }
  if(form.id==='security-recovery-form'){
   const result=await api('/api/security/workspace',{action:'recovery',etag:access.etag,confirmed:true});recovery=result.recovery;delete result.recovery;access=result;state.access=await api('/api/access/status');
   present(t('workspaceSecurity','saveRecovery'),`<p>${text('recoveryShownOnce')}</p>`+field(t('workspaceSecurity','recoveryKey'),'<textarea data-recovery-secret readonly rows="3" spellcheck="false" class="security-fingerprint">'+esc(recovery)+'</textarea>'),`<button class="button" data-action="security-recovery-done">${text('done')}</button><button class="button primary" data-action="security-download-recovery">${text('downloadRecovery')}</button>`);return true;
  }
  return false;
 }
 return {panel,action,submit,input};
}
