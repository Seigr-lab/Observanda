import {websiteContext} from './website-context.js';
import {publicationText} from './publication-review.js';

export function publicationJobsUI({state,api,esc,showDialog,notify,showReview}){
 const call=(op,data={})=>api('/api/publication-jobs/'+op,data,{adopt:false});
 const text=(key,values)=>esc(publicationText(key,values));
 let generation=0,submission=0,timer=null,context=null,route=null,cursor=null,next=null,previous=[],pendingRequest=null;
 const stop=()=>{generation++;clearTimeout(timer);};
 const button=(key,action,id='')=>`<button type="button" class="button" data-action="publication-jobs-${action}" data-id="${esc(id)}">${text(key)}</button>`;
 const active=token=>token===generation&&context===websiteContext(state)&&route===location.hash&&document.querySelector('#dialog[open] #publication-jobs-status');
 const status=job=>job.error==='ACCESS_LOCKED'?publicationText('sourceAccessRequired'):job.error==='IO'&&job.diagnostic?publicationText('failureWithDiagnostics'):job.message??(job.cancelRequested&&job.state==='running'?publicationText('stopping'):job.state==='running'?job.progress.stage==='capturing-selected-edition'?publicationText('capturingEdition'):job.progress.stage:job.state);
 const actions=job=>(job.state==='relocated'?'':job.state==='completed'?button('openReview','open-review',job.result.id):['failed','cancelled'].includes(job.state)?button('retry','retry',job.id):job.cancelRequested?'':button('cancel','cancel',job.id))+(job.diagnostic?button('privateDiagnostics','diagnostics',job.id):'');
 function dialog(title){showDialog(`<section class="job-library"><h2 id="dialog-title">${text(title)}</h2><p>${text('preparationGuidance')}</p><div id="publication-jobs-pages" class="inline-actions" aria-label="${text('preparationPages')}" hidden>${button('newer','previous')}<span role="status">${text('page',{number:1})}</span>${button('older','next')}</div><div id="publication-jobs-status" class="job-library-items" tabindex="0" aria-label="${text('editions')}" aria-live="polite">${text('loading')}</div><div class="dialog-actions">${button('refresh','list')}${button('continue','close')}</div></section>`);}
 function begin(title){stop();cursor=null;next=null;previous=[];context=websiteContext(state);route=location.hash;dialog(title);return generation;}
 async function poll(token,id=null){
  if(!active(token))return;
  const response=await call(id?'status':'list',id?{id}:{cursor});if(!active(token))return;
  const jobs=id?[{job:response.job,createdAt:response.job.createdAt}]:response.items;
  const pager=document.getElementById('publication-jobs-pages');pager.hidden=!!id;
  if(!id){next=response.next;pager.querySelector('[data-action="publication-jobs-previous"]').disabled=!previous.length;pager.querySelector('[data-action="publication-jobs-next"]').disabled=!next;pager.querySelector('span').textContent=publicationText('page',{number:previous.length+1});}
  const container=document.getElementById('publication-jobs-status'),focused=document.activeElement,focusedAction=focused?.dataset.action,focusedId=focused?.dataset.id;
  container.innerHTML=jobs.length?jobs.map(({job,createdAt})=>`<section class="panel"><h3>${text('edition',{date:new Date(createdAt).toLocaleString()})}</h3><p>${esc(status(job))}</p>${job.progress.stage==='capturing-selected-edition'&&Number.isSafeInteger(job.progress.recordsCaptured)?'<p>'+text('capturedRecords',{count:job.progress.recordsCaptured})+'</p>':''}${job.progress.total&&job.state==='running'?`<progress aria-label="${text('outputRetained')}" max="${job.progress.total}" value="${job.progress.done}"></progress>`:''}<div class="inline-actions">${actions(job)}</div></section>`).join(''):`<p>${text('empty')}</p>`;
  if(focusedAction&&focusedId)container.querySelector(`[data-action="${focusedAction}"][data-id="${focusedId}"]`)?.focus();
  if(id&&response.job.state==='completed'){await openReview(response.job.result.id,token);return;}
  if(jobs.some(({job})=>['queued','running'].includes(job.state)))timer=setTimeout(()=>poll(token,id).catch(error=>{if(active(token))notify(error.message,true);}),750);
 }
 async function start(data){
  const token=begin('preparing');
  pendingRequest=structuredClone({...data,commandId:data.commandId??crypto.randomUUID()});
  await submit(token);
 }
 async function submit(token){
  if(!active(token)||!pendingRequest)return;
  const attempt=++submission,current=()=>active(token)&&attempt===submission;
  try{const {job}=await call('start',pendingRequest);if(current()){pendingRequest=null;await poll(token,job.id);}}
  catch(error){if(current()){
   // A disconnected acknowledgement does not mean admission failed. Retain
   // this exact request ID until its durable receipt can be recovered.
   const id=pendingRequest?.commandId;
   document.getElementById('publication-jobs-status').innerHTML='<p role="alert">'+esc(error.message)+'</p>'+(id?'<p>'+text('requestUncertain')+'</p>'+button('resumeRequest','resume-request'):button('refresh','list'));
   // Recovery may wait on storage or the network. Show the failure and keep
   // its exact retry available immediately; an older lookup cannot undo it.
   if(id)try{const response=await call('status',{id});if(current()&&response.job){pendingRequest=null;await poll(token,id);return;}}catch{/* Keep the explicit retry available. */}
  }}
 }
 async function list(){await poll(begin('preparations'));}
 const read=id=>call('open',{id});
 async function diagnostics(id){
  const token=begin('privateDiagnostics'),{diagnostic}=await call('diagnostics',{id});if(!active(token))return;
  document.getElementById('publication-jobs-status').innerHTML='<p>'+text('diagnosticsPrivate')+'</p><pre class="job-diagnostics">'+esc(JSON.stringify(diagnostic,null,2))+'</pre>';
 }
 async function openReview(id,token){const preview=await read(id);if(!active(token))return;stop();document.getElementById('dialog').close();showReview(preview);}
 async function action(el){
  const action=el.dataset.action;if(!action?.startsWith('publication-jobs-'))return false;
  const op=action.slice('publication-jobs-'.length),id=el.dataset.id;
  if(op==='list'){await list();return true;}
  if(op==='close'){stop();document.getElementById('dialog').close();return true;}
  if(context!==websiteContext(state))throw Error(publicationText('workspaceChanged'));
  if(op==='diagnostics'){
   await diagnostics(id);return true;
  }
  if(op==='resume-request'){await submit(generation);return true;}
  if(op==='open-review'){stop();await openReview(id,generation);return true;}
  if(op==='next'&&next){previous.push(cursor);cursor=next;}
  if(op==='previous'&&previous.length)cursor=previous.pop();
  if(['next','previous','cancel','retry'].includes(op)){
   stop();const token=generation;
   if(['cancel','retry'].includes(op))await call(op,{id});
   if(active(token))await poll(token);
  }
  return true;
 }
 return {start,read,action};
}
