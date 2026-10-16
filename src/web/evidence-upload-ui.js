import {matchingUploadPrefix} from './evidence-fingerprint.js';
import {t} from './i18n/index.js';
export const uploadText=(key,args)=>t('evidenceUpload',key,args);
export function evidenceUploadUI({route=value=>value,call,frame,esc,field,button,guard,owner,context,sourceMount,sources,watchJob}){
 let session=null,controller=null,busy=false;
 const progress=message=>{const node=document.getElementById('material-progress');if(node)node.textContent=message;};
 const meter=amount=>{const node=document.getElementById('material-meter');if(node)node.value=amount;};
 async function form(current=null){
  session=current;
  frame(uploadText(current?'resumeHeading':'heading'),'<p>'+esc(uploadText('introduction'))+'</p>'+
   field(esc(uploadText(current?'sameFile':'file')),'<input id="material-file" type="file">')+
   (!current?field(esc(uploadText('provenance')),'<textarea id="material-provenance" rows="3"></textarea>'):'<p>'+esc(current.name)+' · '+esc(uploadText('bytes',{count:current.size.toLocaleString()}))+'</p>')+
   (!current?'<div id="material-picker-parent"><input type="hidden" data-value value=""></div>':'')+
   '<p id="material-progress" role="status" aria-live="polite"></p><progress id="material-meter" value="0" max="1" aria-label="'+esc(uploadText('progress'))+'"></progress>'+
   '<div class="inline-actions">'+button(uploadText(current?'resume':'import'),'upload')+button(uploadText('pause'),'pause','disabled')+'</div>');
  if(!current){
   const control=document.querySelector('[data-action="material-upload"]');control.disabled=true;
   try{await sourceMount('parent',uploadText('derived'),{optional:true});}finally{if(control.isConnected)control.disabled=false;}
  }
 }
 async function upload(){
  if(busy)return;
  const file=document.getElementById('material-file').files[0];if(!file)throw Error(uploadText('chooseFile'));
  if(session&&(file.name!==session.name||file.size!==session.size))throw Error(uploadText('sameSize'));
  const currentContext=context(),currentOwner=owner(),live=()=>{guard();if(currentContext!==context()||currentOwner!==owner())throw Error(uploadText('contextChanged'));};
  controller=new AbortController();const signal=controller.signal;busy=true;
  const start=document.querySelector('[data-action="material-upload"]'),pause=document.querySelector('[data-action="material-pause"]');
  start.disabled=true;pause.disabled=false;
  try{
   if(!session)session=await call('start',{recordId:currentOwner,name:file.name,size:file.size,provenance:document.getElementById('material-provenance').value,derivesFrom:sources()},{signal});
   live();progress(uploadText('checking'));
   if(!await matchingUploadPrefix(file,session,{signal,progress:n=>meter(file.size?n/file.size:1)}))throw Error(uploadText('different'));
   for(let index=session.receivedChunks;index<Math.ceil(file.size/session.chunkSize);index++){
    signal.throwIfAborted();live();
    const response=await fetch(route('/api/research/materials/chunk/'+session.id+'/'+index),{method:'POST',
     headers:{'Content-Type':'application/octet-stream','X-Observanda-Workspace':currentContext},
     body:file.slice(index*session.chunkSize,(index+1)*session.chunkSize),signal});
    if(!response.ok)throw await response.json();session=await response.json();live();
    progress(uploadText('received',{received:session.receivedBytes.toLocaleString(),total:file.size.toLocaleString()}));meter(file.size?session.receivedBytes/file.size:1);
   }
   live();progress(uploadText('queueing'));const result=await call('finish',{id:session.id},{signal});live();await watchJob(result.job);
  }catch(error){
   progress(error.name==='AbortError'?uploadText('paused'):error.message??uploadText('interrupted'));
   if(error.name!=='AbortError')throw error;
  }finally{busy=false;controller=null;if(start.isConnected)start.disabled=false;if(pause.isConnected)pause.disabled=true;}
 }
 return {form,upload,isBusy:()=>busy,pause:()=>controller?.abort()};
}
