import {createRun,sectionAnchor} from './record-workflow.js';
import {recordRunsUI} from './record-runs-ui.js';
import {t,messageLanguage} from './i18n/index.js';
export function recordWorkflowUI({state,api,esc,notify,revisions,create,getRecord}){
 const record=getRecord??(()=>state.book.entries.find(e=>e.id===state.selected));
 const runs=recordRunsUI({state,api,esc,getRecord:record});
 const text=key=>esc(t('recordWorkflow',key));
 const button=(key,action,extra='')=>`<button type="button" class="button" data-action="${action}" ${extra}>${text(key)}</button>`;
 function view({readonly=false}={}){
  const e=record(),parent=e.relations.find(link=>link.role==='run-of'),optional=e.type!=='run'&&e.type!=='experiment';
  const controls=readonly?'':`<div class="inline-actions">${e.type==='run'?button(parent?'changeSeries':'linkSeries','record-workflow-link','data-role="run-of"'):button('add','workflow-new-run')}${button('linkMethod','record-workflow-link','data-role="uses-method"')}${button('linkComparison','record-workflow-link','data-role="compares"')}</div>`;
  return `<div lang="${messageLanguage('recordWorkflow')}">`+(optional?`<details class="optional-workflow" ${state.runSeries===e.id?'open':''}><summary>${text('organize')}</summary>`:'')+`<section class="record-workflow" aria-label="${text('region')}"><h2>${text(e.type==='run'?'series':'runs')}</h2>
   ${e.type==='run'?`<p>${parent?`<a href="#/records/${parent.target.id}/read" data-action="record-read-linked" data-id="${parent.target.id}" data-run-series="true">${esc(parent.label)}</a>`:text('noSeries')}</p>`:runs.view()}${controls}</section>`+(optional?'</details>':'')+'</div>';
 }
 async function action(control){
  if(await runs.action(control))return true;
  if(control.dataset.action!=='workflow-new-run')return false;
  const parent=record();if(state.dirty||!revisions()[parent.id]){notify(t('recordWorkflow','saveFirst'),true);return true;}
  if(parent.attempt){const context=state.storage?.contextId;await api('/api/research/materials/pin',{id:parent.id,expectedRevision:revisions()[parent.id]},{adopt:false});if(context!==state.storage?.contextId||record()?.id!==parent.id||state.access?.locked)return true;}
  const next=createRun(state.book,parent,{revision:revisions()[parent.id],title:t('recordWorkflow','newTitle',{title:parent.title.slice(0,145)})});create(next,parent);return true;
 }
 function focusSection(){if(state.recordReading&&state.recordSection){const el=document.getElementById(state.recordSection.startsWith('record-')?state.recordSection:sectionAnchor({id:state.recordSection}));if(el){el.tabIndex=-1;el.focus({preventScroll:true});el.scrollIntoView({block:'start'});}}}
 return {view,action,focusSection,bind:runs.bind,stop:runs.stop};
}
