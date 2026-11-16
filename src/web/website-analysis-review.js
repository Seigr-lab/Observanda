import {t} from './i18n/index.js';

// Before publishing an editor website, its placed research is checked for
// analyses whose inputs changed, or figures redrawn away from their
// calculation, since the record was placed. Changes need the person's review;
// a check that cannot run is reported but never stops publishing, which works
// from the website's own files.
export function websiteAnalysisReview({api,esc,site,render,onChange=()=>{}}){
 const text=(key,args)=>esc(t('websiteFiles',key,args));
 let state=null;
 const pin=()=>{const opened=site();return opened?{siteId:opened.site.id,revision:opened.site.revision}:null;};
 const current=()=>{const scope=pin();return Boolean(state&&scope&&state.scope.siteId===scope.siteId&&state.scope.revision===scope.revision);};
 async function check({paint=true}={}){
  const scope=pin();if(!scope)return;
  const mine={scope,status:'checking'};state=mine;if(paint)render();
  try{
   const result=await api('/api/website-analysis/check',{siteId:scope.siteId,expectedRevision:scope.revision},{owner:null,adopt:false});
   // An answer of any other shape counts as a check that could not run.
   if(!result||!Array.isArray(result.items)||!Number.isSafeInteger(result.total)||!Number.isSafeInteger(result.records))throw Error('');
   if(state===mine){state={scope,status:'done',result,acknowledged:false};render();}
  }catch(error){if(state===mine){state={scope,status:'failed',message:error?.message??''};render();}}
 }
 // Started while a review is drawn, so the first state is drawn by that same render.
 function ensure(){if(!current())void check({paint:false});}
 function ready(){
  if(!current())return false;
  if(state.status==='failed')return true;
  return state.status==='done'&&(!state.result.items.length||state.acknowledged);
 }
 function item(row){
  const changes=row.sample.map(input=>input.label).filter(Boolean).join(', ');
  const reason=row.reason==='edited'?text('analysisFigureEdited'):text('analysisInputsChanged',{count:row.changed});
  return '<li><strong>'+esc(row.label||row.recordTitle)+'</strong> · '+esc(row.recordTitle)+'<br>'+reason+(changes?' ('+esc(changes)+')':'')+'</li>';
 }
 function view(){
  ensure();
  const again='<button type="button" class="button" data-action="website-files-analysis-check">'+text('analysisCheckAgain')+'</button>';
  let body;
  if(!state||state.status==='checking')body='<p role="status">'+text('analysisChecking')+'</p>';
  else if(state.status==='failed')body='<p role="note">'+text('analysisUnavailable')+'</p>'+(state.message?'<p class="muted">'+esc(state.message)+'</p>':'')+again;
  else if(!state.result.items.length)body='<p role="status">'+text(state.result.records?'analysisCurrent':'analysisNone')+'</p>';
  else body='<p role="alert">'+text('analysisChanged',{count:state.result.total})+'</p><ul class="website-analysis-items">'+state.result.items.map(item).join('')+'</ul>'+
   (state.result.truncated?'<p class="muted">'+text('analysisMore',{count:state.result.total-state.result.items.length})+'</p>':'')+
   '<p class="muted">'+text('analysisGuidance')+'</p><label><input type="checkbox" data-website-analysis-acknowledge '+(state.acknowledged?'checked':'')+'>'+text('analysisAcknowledge')+'</label>'+again;
  return '<section class="website-analysis-review" data-website-analysis-review><h4>'+text('analysisTitle')+'</h4>'+body+'</section>';
 }
 function input(element){
  if(!element.matches('[data-website-analysis-acknowledge]'))return false;
  if(current()&&state.status==='done')state.acknowledged=element.checked;
  onChange();return true;
 }
 return {view,ready,input,check,reset:()=>{state=null;}};
}
