import {t} from './i18n/index.js';
import {validUserProfile} from './user-profile-model.js';
import {collaborationIdentityActions} from './collaboration-identity-ui.js';
const tr=(key,values)=>t('userProfile',key,values);
export function userProfileUI({state,api,esc,field,render,notify}){
 let saved=null,draft=null,context=null,loading=false,error=null,busy=false,generation=0;
 const call=(operation,rest={})=>api('/api/user-profile',{operation,...rest});
 const isDirty=()=>Boolean(saved&&draft&&JSON.stringify(saved.profile)!==JSON.stringify(draft));
 const release=()=>{generation++;saved=null;draft=null;context=null;loading=false;error=null;};
 const button=(key,action)=>'<button type="button" class="button" data-action="user-profile-'+action+'">'+esc(tr(key))+'</button>';
 function view(){
  const intro='<h2>'+esc(tr('title'))+'</h2><p>'+esc(tr('intro'))+'</p>';
  if(error)return intro+'<p role="alert">'+esc(error)+'</p>'+button('retry','reload');
  if(!saved)return intro+'<p role="status">'+esc(tr('loading'))+'</p>';
  const input=(key,name,max,autocomplete='off',type='text')=>field(tr(key),'<input name="'+name+'" type="'+type+'" maxlength="'+max+'" autocomplete="'+autocomplete+'" value="'+esc(draft[name])+'">');
  const identity='<section class="panel"><h3>'+esc(tr('identity'))+'</h3><p class="security-fingerprint"><code data-user-id>'+esc(saved.userId)+'</code></p><p>'+esc(tr('identityHelp'))+'</p><div class="inline-actions">'+button('copy','copy')+button('contact','contact')+'</div><p class="muted">'+esc(tr('contactHelp'))+'</p></section>';
  const identifiers=draft.identifiers.map(item=>'<fieldset data-profile-identifier="'+esc(item.id)+'"><legend>'+esc(tr('identifiers'))+'</legend>'+field(tr('label'),'<input data-profile-property="label" value="'+esc(item.label)+'" maxlength="80" required list="user-identifier-labels">')+field(tr('value'),'<input data-profile-property="value" value="'+esc(item.value)+'" maxlength="2048" required>')+field(tr('url'),'<input data-profile-property="url" type="url" value="'+esc(item.url)+'" maxlength="2048">')+'<button type="button" class="button" data-action="user-profile-remove" data-id="'+esc(item.id)+'">'+esc(tr('remove'))+'</button></fieldset>').join('');
  return intro+identity+'<form id="user-profile-form" data-no-draft class="panel"><fieldset '+(busy?'disabled':'')+'>'+input('username','username',80,'username')+input('name','name',160,'name')+input('email','email',254,'email','email')+field(tr('description'),'<input name="description" maxlength="2000" value="'+esc(draft.description)+'">')+'<h3>'+esc(tr('identifiers'))+'</h3><p>'+esc(tr('identifiersHelp'))+'</p><datalist id="user-identifier-labels"><option value="ORCID"><option value="GitHub"><option value="DOI"><option value="PubMed ID"></datalist>'+identifiers+button('add','add')+'<div class="dialog-actions">'+button('discard','discard')+'<button class="button primary" type="submit">'+esc(tr('save'))+'</button></div></fieldset></form><section class="panel"><h3>'+esc(tr('recovery'))+'</h3><p>'+esc(tr('recoveryHelp'))+'</p>'+collaborationIdentityActions(esc)+'</section>';
 }
 async function load(){
  if(loading||state.page!=='user-profile')return;
  loading=true;error=null;const version=++generation,expectedContext=state.storage?.contextId;
  try{
   const result=await call('read');if(version!==generation||state.storage?.contextId!==expectedContext)return;
   saved=result;draft=structuredClone(result.profile);context=expectedContext;
  }catch(e){if(version===generation)error=e.message??tr('unavailable');}
  finally{if(version===generation){loading=false;if(state.page==='user-profile')render();}}
 }
 function bind(){
  if(state.page!=='user-profile')return;
  if(context!==null&&context!==state.storage?.contextId&&!isDirty())release();
  if(!saved&&!loading&&!error)void load();
 }
 function input(el){
  if(!el.closest('#user-profile-form')||!draft)return false;
  const row=el.closest('[data-profile-identifier]');
  if(row){const item=draft.identifiers.find(i=>i.id===row.dataset.profileIdentifier);if(item&&['label','value','url'].includes(el.dataset.profileProperty))item[el.dataset.profileProperty]=el.value;}
  else if(['username','name','email','description'].includes(el.name))draft[el.name]=el.value;
  return true;
 }
 async function save(){
  if(busy)return;if(!validUserProfile(draft))throw Error(tr('invalid'));
  busy=true;const version=generation,snapshot=structuredClone(draft),form=document.querySelector('#user-profile-form'),fieldset=form?.querySelector('fieldset');if(fieldset)fieldset.disabled=true;if(form)form.dataset.busy='true';
  try{const result=await call('save',{command:{userId:saved.userId,expected:saved.etag,profile:snapshot}});if(version!==generation)return;saved=result;draft=structuredClone(result.profile);notify(tr('saved'));}
  finally{busy=false;if(form)delete form.dataset.busy;if(state.page==='user-profile')render();}
 }
 async function discard(){release();if(state.page==='user-profile')render();}
 async function action(button){
  const name=button.dataset.action;if(name==='user-profile'){release();state.page=name;render();return true;}
  if(!name?.startsWith('user-profile-'))return false;if(busy)return true;
  if(name==='user-profile-reload'){release();render();}
  else if(name==='user-profile-copy'){await navigator.clipboard.writeText(saved.userId);notify(tr('copied'));}
  else if(name==='user-profile-add'){draft.identifiers.push({id:crypto.randomUUID(),label:'',value:'',url:''});render();document.querySelector('#user-profile-form fieldset[data-profile-identifier]:last-of-type input')?.focus();}
  else if(name==='user-profile-remove'){draft.identifiers=draft.identifiers.filter(i=>i.id!==button.dataset.id);render();}
  else if(name==='user-profile-discard')await discard();
  else if(name==='user-profile-contact'){
   const result=await call('contact',{userId:saved.userId}),url=URL.createObjectURL(new Blob([JSON.stringify(result.contact)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='contact.observanda-sharing-contact';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return true;
 }
 return {view,bind,input,action,save,discard,isDirty,release,isBusy:()=>busy};
}
