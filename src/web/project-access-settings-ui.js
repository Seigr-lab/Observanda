import {localizedText} from './i18n/index.js';
const text=localizedText('projectStorage');
// A project's credentials are edited in its own page. Passwords remain only
// in the mounted form and are never kept as workspace drafts or UI cache data.
export function projectAccessSettingsUI({state,api,esc,field}){
 const entries=new Map();let context;
 function current(id){if(context!==state.storage?.contextId){entries.clear();context=state.storage?.contextId;}if(!entries.has(id))entries.set(id,{id,context,data:null,loading:false,error:'',saved:false});return entries.get(id);}
 const host=entry=>entry.context===state.storage?.contextId?document.querySelector('[data-project-access="'+entry.id+'"]'):null;
 function paint(entry){const node=host(entry);if(!node)return;const data=entry.data;const signature=JSON.stringify([data,entry.error,entry.saved]);if(node.dataset.signature===signature)return;node.dataset.signature=signature;
  node.innerHTML='<h2>'+esc(text('accessTitle'))+'</h2>'+(data?'<form id="project-storage-access-form" data-no-draft><p>'+esc(text(data.passwordAvailable?'passwordReady':'passwordHint'))+'</p>'+field(text('accessUsername'),'<input name="username" autocomplete="username" maxlength="80" value="'+esc(data.username)+'">')+field(text('newPassword'),'<input name="password" type="password" autocomplete="new-password" required minlength="12" maxlength="1024">')+field(text('confirmPassword'),'<input name="confirmPassword" type="password" autocomplete="new-password" required maxlength="1024">')+'<button class="button primary" type="submit">'+esc(text('savePassword'))+'</button></form>':'<p role="status">'+esc(text('loadingAccess'))+'</p>')+'<p role="'+(entry.error?'alert':'status')+'">'+esc(entry.error||(entry.saved?text('passwordSaved'):''))+'</p>';
  const form=node.querySelector('form');form?.addEventListener('input',()=>form.elements.confirmPassword.setCustomValidity(''));
 }
 async function load(entry){if(entry.loading)return;entry.loading=true;try{entry.data=await api('/api/projects/'+entry.id+'/access/details',{}, {adopt:false});entry.error='';}catch(error){entry.error=error.message;}finally{entry.loading=false;paint(entry);}}
 return {
  view(id){return '<section class="panel" data-project-access="'+id+'"></section>';},
  bind(id){if(!id)return;const entry=current(id);if(!host(entry))return;paint(entry);if(!entry.data&&!entry.loading)void load(entry);},
  async submit(form){if(form.id!=='project-storage-access-form')return false;const id=state.projectOwner?.projectId;if(!id)return true;const entry=current(id);if(entry.loading||!entry.data)return true;
   form.elements.confirmPassword.setCustomValidity(form.elements.password.value===form.elements.confirmPassword.value?'':text('passwordMismatch'));if(!form.reportValidity())return true;
   const data={etag:entry.data.etag,username:form.elements.username.value,password:form.elements.password.value};entry.loading=true;entry.error='';entry.saved=false;for(const input of form.elements)input.disabled=true;
   try{entry.data=await api('/api/projects/'+id+'/access/password',data,{adopt:false});entry.saved=true;}
   catch(error){entry.error=error.message;try{entry.data=await api('/api/projects/'+id+'/access/details',{}, {adopt:false});}catch{}}
   finally{entry.loading=false;paint(entry);}return true;
  }
 };
}
