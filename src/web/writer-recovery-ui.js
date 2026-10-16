import {t} from './i18n/index.js';
export function writerRecoveryUI({api,esc}){
 let pending;
 async function check({force=false}={}){
  if(pending)return pending;
  const snapshot=await api('/api/writer-recovery');if(!force&&!snapshot.locks.length)return;
  const dialog=document.createElement('dialog');dialog.className='writer-recovery';dialog.setAttribute('aria-labelledby','writer-recovery-heading');document.body.append(dialog);
  const text=key=>esc(t('writerRecovery',key));let current=snapshot;
  function render(){
   dialog.innerHTML=`<h2 id="writer-recovery-heading">${text('title')}</h2>${current.locks.length?`<p>${text('explanation')}</p>${current.locks.map(lock=>`<form data-kind="${lock.kind}"><h3>${text(lock.kind)}</h3><p class="storage-path">${esc(lock.path)}</p><label><input type="checkbox" name="closed" required> ${text('closed')}</label><p data-error role="alert"></p><button class="button primary" type="submit">${text('recover')}</button></form>`).join('')}`:`<p role="status">${text('ready')}</p>`}<div class="dialog-actions"><button type="button" class="button" data-close>${text('continue')}</button></div>`;
  }
  pending=new Promise(resolve=>dialog.addEventListener('close',()=>{dialog.remove();pending=null;resolve();},{once:true}));
  dialog.addEventListener('click',event=>{if(event.target.closest('[data-close]'))dialog.close();});
  dialog.addEventListener('submit',async event=>{
   event.preventDefault();event.stopPropagation();const form=event.target,lock=current.locks.find(item=>item.kind===form.dataset.kind),button=form.querySelector('button');button.disabled=true;
   try{
    await api('/api/writer-recovery',{kind:lock.kind,stamp:lock.stamp,contextId:current.contextId,closedOtherInstallations:form.elements.closed.checked});
    current=await api('/api/writer-recovery');render();
   }catch(error){form.querySelector('[data-error]').textContent=error.message;button.disabled=false;}
  });
  render();dialog.showModal();return pending;
 }
 return {check};
}
