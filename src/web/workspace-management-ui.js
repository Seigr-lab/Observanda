import {t} from './i18n/index.js';

// The workspace directory is a read-only application view. Loading it never
// saves research or acquires an owner writer.
export function workspaceManagementUI({state,api,esc,deletion,render}){
 const m=(key,args)=>t('workspaceManagement',key,args);
 let result=null,error=null,loading=false,request=0,active=false,host=null,context=null;
 const contextKey=()=>JSON.stringify([state.storage?.contextId,state.storage?.root]);
 function cards(){
  if(!result)return '';
  const items=result.workspaces.map(item=>`<article class="workspace-management-card"><div><span class="scope-kicker">${esc(item.label)}</span><h2>${esc(item.title||m('saved'))}</h2><p class="storage-path">${esc(item.path)}</p>${item.conflict?`<p role="alert">${esc(t('workspaceNaming','conflict'))}</p>`:''}</div><div class="inline-actions">${item.path===result.active?`<span class="badge">${esc(m('current'))}</span>`:`<button type="button" class="button" data-action="storage-open-recent" data-path="${esc(item.path)}">${esc(m('open',{title:item.title||m('workspace')}))}</button>`}${deletion.button(item.path===result.active?'':item.path)}</div></article>`).join('');
  return `${items?`<div class="workspace-management-list">${items}</div>`:`<p>${esc(m('empty'))}</p>`}${deletion.pending(result.deletions)}`;
 }
 function contents(){return `${loading&&!result?`<p role="status">${esc(m('loading'))}</p>`:''}${error?`<div role="alert"><p>${esc(m('failed'))}</p><button type="button" class="button" data-action="storage-workspaces-retry">${esc(m('retry'))}</button></div>`:''}${cards()}`;}
 function view({standalone=false}={}){
  const content=`<section class="workspace-management" aria-labelledby="workspace-management-title"><div class="page-heading"><h1 id="workspace-management-title" tabindex="-1">${esc(m('title'))}</h1><div class="inline-actions"><button type="button" class="button" data-action="storage-open-dialog">${esc(m('openExisting'))}</button><button type="button" class="button primary" data-action="storage-new">${esc(m('new'))}</button></div></div>${state.pendingResearchLink?`<p>${esc(m('linked'))}</p>`:''}<div data-workspace-management-list aria-busy="${loading}">${contents()}</div>${state.book&&!state.storageUnavailable?`<section class="workspace-management-import"><h2>${esc(m('external'))}</h2><button type="button" class="button" data-action="migration-open">${esc(m('inspect'))}</button></section>`:''}</section>`;
  return standalone?`<main id="main" class="workspace-management-standalone">${content}</main>`:content;
 }
 function paint(){if(host?.isConnected&&state.page==='workspaces'&&!state.newWorkspace){host.innerHTML=contents();host.setAttribute('aria-busy',String(loading));}}
 async function refresh(){
  const id=++request;loading=true;error=null;paint();
  try{const next=await api('/api/workspaces',undefined,{adopt:false,metadataOnly:true});if(id!==request)return;if(!Array.isArray(next?.workspaces)||!Array.isArray(next?.deletions))throw new Error('Invalid workspace directory');result=next;}
  catch(e){if(id!==request)return;error=e;}
  finally{if(id===request){loading=false;paint();}}
 }
 function bind(){
  const next=document.querySelector('[data-workspace-management-list]'),key=contextKey();
  if(state.page!=='workspaces'||state.newWorkspace||state.access?.locked||!next){active=false;host=null;return;}
  const entering=!active||context!==key;active=true;context=key;host=next;
  if(entering){result=null;void refresh();}else paint();
 }
 function open(){state.newWorkspace=false;state.page='workspaces';active=false;document.getElementById('dialog')?.close();render();}
 async function action(button){if(button.dataset.action==='storage-workspaces'){open();return true;}if(button.dataset.action==='storage-workspaces-retry'){await refresh();return true;}return false;}
 return {view,bind,open,refresh,action};
}
