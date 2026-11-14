import {t} from './i18n/index.js';

// Preferences → Integrations: the workspace's server logins. Each web server is
// set up once and any website may publish to it with its own folder. An FTP
// password is entered here, kept on this computer and never shown again.
const blank={ssh:{protocol:'ssh',name:'',host:'',port:22,user:'',identityFile:''},sftp:{protocol:'sftp',name:'',host:'',port:22,user:'',identityFile:''},ftp:{protocol:'ftp',name:'',host:'',port:21,user:'',security:'explicit'}};
export function serverLoginsUI({api,esc,field,option,notify}){
 let listing=null,editing=null,checked=null,loading=null;
 const text=key=>esc(t('websiteAuthoring',key));
 function mount(){const panel=document.getElementById('server-logins');if(panel)panel.outerHTML=view();}
 async function refresh(){loading??=api('/api/server-logins/list',{},{adopt:false}).then(value=>{listing=value;}).finally(()=>{loading=null;});await loading;mount();}
 function form(){
  const v=editing,input=(key,label,type='text')=>field(text(label),`<input data-server-login="${key}" type="${type}" value="${esc(v[key]??'')}" ${type==='number'?'min="1" max="65535"':'maxlength="1000"'}>`);
  return `<form id="server-login-form" class="server-login-form">${field(text('loginProtocol'),`<select data-server-login="protocol" ${v.id?'disabled':''}>${option('ssh',t('websiteAuthoring','loginSsh'),v.protocol)}${option('sftp',t('websiteAuthoring','loginSftp'),v.protocol)}${option('ftp',t('websiteAuthoring','loginFtp'),v.protocol)}</select>`)}<div class="form-grid">${input('name','loginName')}${input('host','loginHost')}${input('port','loginPort','number')}${input('user','loginUser')}${v.protocol==='ftp'?'':input('identityFile','loginKey')}</div>${v.protocol==='ftp'?field(text('loginSecurity'),`<select data-server-login="security">${option('explicit',t('websiteAuthoring','loginFtpExplicit'),v.security)}${option('implicit',t('websiteAuthoring','loginFtpImplicit'),v.security)}${option('none',t('websiteAuthoring','loginFtpPlain'),v.security)}</select>`)+(v.security==='none'?`<p class="guard-error" role="note">${text('loginFtpPlainWarning')}</p>`:''):`<p class="muted">${text('loginKeyHelp')}</p>`}<div class="inline-actions"><button class="button primary" type="submit">${text('loginSave')}</button><button class="button" type="button" data-action="server-login-cancel">${text('loginCancel')}</button></div></form>`;
 }
 function row(login){
  const password=login.password,status=password?(password.saved?text(password.persistent?'loginPasswordSaved':'loginPasswordSession'):text('loginPasswordMissing')):'';
  return `<li class="server-login" data-server-login-id="${esc(login.id)}"><strong>${esc(login.name)}</strong> <span class="muted">${esc(login.protocol.toUpperCase()+' · '+login.user+'@'+login.host+(login.port!==(login.protocol==='ftp'?21:22)?':'+login.port:''))}</span>${checked===login.id?`<p role="status">${text('loginChecked')}</p>`:''}${login.protocol==='ftp'?`<p class="muted">${status}</p>${field(text('loginPassword'),`<input type="password" autocomplete="off" maxlength="1024" data-server-login-password="${esc(login.id)}">`)}${password?.persistent?`<label class="checkbox"><input type="checkbox" data-server-login-remember="${esc(login.id)}" checked> ${text('loginPasswordRemember')}</label>`:''}`:''}<div class="inline-actions">${login.protocol==='ftp'?`<button class="button" data-action="server-login-password" data-id="${esc(login.id)}">${text('loginPasswordSave')}</button>${password?.saved?`<button class="button" data-action="server-login-password-forget" data-id="${esc(login.id)}">${text('loginPasswordForget')}</button>`:''}`:''}<button class="button" data-action="server-login-check" data-id="${esc(login.id)}">${text('loginCheck')}</button><button class="button" data-action="server-login-edit" data-id="${esc(login.id)}">${text('loginEdit')}</button><details><summary>${text('loginRemove')}</summary><p>${text('loginRemoveHelp')}</p><button class="button" data-action="server-login-remove" data-id="${esc(login.id)}">${text('loginRemove')}</button></details></div></li>`;
 }
 function view(){
  if(!listing&&!loading)refresh().catch(error=>notify(error.message,true));
  return `<section id="server-logins" class="panel"><h2>${text('loginsTitle')}</h2><p class="muted">${text('loginsHelp')}</p>${!listing?'':listing.logins.length?`<ul class="server-login-list">${listing.logins.map(row).join('')}</ul>`:`<p>${text('loginsEmpty')}</p>`}${editing?form():`<button class="button" data-action="server-login-add">${text('loginAdd')}</button>`}</section>`;
 }
 function input(el){
  const key=el.dataset.serverLogin;if(!key||!editing)return false;
  if(key==='protocol'){editing={...blank[el.value],name:editing.name};mount();return true;}
  editing[key]=el.type==='number'?Number(el.value):el.value;if(key==='security')mount();return true;
 }
 async function submit(form){
  if(form?.id!=='server-login-form')return false;
  listing=await api('/api/server-logins/save',{login:editing,etag:listing.etag},{adopt:false});editing=null;checked=null;mount();return true;
 }
 async function action(button){
  const name=button.dataset.action;if(!name?.startsWith('server-login-'))return false;
  const id=button.dataset.id,login=listing?.logins.find(item=>item.id===id);
  if(name==='server-login-add'){editing=structuredClone(blank.ftp);mount();return true;}
  if(name==='server-login-cancel'){editing=null;mount();return true;}
  if(name==='server-login-edit'){const {password,...value}=login;void password;editing=structuredClone(value);mount();return true;}
  button.disabled=true;
  try{
   if(name==='server-login-remove')listing=await api('/api/server-logins/remove',{id,etag:listing.etag},{adopt:false});
   else if(name==='server-login-check'){checked=null;listing=await api('/api/server-logins/check',{id},{adopt:false});checked=listing.checked;}
   else if(name==='server-login-password'){
    const entry=document.querySelector(`[data-server-login-password="${CSS.escape(id)}"]`);
    try{if(!entry?.value){notify(t('websiteAuthoring','loginPasswordMissing'),true);return true;}listing=await api('/api/server-logins/password',{id,password:entry.value,remember:document.querySelector(`[data-server-login-remember="${CSS.escape(id)}"]`)?.checked!==false},{adopt:false});}
    finally{if(entry)entry.value='';}
   }else if(name==='server-login-password-forget')listing=await api('/api/server-logins/password-forget',{id},{adopt:false});
   else return false;
   mount();return true;
  }finally{button.disabled=false;}
 }
 return {view,refresh,input,submit,action,logins:()=>listing?.logins??null};
}
