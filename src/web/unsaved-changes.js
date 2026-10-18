// One decision before leaving an editing context. The original screen/form stays mounted.
export function unsavedChanges({esc,changes,save,discard,busy,notify,flush,prepare,defaultScope='all'}) {
  const dialog=document.createElement('dialog');dialog.id='leave-dialog';dialog.setAttribute('aria-labelledby','leave-title');document.body.append(dialog);
  let active=false,work=null,generation=0,preparing=null;
  async function run(next,{scope=defaultScope}={}){
    if(active)return false;
    const request=++generation;
    if(busy()){notify('Wait for the current operation to finish before leaving.',true);return false;}
    // Automatic editors commit their pending input before evaluating manual
    // drafts. A failed save leaves the editor and its input in place.
    if(flush){
      preparing=request;
      try{await flush(scope);}catch(error){if(request!==generation)return false;throw error;}
      finally{if(preparing===request)preparing=null;}
      if(request!==generation)return false;
      if(busy()){notify('Wait for the current operation to finish before leaving.',true);return false;}
    }
    // A draft without a durable checkpoint needs an immediate decision. Its
    // queued write must not hide Stay or Discard behind preparation. Already
    // retained drafts may prepare a return token without applying their edits.
    let pending=changes(scope);
    if(prepare&&!pending.labels.length){
      preparing=request;
      try{await prepare(scope);}catch(error){if(request!==generation)return false;throw error;}
      finally{if(preparing===request)preparing=null;}
      if(request!==generation)return false;
      if(busy()){notify('Wait for the current operation to finish before leaving.',true);return false;}
    }
    pending=changes(scope);
    if(!pending.labels.length){await next();return true;}
    active=true;
    const decision=await new Promise(resolve=>{
      dialog.innerHTML=`<h2 id="leave-title">Unsaved changes</h2><p>Before leaving, choose what to do with your changes.</p><ul>${pending.labels.map(label=>`<li>${esc(label)}</li>`).join('')}</ul>${pending.canSave?'':'<p>Complete this form to apply it, or discard the unfinished form.</p>'}<p class="guard-error" role="alert" hidden></p><div class="dialog-actions"><button class="button" data-choice="stay">Stay here</button><button class="button danger" data-choice="discard">Discard changes</button>${pending.canSave?'<button class="button primary" data-choice="save">Save and continue</button>':''}</div>`;
      let settled=false;
      const refresh=()=>{for(const button of dialog.querySelectorAll('[data-choice]'))button.disabled=button.dataset.choice!=='stay'&&!!work;};
      const finish=value=>{if(settled)return;settled=true;dialog.close();dialog.onclick=null;dialog.oncancel=null;resolve(value);};
      dialog.oncancel=event=>{event.preventDefault();finish(false);};
      // Returning to the current screen never waits on a queued save. Its
      // eventual reply must not navigate or close a newer decision dialog.
      work?.finally(()=>{if(!settled)refresh();});
      dialog.onclick=async event=>{
        const button=event.target.closest('[data-choice]');if(!button)return;
        if(button.dataset.choice==='stay'){finish(false);return;}
        if(work)return;
        const operation=Promise.resolve().then(()=>button.dataset.choice==='save'?save(scope,pending.forms):discard(scope,pending.forms));
        work=operation.then(()=>{},()=>{});refresh();
        try{
          await operation;
          finish(true);
        }catch(error){if(!settled){const message=dialog.querySelector('[role="alert"]');message.hidden=false;message.textContent=error?.message??'Could not save. Your changes are still here.';}else notify(error?.message??'Could not save. Your changes are still here.',true);}
        finally{work=null;if(!settled)refresh();}
      };
      refresh();dialog.showModal();dialog.querySelector('[data-choice="stay"]').focus();
    });
    active=false;
    if(decision){await next();return true;}return false;
  }
  return {run,isActive:()=>active,canLeaveImmediately:(scope=defaultScope)=>!active&&preparing===null&&!busy()&&!changes(scope).labels.length};
}

// Forms use independent snapshots, including unchecked controls. Nothing is persisted here.
export function formDrafts(){
  const snapshots=new WeakMap();
  const values=form=>[...form.elements].filter(el=>el.name&&!['button','submit','reset'].includes(el.type)).map(el=>({el,value:el.value,checked:el.checked}));
  function track(){for(const form of document.querySelectorAll('form'))if(!snapshots.has(form))snapshots.set(form,values(form));}
  function dirty(form){return (snapshots.get(form)??[]).some(item=>item.el.value!==item.value||item.el.checked!==item.checked);}
  function changed(scope){return [...document.querySelectorAll(scope==='dialog'?'#dialog[open] form':'main form, #dialog[open] form')].filter(form=>!form.hasAttribute('data-module-form')&&!form.hasAttribute('data-no-draft')&&dirty(form));}
  function reset(forms){for(const form of forms)for(const item of snapshots.get(form)??[]){if(item.el.type!=='file')item.el.value=item.value;item.el.checked=item.checked;}}
  function accept(form){snapshots.set(form,values(form));}
  return {track,changed,reset,accept};
}
