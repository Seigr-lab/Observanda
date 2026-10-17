import {revisionId} from './revision-model.js';
import {t} from './i18n/index.js';

// Observe durable workspace revisions, including commits made by another process.
// A response may only replace the clean view whose identity/revision requested it.
export function workspaceRefresh({state,api,read,apply,blocked,notify,onAccessError,interval=5000}){
 let task=null,controller=null,stopped=false,pending=false,failure=false,manualBusy=false,owner=null;
 const text=key=>t('workspaceRead',key);
 const identity=()=>state.book&&!state.access?.locked&&!state.storageUnavailable&&!state.newWorkspace?
  (state.storage?.contextId??'')+':'+state.book.id+':'+(state.websiteId??''):null;
 function paint(){
  const logo=document.querySelector('.brand[data-action="workspace-refresh"]');
  if(!logo)return;
  logo.setAttribute('aria-label',text('refreshLabel'));logo.title=text('refreshLabel');
  logo.setAttribute('aria-busy',String(manualBusy));
  let status=document.querySelector('[data-workspace-refresh-status]');
  if(!status){status=document.createElement('p');status.dataset.workspaceRefreshStatus='';status.className='workspace-refresh-status';status.setAttribute('role','status');logo.after(status);}
  const message=manualBusy?text('refreshing'):failure?text('refreshFailed'):pending?text('refreshPending'):'';
  status.hidden=!message;if(status.textContent!==message)status.textContent=message;
 }
 async function check({manual=false,background=false,completedDialog=null}={}){
  const key=identity();
  if(stopped||!key||background&&document.hidden)return false;
  // Explicit refreshes (including our own completed save) must observe a new
  // revision after any older poll. Background activity is not a read lock.
  if(task){if(background)return task;await task;return check({manual,completedDialog});}
  const base=state.etag,workspaceId=state.book.id,route=location.hash;
  const request=new AbortController();controller=request;
  const current=()=>!stopped&&!request.signal.aborted&&identity()===key&&state.etag===base&&location.hash===route;
  manualBusy=manual;paint();
  task=(async()=>{
   try{
    const version=await api('/api/workspace/read/version',{workspaceId},{adopt:false,signal:AbortSignal.any([request.signal,AbortSignal.timeout(15000)])});
    if(!current())return false;
    if(version.workspaceId!==workspaceId||!revisionId(version.etag))throw Error(text('refreshFailed'));
    failure=false;pending=version.etag!==base;paint();
    if(!pending){if(manual)notify(text('refreshCurrent'));return true;}
    if(blocked({completedDialog})){if(manual)notify(text('refreshDeferred'));return false;}
    const result=await read({signal:request.signal});
    // Typing, saving, navigating, locking and switching workspaces can all occur
    // during the read. Keep the user's current view/draft in each of those cases.
    if(!current()||blocked({completedDialog}))return false;
    if(result.book?.id!==workspaceId||!revisionId(result.etag))throw Error(text('refreshFailed'));
    apply(result);pending=false;
    if(manual)notify(text('refreshed'));return true;
   }catch(error){
    // A normal folder operation temporarily fences this owner. The next poll
    // resumes automatically; this is not a failed read or a request to reload.
    if(['STORAGE_RENAMING','STORAGE_DELETING'].includes(error.code))return false;
    if(current()){failure=true;if(error.code==='ACCESS_LOCKED')onAccessError?.(error);else if(manual)notify(text('refreshFailed'),true);}return false;
   }finally{if(controller===request)controller=null;task=null;manualBusy=false;paint();}
  })();
  return task;
 }
 const focused=()=>void check({background:true}),visible=()=>{if(!document.hidden)void check({background:true});};
 const timer=setInterval(focused,interval);
 window.addEventListener('focus',focused);document.addEventListener('visibilitychange',visible);
 return {
  check,
  bind(){const key=identity();if(key!==owner){controller?.abort();owner=key;pending=failure=false;}paint();},
  stop(){stopped=true;controller?.abort();clearInterval(timer);window.removeEventListener('focus',focused);document.removeEventListener('visibilitychange',visible);}
 };
}
