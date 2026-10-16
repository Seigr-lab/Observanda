import {websiteProjectPicker} from './website-project-picker.js';
import {workspaceReader} from './workspace-reader.js';
import {websiteDirectoryUI} from './website-directory-ui.js';
import {researchContext} from './project-context.js';
import {t} from './i18n/index.js';
import {websiteRouteId,websitePages} from './website-context.js';
const tr=key=>t('websiteSites',key);

// Owns website navigation and the research/presentation boundary. The editor
// receives one website draft; the navigation keeps the full project hierarchy.
export function websiteSitesUI({state,api,esc,field,showDialog,render,rootSnapshot,adopt,selection,ready,access=operation=>operation(),enterOwner}){
 let base=null,owner=null,filter=null,generation=0;
 const directory=websiteDirectoryUI({state,api,esc,access,open:async item=>{await enter(null);await enterOwner(item.projectId,item.labBookId);await show(item.siteId);}});
 const sync=()=>{if(owner!==researchContext(state)){owner=researchContext(state);base=null;state.websiteId=null;state.website=null;}};
 const root=()=>{sync();return base?.book??state.book;};
 const list=()=>root()?.websites??[];
 const picker=websiteProjectPicker({state,api,esc,book:root});
 const button=(key,action,extra='')=>`<button type="button" class="button" data-action="${action}" ${extra}>${esc(tr(key))}</button>`;
 async function enter(id){
  sync();const request=++generation;if((state.websiteId??null)===(id??null))return;
  const context=owner;
  const original=await rootSnapshot();
  const result=id?await api('/api/websites/open',{id},{adopt:false}):original;
  if(context!==researchContext(state)||request!==generation)throw {name:'AbortError'};
  base=id?original:null;state.websiteId=id??null;state.website=result.site??null;state.preview=null;state.publishing=null;
  selection.reset();adopt(result);if(result.site)selection.load(result.site.selection,result.selectionProjects);
 }
 async function show(id,page='website'){
  await enter(id);Object.assign(state,{page,project:null,notebook:'all',selected:null});await ready(page);render();
 }
 async function manager(projectId=null){await enter(null);filter=projectId;state.page='websites';state.project=projectId;render();}
 function header(){
  if(!websitePages.has(state.page))return '';
  const site=state.website;
  return `<section class="panel website-site-context"><div class="inline-actions"><strong>${esc(site?.name??tr('workspace'))}</strong>${site?`<span class="muted">${esc(root().projects.find(p=>p.id===site.projectId)?.title??'')}</span>`:''}${button('title','site-list')}${site?button('rename','site-rename'):''}</div><div class="inline-actions">${['editor','publishing','destination'].map((key,i)=>button(key,'site-view',`data-page="${['website','publishing','integrations'][i]}" ${state.page===['website','publishing','integrations'][i]?'disabled':''}`)).join('')}</div></section>`;
 }
 function view(){
  const book=root(),items=list().filter(s=>!filter||s.projectId===filter);
  if(state.workspaceOutline&&!state.projectOwner?.labBookId)return '<div class="page-heading"><div><h1>'+esc(tr('title'))+'</h1><p>'+esc(tr('help'))+'</p></div>'+button('new','site-create',filter?'data-project="'+filter+'"':'')+'</div>'+directory.view(filter);
  return `<div class="page-heading"><div><h1>${esc(tr('title'))}</h1><p>${esc(tr('help'))}</p></div>${button('new','site-create',filter?`data-project="${filter}"`:'')}</div>${items.map(s=>`<section class="panel"><h2>${esc(s.name)}</h2><p>${esc(book.projects.find(p=>p.id===s.projectId)?.title??'')}</p>${button('editor','site-open',`data-id="${s.id}"`)}</section>`).join('')||`<p>${esc(tr('empty'))}</p>`}${!filter?`<section class="panel"><h2>${esc(tr('workspace'))}</h2>${button('editor','site-open','data-id=""')}</section>`:''}`;
 }
 function presentForm(rename,projectId,name=''){
  const site=state.website;showDialog(`<form id="website-site-form" data-no-draft data-site="${rename?site.id:''}"><h2>${esc(tr(rename?'rename':'new'))}</h2>${field(tr('name'),`<input name="name" required maxlength="160" value="${esc(rename?site.name:name)}">`)}${rename?'':field(tr('project'),'<select name="projectId" required></select>')+picker.view()+`<p>${esc(tr('private'))}</p>`}<div class="dialog-actions">${button('cancel','close-dialog')}<button class="button primary" type="submit">${esc(tr(rename?'saveName':'create'))}</button></div></form>`);
  if(!rename)picker.start(projectId);
 }

 return {root,header,view,enter,choiceAction:picker.action,bind:directory.bind,input:element=>picker.input(element)||directory.input(element),
  projectButton:id=>button('projectWebsites','site-list',`data-project="${id}"`),
  async restore(hash){await enter(websiteRouteId(hash));filter=/^#\/websites\/([a-f0-9-]{36})$/.exec(hash)?.[1]??null;},
  async exit(){await enter(null);},
  async action(el){if(await directory.action(el)||await picker.action(el))return true;const name=el.dataset.action;
   if(name==='site-list'){await manager(el.dataset.project??null);return true;}
   if(name==='site-open'){await show(el.dataset.id||null);return true;}
   if(name==='site-view'){await show(state.websiteId,el.dataset.page);return true;}
   if(name==='site-create'||name==='site-rename'){presentForm(name==='site-rename',el.dataset.project??filter);return true;}
   return false;
  },
  async submit(form,data){if(form.id!=='website-site-form')return false;
   form.dataset.busy='true';const button=form.querySelector('[type=submit]');button.disabled=true;
   const id=form.dataset.site,projectId=data.get('projectId'),name=data.get('name').trim(),context=researchContext(state);
   try{
    const destination=id?state.projectOwner?.labBookId?{projectId:state.projectOwner.projectId,labBookId:state.projectOwner.labBookId}:state.projectOwner?.projectId??null:picker.destination(projectId);
    const read=()=>workspaceReader((route,body,options)=>api(route,body,{...options,adopt:false,owner:destination})).read({metadataOnly:true,requireOutline:true});
    const snapshot=id?{book:state.book,etag:state.etag}:await access(read);if(context!==researchContext(state))throw {name:'AbortError'};
    const result=await api('/api/websites/change',{workspaceId:snapshot.book.id,etag:snapshot.etag,operation:id?'rename':'create',...(id?{id}:{}),name,projectId},{adopt:false,owner:destination});
    if(context!==researchContext(state))return true;
    picker.clear();await enter(null);await enterOwner(typeof destination==='object'&&destination!==null?destination.projectId:destination,destination?.labBookId??null);
    state.websiteId=null;base=null;await show(result.id);document.querySelector('#dialog').close();
   }catch(error){
    if(!form.isConnected&&context===researchContext(state)&&!id){presentForm(false,projectId,name);}
    throw error;

   }finally{delete form.dataset.busy;button.disabled=false;}return true;
  }
 };
}
