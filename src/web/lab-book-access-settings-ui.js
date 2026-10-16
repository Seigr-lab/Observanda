import {localizedText} from './i18n/index.js';
const text=localizedText('labBookAccess');
// Password fields exist only in the opened book access section, never drafts.
export function labBookAccessSettingsUI({state,api,esc,field,enterProject,render}){
 let context,entries=new Map();
 function sync(){if(context!==state.storage?.contextId){context=state.storage?.contextId;entries=new Map();}}
 function selected(){sync();const owner=state.projectOwner;if(!owner?.labBookId)return null;const id=owner.projectId+'/'+owner.labBookId;if(!entries.has(id))entries.set(id,{...owner,id,context,data:null,error:'',saved:false,busy:false});return entries.get(id);}
 const prefix=entry=>'/api/projects/'+entry.projectId+'/lab-books/'+entry.labBookId;
 const host=entry=>entry.context===state.storage?.contextId?document.querySelector('[data-lab-book-access="'+entry.id+'"]'):null;
 function paint(entry){
  const node=host(entry)?.querySelector('[data-access-fields]');if(!node)return;
  const signature=JSON.stringify([entry.data,entry.error,entry.saved]);if(node.dataset.signature===signature)return;node.dataset.signature=signature;
  node.innerHTML=(entry.data?'<form id="lab-book-access-form" data-no-draft><p>'+esc(text(entry.data.passwordAvailable?'passwordReady':'passwordHint'))+'</p>'+field(text('username'),'<input name="username" autocomplete="username" maxlength="80" value="'+esc(entry.data.username)+'">')+field(text('newPassword'),'<input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="1024" required>')+field(text('confirmPassword'),'<input name="confirmPassword" type="password" autocomplete="new-password" maxlength="1024" required>')+'<div class="inline-actions"><button class="button primary" type="submit">'+esc(text('savePassword'))+'</button><button class="button" type="button" data-action="lab-book-access-lock">'+esc(text('lock'))+'</button></div></form>':'<p role="status">'+esc(text('loading'))+'</p>')+'<p role="'+(entry.error?'alert':'status')+'">'+esc(entry.error||(entry.saved?text('saved'):''))+'</p>';
  const form=node.querySelector('form');form?.addEventListener('input',()=>form.elements.confirmPassword.setCustomValidity(''));
 }
 async function load(entry){if(entry.busy)return;entry.busy=true;try{entry.data=await api(prefix(entry)+'/access/details',{}, {adopt:false});entry.error='';}catch(error){entry.error=error.message;}finally{entry.busy=false;paint(entry);}}
 return {
  view(){const entry=selected();return entry?'<details class="panel" data-lab-book-access="'+entry.id+'"><summary>'+esc(text('section'))+'</summary><div data-access-fields></div></details>':'';},
  bind(){const entry=selected(),node=entry&&host(entry);if(!node||node.dataset.bound)return;node.dataset.bound='true';node.addEventListener('toggle',()=>{if(node.open){paint(entry);if(!entry.data)void load(entry);}});},
  async submit(form){if(form.id!=='lab-book-access-form')return false;const entry=selected();if(!entry?.data||entry.busy||!host(entry)?.contains(form))return true;
   form.elements.confirmPassword.setCustomValidity(form.elements.password.value===form.elements.confirmPassword.value?'':text('passwordMismatch'));if(!form.reportValidity())return true;
   const data={etag:entry.data.etag,username:form.elements.username.value,password:form.elements.password.value};entry.busy=true;entry.error='';entry.saved=false;for(const input of form.elements)input.disabled=true;
   try{entry.data=await api(prefix(entry)+'/access/password',data,{adopt:false});entry.saved=true;}
   catch(error){entry.error=error.message;try{entry.data=await api(prefix(entry)+'/access/details',{}, {adopt:false});}catch{}}
   finally{entry.busy=false;paint(entry);}return true;
  },
  async action(node){if(node.dataset.action!=='lab-book-access-lock')return false;const entry=selected();if(!entry||entry.busy)return true;entry.busy=true;
   try{await api(prefix(entry)+'/access/lock',{}, {adopt:false});if(entry.context!==state.storage?.contextId)return true;await enterProject(entry.projectId);state.page='project';state.project=entry.projectId;state.notebook='all';render();}
   catch(error){entry.error=error.message;paint(entry);}finally{entry.busy=false;}return true;
  }
 };
}
