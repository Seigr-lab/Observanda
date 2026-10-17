import {workspaceReader} from './workspace-reader.js';
import {websiteDirectoryUI} from './website-directory-ui.js';
import {researchContext} from './project-context.js';
import {t} from './i18n/index.js';
import {activeWebsite,websiteRouteId,websiteRoute,websitePages} from './website-context.js';
const tr=key=>t('websiteSites',key);

// Owns website navigation and the research/presentation boundary. The editor
// receives one website draft; the navigation keeps the full project hierarchy.
export function websiteSitesUI({state,api,esc,field,showDialog,render,rootSnapshot,adopt,selection,ready,documents,access=operation=>operation(),enterOwner}){
 let base=null,owner=null,generation=0;
 const directory=websiteDirectoryUI({state,api,esc,access,open:async item=>{await exit();await enterOwner(item.projectId,item.labBookId);await show(item.siteId);}});
 const sync=()=>{if(owner!==researchContext(state)){owner=researchContext(state);base=null;state.websiteId=null;state.websitePin=null;state.website=null;state.websiteEditor=null;documents.stop();}};
 const root=()=>{sync();return base?.book??state.book;};
 const button=(key,action,extra='')=>`<button type="button" class="button" data-action="${action}" ${extra}>${esc(tr(key))}</button>`;
 async function enter(id){
  sync();const request=++generation;if(activeWebsite(state)&&(state.websiteId??null)===(id??null))return;
  const context=owner;
  const original=await rootSnapshot();
  const version=await api('/api/websites/version',{id:id??null},{adopt:false});
  const result=await documents.open({websiteId:id??null,websitePin:version.websitePin,base:original});
  if(context!==researchContext(state)||request!==generation)throw {name:'AbortError'};
  base=original;state.websiteId=id??null;state.website=result.site??null;state.preview=null;state.publishing=null;
  selection.reset();adopt(result);if(result.site)selection.load(result.site.selection,result.selectionProjects);documents.installed();
 }
 async function exit(){
  sync();const request=++generation;if(!activeWebsite(state))return;
  const context=owner,result=await rootSnapshot();
  if(context!==researchContext(state)||request!==generation)throw {name:'AbortError'};
  documents.stop();base=null;state.websiteId=null;state.websitePin=null;state.website=null;state.websiteEditor=null;state.preview=null;state.publishing=null;selection.reset();adopt(result);
 }
 async function show(id,page='website'){
  await enter(id);Object.assign(state,{page,project:null,notebook:'all',selected:null});await ready(page);render();
 }
 async function manager(){await exit();await enterOwner(null);sync();state.page='websites';state.project=null;render();}
 function header(){
  if(!websitePages.has(state.page))return '';
  const site=state.website;
  return `<section class="panel website-site-context"><div class="inline-actions"><strong>${esc(state.websiteId?site?.name:tr('workspace'))}</strong>${site?`<span class="muted">${esc(root().projects.find(p=>p.id===site.projectId)?.title??'')}</span>`:''}${button('title','site-list')}${state.websiteId?button('rename','site-rename'):''}</div><div class="inline-actions">${['editor','publishing','destination'].map((key,i)=>button(key,'site-view',`data-page="${['website','publishing','integrations'][i]}" ${state.page===['website','publishing','integrations'][i]?'disabled':''}`)).join('')}<button type="button" class="button" data-action="site-view" data-page="appearance" ${state.page==='appearance'?'disabled':''}>${esc(t('appearance','title'))}</button></div></section>`;
 }
 function view(){
  return '<div class="page-heading"><div><h1>'+esc(tr('title'))+'</h1><p>'+esc(tr('help'))+'</p></div>'+button('new','site-create')+'</div>'+directory.view(null);
 }
 function presentForm(rename,name=''){
  const site=state.website;showDialog(`<form id="website-site-form" data-no-draft data-site="${rename?site.id:''}"><h2>${esc(tr(rename?'rename':'new'))}</h2>${field(tr('name'),`<input name="name" required maxlength="160" value="${esc(rename?site.name:name)}">`)}<div class="dialog-actions">${button('cancel','close-dialog')}<button class="button primary" type="submit">${esc(tr(rename?'saveName':'create'))}</button></div></form>`);
 }

 return {root,header,view,enter,bind:directory.bind,input:element=>directory.input(element),
  async restore(hash){if(hash==='#/websites')await enterOwner(null);if(websiteRoute(hash))await enter(websiteRouteId(hash));else await exit();},
  exit,
  async action(el){if(await directory.action(el))return true;const name=el.dataset.action;
   if(name==='site-list'){await manager();return true;}
   if(name==='site-open'){await show(el.dataset.id||null);return true;}
   if(name==='site-view'){await show(state.websiteId,el.dataset.page);return true;}
   if(name==='site-create'||name==='site-rename'){presentForm(name==='site-rename');return true;}
   return false;
  },
  async submit(form,data){if(form.id!=='website-site-form')return false;
   form.dataset.busy='true';const button=form.querySelector('[type=submit]');button.disabled=true;
   const id=form.dataset.site,name=data.get('name').trim(),context=researchContext(state);
   try{
    if(id&&documents.enabled()){await documents.perform([{type:'settings',path:['name'],value:name}]);document.querySelector('#dialog').close();render();return true;}
    const destination=id?state.projectOwner?.labBookId?{projectId:state.projectOwner.projectId,labBookId:state.projectOwner.labBookId}:state.projectOwner?.projectId??null:null;
    const read=()=>workspaceReader((route,body,options)=>api(route,body,{...options,adopt:false,owner:destination})).read({metadataOnly:true,requireOutline:true});
    const snapshot=id?{book:state.book,etag:state.etag}:await access(read);if(context!==researchContext(state))throw {name:'AbortError'};
    const result=await api('/api/websites/change',{workspaceId:snapshot.book.id,etag:snapshot.etag,operation:id?'rename':'create',...(id?{id,websitePin:state.websitePin}:{}),name},{adopt:false,owner:destination});
    if(context!==researchContext(state))return true;
    await exit();await enterOwner(typeof destination==='object'&&destination!==null?destination.projectId:destination,destination?.labBookId??null);
    state.websiteId=null;base=null;await show(result.id);document.querySelector('#dialog').close();
   }catch(error){
    if(!form.isConnected&&context===researchContext(state)&&!id){presentForm(false,name);}
    throw error;

   }finally{delete form.dataset.busy;button.disabled=false;}return true;
  }
 };
}
