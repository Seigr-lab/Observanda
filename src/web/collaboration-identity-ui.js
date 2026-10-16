import {t} from './i18n/index.js';
const tr=(key,values)=>t('collaborationIdentity',key,values);
const actionButton=(esc,key,action)=>'<button type="button" class="button" data-action="security-collaboration-'+action+'">'+esc(tr(key))+'</button>';
export const collaborationIdentityActions=esc=>'<div class="module-actions">'+actionButton(esc,'backup','backup')+actionButton(esc,'recover','recover')+'</div>';
export const collaborationIdentityRecoveryButton=esc=>actionButton(esc,'recover','recover');

export function collaborationIdentityUI({state,api,esc,field,showDialog,notify,lock}){
 let busy=false,inspection=null,backup=null,password='',snapshot=null,context=null,serial=0;
 const dialog=()=>document.querySelector('#dialog');
 const clear=()=>{inspection=null;backup=null;password='';snapshot=null;serial++;const f=dialog()?.querySelector('[data-collaboration-identity-form]');if(f)for(const input of f.querySelectorAll('input[type="password"]'))input.value='';};
 dialog()?.addEventListener('close',clear);
 async function call(operation,data={}){
  if(context!==state.storage?.contextId)throw Error(tr('changed'));
  const result=await api('/api/security/collaboration-identity/'+operation,{contextId:context,...data});
  if(context!==state.storage?.contextId)throw Error(tr('changed'));return result;
 }
 const fingerprint=(title,value)=>'<div class="field"><strong>'+esc(tr(title))+'</strong><div class="security-fingerprint"><code>'+esc(value?.id??tr('none'))+'</code></div></div>';
 const pair=value=>fingerprint('signing',value.signing)+fingerprint('encryption',value.encryption);
 function form(kind,title,body,submit){showDialog('<form id="security-collaboration-'+kind+'-form" data-collaboration-identity-form="'+kind+'" data-no-draft><h2 id="dialog-title">'+esc(tr(title))+'</h2>'+body+'<p role="alert" data-identity-error></p><div class="dialog-actions">'+actionButton(esc,'cancel','cancel')+'<button class="button primary" type="submit">'+esc(tr(submit))+'</button></div></form>');}
 const passwordField=(name,label,autocomplete)=>field(tr(label),'<input name="'+name+'" type="password" required minlength="12" maxlength="1024" autocomplete="'+autocomplete+'">');
 function sourceForm(){
  form('inspect','recover','<p>'+esc(tr('recoveryHelp'))+'</p>'+field(tr('file'),'<input name="file" type="file" required accept=".observanda-identity-backup,.json">')+passwordField('password','password','current-password'),'inspect');
  const previous=snapshot.saved.filter(item=>item.id!==snapshot.active);
  if(previous.length)dialog().querySelector('form').insertAdjacentHTML('afterend','<details data-identity-saved><summary>'+esc(tr('saved'))+'</summary>'+previous.map((item,i)=>'<section class="security-section">'+pair(item)+actionButton(esc,'useSaved','choose-'+i)+'</section>').join('')+'</details>');
 }
 function review(identity,kind){
  form(kind,'review','<p>'+esc(tr('reviewHelp'))+'</p><h3>'+esc(tr('current'))+'</h3>'+pair(snapshot.current)+'<h3>'+esc(tr('incoming'))+'</h3>'+pair(identity)+'<label class="checkbox"><input type="checkbox" name="confirmed" required>'+esc(tr('confirmed'))+'</label>','restore');
 }
 function error(e){const node=dialog()?.querySelector('[data-identity-error]');if(node)node.textContent=e.message;else notify(e.message,true);}
 async function action(button){
  const name=button.dataset.action;if(!name?.startsWith('security-collaboration-'))return false;if(busy)return true;
  const op=name.slice('security-collaboration-'.length);busy=true;
  try{
   if(op==='cancel'){clear();dialog().close();return true;}
   if(op==='backup'){clear();context=state.storage?.contextId;form('backup','backup','<p>'+esc(tr('backupHelp'))+'</p>'+passwordField('password','password','new-password')+passwordField('confirmation','confirmation','new-password'),'download');}
   else if(op==='recover'){clear();if(!await lock())return true;context=state.storage?.contextId;snapshot=await call('state');sourceForm();}
   else if(op.startsWith('choose-')){const previous=snapshot.saved.filter(item=>item.id!==snapshot.active),item=previous[Number(op.slice(7))];if(!item)throw Error(tr('changed'));inspection=item;review(item,'activate');}
  }catch(e){error(e);}finally{busy=false;}return true;
 }
 async function submit(element,data){
  const kind=element.dataset.collaborationIdentityForm;if(!kind)return false;if(busy)return true;busy=true;const version=serial,controls=[...element.elements].map(el=>[el,el.disabled]);for(const [el]of controls)el.disabled=true;
  try{
   if(kind==='backup'){
    const result=await call('backup',{password:data.get('password'),confirmation:data.get('confirmation')});if(version!==serial)return true;
    const url=URL.createObjectURL(new Blob([JSON.stringify(result.file)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='collaboration.observanda-identity-backup';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);clear();dialog().close();notify(tr('downloaded'));
   }else if(kind==='inspect'){
    const file=data.get('file');if(!file?.size||file.size>24576)throw Error(tr('invalidFile'));let value;try{value=JSON.parse(await file.text());}catch{throw Error(tr('invalidFile'));}
    const secret=data.get('password'),result=await call('inspect',{file:value,password:secret});if(version!==serial)return true;backup=value;password=secret;inspection=result.identity;snapshot=result.state;review(inspection,'restore');
   }else{
    if(!data.has('confirmed')||!inspection)throw Error(tr('confirmFirst'));
    if(kind==='restore')await call('restore',{file:backup,password,expected:snapshot.etag,verified:inspection.id});
    else if(kind==='activate')await call('activate',{id:inspection.id,expected:snapshot.etag,confirmed:true});else throw Error(tr('invalidFile'));
    if(version!==serial)return true;clear();dialog().close();notify(tr('restored'));
   }
  }catch(e){if(version===serial)error(e);}finally{busy=false;for(const [el,disabled]of controls)el.disabled=disabled;}return true;
 }
 return {action,submit,panel:()=>'<section class="panel"><h2>'+esc(tr('title'))+'</h2><p>'+esc(tr('scope'))+'</p>'+collaborationIdentityActions(esc)+'</section>'};
}
