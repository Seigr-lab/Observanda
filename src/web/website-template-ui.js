import {t} from './i18n/index.js';
const text=(key,args)=>t('websiteEditor',key,args);

// A review is pinned to the current draft. Opening it never applies an upstream change.
export function websiteTemplateUI({state,documents,esc,field,scopeTarget,changed,render,notify,contextKey=scopeTarget}){
 let review=null,stamp=null,decisions={},busy=false,controller=null,epoch=0,origin=null;
 const enabled=()=>Boolean(documents?.enabled());
 const button=(name,label,extra='')=>'<button type="button" class="button" data-action="website-template-'+name+'" '+extra+(busy?' disabled':'')+'>'+esc(text(label))+'</button>';
 function reset(){controller?.abort();controller=null;epoch++;review=null;stamp=null;decisions={};busy=false;origin=null;}
 function sync(){if(origin!==null&&(origin!==contextKey()||review&&stamp!==documents.snapshot()))reset();}
 function targetValue(target){if(target==='home')return state.book.website.home;if(target?.startsWith('page:'))return state.book.pages.find(page=>page.id===target.slice(5));if(target?.startsWith('template:'))return state.book.website.templates.find(item=>item.id===target.slice(9));return state.book.website.layouts.find(item=>item.target===target);}
 function binding(target){const link=targetValue(target)?.templateLink;return link?state.book.website.templates.find(item=>item.id===link.templateId):null;}
 function controls(target,label){const parent=binding(target);return parent?'<div class="template-binding"><p>'+esc(text(label,{name:parent.name}))+'</p><div class="inline-actions">'+button('review','templateReview','data-target="'+esc(target)+'"')+button('detach','templateDetach','data-target="'+esc(target)+'"')+'</div></div>':'';}
 function display(value){if(value===null||value===undefined)return text('templateAbsent');return typeof value==='string'?value:JSON.stringify(value,null,2);}
 function reviewView(){
  if(!review)return '';
  const conflicts=review.conflicts??[],counts=new Map();for(const change of review.changes??[])counts.set(change.kind,(counts.get(change.kind)??0)+1);
  return '<section class="template-review" aria-label="'+esc(text('templateReview'))+'"><h3>'+esc(text('templateReviewTitle',{name:review.templateName}))+'</h3><p>'+esc(text(review.changed?'templateReviewHelp':'templateUnchanged'))+'</p>'+
   (counts.size?'<ul>'+[...counts].map(([kind,count])=>'<li>'+esc(text('templateChange_'+kind,{count}))+'</li>').join('')+'</ul>':'')+
   conflicts.map((conflict,index)=>'<fieldset><legend>'+esc(text('templateConflict',{number:index+1,field:Array.isArray(conflict.path)?conflict.path.join(' / '):(conflict.path||conflict.kind)}))+'</legend><details><summary>'+esc(text('templateCompare'))+'</summary><h4>'+esc(text('templateOriginal'))+'</h4><pre style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:18rem;overflow:auto">'+esc(display(conflict.base))+'</pre><h4>'+esc(text('templateLocal'))+'</h4><pre style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:18rem;overflow:auto">'+esc(display(conflict.local))+'</pre><h4>'+esc(text('templateIncoming'))+'</h4><pre style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:18rem;overflow:auto">'+esc(display(conflict.incoming))+'</pre></details>'+field(text('templateDecision'),'<select data-template-conflict="'+esc(conflict.id)+'"><option value="">'+esc(text('templateChoose'))+'</option><option value="local"'+(decisions[conflict.id]==='local'?' selected':'')+'>'+esc(text('templateLocal'))+'</option><option value="template"'+(decisions[conflict.id]==='template'?' selected':'')+'>'+esc(text('templateIncoming'))+'</option></select>')+'</fieldset>').join('')+
   (review.changed&&!conflicts.length?'<p>'+esc(text('templateNoConflicts'))+'</p>':'')+
   '<div class="inline-actions">'+(review.changed?button('accept','templateAccept',!review.ready||conflicts.some(item=>!decisions[item.id])?'disabled':''):'')+button('keep','templateKeep')+'</div></section>';
 }
 function view(selected){if(!enabled())return '';sync();return controls(scopeTarget(),'templatePageLinked')+(selected?.templateLink?controls('template:'+selected.id,'templateLayoutLinked'):'')+(busy?'<p role="status">'+esc(text('templateBusy'))+'</p>':'')+reviewView();}
 async function loadReview(target){
  reset();origin=contextKey();const request=epoch,control=controller=new AbortController();busy=true;render();
  try{const result=await documents.templateReview(target,{signal:control.signal});sync();if(request!==epoch||control.signal.aborted)return;review=result;stamp=documents.snapshot();if(!result.linked){review=null;notify(text('templateNotLinked'));}}
  finally{if(request===epoch){busy=false;controller=null;render();}}
 }
 async function resolve(){
  if(!review||busy)return;
  const request=++epoch,target=review.target,previous=stamp,control=controller=new AbortController();busy=true;render();
  try{const result=await documents.templateReview(target,{decisions:{...decisions},signal:control.signal});sync();if(request!==epoch||control.signal.aborted)return;if(previous!==documents.snapshot()){reset();return;}review=result;stamp=documents.snapshot();decisions=Object.fromEntries(result.conflicts.filter(item=>item.decision).map(item=>[item.id,item.decision]));}
  catch(reason){if(request===epoch&&!control.signal.aborted){review=null;notify(reason.message,true);}}
  finally{if(request===epoch){busy=false;controller=null;render();}}
 }
 async function perform(operation){reset();origin=contextKey();const request=epoch;busy=true;render();try{await documents.perform(Array.isArray(operation)?operation:[operation]);if(request===epoch&&origin===contextKey())changed(true);}finally{if(request===epoch){busy=false;render();}}}
 async function action(buttonEl){const name=buttonEl.dataset.action;if(!name?.startsWith('website-template-'))return false;if(!enabled()||busy)return true;sync();
  if(name==='website-template-review')await loadReview(buttonEl.dataset.target);
  else if(name==='website-template-detach')await perform({type:'template-detach',target:buttonEl.dataset.target});
  else if(name==='website-template-keep'){reset();render();}
  else if(name==='website-template-accept'){if(!review||!review.ready||stamp!==documents.snapshot()||(review.conflicts??[]).some(item=>!decisions[item.id]))return true;await perform({type:'template-accept',target:review.target,token:review.token,decisions:{...decisions}});}
  return true;
 }
 function input(el){if(!el.hasAttribute('data-template-conflict'))return false;sync();if(review&&!busy&&review.conflicts.some(item=>item.id===el.dataset.templateConflict)){if(['local','template'].includes(el.value))decisions[el.dataset.templateConflict]=el.value;else delete decisions[el.dataset.templateConflict];void resolve();}return true;}
 return {view,input,action,reset,perform,isBusy:()=>busy};
}
