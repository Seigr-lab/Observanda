import {websiteContext} from './website-context.js';
import {publicationText} from './publication-review.js';

export function publicationJobsUI({state,api,esc,showDialog,notify,showReview}){
 const call=(op,data={})=>api('/api/publication-jobs/'+op,data,{adopt:false});
 const text=(key,values)=>esc(publicationText(key,values));
 let generation=0,timer=null,context=null,route=null,cursor=null,next=null,previous=[];
 const stop=()=>{generation++;clearTimeout(timer);};
 const button=(key,action,id='')=>`<button type="button" class="button" data-action="publication-jobs-${action}" data-id="${esc(id)}">${text(key)}</button>`;
 const active=token=>token===generation&&context===websiteContext(state)&&route===location.hash&&document.querySelector('#dialog[open] #publication-jobs-status');
 const status=job=>job.message??(job.cancelRequested&&job.state==='running'?publicationText('stopping'):job.state==='running'?job.progress.stage:job.state);
 const actions=job=>job.state==='relocated'?'':job.state==='completed'?button('openReview','open-review',job.result.id):['failed','cancelled'].includes(job.state)?button('retry','retry',job.id):job.cancelRequested?'':button('cancel','cancel',job.id);
 function dialog(title){showDialog(`<section class="job-library"><h2 id="dialog-title">${text(title)}</h2><p>${text('preparationGuidance')}</p><div id="publication-jobs-pages" class="inline-actions" aria-label="${text('preparationPages')}" hidden>${button('newer','previous')}<span role="status">${text('page',{number:1})}</span>${button('older','next')}</div><div id="publication-jobs-status" class="job-library-items" tabindex="0" aria-label="${text('editions')}" aria-live="polite">${text('loading')}</div><div class="dialog-actions">${button('refresh','list')}${button('continue','close')}</div></section>`);}
 function begin(title){stop();cursor=null;next=null;previous=[];context=websiteContext(state);route=location.hash;dialog(title);return generation;}
 async function poll(token,id=null){
  const response=await call(id?'status':'list',id?{id}:{cursor});if(!active(token))return;
  const jobs=id?[{job:response.job,createdAt:response.job.createdAt}]:response.items;
  const pager=document.getElementById('publication-jobs-pages');pager.hidden=!!id;
  if(!id){next=response.next;pager.querySelector('[data-action="publication-jobs-previous"]').disabled=!previous.length;pager.querySelector('[data-action="publication-jobs-next"]').disabled=!next;pager.querySelector('span').textContent=publicationText('page',{number:previous.length+1});}
  const container=document.getElementById('publication-jobs-status'),focused=document.activeElement,focusedAction=focused?.dataset.action,focusedId=focused?.dataset.id;
  container.innerHTML=jobs.length?jobs.map(({job,createdAt})=>`<section class="panel"><h3>${text('edition',{date:new Date(createdAt).toLocaleString()})}</h3><p>${esc(status(job))}</p>${job.progress.total&&job.state==='running'?`<progress aria-label="${text('outputRetained')}" max="${job.progress.total}" value="${job.progress.done}"></progress>`:''}<div class="inline-actions">${actions(job)}</div></section>`).join(''):`<p>${text('empty')}</p>`;
  if(focusedAction&&focusedId)container.querySelector(`[data-action="${focusedAction}"][data-id="${focusedId}"]`)?.focus();
  if(id&&response.job.state==='completed'){await openReview(response.job.result.id,token);return;}
  if(jobs.some(({job})=>['queued','running'].includes(job.state)))timer=setTimeout(()=>poll(token,id).catch(error=>{if(active(token))notify(error.message,true);}),750);
 }
 async function start(data){
  const token=begin('preparing');
  try{const {job}=await call('start',data);if(active(token))await poll(token,job.id);}
  catch(error){if(active(token)){stop();document.getElementById('dialog').close();throw error;}}
 }
 async function list(){await poll(begin('preparations'));}
 const read=id=>call('open',{id});
 async function openReview(id,token){const preview=await read(id);if(!active(token))return;stop();document.getElementById('dialog').close();showReview(preview);}
 async function action(el){
  const action=el.dataset.action;if(!action?.startsWith('publication-jobs-'))return false;
  const op=action.slice('publication-jobs-'.length),id=el.dataset.id;
  if(op==='list'){await list();return true;}
  if(op==='close'){stop();document.getElementById('dialog').close();return true;}
  if(context!==websiteContext(state))throw Error(publicationText('workspaceChanged'));
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
