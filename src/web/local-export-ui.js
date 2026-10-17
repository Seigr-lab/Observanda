import {publicationPreviewUrl} from './website-context.js';
import {websiteContext} from './website-context.js';
import {t} from './i18n/index.js';
import {requireAnalysisEditionReview} from './analysis-review-ui.js';
import {folderPickerUI} from './folder-picker-ui.js';

export function localExportUI({state,api,esc,field,showDialog,notify}){
 const message=(key,values)=>t('localExport',key,values),text=(key,values)=>esc(message(key,values));
 const call=(operation,data)=>api('/api/local-export/'+operation,data,{adopt:false,websitePin:state.preview?.websitePin});
 let generation=0,context=null,route=null,plan=null,offset=0,files=[],next=null,directory='',busy=false,error='',choosing=false;
 const active=token=>token===generation&&context===websiteContext(state)&&route===location.hash&&document.querySelector('#dialog[open] #local-export');
 const button=(key,action,extra='')=>`<button class="button" type="button" data-action="local-export-${action}" ${extra}>${text(key)}</button>`;
 const picker=folderPickerUI({api,esc,field,showDialog,capabilities:()=>state.storage?.folderPicker});
 function view(){
  const continuing=plan&&['staging','applying'].includes(plan.state),complete=plan?.state==='completed',editable=!continuing&&!busy;
  showDialog(`<section id="local-export"><header><h2 id="dialog-title">${text('title')}</h2></header><div class="local-export-body"><p>${text('guidance')}</p>
   ${field(text('folder'),`<input id="local-export-folder" value="${esc(directory)}" autocomplete="off" spellcheck="false" ${editable?'':'disabled'}>`)}
   <div class="inline-actions"><button class="button" data-action="storage-browse" data-target="local-export-folder" ${editable?'':'disabled'}>${text('choose')}</button>${button('review','plan',editable?'':'disabled')}</div>
   <p>${text('folderGuidance')}</p>
   ${error?`<p role="alert" class="material-review">${esc(error)}</p>`:''}
   ${plan?`<section class="panel" id="local-export-plan"><h3>${text('changes')}</h3><a href="${esc(plan.previewUrl)}" target="_blank" rel="noopener">${text('openEdition')}</a><details><summary>${text('edition')}</summary><p class="source-note">${esc(plan.releaseId)}</p><a href="${esc(publicationPreviewUrl(state,plan.reviewId,'publication.json'))}" target="_blank" rel="noopener">${text('manifest')}</a></details>
    <p role="status">${text(plan.state,{done:plan.applied,total:plan.total})}</p>
    ${plan.reviewId!==state.preview.id?`<p>${text('earlier')}</p>`:''}
    <ul>${Object.entries(plan.counts).map(([kind,count])=>`<li>${text(kind,{count})}</li>`).join('')}</ul>
    ${plan.counts.conflict?`<p>${text('conflictHelp')}</p>`:''}
    <details ${complete?'':'open'}><summary>${text('files')}</summary><div class="local-export-files" tabindex="0" aria-label="${text('files')}"><ul>${files.map(f=>`<li><span>${text('kind'+f.kind[0].toUpperCase()+f.kind.slice(1))}</span> <code>${esc(f.path)}</code></li>`).join('')}</ul></div>
    <div class="inline-actions">${button('previous','previous',offset&&!busy?'':'disabled')}<span>${text('page',{number:Math.floor(offset/50)+1})}</span>${button('next','next',next!==null&&!busy?'':'disabled')}</div></details>
    ${complete&&plan.cleaned?`<p>${text('finished')}</p>`:plan.state!=='discarded'?`<label class="checkbox"><input id="local-export-confirm" type="checkbox" ${busy||plan.counts.conflict?'disabled':''}><span>${text('confirm')}</span></label><div class="inline-actions">${button(continuing||complete?'resume':'apply','apply',busy||plan.counts.conflict?'disabled':'')}${['planned','staging'].includes(plan.state)?button('discard','discard',busy?'disabled':''):''}</div>`:''}
   </section>`:''}
   <p role="status">${busy?text('busy'):''}</p></div><div class="dialog-actions">${button('refresh','refresh',busy||!plan?'disabled':'')}${button('close','close')}</div></section>`);
 }
 async function load(id,token){const result=await call('page',{id,offset});if(!active(token))return;plan=result;files=result.files;next=result.next;directory=result.directory;}
 async function run(work){
  const token=generation,focusedId=document.activeElement?.id,focusedAction=document.activeElement?.dataset.action,scroll=document.querySelector('.local-export-body')?.scrollTop??0;busy=true;error='';view();
  try{await work(token);}catch(e){if(active(token)){error=[e.message,...(e.details??[]).filter(d=>typeof d==='string')].join('\n');if(plan)try{await load(plan.id,token);}catch{}}}
  finally{if(active(token)){
   busy=false;view();document.querySelector('.local-export-body').scrollTop=scroll;
   const controls=[...document.querySelectorAll('#local-export button,#local-export input')],focus=controls.find(el=>!el.disabled&&(focusedId&&el.id===focusedId||focusedAction&&el.dataset.action===focusedAction))??document.querySelector('[data-action="local-export-close"]');focus?.focus({preventScroll:true});
  }}
 }
 async function action(el){
  const name=el.dataset.action;
  if(name==='local-export-open'){
   requireAnalysisEditionReview(state.preview);
   if(!document.querySelector('#review-confirm')?.checked){notify(t('publication','confirmRequired'),true);return true;}
   generation++;context=websiteContext(state);route=location.hash;plan=null;directory='';offset=0;files=[];next=null;busy=false;error='';choosing=false;view();
   await run(async token=>{const result=await call('current',{reviewId:state.preview.id});if(active(token)&&result.plan)await load(result.plan.id,token);});return true;
  }
  const open=context===websiteContext(state)&&route===location.hash&&document.querySelector('#dialog[open]');
  if(open&&name?.startsWith('storage-browse')&&(document.querySelector('#local-export')||choosing)){
   choosing=true;const result=await picker.action(el);if(document.querySelector('#local-export'))choosing=false;return result;
  }
  if(!name?.startsWith('local-export-'))return false;
  if(!active(generation))return true;
  if(name==='local-export-close'){generation++;document.getElementById('dialog').close();return true;}
  if(busy)return true;
  directory=document.getElementById('local-export-folder').value;
  if(name==='local-export-apply'&&!document.getElementById('local-export-confirm')?.checked){error=message('confirmRequired');view();return true;}
  await run(async token=>{
   if(name==='local-export-plan'){const result=await call('plan',{reviewId:state.preview.id,directory});if(active(token)){offset=0;await load(result.id,token);}}
   if(name==='local-export-apply'||name==='local-export-discard'){await call(name.endsWith('apply')?'apply':'discard',{id:plan.id,reviewed:true});if(active(token))await load(plan.id,token);}
   if(['local-export-previous','local-export-next','local-export-refresh'].includes(name)){
    if(name.endsWith('previous'))offset=Math.max(0,offset-50);if(name.endsWith('next')&&next!==null)offset=next;await load(plan.id,token);
   }
  });return true;
 }
 function input(el){
  if(context!==websiteContext(state)||route!==location.hash)return false;
  if(el.id==='local-export-folder'){
   directory=el.value;if(plan&&directory!==plan.directory){plan=null;files=[];offset=0;next=null;document.getElementById('local-export-plan')?.remove();}return true;
  }
  return choosing&&picker.input(el);
 }
 return {action,input,submit:(form,data)=>choosing?picker.submit(form,data):false,close:async()=>{
  if(choosing){await picker.action({dataset:{action:'storage-browse-cancel'}});choosing=false;return true;}return false;
 }};
}
