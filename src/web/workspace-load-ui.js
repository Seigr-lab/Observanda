import {t,language} from './i18n/index.js';
import errors from './locales/en/errors.json' with {type:'json'};
const message=(key,values)=>t('startup',key,values);
const esc=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const progressMessage=(key,value)=>message(key,{count:value.total,loaded:value.loaded.toLocaleString(language()),total:value.total.toLocaleString(language())});
// Startup has its own lifecycle: cancellation never opens a partial workspace.
export function loadWorkspaceView({reader,show,reload=()=>location.reload()}){
 return new Promise((resolve,reject)=>{
  let controller,progress=null;
  show('<main id="main" class="loading workspace-loading"><h1 tabindex="-1">'+esc(message('workspaceOpening'))+'</h1><p id="workspace-load-progress" role="status">'+esc(message('workspaceDetails'))+'</p><progress aria-label="'+esc(message('workspaceRecords'))+'"></progress><div class="inline-actions"><button class="button" id="workspace-load-cancel">'+esc(message('workspaceCancel'))+'</button><button class="button primary" id="workspace-load-retry" hidden>'+esc(message('workspaceRetry'))+'</button><button class="button" id="workspace-load-restart" hidden>'+esc(message('workspaceReload'))+'</button></div><p id="workspace-load-error" role="alert"></p></main>');
  const main=document.querySelector('#main'),status=main.querySelector('#workspace-load-progress'),bar=main.querySelector('progress'),
   cancel=main.querySelector('#workspace-load-cancel'),retry=main.querySelector('#workspace-load-retry'),
   restart=main.querySelector('#workspace-load-restart'),errorText=main.querySelector('#workspace-load-error');
  main.querySelector('h1').focus();
  const update=value=>{progress=value;status.textContent=progressMessage('workspaceProgress',value);bar.max=Math.max(1,value.total);bar.value=value.loaded;};
  async function run(){
   controller=new AbortController();cancel.hidden=false;cancel.disabled=false;retry.hidden=true;restart.hidden=true;errorText.textContent='';
   status.textContent=progress?progressMessage('workspaceProgress',progress):message('workspaceDetails');
   try{
    const result=await reader.read({signal:controller.signal,onProgress:update});
    resolve(result);
   }catch(error){
    cancel.hidden=true;
    if(error.code==='ACCESS_LOCKED'||error.code==='AUTH'){reader.reset();reject(error);return;}
    const fatal=['WORKSPACE_CHANGED','WORKSPACE_READ_CURSOR','WORKSPACE_READ_INVALID','CATALOGUE_DAMAGED'].includes(error.code);
    const cancelled=controller.signal.aborted;
    status.textContent=message(cancelled?'workspacePaused':'workspaceFailed');
    if(!cancelled)errorText.textContent=Object.hasOwn(errors,error.code)?t('errors',error.code):error.message??message('workspaceInterrupted');
    if(progress)status.textContent+=' '+progressMessage('workspaceReceived',progress);
    retry.hidden=fatal;retry.textContent=message(cancelled?'workspaceResume':'workspaceRetry');restart.hidden=false;
    (fatal?restart:retry).focus();
   }
  }
  cancel.onclick=()=>{cancel.disabled=true;controller.abort();};
  retry.onclick=run;restart.onclick=()=>{reader.reset();reload();};
  run();
 });
}
