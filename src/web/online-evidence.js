import {t} from './i18n/index.js';
import {FILE_CHUNK,fingerprintFile} from './evidence-fingerprint.js';
import {evidencePurposes,validEvidencePath} from './evidence-files.js';
import {onlineRetainedReference} from './online-retained-reference.js';
const tr=(key,values)=>t('onlineEvidence',key,values);
const base64=buffer=>{const bytes=new Uint8Array(buffer);let value='';for(let i=0;i<bytes.length;i+=8192)value+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(value);};

// Evidence has its own mounted form. Text collaboration never replaces a file
// selection, and the host's durable upload checkpoints survive browser restart.
export function onlineEvidence({remote,esc,notify,fileUrl,retainedFileUrl,figureURL}){
 let host,recordId,readOnly=false,disposed=false,busy=false,reading=false,loading=false,controller=null,current=null,intent=null,uncertain=false,timer=null,next=null,pendingNext=null,reference=null;
 const pending=new Map(),items=new Map();
 const request=(operation,data={})=>remote(operation,{recordId,...data});
 const button=(key,action,id='',values={})=>'<button type="button" class="button" data-online-evidence="'+action+'" data-upload-id="'+esc(id)+'">'+esc(tr(key,values))+'</button>';
 const form=()=>host.querySelector('form');
 const status=text=>{if(!disposed)host.querySelector('[data-evidence-status]').textContent=text;};
 function controls(){
  if(disposed)return;host.setAttribute('aria-busy',String(busy||loading||reading));
  for(const el of host.querySelectorAll('button,input,textarea,select')){if(!el.closest('[data-evidence-inspection]'))el.disabled=busy||loading||reading;}
  const f=form();if(f){for(const el of f.elements)el.disabled=busy||loading||reading||readOnly||uncertain;
   for(const name of ['sourcePath','purpose','provenance'])f.elements[name].disabled=busy||loading||reading||readOnly||!!current||!!intent||uncertain;
   const pause=f.querySelector('[data-online-evidence="pause"]');pause.hidden=!busy;pause.disabled=!busy||controller?.signal.aborted;
  }
  for(const el of host.querySelectorAll('[data-upload-id]:not([data-upload-id=""])'))el.disabled=busy||loading||reading||readOnly;
  reference?.setBlocked(busy||loading);
 }
 function draw(){
  if(disposed)return;
  host.querySelector('[data-evidence-list]').innerHTML=items.size?'<ul>'+[...items.values()].map(m=>'<li><button type="button" class="text-button" data-online-evidence="inspect" data-material-id="'+m.id+'" aria-label="'+esc(tr('inspect',{title:m.title}))+'">'+esc(m.title)+'</button>'+(m.kind==='artifact'?'<p>'+esc(m.sourcePath??m.name)+' · '+esc(tr('size',{size:m.size}))+'</p>'+(m.sourcePurpose?'<p>'+esc(t('evidenceIntake','purpose-'+m.sourcePurpose))+'</p>':'')+'<code>'+esc(tr('sha256',{hash:m.sha256}))+'</code>'+(m.provenance?'<p class="online-comment">'+esc(m.provenance)+'</p>':'')+'<p><a class="button" href="'+esc(fileUrl('artifact',m.id,m.revision))+'" download>'+esc(tr('download'))+'</a></p>':'<code>'+esc(m.revision)+'</code>')+'</li>').join('')+'</ul>':'<p>'+esc(tr('empty'))+'</p>';
  host.querySelector('[data-evidence-pending]').innerHTML=pending.size?'<ul>'+[...pending.values()].map(s=>{
   const state=s.job?.state,working=['queued','running'].includes(state),finished=s.receivedBytes===s.size;
   return '<li><strong>'+esc(s.sourcePath??s.name)+'</strong><p>'+esc(tr('received',{received:s.receivedBytes,total:s.size}))+'</p>'+(s.job?'<p>'+esc(state==='running'?tr('verifying',s.job.progress):state==='queued'?tr('queuedState'):tr('failed',{message:s.job.message??state}))+'</p>':'')+(!readOnly&&!working?button(finished?state?'retry':'finish':'resume',finished?'finish':'resume',s.id,{name:s.name}):'')+'</li>';
  }).join('')+'</ul>':'<p>'+esc(tr('emptyPending'))+'</p>';
  host.querySelector('[data-online-evidence="more"]').hidden=!next;host.querySelector('[data-online-evidence="more-pending"]').hidden=!pendingNext;controls();
  clearTimeout(timer);if([...pending.values()].some(s=>['queued','running'].includes(s.job?.state)))timer=setTimeout(()=>void refresh().catch(error=>notify(error.message,true)),2000);
 }
 async function refresh(which=null){
  if(disposed||busy||loading||reading)return;loading=true;controls();
  try{
   if(which!=='pending'){const page=await request('evidence',which==='more'?{cursor:next}:{});if(disposed)return;if(which!=='more')items.clear();for(const item of page.items)items.set(item.id,item);next=page.next;}
   if(which!=='more'){const page=await request('evidence-uploads',which==='pending'?{cursor:pendingNext}:{});if(disposed)return;if(which!=='pending')pending.clear();for(const item of page.items)pending.set(item.id,item);pendingNext=page.next;}
   uncertain=false;
  }finally{loading=false;if(!disposed)draw();}
 }
 function clear(){current=null;intent=null;form()?.reset();status('');controls();}
 function resume(id){
  current=pending.get(id);if(!current)return;intent=null;const f=form();f.reset();f.elements.sourcePath.value=current.sourcePath??'';f.elements.purpose.value=current.sourcePurpose;f.elements.provenance.value=current.provenance;
  status(tr('selectSame',{name:current.name}));controls();f.elements.file.focus();
 }
 async function finish(id){const result=await request('evidence-finish',{id});pending.set(id,result);status(tr('queued'));}
 async function save(){
  if(busy||loading||reading||readOnly||uncertain)throw Error(tr('busy'));const f=form(),file=f.elements.file.files[0];if(!file)throw Error(tr('chooseFile'));
  const sourcePath=f.elements.sourcePath.value.trim();if(sourcePath&&(!validEvidencePath(sourcePath)||sourcePath.split('/').at(-1)!==file.name))throw Error(tr('invalidPath'));
  busy=true;controller=new AbortController();controls();
  try{
   status(tr('checking'));const fingerprint=await fingerprintFile(file,{signal:controller.signal});controller.signal.throwIfAborted();
   if(current){if(current.name!==file.name||current.size!==file.size||current.fingerprint!==fingerprint)throw Error(tr('different'));current=await request('evidence-upload',{id:current.id});}
   else{
    intent??={id:crypto.randomUUID(),file:{name:file.name,size:file.size,fingerprint,...(sourcePath?{sourcePath}:{})},purpose:f.elements.purpose.value,provenance:f.elements.provenance.value};
    if(intent.file.fingerprint!==fingerprint||intent.file.name!==file.name||intent.file.size!==file.size)throw Error(tr('different'));
    current=await request('evidence-start',intent);intent=null;
   }
   while(current.receivedBytes<file.size){
    controller.signal.throwIfAborted();const index=current.receivedChunks,bytes=base64(await file.slice(index*FILE_CHUNK,(index+1)*FILE_CHUNK).arrayBuffer());controller.signal.throwIfAborted();
    current=await request('evidence-chunk',{id:current.id,index,bytes});status(tr('received',{received:current.receivedBytes,total:file.size}));
   }
   controller.signal.throwIfAborted();await finish(current.id);current=null;intent=null;f.reset();
  }catch(error){
   if(controller.signal.aborted)status(tr('paused'));
   else{uncertain=!!intent;status(tr('interrupted',{error:error.message}));throw error;}
  }finally{busy=false;controller=null;controls();await refresh().catch(error=>{uncertain=true;controls();notify(error.message,true);});}
 }
 async function action(event){
  const el=event.target.closest('[data-online-evidence]');if(!el)return;const action=el.dataset.onlineEvidence;
  if(action==='pause'){controller?.abort();controls();return;}if(busy||loading||reading)return;
  try{
   if(action==='refresh')await refresh();
   if(action==='more')await refresh('more');
   if(action==='more-pending')await refresh('pending');
   if(action==='resume')resume(el.dataset.uploadId);
   if(action==='clear')clear();
   if(action==='inspect'){
    const item=items.get(el.dataset.materialId);if(!item)return;reference?.dispose();
    const panel=host.querySelector('[data-evidence-inspection-panel]');panel.hidden=false;
    reference=onlineRetainedReference({host:panel.querySelector('[data-evidence-inspection]'),recordId,rootRef:{kind:item.kind,id:item.id,revision:item.revision},remote,esc,fileUrl:retainedFileUrl,figureURL,operations:{read:'evidence-read',page:'evidence-page'},onBusy:value=>{reading=value;controls();}});
    await reference.open();panel.scrollIntoView({block:'nearest'});
   }
   if(action==='close-inspection'){reference?.dispose();reference=null;host.querySelector('[data-evidence-inspection-panel]').hidden=true;}
   if(action==='finish'){busy=true;controls();try{await finish(el.dataset.uploadId);}finally{busy=false;controls();}await refresh();}
  }catch(error){notify(error.message,true);}
 }
 return {
  mount(element,id,role){host=element;recordId=id;readOnly=role!=='editor';
   host.innerHTML='<details data-live-evidence><summary>'+esc(tr('heading'))+'</summary>'+button('refresh','refresh')+'<div data-evidence-list></div>'+button('more','more')+'<section data-evidence-inspection-panel hidden>'+button('closeInspection','close-inspection')+'<div data-evidence-inspection></div></section><h4>'+esc(tr('pending'))+'</h4><div data-evidence-pending></div>'+button('morePending','more-pending')+(readOnly?'':'<form data-evidence-upload><p>'+esc(tr('introduction'))+'</p><label class="field">'+esc(tr('file'))+'<input name="file" type="file" required></label><label class="field">'+esc(tr('path'))+'<input name="sourcePath" maxlength="4096" aria-describedby="online-evidence-path-help"></label><p id="online-evidence-path-help" class="muted">'+esc(tr('pathHelp'))+'</p><label class="field">'+esc(tr('purpose'))+'<select name="purpose" aria-label="'+esc(tr('purpose'))+'">'+evidencePurposes.map(p=>'<option value="'+p+'">'+esc(t('evidenceIntake','purpose-'+p))+'</option>').join('')+'</select></label><label class="field">'+esc(tr('provenance'))+'<textarea name="provenance" maxlength="10000"></textarea></label><div class="module-actions"><button type="submit" class="button">'+esc(tr('upload'))+'</button>'+button('pause','pause')+button('clear','clear')+'</div></form>')+'<p role="status" data-evidence-status></p></details>';
   host.addEventListener('click',action);form()?.addEventListener('submit',event=>{event.preventDefault();event.stopPropagation();void save().catch(error=>notify(error.message,true));});void refresh().catch(error=>notify(error.message,true));
  },save,refresh,isBusy:()=>busy||reading,isDirty:()=>{const f=form();return busy||!!current||!!intent||!!f&&(!!f.elements.file.files.length||!!f.elements.sourcePath.value||!!f.elements.provenance.value||f.elements.purpose.value!=='evidence');},
  setReadOnly(){readOnly=true;controller?.abort();controls();},
  dispose(){disposed=true;controller?.abort();reference?.dispose();clearTimeout(timer);host?.removeEventListener('click',action);}
 };
}
