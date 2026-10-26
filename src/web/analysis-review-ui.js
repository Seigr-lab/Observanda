import {analysisText as a} from './analysis-messages.js';
import {websiteContext} from './website-context.js';
const count=preview=>preview.researchReview?.analysis?.count??preview.researchReview?.analysis?.items?.length??0;
const windowOf=preview=>preview.analysisReviewWindow??preview.analysisReview?.window;
const request=preview=>({id:preview.id,...(preview.rollback?{rollbackReview:preview.rollback.id}:{})});
const decisionReason=(preview,row)=>preview.analysisReviewPending?.decisions.find(item=>item.id===row.id)?.reason??(!['completed','relocated'].includes(preview.analysisReviewOperation?.state)?preview.analysisReviewOperation?.decisions?.find(item=>item.id===row.id)?.reason:undefined)??row.decision?.reason??preview.analysisReview?.decisions?.find(item=>item.id===row.id)?.reason??'';
const pause=()=>new Promise(resolve=>setTimeout(resolve,500));
function operationStatus(text){const element=document.querySelector('[data-analysis-review-operation]');if(element)element.textContent=text;}
export function analysisEditionReviewView(p,{esc,field}){
 const total=count(p);if(!total)return '';const page=windowOf(p),rows=page?.items??p.researchReview?.analysis?.items??[],offset=page?.offset??0;
 const rowView=(r,i)=>'<fieldset><legend>'+esc(r.recordTitle||p.entries?.find(e=>e.id===r.recordId)?.title||a('results'))+' ? '+esc(r.label||String(offset+i+1))+'</legend><p>'+esc(a('changed'))+'</p><details><summary>'+esc(a('changedSources',{count:r.changed}))+'</summary><ul>'+r.sample.map(s=>'<li>'+esc(s.label??s.id)+'<p>'+esc(a('retainedRevision'))+': <code>'+esc(s.revision)+'</code></p><p>'+esc(a('currentRevision'))+': <code>'+esc(s.current??a('unavailableCategory'))+'</code></p></li>').join('')+'</ul>'+(r.changed>r.sample.length?'<p>'+esc(a('changedSample'))+'</p>':'')+'</details>'+field(esc(a('disposition')),`<textarea data-analysis-decision="${r.id}" maxlength="4000">${esc(decisionReason(p,r))}</textarea>`)+'</fieldset>';
 const previous=page&&offset>0?'<button type="button" class="button subtle" data-action="analysis-review-previous" data-offset="'+Math.max(0,offset-4)+'">'+esc(a('reviewPrevious'))+'</button>':'',next=page?.next!==null&&page?'<button type="button" class="button subtle" data-action="analysis-review-next" data-offset="'+(offset+rows.length)+'">'+esc(a('reviewNext'))+'</button>':'';
 return '<section class="panel"><h2>'+esc(a('reviewHeading'))+'</h2><p>'+esc(a('reviewHelp'))+'</p>'+rows.map(rowView).join('')+(rows.length?'<button type="button" class="button" data-action="analysis-review-save">'+esc(a('reviewSave'))+'</button>':'<button type="button" class="button" data-action="analysis-review-next" data-offset="0">'+esc(a('reviewLoad'))+'</button>')+previous+next+'<p role="status" data-analysis-review-operation>'+esc(p.analysisReviewOperation&&!['completed','failed','cancelled'].includes(p.analysisReviewOperation.state)?a('reviewSaving'):'')+'</p>'+(page?'<p role="status">'+esc(a('reviewProgress',{decided:p.analysisReview?.decided??page.decided,total}))+'</p>':'')+(p.analysisReview?.reviewed?'<p role="status">'+esc(a('reviewSaved'))+'</p>':'')+'</section>';
}
export async function saveAnalysisEditionReview(state,api){
 const decisions=[...document.querySelectorAll('[data-analysis-decision]')].map(el=>({id:el.dataset.analysisDecision,reason:el.value})),preview=state.preview,call=(operation,data)=>api('/api/publication-jobs/'+operation,data,{adopt:false,websitePin:preview.websitePin});
 const context=websiteContext(state),pageName=state.page,route=location.hash,active=()=>state.preview===preview&&state.page===pageName&&websiteContext(state)===context&&location.hash===route;
 let result;
 const awaitReceipt=async job=>{
  while(active()){
   preview.analysisReviewOperation={...job,decisions:job.decisions??preview.analysisReviewOperation?.decisions??preview.analysisReviewPending?.decisions};
   if(job.state==='completed')return job.result;
   if(['failed','cancelled','relocated'].includes(job.state))throw Error(job.message||a('reviewSaveFailed'));
   operationStatus(a('reviewSaving'));await pause();if(!active())return null;
   ({job}=await call('analysis-review-status',{id:job.id}));
  }
  return null;
 };
 if(!preview.analysisReviewPending&&['failed','cancelled'].includes(preview.analysisReviewOperation?.state)&&preview.analysisReviewOperation.decisions)preview.analysisReviewPending={...request(preview),commandId:preview.analysisReviewOperation.id,decisions:structuredClone(preview.analysisReviewOperation.decisions)};
 try{
  if(preview.analysisReviewPending){
   const pending=preview.analysisReviewPending,response=await call('analysis-review',pending);
   if(response.job&&['failed','cancelled'].includes(response.job.state)&&preview.analysisReviewOperation?.id===response.job.id)response.job=(await call('analysis-review-retry',{id:response.job.id})).job;
   result=response.job?await awaitReceipt(response.job):response;
   if(!active())return;delete preview.analysisReviewPending;
   if(JSON.stringify(pending.decisions)!==JSON.stringify(decisions))result=null;
  }else if(preview.analysisReviewOperation&&!['completed','failed','cancelled','relocated'].includes(preview.analysisReviewOperation.state)){
   const completed=await awaitReceipt(preview.analysisReviewOperation);if(!active())return;
   if(completed&&decisions.every(value=>completed.decisions.some(saved=>saved.id===value.id&&saved.reason===value.reason)))result=completed;
  }
  if(!result){const command={...request(preview),commandId:crypto.randomUUID(),decisions};preview.analysisReviewPending=command;operationStatus(a('reviewSaving'));const response=await call('analysis-review',command);result=response.job?await awaitReceipt(response.job):response;if(!active())return;delete preview.analysisReviewPending;}
 }catch(error){if(active())operationStatus(a(['failed','cancelled','relocated'].includes(preview.analysisReviewOperation?.state)?'reviewSaveFailed':'reviewSaveUncertain'));throw error;}
 if(!result)return;
 if(active()){const page=windowOf(preview);preview.analysisReview=result;if(page)preview.analysisReviewWindow={...page,reviewed:result.reviewed,decided:result.decided,items:page.items.map(item=>({...item,decision:result.decisions.find(value=>value.id===item.id)??item.decision}))};}
}
export async function loadAnalysisEditionReview(state,api,{offset=0,cursor=null}={}){
 const preview=state.preview,page=windowOf(preview),fields=[...document.querySelectorAll('[data-analysis-decision]')],dirty=fields.some(field=>field.value!==(page?.items.find(item=>item.id===field.dataset.analysisDecision)?.decision?.reason??preview.analysisReview?.decisions?.find(item=>item.id===field.dataset.analysisDecision)?.reason??''));
 if(dirty)await saveAnalysisEditionReview(state,api);if(state.preview!==preview)return;
 const result=await api('/api/publication-jobs/analysis-review-window',{...request(preview),offset,cursor,limit:4},{adopt:false,websitePin:preview.websitePin});
 if(state.preview===preview){preview.analysisReviewWindow=result;preview.analysisReview={...preview.analysisReview,reviewed:result.reviewed,decided:result.decided,total:result.total};}
}
export function requireAnalysisEditionReview(preview){if(count(preview)&&!preview.analysisReview?.reviewed)throw Error(a('reviewRequired'));}
