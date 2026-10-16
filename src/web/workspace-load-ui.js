// Startup has its own lifecycle: cancellation never opens a partial workspace.
export function loadWorkspaceView({reader,show,reload=()=>location.reload()}){
 return new Promise((resolve,reject)=>{
  let controller,progress=null;
  show('<main id="main" class="loading workspace-loading"><h1 tabindex="-1">Opening workspace</h1><p id="workspace-load-progress" role="status">Reading workspace details...</p><progress aria-label="Loading records"></progress><div class="inline-actions"><button class="button" id="workspace-load-cancel">Cancel loading</button><button class="button primary" id="workspace-load-retry" hidden>Retry loading</button><button class="button" id="workspace-load-restart" hidden>Reload workspace</button></div><p id="workspace-load-error" role="alert"></p></main>');
  const main=document.querySelector('#main'),status=main.querySelector('#workspace-load-progress'),bar=main.querySelector('progress'),
   cancel=main.querySelector('#workspace-load-cancel'),retry=main.querySelector('#workspace-load-retry'),
   restart=main.querySelector('#workspace-load-restart'),errorText=main.querySelector('#workspace-load-error');
  main.querySelector('h1').focus();
  const update=value=>{progress=value;status.textContent='Loading records '+value.loaded+' of '+value.total;bar.max=Math.max(1,value.total);bar.value=value.loaded;};
  async function run(){
   controller=new AbortController();cancel.hidden=false;cancel.disabled=false;retry.hidden=true;restart.hidden=true;errorText.textContent='';
   status.textContent=progress?'Loading records '+progress.loaded+' of '+progress.total:'Reading workspace details...';
   try{
    const result=await reader.read({signal:controller.signal,onProgress:update});
    resolve(result);
   }catch(error){
    cancel.hidden=true;
    if(error.code==='ACCESS_LOCKED'||error.code==='AUTH'){reader.reset();reject(error);return;}
    const fatal=['WORKSPACE_CHANGED','WORKSPACE_READ_CURSOR','WORKSPACE_READ_INVALID','CATALOGUE_DAMAGED'].includes(error.code);
    const cancelled=controller.signal.aborted;
    status.textContent=cancelled?'Loading paused.':'Workspace could not be opened.';
    if(!cancelled)errorText.textContent=error.message??'Connection interrupted. Received pages are kept for retry.';
    if(progress)status.textContent+=' '+progress.loaded+' of '+progress.total+' records received.';
    retry.hidden=fatal;retry.textContent=cancelled?'Resume loading':'Retry loading';restart.hidden=false;
    (fatal?restart:retry).focus();
   }
  }
  cancel.onclick=()=>{cancel.disabled=true;controller.abort();};
  retry.onclick=run;restart.onclick=()=>{reader.reset();reload();};
  run();
 });
}
