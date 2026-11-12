import './i18n/catalogues/sampleAnalysis.js';
import {sampleNumericFields,readSampleResult,updateSampleNumericFields} from './sample-result-entry.js';
import {displaySampleScalar} from './sample-result-format.js';
import {sampleInterval} from './sample-result-numerics.js';
import {sampleSourceFields,bindSampleSources} from './sample-result-sources-ui.js';
import {researchContext,ownedAssetURL} from './project-context.js';
import {t,language as appLanguage} from './i18n/index.js';
import {sampleAnalysisPages} from './sample-analysis-pages.js';
import {revisionId} from './revision-model.js';
import {sampleAnalysisAction} from './sample-analysis-labels.js';
import {sampleRunInputsUI} from './sample-run-inputs-ui.js';
import {qualityText,retainedQualityText} from './modules/resource-quality-presentation.js';
const tr=(key,values)=>t('sampleAnalysis',key,values);
export function laboratoryUI({state,api,esc,field,option,showDialog,render,notify}){
 const scope=()=>researchContext(state);let owner=scope(),selected=null,sampleChoice=null,opening=0,selectionController=null,timer=null,pending=null;
 const label=status=>tr({'draft':'statusDraft','in review':'statusReview','approved':'statusApproved','rejected':'statusRejected','archived':'statusArchived'}[status]);
 const flag=result=>{const {flag}=sampleInterval(result);return flag&&flag!=='noInterval'?tr(flag):'';};
 const reading=value=>displaySampleScalar(value,tr);
 const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
 const button=(key,action,attrs='')=>`<button type="button" class="button" data-action="${action}" ${attrs}>${esc(tr(key))}</button>`;
 const main=sampleAnalysisPages({api,context:scope,onChange:()=>{if(state.page==='laboratory'&&owner===scope())draw();}});
 const samples=sampleAnalysisPages({api,context:scope,onChange:()=>updateDialog('samples')}),history=sampleAnalysisPages({api,context:scope,onChange:()=>updateDialog('history')}),related=sampleAnalysisPages({api,context:scope,onChange:()=>updateDialog('related')});
 const lanes={main,samples,history,related},runInputs=sampleRunInputsUI({state,api,esc,field,option});
 // Readiness the server recorded when the run's analysis was created.
 const runQualityView=quality=>quality?`<section data-lab-run-quality><h3>${esc(qualityText('runRecorded'))}</h3><ul>${quality.items.map(item=>`<li>${esc(retainedQualityText(item.readiness))}${item.kind==='movement'?`<br>${esc(qualityText('stockUse')+': '+item.delta+' '+item.unit+' · '+retainedQualityText(item.stockUse))}${item.status==='hold'?`<br>${esc(qualityText('heldAtRun'))}`:''}`:''}</li>`).join('')}</ul></section>`:'';
 function draw(){const active=document.activeElement,id=active?.id,start=active?.selectionStart;render();if(id){const next=document.getElementById(id);next?.focus();if(start!==null&&start!==undefined&&next?.setSelectionRange)next.setSelectionRange(start,start);}}
 function request(view,extra={}){return {workspaceId:state.book.id,view,limit:25,...extra};}
 async function load(){return main.load(request(state.labTab??'samples',{search:state.labSearch??''}));}
 function pager(name){const lane=lanes[name],p=lane.page;return `<div class="section-bar" aria-busy="${lane.loading}">${lane.error?`<p role="alert">${esc(lane.error.message)}</p>${button('retry','lab-retry',`data-lane="${name}"`)}`:''}${lane.loading?`<p role="status">${esc(tr('loading'))}</p>`:''}${p?`<span>${esc(tr('range',{first:p.total?p.offset+1:0,last:p.offset+p.items.length,total:p.total}))}</span>${['previous','next'].map(direction=>button(direction,'lab-page',`data-lane="${name}" data-direction="${direction}" ${lane.loading||!p[direction+'Cursor']?'disabled':''}`)).join('')}`:''}</div>`;}
 function view(){
  const page=main.page,tab=state.labTab??'samples',counts=page?.counts??{};
  const rows=page?.view===tab?page.items:[],columns=tab==='samples'?['sampleCode','material','source','collected','received','analyses']:['analysis','sample','analyteMethod','result','flag','status'];
  return `<div class="page-heading"><div><p><button type="button" class="text-button" data-action="module-open" data-module-id="laboratory">${esc(tr('projects'))}</button></p><h1>${esc(tr('title'))}</h1><p class="subtitle">${esc(tr('subtitle'))}</p></div>${button('register','lab-new-sample',page?'':'disabled')}</div><div class="workspace-tabs">${['samples','analyses','review','archive'].map(id=>`<button class="button ${id===tab?'primary':''}" data-action="lab-tab" data-tab="${id}">${esc(tr(id))} <span>${counts[id]??''}</span></button>`).join('')}</div><div class="section-bar"><input id="lab-search" class="search-input" type="search" aria-label="${esc(tr('search'))}" placeholder="${esc(tr('searchPlaceholder'))}" value="${esc(state.labSearch??'')}">${button('refresh','lab-refresh')}${button('recordAnalysis','lab-new-analysis',counts.samples?'':'disabled')}</div>${pager('main')}<div class="table-scroll"><table class="records-table"><thead><tr>${columns.map(key=>`<th>${esc(tr(key))}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>tab==='samples'?`<tr><td><button class="text-button" data-action="lab-sample" data-id="${r.id}">${esc(r.code)}</button></td><td>${esc(r.material)}</td><td>${esc(r.source)}</td><td>${r.collectedOn}</td><td>${r.receivedOn}</td><td>${r.analyses}</td></tr>`:`<tr><td><button class="text-button" data-action="lab-open" data-id="${r.id}">${esc(r.code)}</button></td><td>${esc(r.sampleCode)}</td><td>${esc(r.result.analyte)}<small>${esc(r.result.method)}</small></td><td>${esc(reading(r.result.value))} ${esc(r.result.unit)}</td><td>${esc(flag(r.result))}</td><td>${esc(label(r.status))}</td></tr>`).join('')}</tbody></table></div>${page&&!rows.length?`<p class="empty-inline">${esc(tr('empty'))}</p>`:''}<p class="source-note">${esc(tr('private'))}</p>`;
 }
 function resultFields(r={}){
  const input=(key,attrs='')=>`<input name="${key}" ${attrs} value="${esc(r[key]??'')}">`;
  return `<div class="form-grid">${field(esc(tr('method')),input('method','required maxlength="160"'))}${field(esc(tr('analyte')),input('analyte','required maxlength="160"'))}${field(esc(tr('resultType')),`<select name="kind">${option('numeric',tr('numeric'),r.kind??'numeric')}${option('text',tr('text'),r.kind??'numeric')}</select>`)}${sampleNumericFields(r,{esc,field,option,tr})}${field(esc(tr('unit')),input('unit','maxlength="80"'))}</div>${field(esc(tr('notes')),`<textarea name="notes" maxlength="2000" rows="3">${esc(r.notes??'')}</textarea>` )}${sampleSourceFields(r.provenance,{esc,tr,editable:true})}`;
 }
 function bindSources(){const form=document.querySelector('#dialog form');if(form?.querySelector('[data-lab-sources]'))bindSampleSources(form,{state,api,esc,field,tr,scope});}
 function form(title,id,body,save,attrs=''){showDialog(`<form id="${id}" data-etag="${main.page?.etag??''}" ${attrs}><h2 id="dialog-title">${esc(title)}</h2>${body}<div class="dialog-actions">${button('cancel','close-dialog')}<button class="button primary">${esc(tr(save))}</button></div></form>`);bindSources();}
 async function readSelected(id,kind,etag=main.page?.etag??null){
  selectionController?.abort();selectionController=new AbortController();const n=++opening,context=scope();
  const value=await api('/api/laboratory/read/selected',{workspaceId:state.book.id,id,kind,etag},{adopt:false,signal:selectionController.signal});
  if(n!==opening||context!==scope())return null;
  if(value?.workspaceId!==state.book.id||value.record?.id!==id||!revisionId(value.revision)||!revisionId(value.etag)||kind==='analysis'&&value.sample?.id!==value.record.sampleId)throw Error(tr('unavailable'));
  return value;
 }
 function updateDialog(name){
  if(owner!==scope())return;const node=document.querySelector(`[data-lab-surface="${name}"]`);if(!node)return;
  const active=document.activeElement,action=active?.dataset.action,direction=active?.dataset.direction;
  if(name==='samples'){
   const choices=[...(samples.page?.items??[])];if(sampleChoice&&!choices.some(s=>s.id===sampleChoice.id))choices.unshift(sampleChoice);
   node.innerHTML=field(esc(tr('sample')),`<select name="sampleId" required>${choices.map(s=>option(s.id,s.code,sampleChoice?.id)).join('')}</select>`)+pager(name);
  }else if(name==='history')node.innerHTML=pager(name)+(history.page?.items??[]).map(e=>`<p><time>${esc(e.at)}</time> &middot; ${esc(sampleAnalysisAction(e.action))}${e.actor?' / '+esc(e.actor):''}${e.reason?'<br>'+esc(e.reason):''}</p>`).join('');
  else node.innerHTML=pager(name)+(related.page?.items??[]).map(a=>`<p><button class="button" data-action="lab-open" data-id="${a.id}">${esc(a.code)} / ${esc(a.result.analyte)} / ${esc(label(a.status))}</button></p>`).join('');
  if(action)node.querySelector(`[data-action="${action}"]${direction?`[data-direction="${direction}"]`:''}:not(:disabled)`)?.focus();
 }
 async function openAnalysis(id,etag){
  const value=await readSelected(id,'analysis',etag);if(!value)return;selected=value;history.clear();const a=value.record,s=value.sample,editable=a.status==='draft';
  showDialog(`<form id="lab-result-form" data-id="${id}"><h2 id="dialog-title">${esc(a.code)}</h2><p>${esc(tr('sampleDetails',{code:s.code,material:s.material}))} <span class="status-badge">${esc(label(a.status))}</span></p>${editable?resultFields(a.result):`<dl class="result-details"><dt>${esc(tr('method'))}</dt><dd>${esc(a.result.method)}</dd><dt>${esc(tr('analyte'))}</dt><dd>${esc(a.result.analyte)}</dd><dt>${esc(tr('result'))}</dt><dd>${esc(reading(a.result.value))} ${esc(a.result.unit)}</dd><dt>${esc(tr('interval'))}</dt><dd>${esc(tr('intervalValues',{lower:reading(a.result.lower),upper:reading(a.result.upper)}))} / ${esc(flag(a.result))}</dd></dl><p>${esc(a.result.notes)}</p>${sampleSourceFields(a.result.provenance,{esc,tr,editable:false})}`}${runQualityView(a.runQuality)}${a.review?`<p>${esc(tr('reviewed',{reviewer:a.review.reviewer,at:a.review.at}))}</p><p>${esc(a.review.comment)}</p>`:''}<div class="dialog-actions">${button('close','close-dialog')}${editable?`<button class="button" type="submit">${esc(tr('saveResult'))}</button>${button('submit','lab-submit',`data-id="${id}"`)}`:''}${a.status==='in review'?button('reviewResult','lab-review',`data-id="${id}"`):''}${['in review','approved','rejected'].includes(a.status)?button('amend','lab-amend',`data-id="${id}"`):''}${['approved','archived'].includes(a.status)?`<a class="button primary" href="${esc(ownedAssetURL(state,`/api/laboratory/issued/${id}`))}?revision=${value.etag}&amp;language=${esc(appLanguage())}" target="_blank" rel="noopener">${esc(tr('print'))}</a>`:''}${a.status==='approved'?button('archiveResult','lab-archive',`data-id="${id}"`):''}</div><details class="lab-history"><summary>${esc(tr('history'))}</summary><div data-lab-surface="history">${button('loadHistory','lab-history',`data-id="${id}"`)}</div></details></form>`);bindSources();
 }
 async function change(data,{tab=state.labTab??'samples'}={}){
  const form=document.querySelector('#dialog[open] form[id^="lab-"]'),context=scope();
  const current=()=>scope()===context&&form?.isConnected&&form.closest('dialog')?.open;
  const signature=JSON.stringify([context,data]);
  if(!pending||pending.signature!==signature)pending={signature,command:{...data,etag:data.id?selected.etag:form.dataset.etag,...(data.id?{expectedRecordRevision:selected.revision}:{}),...(state.storage?.researchStorage==='catalogue'?{commandId:crypto.randomUUID()}:{})}};
  let saved;
  try { saved=await api('/api/laboratory/change?compact=1',pending.command); }
  catch(error) {
   if(!current())return null;
   throw error;
  }
  if(!current())return null;
  pending=null;
  document.querySelector('#dialog').close();selected=null;history.clear();samples.clear();related.clear();state.labTab=tab;await load();notify(tr('saved'));return saved;
 }
 async function action(node){
  const name=node.dataset.action,id=node.dataset.id;
  if(name==='laboratory-samples'){owner=scope();state.page='laboratory';selected=null;main.clear();await load();return true;}
  if(!name.startsWith('lab-'))return false;
  if(await runInputs.action(node))return true;
  if(name==='lab-tab'){state.labTab=node.dataset.tab;state.labSearch='';main.clear();await load();}
  if(name==='lab-refresh')await load();
  if(name==='lab-retry')await lanes[node.dataset.lane]?.retry();
  if(name==='lab-page'){const lane=lanes[node.dataset.lane],cursor=lane?.page?.[node.dataset.direction+'Cursor'];if(cursor){await lane.load({...lane.request,cursor});document.querySelector(`[data-action="lab-page"][data-lane="${node.dataset.lane}"][data-direction="${node.dataset.direction}"]:not(:disabled)`)?.focus();}}
  if(name==='lab-new-sample')form(tr('register'),'lab-sample-form',`<div class="form-grid">${[['code','sampleCode',80],['material','material',160],['source','source',160]].map(([key,label,max])=>field(esc(tr(label)),`<input name="${key}" ${key==='source'?'':'required'} maxlength="${max}">`)).join('')}${['collectedOn','receivedOn'].map(key=>field(esc(tr(key==='collectedOn'?'collected':'received')),`<input type="date" name="${key}" required value="${today()}">`)).join('')}</div>`,'register');
  if(name==='lab-sample'){
   const value=await readSelected(id,'sample');if(!value)return true;const s=value.record;selected=null;related.clear();showDialog(`<h2 id="dialog-title">${esc(s.code)}</h2><p>${esc(s.material)} / ${esc(s.source)}</p><p>${esc(tr('dates',{collected:s.collectedOn,received:s.receivedOn}))}</p><div data-lab-surface="related"></div><div class="dialog-actions">${button('close','close-dialog')}${button('recordAnalysis','lab-new-analysis',`data-id="${id}"`)}</div>`);await related.load(request('all',{sampleId:id}));
  }
  if(name==='lab-new-analysis'){
   sampleChoice=null;samples.clear();runInputs.reset();if(id){const value=await readSelected(id,'sample');if(!value)return true;sampleChoice=value.record;}selected=null;
   // Laboratories without project domains cannot join inventory to a run; say so before the author fills the form.
   const runAvailable=main.page?.runInputs===true,runSection=runAvailable?runInputs.view():`<p class="muted" data-lab-run-unavailable>${esc(qualityText('runInputsUnavailable'))}</p>`;
   form(tr('recordAnalysis'),'lab-analysis-form',`${field(esc(tr('analysisCode')),'<input name="code" required maxlength="80">')}${field(esc(tr('findSample')),'<input type="search" id="lab-sample-search">')}<div data-lab-surface="samples"></div>${resultFields()}${runSection}`,'saveAnalysis');runInputs.draw();await Promise.all([samples.load(request('samples')),runAvailable?runInputs.load():null]);
  }
  if(name==='lab-open')await openAnalysis(id,related.page?.items.some(a=>a.id===id)?related.page.etag:main.page?.etag);
  if(name==='lab-history')await history.load(request('events',{recordId:id,limit:20}));
  if(name==='lab-submit'){const form=document.querySelector('#lab-result-form');if(form.reportValidity()){const result=readSampleResult(form,selected.record.result,tr);if(result)await change({action:'save-and-submit',id,result},{tab:'review'});}}
  if(name==='lab-review')form(tr('reviewResult'),'lab-review-form',`${field(esc(tr('reviewer')),'<input name="reviewer" required maxlength="160">')}${field(esc(tr('decision')),`<select name="decision"><option value="approve">${esc(tr('approve'))}</option><option value="reject">${esc(tr('reject'))}</option></select>`)}${field(esc(tr('comment')),'<textarea name="comment" maxlength="2000" rows="3"></textarea>')}<label class="checkbox"><input name="checked" type="checkbox" required><span>${esc(tr('checked'))}</span></label><p class="source-note">${esc(tr('acknowledgment'))}</p>`,'recordReview',`data-id="${id}"`);
  if(name==='lab-amend')form(tr('amend'),'lab-amend-form',`<p>${esc(tr('amendHelp'))}</p>${field(esc(tr('reason')),'<textarea name="reason" required maxlength="2000" rows="3"></textarea>')}`,'startAmendment',`data-id="${id}"`);
  if(name==='lab-archive')await change({action:'archive',id});
  return true;
 }
 async function submit(form,data){
  if(!form.id.startsWith('lab-'))return false;
  if(form.id==='lab-sample-form')await change({action:'create-sample',sample:Object.fromEntries(data)});
  if(form.id==='lab-analysis-form'){const result=readSampleResult(form,null,tr),used=runInputs.value();if(result){const saved=await change({action:'create-analysis',analysis:{code:data.get('code').trim(),sampleId:data.get('sampleId'),result,...(used?{runInputs:used}:{})}},{tab:'analyses'});if(saved)runInputs.reset();}}
  if(form.id==='lab-result-form'){const result=readSampleResult(form,selected.record.result,tr);if(result)await change({action:'save-result',id:form.dataset.id,result});}
  if(form.id==='lab-review-form')await change({action:'review',id:form.dataset.id,reviewer:data.get('reviewer').trim(),comment:data.get('comment').trim(),decision:data.get('decision'),checked:data.has('checked')});
  if(form.id==='lab-amend-form'){const saved=await change({action:'amend',id:form.dataset.id,reason:data.get('reason').trim()});if(saved)await openAnalysis(form.dataset.id,saved.etag);}
  return true;
 }
 function input(el){
  if(el.form?.elements.kind)updateSampleNumericFields(el);
  if(runInputs.input(el))return true;
  if(el.name==='sampleId'&&el.closest('#lab-analysis-form')){sampleChoice=samples.page?.items.find(s=>s.id===el.value)??sampleChoice;return true;}
  if(!['lab-search','lab-sample-search'].includes(el.id))return false;clearTimeout(timer);
  if(el.id==='lab-search'){state.labSearch=el.value;timer=setTimeout(()=>{main.clear();void load();},180);}
  else {const search=el.value;timer=setTimeout(()=>void samples.load(request('samples',{search})),180);}return true;
 }
 function bind(){if(owner!==scope()||state.page!=='laboratory'){clearTimeout(timer);selectionController?.abort();opening++;for(const lane of Object.values(lanes))lane.clear();runInputs.reset();selected=null;sampleChoice=null;pending=null;state.laboratory=null;owner=scope();}}
 return {view,action,submit,load,input,bind};
}
