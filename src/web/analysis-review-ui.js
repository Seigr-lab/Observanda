import {analysisText as a} from './analysis-messages.js';
const count=preview=>preview.researchReview?.analysis?.count??preview.researchReview?.analysis?.items?.length??0;
const windowOf=preview=>preview.analysisReviewWindow??preview.analysisReview?.window;
const request=preview=>({id:preview.id,...(preview.rollback?{rollbackReview:preview.rollback.id}:{})});
export function analysisEditionReviewView(p,{esc,field}){
 const total=count(p);if(!total)return '';const page=windowOf(p),rows=page?.items??p.researchReview?.analysis?.items??[],offset=page?.offset??0;
 const rowView=(r,i)=>'<fieldset><legend>'+esc(r.recordTitle||p.entries?.find(e=>e.id===r.recordId)?.title||a('results'))+' ? '+esc(r.label||String(offset+i+1))+'</legend><p>'+esc(a('changed'))+'</p><details><summary>'+esc(a('changedSources',{count:r.changed}))+'</summary><ul>'+r.sample.map(s=>'<li>'+esc(s.label??s.id)+'<p>'+esc(a('retainedRevision'))+': <code>'+esc(s.revision)+'</code></p><p>'+esc(a('currentRevision'))+': <code>'+esc(s.current??a('unavailableCategory'))+'</code></p></li>').join('')+'</ul>'+(r.changed>r.sample.length?'<p>'+esc(a('changedSample'))+'</p>':'')+'</details>'+field(esc(a('disposition')),`<textarea data-analysis-decision="${r.id}" maxlength="4000">${esc(r.decision?.reason??p.analysisReview?.decisions?.find(d=>d.id===r.id)?.reason??'')}</textarea>`)+'</fieldset>';
 const previous=page&&offset>0?'<button type="button" class="button subtle" data-action="analysis-review-previous" data-offset="'+Math.max(0,offset-4)+'">'+esc(a('reviewPrevious'))+'</button>':'',next=page?.next!==null&&page?'<button type="button" class="button subtle" data-action="analysis-review-next" data-offset="'+(offset+rows.length)+'">'+esc(a('reviewNext'))+'</button>':'';
 return '<section class="panel"><h2>'+esc(a('reviewHeading'))+'</h2><p>'+esc(a('reviewHelp'))+'</p>'+rows.map(rowView).join('')+(rows.length?'<button type="button" class="button" data-action="analysis-review-save">'+esc(a('reviewSave'))+'</button>':'<button type="button" class="button" data-action="analysis-review-next" data-offset="0">'+esc(a('reviewLoad'))+'</button>')+previous+next+(page?'<p role="status">'+esc(a('reviewProgress',{decided:p.analysisReview?.decided??page.decided,total}))+'</p>':'')+(p.analysisReview?.reviewed?'<p role="status">'+esc(a('reviewSaved'))+'</p>':'')+'</section>';
}
export async function saveAnalysisEditionReview(state,api){
 const decisions=[...document.querySelectorAll('[data-analysis-decision]')].map(el=>({id:el.dataset.analysisDecision,reason:el.value})),preview=state.preview,result=await api('/api/publication-jobs/analysis-review',{...request(preview),decisions},{adopt:false,websitePin:preview.websitePin});
 if(state.preview===preview){const page=windowOf(preview);preview.analysisReview=result;if(page)preview.analysisReviewWindow={...page,reviewed:result.reviewed,decided:result.decided,items:page.items.map(item=>({...item,decision:result.decisions.find(value=>value.id===item.id)??item.decision}))};}
}
export async function loadAnalysisEditionReview(state,api,{offset=0,cursor=null}={}){
 const preview=state.preview,page=windowOf(preview),fields=[...document.querySelectorAll('[data-analysis-decision]')],dirty=fields.some(field=>field.value!==(page?.items.find(item=>item.id===field.dataset.analysisDecision)?.decision?.reason??preview.analysisReview?.decisions?.find(item=>item.id===field.dataset.analysisDecision)?.reason??''));
 if(dirty)await saveAnalysisEditionReview(state,api);if(state.preview!==preview)return;
 const result=await api('/api/publication-jobs/analysis-review-window',{...request(preview),offset,cursor,limit:4},{adopt:false,websitePin:preview.websitePin});
 if(state.preview===preview){preview.analysisReviewWindow=result;preview.analysisReview={...preview.analysisReview,reviewed:result.reviewed,decided:result.decided,total:result.total};}
}
export function requireAnalysisEditionReview(preview){if(count(preview)&&!preview.analysisReview?.reviewed)throw Error(a('reviewRequired'));}
