import {t} from './i18n/index.js';
export function recordSelectionLoadUI({esc,namespace='recordSelection'}){
 const text=(key,args)=>t(namespace,key,args);
 const dialog=document.createElement('dialog');dialog.className='record-selection-loading';document.body.append(dialog);
 const headingId='loading-'+namespace;dialog.setAttribute('aria-labelledby',headingId);
 let cancelActive=null;
 function load(reader,{signal,committed=false}={}){
  if(cancelActive)throw Error(text('busy'));
  return new Promise((resolve,reject)=>{
   const previous=document.activeElement;let settled=false,running=false,controller=null;
   dialog.innerHTML='<h2 id="'+headingId+'">'+esc(text('title'))+'</h2><p>'+esc(text(committed?'committed':'description'))+'</p><p data-selection-progress role="status"></p><progress aria-label="'+esc(text('title'))+'"></progress><p data-selection-error role="alert" hidden></p><div class="dialog-actions"><button class="button" data-selection-retry hidden>'+esc(text('retry'))+'</button><button class="button" data-selection-cancel>'+esc(text('cancel'))+'</button></div>';
   const progress=dialog.querySelector('[data-selection-progress]'),bar=dialog.querySelector('progress'),retry=dialog.querySelector('[data-selection-retry]'),errorView=dialog.querySelector('[data-selection-error]');
   function finish(result,error){
    if(settled)return;settled=true;controller?.abort();reader.reset();signal?.removeEventListener('abort',cancel);
    cancelActive=null;dialog.close();dialog.innerHTML='';if(previous?.isConnected)previous.focus({preventScroll:true});
    if(error)reject(error);else resolve(result);
   }
   function cancel(){finish(null,{code:'RECORD_SELECTION_CANCELLED',message:text(committed?'savedCancelled':'cancelled')});}
   async function run(){
    if(settled||running)return;running=true;
    controller=new AbortController();retry.hidden=true;errorView.hidden=true;
    try{
     const result=await reader.read({signal:controller.signal,onProgress:({loaded,total})=>{
      if(settled)return;progress.textContent=text('progress',{loaded,total});bar.max=total;bar.value=loaded;
     }});
     if(!settled)finish(result);
    }catch(error){
     if(settled)return;
     if(['WORKSPACE_CHANGED','WORKSPACE_READ_LIMIT','WORKSPACE_READ_INVALID','WORKSPACE_READ_CURSOR','RECORD_SELECTION_LIMIT','CATALOGUE_DAMAGED','ACCESS_LOCKED','AUTH'].includes(error.code)){finish(null,error);return;}
     errorView.textContent=error.message??text('failed');errorView.hidden=false;retry.hidden=false;retry.focus();
    }finally{running=false;}
   }
   cancelActive=cancel;dialog.oncancel=event=>{event.preventDefault();cancel();};
   dialog.querySelector('[data-selection-cancel]').onclick=cancel;retry.onclick=run;
   signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted){cancel();return;}
   dialog.showModal();dialog.querySelector('[data-selection-cancel]').focus();void run();
  });
 }
 return {load,close(){cancelActive?.();}};
}
