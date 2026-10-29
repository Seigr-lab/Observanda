import {viewQuery,validViewQuery,viewScopeIssue,viewScopeLabel} from './record-view-model.js';
import {recordTypeLabel} from './record-type-presentation.js';
import {lookupRecordTypes} from './record-type-lookup.js';
import {t} from './i18n/index.js';
import {labBookProfileLabel} from './project-type-presentation.js';
const text=(key,args)=>t('recordViews',key,args);

export function recordViewsUI({state,api,esc,field,showDialog,notify,apply,snapshot}){
 let context=null,workspaceId=null,views=[],editing=null,captured=null,generation=0,typeController=null;
 const dialog=()=>document.querySelector('#dialog');
 const button=(label,action,id='')=>`<button type="button" class="button" data-action="record-view-${action}" data-id="${esc(id)}">${esc(text(label))}</button>`;
 const closeButton=()=>`<button type="button" class="button" data-action="close-dialog">${esc(text('close'))}</button>`;
 const validContext=()=>context===state.storage?.contextId&&workspaceId===state.book?.id&&!state.access?.locked;
 const guard=()=>{if(!validContext()||!dialog().open)throw Error(text('reopen'));};
 function clear(){typeController?.abort();typeController=null;generation++;views=[];editing=null;captured=null;context=null;workspaceId=null;}
 dialog().addEventListener('close',clear);
 function frame(title,body,actions=''){
  showDialog(`<section class="record-views"><h2 id="dialog-title" tabindex="-1">${esc(title)}</h2>${body}${actions?'<div class="dialog-actions">'+actions+'</div>':''}</section>`);
  dialog().querySelector('h2').focus();
 }
 function summary(q){
  const b=q.browse,type=recordTypeLabel(q.filter,t('recordTypes','saved'));
  const lines=[['scope',viewScopeLabel(state.book,q)],['recordType',q.filter==='all'?t('recordTypes','all'):type]];
  if(b.journey&&b.journey!=='all')lines.push(['journey',t('book',b.journey)]);
  if(q.search)lines.push(['search',q.search]);
  if(b.tags)lines.push([b.tagMode==='any'?'anyTags':'allTags',b.tags]);
  if(b.from||b.to)lines.push(['dates',text('dateRange',{from:b.from||text('anyStart'),to:b.to||text('anyEnd')})]);
  if(b.dateKnowledge!=='all')lines.push(['certainty',text('certaintyValues.'+b.dateKnowledge)]);
  if(b.domain!=='all')lines.push(['labType',b.domain==='general'?text('general'):labBookProfileLabel(b.domain,text('unavailableLabType'))]);
  if(b.status!=='all')lines.push(['progress',text('statusValues.'+b.status.replaceAll(' ','-'))]);
  lines.push(['order',text({'date-desc':'dateDesc','date-asc':'dateAsc',title:'titleOrder'}[b.sort])]);
  return '<dl class="record-view-summary">'+lines.map(([label,value])=>`<div><dt>${esc(text(label))}</dt><dd>${label==='recordType'&&q.filter.startsWith('template:')?`<span data-view-record-type="${esc(JSON.stringify({projectId:q.projectId,notebookId:q.notebookId,selected:q.filter}))}">${esc(value)}</span>`:esc(value)}</dd></div>`).join('')+'</dl>';
 }
 function list(){
  typeController?.abort();typeController=null;
  editing=null;captured=null;
  frame(text('title'),`<p>${esc(text('description'))}</p>
   <div class="inline-actions">${button('saveCurrent','new')}</div>
   <ul class="record-view-list">${views.map(v=>{
    const issue=viewScopeIssue(state.book,v.query);
    return `<li><div><h3>${esc(v.name)}</h3><p class="muted">${esc(viewScopeLabel(state.book,v.query))}</p>${issue?'<p role="status">'+esc(issue)+'</p>':''}</div><div class="inline-actions">${issue?'':button('open','open',v.id)}${button('edit','edit',v.id)}${button('remove','remove',v.id)}</div></li>`;
   }).join('')}</ul>${views.length?'':`<p>${esc(text('empty'))}</p>`}`,closeButton());
 }
 async function load(){
  context=state.storage?.contextId;workspaceId=state.book.id;const request=++generation;
  frame(text('title'),`<p role="status">${esc(text('loading'))}</p>`,closeButton());
  try{const result=await api('/api/research/views/list',{workspaceId});
   if(request!==generation||!validContext()||!dialog().open)return;
   views=result.views;list();
  }catch(error){if(request===generation&&validContext()&&dialog().open){frame(text('title'),`<p role="alert">${esc(error.message)}</p>`,button('retry','reload')+closeButton());}}
 }
 function form(view){
  editing=view??null;captured=viewQuery(state);
  if(!view&&!validViewQuery(captured)){notify(text('correctFilters'),true);return;}
  frame(text(view?'editTitle':'saveCurrent'),`<form id="record-view-form">
   ${field(text('name'),`<input name="name" required maxlength="120" value="${esc(view?.name??'')}" autocomplete="off">`)}
   <h3>${esc(text(view?'savedScope':'filtersScope'))}</h3>${summary(view?.query??captured)}
   ${view?`<label class="checkbox"><input type="checkbox" name="replaceQuery"> ${esc(text('replace'))}</label><details><summary>${esc(text('review'))}</summary>${summary(captured)}</details>`:''}
   <div class="dialog-actions">${button('back','back')}<button class="button primary" type="submit">${esc(text('save'))}</button></div></form>`);
  dialog().querySelector('[name="name"]').focus();
  typeController?.abort();const controller=new AbortController();typeController=controller;
  for(const node of dialog().querySelectorAll('[data-view-record-type]')){
   void lookupRecordTypes(api,{workspaceId,etag:snapshot(),...JSON.parse(node.dataset.viewRecordType),search:'',cursor:null,limit:1},{signal:controller.signal})
    .then(result=>{if(!controller.signal.aborted&&node.isConnected&&validContext())node.textContent=result.selected?.label??t('recordTypes','unavailable');})
    .catch(()=>{if(!controller.signal.aborted&&node.isConnected)node.textContent=t('recordTypes','error');});
  }
 }
 async function action(control){
  const name=control.dataset.action;
  if(name==='record-views'||name==='record-view-reload'){await load();return true;}
  if(!name?.startsWith('record-view-'))return false;
  guard();
  const view=views.find(v=>v.id===control.dataset.id);
  if(name==='record-view-back')list();
  if(name==='record-view-new')form();
  if(name==='record-view-edit'&&view)form(view);
  if(name==='record-view-remove'&&view){
   editing=view;
   frame(text('removeTitle'),`<form id="record-view-remove-form"><p>${esc(text('removePrompt',{name:view.name}))}</p><div class="dialog-actions">${button('cancel','back')}<button class="button danger" type="submit">${esc(text('removeView'))}</button></div></form>`);
  }
  if(name==='record-view-open'&&view){
   const issue=viewScopeIssue(state.book,view.query);if(issue){notify(issue,true);return true;}
   const query=structuredClone(view.query);dialog().close();apply(query);notify(text('opened',{name:view.name}));
  }
  return true;
 }
 async function submit(form,data){
  guard();
  const submit=form.querySelector('[type="submit"]');submit.disabled=true;
  try{
   if(form.id==='record-view-remove-form'){
    await api('/api/research/views/remove',{workspaceId,id:editing.id,expectedRevision:editing.revision});guard();
    views=views.filter(v=>v.id!==editing.id);list();notify(text('removed'));
   }else{
    const query=editing&&!data.has('replaceQuery')?editing.query:captured;
    if(!validViewQuery(query))throw Error(text('correctView'));
    const id=editing?.id??(form.dataset.viewId??=crypto.randomUUID());
    const {view}=await api('/api/research/views/save',{workspaceId,expectedRevision:editing?.revision??null,view:{id,name:String(data.get('name')).trim(),query}});guard();
    views=views.some(v=>v.id===view.id)?views.map(v=>v.id===view.id?view:v):[...views,view];list();notify(text('saved'));
   }
  }finally{submit.disabled=false;}
 }
 return {action,submit};
}
