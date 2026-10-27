import './i18n/catalogues/materialFiles.js';
import {t} from './i18n/index.js';
import {materialFileSummary} from './material-file-summary.js';
const text=(key,args)=>t('materialFiles',key,args);

export function evidenceReuseUI({route=value=>value,call,frame,esc,button,guard,owner,context,sourceMount,sources,home,notify}){
 let busy=false,generation=0,request=null,paused=false,batch=null,startIntent=null;
 const stop=()=>{generation++;request?.abort();request=null;paused=true;};
 const active=view=>view===generation&&document.getElementById('dialog')?.open;
 const progressText=value=>text('progress',{count:value.count,attached:value.attached});
 const taskRow=value=>'<p>'+esc(progressText(value))+' '+button(esc(text('continue')),'reuse-original-resume','data-id="'+esc(value.id)+'"')+'</p>';
 async function pending({signal}={}){
  const page=await call('association-list',{recordId:owner(),limit:5},{adopt:false,signal});
  return page.items.length?'<section><h3>'+esc(text('unfinished'))+'</h3>'+page.items.map(taskRow).join('')+(page.next?button(esc(text('allUnfinished')),'reuse-original-list'):'')+'</section>':'';
 }
 async function list(cursor=null){
  const page=await call('association-list',{recordId:owner(),cursor},{adopt:false});guard();
  frame(text('unfinished'),page.items.length?page.items.map(taskRow).join('')+(page.next?button(esc(text('moreUnfinished')),'reuse-original-list','data-cursor="'+esc(page.next)+'"'):''):'<p>'+esc(text('noneUnfinished'))+'</p>');
 }
 async function form(){
  startIntent=null;
  frame(text('reuse'),'<p>'+esc(text('reuseHelp'))+'</p><div id="material-picker-reuse"><input type="hidden" data-value value=""></div><div data-original-preview role="status" aria-live="polite"></div>'+button(esc(text('attach')),'reuse-original-save','disabled'));
  const view=generation,save=document.querySelector('[data-action="material-reuse-original-save"]'),preview=document.querySelector('[data-original-preview]');
  async function showOriginal(ref){
   request?.abort();const current=request=new AbortController();preview.textContent=text('loading');
   try{
    const doc=await call('read',{ref},{adopt:false,signal:current.signal});
    const acquired=doc.content.acquisition?await call('read',{ref:doc.content.acquisition},{adopt:false,signal:current.signal}):null;
    if(!active(view)||current.signal.aborted)return;guard();
    preview.innerHTML=materialFileSummary({...ref,file:doc.content},{context:context(),esc,route})+'<dl class="material-file-summary"><dt>'+esc(text('acquisition'))+'</dt><dd>'+esc(acquired?.title??text('notRecorded'))+(acquired?'<br><code>'+esc(acquired.id)+'</code>':'')+'</dd><dt>'+esc(text('provenance'))+'</dt><dd>'+esc(doc.content.provenance||text('notRecorded'))+'</dd></dl>';
   }catch(error){if(active(view)&&!current.signal.aborted)preview.textContent=error.message??text('previewFailed');}
  }
  await sourceMount('reuse',text('existing'),{kind:'artifact',multiple:true,scope:'all',onInspect:showOriginal,onBusy:value=>{
   if(active(view))save.disabled=value||sources().count===0;
  }});
 }
 function drawProgress(){
  const status=document.querySelector('[data-association-status]'),meter=document.querySelector('[data-association-progress]');
  if(status)status.textContent=progressText(batch);if(meter){meter.max=batch.count;meter.value=batch.attached;}
 }
 async function run(value){
  frame(text('reuse'),'<p>'+esc(text('resumeHelp'))+'</p><p data-association-status role="status" aria-live="polite"></p><progress data-association-progress aria-label="'+esc(text('attachmentProgress'))+'"></progress><p data-association-error role="alert"></p><div class="inline-actions">'+button(esc(text('pause')),'reuse-original-pause')+button(esc(text('continue')),'reuse-original-retry','hidden')+button(esc(text('cancel')),'reuse-original-cancel','hidden')+'</div>');
  batch=value;const view=generation;paused=false;busy=true;drawProgress();
  try{
   while(batch.state==='open'&&!paused&&active(view)){
    request=new AbortController();batch=await call('association-step',{id:batch.id},{adopt:false,signal:request.signal});guard();if(active(view))drawProgress();
   }
   if(!active(view))return;
   if(batch.state==='completed'){const count=batch.count;await home({fresh:true});notify(text('attached',{count}));return;}
  }catch(error){if(active(view)&&error.name!=='AbortError')document.querySelector('[data-association-error]').textContent=error.message;}
  finally{
   busy=false;
   if(active(view)){
    document.querySelector('[data-action="material-reuse-original-pause"]').hidden=true;
    document.querySelector('[data-action="material-reuse-original-retry"]').hidden=false;
    document.querySelector('[data-action="material-reuse-original-cancel"]').hidden=false;
   }
  }
 }
 async function action(act,control){
  if(act==='reuse-original-pause'){paused=true;control.disabled=true;return true;}
  if(busy)return true;
  if(act==='reuse-original-form'){await form();return true;}
  if(act==='reuse-original-list'){await list(control.dataset.cursor??null);return true;}
  if(act==='reuse-original-resume'||act==='reuse-original-retry'){
   busy=true;control.disabled=true;const view=generation;
   try{const value=await call('association-read',{id:act==='reuse-original-resume'?control.dataset.id:batch.id},{adopt:false});guard();if(active(view))await run(value);}
   finally{busy=false;if(control.isConnected)control.disabled=false;}return true;
  }
  if(act==='reuse-original-cancel'){
   busy=true;control.disabled=true;
   try{await call('association-cancel',{id:batch.id});guard();await home({fresh:true});notify(text('cancelled'));}
   finally{busy=false;if(control.isConnected)control.disabled=false;}return true;
  }
  if(act!=='reuse-original-save')return false;
  guard();const selected=sources();if(!selected.count)throw Error(text('chooseFiles'));
  if(!startIntent||startIntent.selection!==selected.selection)startIntent={id:crypto.randomUUID(),recordId:owner(),selection:selected.selection,count:selected.count};
  const formElement=document.getElementById('material-form'),controls=[...formElement.querySelectorAll('button,input,select')];
  busy=true;controls.forEach(el=>el.disabled=true);
  try{const value=await call('association-start',startIntent);guard();await run(value);}
  finally{busy=false;controls.forEach(el=>{if(el.isConnected)el.disabled=false;});}
  return true;
 }
 return {action,pending,stop,isBusy:()=>busy};
}
