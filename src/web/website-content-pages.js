import {websiteSnapshot} from './website-context.js';
import {t} from './i18n/index.js';
import {recordLabel} from './record-types.js';
const tr=(key,args)=>t('websiteContent',key,args);
// Each displayed project owns one ten-record window. Closing or paging the
// panel drops that window; only one selected attachment inventory is retained.
export function websiteContentPages({state,esc,field,option,render,research,selection}){
 let key=null,search='',projectOffset=0,groups=null,loading=false,error='',generation=0,summaryVersion=0,timer=null,controller=null,openMedia=null;
 const pages=new Map();
 function sync(){const next=JSON.stringify([websiteSnapshot(state),state.book?.id]);if(next!==key){controller?.abort();key=next;generation++;pages.clear();groups=null;openMedia=null;loading=false;error='';}}
 function redraw(){if(state.page==='website'&&document.querySelector('#website-content-search'))render();}
 async function loadGroups(){
  sync();controller?.abort();controller=new AbortController();const signal=controller.signal,epoch=generation,version=++summaryVersion;loading=true;error='';redraw();
  try{const result=await research.query('summary',{selection:selection.snapshot(),search},{signal});if(epoch!==generation||version!==summaryVersion)return;groups=result.projects.filter(p=>p.matches);projectOffset=Math.min(projectOffset,Math.max(0,Math.ceil(groups.length/5)-1)*5);}
  catch(reason){if(epoch!==generation||version!==summaryVersion||signal.aborted)return;error=tr('loadFailed');}
  finally{if(epoch===generation&&version===summaryVersion){loading=false;redraw();}}
 }
 function visible(){return (groups??[]).slice(projectOffset,projectOffset+5);}
 async function loadPage(id,cursor=null){
  if(pages.get(id)?.loading)return;const epoch=generation;pages.set(id,{loading:true,cursor});redraw();
  try{const result=await research.query('content',{projectId:id,search,cursor});if(epoch!==generation||!visible().some(p=>p.id===id))return;
   if(!Array.isArray(result.items)||result.items.length>10||!Number.isSafeInteger(result.total)||!Number.isSafeInteger(result.offset))throw Error(tr('invalid'));
   pages.set(id,{...result,cursor});
  }catch(reason){if(epoch!==generation||reason.name==='AbortError')return;pages.set(id,{error:tr('loadFailed'),cursor});}
  redraw();
 }
 const button=(label,action,extra='')=>`<button type="button" class="button" data-action="website-content-${action}" ${extra}>${esc(tr(label))}</button>`;
 function media(record,project){const selected=research.cachedRecord();if(research.recordError(record.id))return `<p role="alert">${esc(research.recordError(record.id))}</p>${button('retry','media-retry',`data-record="${record.id}"`)}`;if(selected?.id!==record.id)return `<p role="status">${esc(tr('loading'))}</p>`;
  const cover=state.book.website.presentation.covers.find(c=>c.entryId===record.id);
  return `${field(tr('cover'),`<select data-record-cover="${record.id}">${option('auto',tr('autoCover'),cover?cover.attachmentId??'':'auto')}${option('',tr('noCover'),cover?cover.attachmentId??'':'auto')}${selected.attachments.filter(a=>a.kind==='image').map(a=>option(a.id,a.caption||a.alt||tr('image'),cover?.attachmentId)).join('')}</select>`)}${selected.attachments.map(a=>`<label class="checkbox"><input type="checkbox" data-website-media="${a.id}" data-record="${record.id}" ${selection.attachmentShare(record.id,a)?'checked':''}><span>${esc(a.caption||a.alt||a.kind)}<small>${esc(a.kind)}${!selection.projectRecordShare(record,project.id)||!project.share?' / '+esc(tr('mediaExcluded')):''}</small></span></label>`).join('')}`;
 }
 function records(group){const project=state.book.projects.find(p=>p.id===group.id),page=pages.get(group.id);if(!page||page.loading)return `<p role="status">${esc(tr('loading'))}</p>`;
  if(page.error)return `<p role="alert">${esc(page.error)}</p>${button('retry','retry',`data-project="${group.id}"`)}`;
  return page.items.map(record=>`<div class="website-record"><p class="muted">${esc(state.book.notebooks.find(n=>n.id===record.notebookId)?.title??'')}</p><label class="checkbox"><input type="checkbox" data-publish-entry="${record.id}" ${selection.projectRecordShare(record,project.id)?'checked':''}><span>${esc(record.title)}<small>${esc(recordLabel(record.type))}${selection.projectRecordShare(record,project.id)&&!project.share?' / '+esc(tr('recordExcluded')):''}</small></span></label>${record.attachmentCount?`<details class="website-record-media" data-content-media="${record.id}" ${openMedia===record.id?'open':''}><summary>${esc(tr('mediaCount',{total:record.attachmentCount}))}</summary>${openMedia===record.id?media(record,project):''}</details>`:''}</div>`).join('')+`<div class="inline-actions inventory-pager">${button('previousRecords','records-previous',`data-project="${group.id}" ${page.previousCursor?'':'disabled'}`)}<span role="status">${esc(page.total?tr('recordRange',{first:page.offset+1,last:page.offset+page.items.length,total:page.total}):tr('noRecords'))}</span>${button('nextRecords','records-next',`data-project="${group.id}" ${page.nextCursor?'':'disabled'}`)}</div>`;
 }
 function view(){sync();if(!groups&&!loading&&!error)queueMicrotask(loadGroups);
  return `<section class="panel"><h2>${esc(tr('title'))}</h2><p class="muted">${esc(tr('help'))}</p>${field(tr('search'),`<input type="search" id="website-content-search" maxlength="512" value="${esc(search)}">`)}${error?`<p role="alert">${esc(error)}</p>${button('retry','refresh')}`:loading?`<p role="status">${esc(tr('loading'))}</p>`:visible().map(group=>{const project=state.book.projects.find(p=>p.id===group.id);return `<section class="publication-project" data-project="${project.id}"><div class="publication-project-heading"><label class="checkbox"><input type="checkbox" data-project-share="${project.id}" ${project.share?'checked':''}><span><strong>${esc(project.title)}</strong><small>${esc(tr('includeProject'))}</small></span></label>${group.total?`<button class="button" data-action="include-project-entries" data-id="${project.id}">${esc(tr('includeAll'))}</button>`:''}</div><p class="selection-status">${esc(project.share?tr('included',{included:group.included,total:group.total}):tr('projectExcluded'))}</p>${records(group)}</section>`;}).join('')||`<p>${esc(tr('empty'))}</p>`}<div class="inline-actions inventory-pager">${button('previousProjects','projects-previous',!projectOffset?'disabled':'')}${button('nextProjects','projects-next',projectOffset+5>=(groups?.length??0)?'disabled':'')}</div></section>`;
 }
 function bind(){sync();const ids=new Set(visible().map(p=>p.id));for(const id of pages.keys())if(!ids.has(id))pages.delete(id);if(!loading)for(const id of ids)if(!pages.has(id))void loadPage(id);
  for(const panel of document.querySelectorAll('[data-content-media]'))panel.addEventListener('toggle',async()=>{
   if(!panel.isConnected||panel.open===(openMedia===panel.dataset.contentMedia))return;
   openMedia=panel.open?panel.dataset.contentMedia:null;const id=openMedia;redraw();if(!id)return;
   try{await research.record(id);}catch{}if(openMedia===id)redraw();
  });
 }
 function input(el){if(el.id!=='website-content-search')return false;search=el.value;projectOffset=0;pages.clear();openMedia=null;clearTimeout(timer);controller?.abort();generation++;timer=setTimeout(()=>void loadGroups(),180);return true;}
 function action(el){const name=el.dataset.action;if(!name?.startsWith('website-content-'))return false;
  if(name==='website-content-media-retry'){void research.record(el.dataset.record).catch(()=>{}).finally(redraw);redraw();return true;}
  if(name==='website-content-refresh'){void loadGroups();return true;}
  if(name==='website-content-retry'){void loadPage(el.dataset.project,pages.get(el.dataset.project)?.cursor??null);return true;}
  if(name.startsWith('website-content-records-')){const page=pages.get(el.dataset.project),cursor=page?.[name.endsWith('previous')?'previousCursor':'nextCursor'];if(cursor){openMedia=null;void loadPage(el.dataset.project,cursor);}return true;}
  if(name.startsWith('website-content-projects-')){projectOffset=Math.max(0,projectOffset+(name.endsWith('previous')?-5:5));openMedia=null;redraw();return true;}
  return false;
 }
 return {view,bind,input,action,sync,refresh:()=>{if(groups)void loadGroups();}};
}
