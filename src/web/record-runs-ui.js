import {recordDateLabel} from './record-date.js';
import {runsOf} from './record-workflow.js';
import {runConditions,validRunPage,validRunComparisonPage,RUN_PAGE_SIZE,RUN_DETAIL_PAGE_SIZE} from './record-runs.js';
import {t} from './i18n/index.js';
import {attemptComparisonView} from './attempt-comparison.js';

export function recordRunsUI({state,api,esc,getRecord}){
 const text=(key,parameters)=>esc(t('recordWorkflow',key,parameters));
 const record=getRecord??(()=>state.book?.entries.find(e=>e.id===state.selected));
 const active=()=>['editor','record-reader'].includes(state.page)&&!state.access?.locked&&!state.storageUnavailable&&!state.newWorkspace&&record()?.type!=='run'&&!!record();
 const identity=()=>JSON.stringify([state.storage?.contextId,state.book?.id,state.selected,state.etag]);
 const indexed=()=>state.storage?.researchStorage==='catalogue'&&state.storage.researchFormatVersion===21;
 const link=run=>`<a href="#/records/${run.id}/read" data-action="record-read-linked" data-id="${run.id}">${esc(run.title)}</a>`;
 const button=(key,action,disabled=false)=>`<button type="button" class="button" data-action="workflow-${action}" ${disabled?'disabled':''}>${text(key)}</button>`;
 let key='',generation=0,controller=null,page=null,error=null,loading=false,opened=false,compare=false,requestedCursor=null,detail=null;
 function stop(){controller?.abort();controller=null;generation++;key='';page=null;error=null;loading=false;opened=false;compare=false;requestedCursor=null;detail=null;}
 function sync(){const next=identity();if(next!==key){stop();key=next;opened=record()?.type==='experiment'||state.runSeries===state.selected;}}
 function detailsStatus(run){
  if(detail?.runId!==run.id)return '';
  if(detail.loading)return `<p role="status">${text('detailLoading')}</p>`;
  return `<p role="alert">${esc(detail.error)}</p><button type="button" class="button" data-action="workflow-detail-retry" data-run-id="${run.id}">${text('detailRetry')}</button>`;
 }
 function navigation(run,name){
  const window=run.conditions.windows?.[name];if(!window||window.total<=RUN_DETAIL_PAGE_SIZE)return '';
  const disabled=detail?.runId===run.id&&detail.loading,label=name==='methods'?t('recordWorkflow','methods'):t('attempts',name);
  const control=(action,off=false)=>`<button type="button" class="button" data-action="workflow-detail-${action}" ${disabled||off?'disabled':''}>${text('detail_'+action)}</button>`;
  return `<nav data-run-detail="${name}" data-run-id="${run.id}" aria-label="${text('detailNavigation',{name:label,run:run.title})}"><p tabindex="-1" data-detail-status role="status">${text('detailRange',{first:window.offset+1,last:window.offset+window.count,total:window.total})}</p><div class="inline-actions">${control('previous',window.offset===0)}${control('next',window.offset+window.count>=window.total)}</div><label>${text('detailPosition')} <input type="number" data-detail-position min="1" max="${window.total}" value="${window.offset+1}" ${disabled?'disabled':''} required></label>${control('go')}</nav>`;
 }
 function table(){return `<div class="run-comparison"><p>${text('comparisonScope',{count:page.runs.length})}</p><div class="table-scroll" tabindex="0" role="region" aria-label="${text('comparison')}"><table class="records-table"><thead><tr>${['run','conditions','plannedChanges','deviations','methods'].map(key=>`<th scope="col">${text(key)}</th>`).join('')}<th scope="col">${esc(t('attempts','comparison'))}</th></tr></thead><tbody>${page.runs.map(run=>`<tr data-run-comparison-row="${run.id}"><th scope="row">${link(run)}${detailsStatus(run)}</th>${['parameters','changes','deviations'].map(key=>`<td>${esc(run.conditions[key])||text('notRecorded')}</td>`).join('')}<td>${navigation(run,'methods')}${run.conditions.methods.map(method=>esc(method.label)+' &middot; '+esc(method.revision.slice(0,12))).join('<br>')||text('notLinked')}</td><td>${attemptComparisonView(run.conditions.attempt,page.runs[0].conditions.attempt,esc,{message:(key,args)=>t('attempts',key,args),navigation:name=>navigation(run,name)})}</td></tr>`).join('')}</tbody></table></div></div>`;}
 function content(){
  if(!opened)return button('view','load');
  if(loading)return `<p role="status">${text('loading')}</p>`;
  if(error)return `<p role="alert">${esc(error.message)}</p>${button('retry','retry')}`;
  if(!page)return `<p role="status">${text('loading')}</p>`;
  return `${page.changed?`<p role="status">${text('changed')}</p>`:''}<p tabindex="-1" data-run-page-status>${page.total?text('range',{first:page.offset+1,last:page.offset+page.runs.length,total:page.total}):text('empty')}</p>
   <ol class="run-list">${page.runs.map(run=>`<li>${link(run)}<span>${esc(recordDateLabel(run.occurredOn))} &middot; ${esc(run.status)} &middot; ${text('outcome',{outcome:run.outcome||t('recordWorkflow','notRecorded')})}</span></li>`).join('')}</ol>
   ${page.runs.length?button(compare?'hideComparison':'compare','compare'):''}${compare&&page.runs.length?table():''}
   <nav class="inline-actions" aria-label="${text('pages')}">${button('previous','previous',!page.previousCursor)}${button('next','next',!page.nextCursor)}${button('refresh','refresh')}</nav>`;
 }
 function paint(focus=false){const area=document.querySelector('[data-run-pages]');if(active()&&area){area.innerHTML=content();if(focus)area.querySelector('[data-run-page-status],button')?.focus();}}
 async function load(cursor=null,focus=false){
  if(!active())return;sync();const request=++generation,expectedKey=key;
  controller?.abort();controller=new AbortController();loading=true;error=null;requestedCursor=cursor;detail=null;paint();
  try{
   const command={workspaceId:state.book.id,recordId:record().id,cursor,compare};let result;
   if(indexed()){
    result=await api('/api/research/records/runs',command,{adopt:false,signal:controller.signal});
    if(!validRunPage(result,command))throw Error(t('recordWorkflow','invalidPage'));
   }else{
    const runs=runsOf(state.book,record().id),offset=Number(cursor??0);
    result={runs:runs.slice(offset,offset+RUN_PAGE_SIZE).map(run=>({...run,...(compare?{conditions:runConditions(run)}:{})})),total:runs.length,offset,cursor:String(offset),nextCursor:offset+RUN_PAGE_SIZE<runs.length?String(offset+RUN_PAGE_SIZE):null,previousCursor:offset?String(Math.max(0,offset-RUN_PAGE_SIZE)):null,changed:false,compare};
   }
   if(request!==generation||!active()||expectedKey!==identity())return;
   page=result;loading=false;paint(focus);
  }catch(caught){if(request===generation&&active()&&expectedKey===identity()&&caught.name!=='AbortError'){page=null;error={message:caught.message??t('recordWorkflow','loadFailed')};loading=false;paint(true);}}
 }
 async function loadDetail(run,windows,field){
  const request=++generation,expectedKey=key,snapshotId=page.snapshotId;controller?.abort();controller=new AbortController();
  detail={runId:run.id,windows,field,loading:true,error:null};paint();
  try{
   const command={workspaceId:state.book.id,recordId:record().id,runId:run.id,snapshotId,windows},result=await api('/api/research/records/runs/comparison',command,{adopt:false,signal:controller.signal});
   if(request!==generation||!active()||expectedKey!==identity()||page?.snapshotId!==snapshotId)return;
   if(!validRunComparisonPage(result,command))throw Error(t('recordWorkflow','invalidPage'));
   run.conditions=result.conditions;detail=null;paint();document.querySelector(`[data-run-detail="${field}"][data-run-id="${run.id}"] [data-detail-status]`)?.focus();
  }catch(caught){if(request===generation&&active()&&expectedKey===identity()&&caught.name!=='AbortError'){detail={runId:run.id,windows,field,loading:false,error:caught.message??t('recordWorkflow','loadFailed')};paint();document.querySelector(`[data-run-comparison-row="${run.id}"] [data-action="workflow-detail-retry"]`)?.focus();}}
 }
 function view(){sync();return `<div data-run-pages>${content()}</div>`;}
 function bind(){if(!active()){stop();return;}sync();if(opened&&!page&&!error&&!loading)void load();}
 async function action(control){
  const name=control.dataset.action;if(!active())return false;
  if(['workflow-detail-next','workflow-detail-previous','workflow-detail-go','workflow-detail-retry'].includes(name)){
   sync();if(loading||!compare||!page)return true;
   if(name==='workflow-detail-retry'){const run=page.runs.find(run=>run.id===detail?.runId);if(run&&!detail.loading)await loadDetail(run,detail.windows,detail.field);return true;}
   const owner=control.closest('[data-run-detail]'),run=page.runs.find(run=>run.id===owner?.dataset.runId),field=owner?.dataset.runDetail,window=run?.conditions.windows?.[field];if(!window||detail?.loading&&detail.runId===run.id)return true;
   const input=owner.querySelector('[data-detail-position]');if(name==='workflow-detail-go'&&!input.reportValidity())return true;
   const offset=name==='workflow-detail-next'?window.offset+window.count:name==='workflow-detail-previous'?Math.max(0,window.offset-RUN_DETAIL_PAGE_SIZE):Number(input.value)-1;
   const windows=Object.fromEntries(Object.entries(run.conditions.windows).map(([key,value])=>[key,value.offset]));windows[field]=offset;await loadDetail(run,windows,field);return true;
  }
  if(!['workflow-load','workflow-compare','workflow-previous','workflow-next','workflow-refresh','workflow-retry'].includes(name))return false;
  sync();if(loading)return true;opened=true;
  if(name==='workflow-compare'){
   compare=!compare;
   // Collapsing and reopening this page reuses its verified comparison values.
   if(!compare||page?.compare){if(detail){controller?.abort();generation++;detail=null;}paint();return true;}
   await load(page?.cursor,true);
  }else await load(name==='workflow-next'?page?.nextCursor:name==='workflow-previous'?page?.previousCursor:name==='workflow-retry'?requestedCursor:null,true);
  return true;
 }
 return {view,bind,action,stop};
}
