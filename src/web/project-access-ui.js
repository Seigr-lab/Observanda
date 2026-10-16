import {t} from './i18n/index.js';
// Credentials belong to the selected project or book. Cancelling leaves the
// workspace and other unlocked owners available.
export function projectAccessUI({state,api,esc,field,showDialog}){
 const dialog=document.getElementById('dialog');let pending=null;
 function open(projectId,labBookId,name,{unlock}={}){
  const text=key=>t(labBookId?'labBookAccess':'projectAccess',key),prefix='/api/projects/'+projectId+(labBookId?'/lab-books/'+labBookId:'');
  pending?.cancel();const context=state.storage?.contextId;
  return new Promise((resolve,reject)=>{
   const controller=new AbortController();let settled=false;
   const finish=(error)=>{if(settled)return;settled=true;controller.abort();dialog.removeEventListener('close',cancel);dialog.removeEventListener('cancel',escape,true);dialog.removeEventListener('submit',submit,true);dialog.removeEventListener('click',click,true);if(pending?.cancel===cancel)pending=null;if(error)reject(error);else resolve();};
   const cancel=()=>finish({name:'AbortError'});
   const escape=event=>{event.preventDefault();event.stopImmediatePropagation();cancel();dialog.close();};
   const click=event=>{if(event.target.closest('[data-project-unlock-cancel]')){event.preventDefault();event.stopImmediatePropagation();cancel();dialog.close();}};
   async function submit(event){
    const form=event.target;if(form.id!=='project-unlock-form')return;event.preventDefault();event.stopImmediatePropagation();
    if(form.dataset.busy||!form.reportValidity())return;
    const username=form.elements.username.value,password=form.elements.password.value,recovery=form.elements.recovery.value;form.dataset.busy='true';form.querySelector('[type="submit"]').disabled=true;
    try{
     if(unlock)await unlock({projectId,...(labBookId?{labBookId}:{}),username,password,recovery},{signal:controller.signal});
     else await api(prefix+'/access/unlock',{username,password,recovery},{adopt:false,signal:controller.signal});
     if(context!==state.storage?.contextId)throw {name:'AbortError'};finish();dialog.close();
    }catch(error){
     if(settled)return;if(error.name==='AbortError'){cancel();dialog.close();return;}
     const message=form.querySelector('[role="alert"]');message.textContent=error.message??text('failed');message.hidden=false;form.elements.password.value='';form.elements.password.focus();
    }finally{delete form.dataset.busy;form.querySelector('[type="submit"]').disabled=false;}
   }
   pending={cancel};
   showDialog('<form id="project-unlock-form"><h2 id="dialog-title">'+esc(text('title'))+'</h2>'+(name?'<p>'+esc(name)+'</p>':'')+field(text('username'),'<input name="username" autocomplete="username">')+field(text('password'),'<input name="password" type="password" autocomplete="current-password">')+'<details><summary>'+esc(text('recovery'))+'</summary>'+field(text('recoveryKey'),'<input name="recovery" type="password" autocomplete="off">')+'</details><p role="alert" hidden></p><div class="dialog-actions"><button type="button" class="button" data-project-unlock-cancel>'+esc(text('cancel'))+'</button><button type="submit" class="button primary">'+esc(text('unlock'))+'</button></div></form>');
   dialog.addEventListener('close',cancel);dialog.addEventListener('cancel',escape,true);dialog.addEventListener('click',click,true);dialog.addEventListener('submit',submit,true);dialog.querySelector('[name="password"]').focus();
  });
 }
 return {open};
}
