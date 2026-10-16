import {t} from './i18n/index.js';
export function securityUI({state,api,esc,field,showDialog,notify}){
 let access=null,identity=null,recovery=null;
 document.querySelector('#dialog')?.addEventListener('close',()=>{recovery=null;const secret=document.querySelector('[data-recovery-secret]');if(secret){secret.value='';secret.textContent='';}});
 const fingerprint=id=>id.match(/.{1,8}/g).join(' ');
 function download(name,text){const url=URL.createObjectURL(new Blob([text],{type:'application/octet-stream'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 function panel(){return '<section class="panel"><h2>Sharing & recovery</h2><p>Grant another device access when someone joins your work. Copying files to a host does not grant it access.</p><div class="inline-actions"><button class="button primary" data-action="security-manage">Manage workspace access</button>'+(state.access.deviceAvailable?'<button class="button" data-action="security-identity">'+esc(t('access','deviceRequest'))+'</button>':'')+'</div></section>';}
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
  present('Workspace access','<p class="security-summary"><strong>'+esc(state.book?.title??'This workspace')+'</strong><span>'+count+' authorized '+(count===1?'device':'devices')+'</span></p><p>Members can read and edit every lab book, record, attachment and saved version in this workspace, and authorize others.</p><div class="security-devices">'+access.devices.map((device,i)=>'<details><summary>'+esc(device.id===identity?.id?'This device':'Authorized device '+(i+1))+'</summary><p class="security-fingerprint">'+esc(fingerprint(device.id))+'</p></details>').join('')+'</div>'+(identity&&!access.devices.some(d=>d.id===identity.id)?'<button class="button" data-action="security-authorize-self">Authorize this device for passwordless access</button>':'')+
   '<details class="security-section"><summary>Add a device</summary><form id="security-grant-form">'+field('Recipient’s public access request','<textarea name="request" required rows="3" spellcheck="false" placeholder="Paste their public request"></textarea>')+field('Or open an access request','<input type="file" accept=".observanda-device,application/json" data-security-request>')+'<p class="security-fingerprint" data-recipient-fingerprint aria-live="polite"></p><label class="security-confirm"><input type="checkbox" name="verified" required> I verified the recipient’s fingerprint and grant full access to this workspace.</label><button class="button primary" type="submit">Grant workspace access</button></form></details>'+
   '<section class="security-section"><h3>Recovery</h3><p>'+(access.recoveryAvailable?'A recovery key is configured. Keep it separately from this workspace.':'Create a recovery key so you can regain access if you lose your device or password.')+'</p><button class="button" data-action="security-recovery-review">'+(access.recoveryAvailable?'Replace recovery key':'Create recovery key')+'</button></section>'+
   '<details class="security-section"><summary>Continue with a different group</summary><p>Create a private successor with a new encryption key, then authorize its members. Previous members retain access to earlier copies; they cannot open the new workspace unless invited.</p><button class="button" data-action="storage-encrypt-dialog">Create private successor</button></details>');
 }
 function parseRequest(form){try{const value=JSON.parse(form.elements.request.value);if(value.format!=='observanda-device-v1'||!/^[a-f0-9]{64}$/.test(value.id)||typeof value.publicKey!=='string')return null;return value;}catch{return null;}}
 async function input(el){
  const form=el.closest('#security-grant-form');if(!form)return false;
  if(el.matches('[data-security-request]')){const file=el.files[0];if(file){if(file.size>4096){notify('The access request is too large.',true);return true;}form.elements.request.value=await file.text();}}
  if(el.name==='request'||el.matches('[data-security-request]')){const recipient=parseRequest(form);form.elements.verified.checked=false;form.querySelector('[data-recipient-fingerprint]').textContent=recipient?'Recipient fingerprint: '+fingerprint(recipient.id):'Enter a valid Observanda device request.';}
  return true;
 }
 async function action(button){
  const name=button.dataset.action;
  if(name==='security-identity'){identity=await api('/api/security/device',{});requestView();return true;}
  if(name==='security-download-request'){download('device.observanda-device',JSON.stringify(identity,null,2));return true;}
  if(name==='security-manage'){access=await api('/api/security/workspace');identity=null;if(state.access.deviceAvailable)try{identity=await api('/api/security/device',{});}catch(error){notify(error.message,true);}manageView();return true;}
  if(name==='security-authorize-self'){
   access=await api('/api/security/workspace',{action:'grant',etag:access.etag,identity,verifiedFingerprint:identity.id,confirmed:true});state.access=await api('/api/access/status');manageView();notify('This device can now reopen the workspace.');return true;
  }
  if(name==='security-recovery-review'){present((access.recoveryAvailable?'Replace':'Create')+' recovery key','<p>The recovery key grants full access without a device or password. Save it in a separate secure place.</p>'+(access.recoveryAvailable?'<p>The old key will stop opening the current access file. Earlier backups can still be opened with their earlier recovery keys.</p>':''),'<button class="button" data-action="security-manage" type="button">Cancel</button><button class="button primary" type="submit">Generate recovery key</button>','security-recovery-form');return true;}
  if(name==='security-download-recovery'){if(recovery)download('workspace-recovery.txt','Observanda recovery key\n\nWorkspace identifier: '+access.vaultId+'\n\n'+recovery+'\n\nKeep this key separate from the workspace. Anyone with this key and the workspace files can open the work.\n');return true;}
  if(name==='security-recovery-done'){recovery=null;document.querySelector('#dialog').close();return true;}
  return false;
 }
 async function submit(form,data){
  if(form.id==='security-grant-form'){
   const recipient=parseRequest(form);if(!recipient||data.get('verified')!=='on'){notify('Check the recipient request and verify its fingerprint.',true);return true;}
   access=await api('/api/security/workspace',{action:'grant',etag:access.etag,identity:recipient,verifiedFingerprint:recipient.id,confirmed:true});state.access=await api('/api/access/status');manageView();notify('Device authorized. Share the complete encrypted workspace folder with the recipient.');return true;
  }
  if(form.id==='security-recovery-form'){
   const result=await api('/api/security/workspace',{action:'recovery',etag:access.etag,confirmed:true});recovery=result.recovery;delete result.recovery;access=result;state.access=await api('/api/access/status');
   present('Save your recovery key','<p>This key is shown once. Save it outside the workspace, such as in a password manager or a secure offline location.</p>'+field('Recovery key','<textarea data-recovery-secret readonly rows="3" spellcheck="false" class="security-fingerprint">'+esc(recovery)+'</textarea>'),'<button class="button" data-action="security-recovery-done">Done</button><button class="button primary" data-action="security-download-recovery">Download recovery key</button>');return true;
  }
  return false;
 }
 return {panel,action,submit,input};
}
