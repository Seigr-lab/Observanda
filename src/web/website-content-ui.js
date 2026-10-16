import {t} from './i18n/index.js';
import {recordLabel} from './record-types.js';
import {inventoryWindow,contentProjects,contentRecords,PROJECT_WINDOW,CONTENT_WINDOW} from './website-inventory.js';
const tr=(key,values)=>t('websiteContent',key,values);

// The panel owns only the visible project/record windows and one expanded
// media list. Sharing mutations remain in the website draft's command owner.
export function websiteContentUI({state,esc,field,option,render}){
 let context=null,query='',projectOffset=0,recordOffsets=new Map(),openMedia=null;
 const button=(key,extra='')=>`<button type="button" class="button" data-action="website-content-page" ${extra}>${esc(tr(key))}</button>`;
 const pager=(page,projectId=null)=>`<div class="inline-actions inventory-pager">${button(projectId?'previousRecords':'previousProjects',`data-project-page="${projectId??''}" data-offset="${page.previous??0}" ${page.previous===null?'disabled':''}`)}<span role="status">${page.total?esc(tr(projectId?'recordRange':'projectRange',{first:page.offset+1,last:page.offset+page.items.length,total:page.total})):''}</span>${button(projectId?'nextRecords':'nextProjects',`data-project-page="${projectId??''}" data-offset="${page.next??0}" ${page.next===null?'disabled':''}`)}</div>`;
 function sync(){const next=JSON.stringify([state.book?.id,state.storage?.contextId]);if(next!==context){context=next;query='';projectOffset=0;recordOffsets.clear();openMedia=null;}}
 function mediaFields(record,project){const b=state.book,e=record,cover=b.website.presentation.covers.find(c=>c.entryId===e.id);return `${field(tr('cover'),`<select data-record-cover="${e.id}">${option('auto',tr('autoCover'),cover?cover.attachmentId??'':'auto')}${option('',tr('noCover'),cover?cover.attachmentId??'':'auto')}${e.attachments.filter(a=>a.kind==='image').map(a=>option(a.id,a.caption||a.alt||tr('image'),cover?.attachmentId)).join('')}</select>`)}${e.attachments.map(a=>`<label class="checkbox"><input type="checkbox" data-website-media="${a.id}" data-record="${e.id}" ${a.share?'checked':''}><span>${esc(a.caption||a.alt||a.kind)}<small>${esc(a.kind)}${!e.share||!project.share?' / '+esc(tr('mediaExcluded')):''}</small></span></label>`).join('')}`;}
 function view(){sync();const b=state.book,page=inventoryWindow(contentProjects(b,query),{offset:projectOffset,limit:PROJECT_WINDOW});projectOffset=page.offset;
  const visible=new Set(page.items.map(item=>item.project.id));for(const id of recordOffsets.keys())if(!visible.has(id))recordOffsets.delete(id);
  return `<section class="panel"><h2>${esc(tr('title'))}</h2><p class="muted">${esc(tr('help'))}</p>${field(tr('search'),`<input type="search" id="website-content-search" maxlength="512" value="${esc(query)}">`)}${!page.items.length?`<p>${esc(tr('empty'))}</p>`:''}
   ${page.items.map(({project:p,total,included})=>{const records=inventoryWindow(contentRecords(b,p,query),{offset:recordOffsets.get(p.id)??0,limit:CONTENT_WINDOW});recordOffsets.set(p.id,records.offset);return `<section class="publication-project" data-project="${p.id}">
    <div class="publication-project-heading"><label class="checkbox"><input type="checkbox" data-project-share="${p.id}" ${p.share?'checked':''}><span><strong>${esc(p.title)}</strong><small>${esc(tr('includeProject'))}</small></span></label>${total?`<button class="button" data-action="include-project-entries" data-id="${p.id}">${esc(tr('includeAll'))}</button>`:''}</div>
    <p class="selection-status">${esc(p.share?tr('included',{included,total}):tr('projectExcluded'))}</p>
    ${records.items.map(e=>`<div class="website-record"><p class="muted">${esc(b.notebooks.find(n=>n.id===e.notebookId)?.title??'')}</p><label class="checkbox"><input type="checkbox" data-publish-entry="${e.id}" ${e.share?'checked':''}><span>${esc(e.title)}<small>${esc(recordLabel(e.type))}${e.share&&!p.share?' / '+esc(tr('recordExcluded')):''}</small></span></label>
     ${e.attachments.length?`<details class="website-record-media" data-content-media="${e.id}" ${openMedia===e.id?'open':''}><summary>${esc(tr('media',{included:e.attachments.filter(a=>a.share).length,total:e.attachments.length}))}</summary>${openMedia===e.id?mediaFields(e,p):''}</details>`:''}</div>`).join('')||`<p class="muted">${esc(tr('noRecords'))}</p>`}${pager(records,p.id)}</section>`;}).join('')}${pager(page)}</section>`;
 }
 function input(el){if(el.id!=='website-content-search')return false;query=el.value;projectOffset=0;recordOffsets.clear();openMedia=null;const start=el.selectionStart,end=el.selectionEnd;render();const next=document.querySelector('#website-content-search');next?.focus({preventScroll:true});next?.setSelectionRange(start,end);return true;}
 function action(el){if(el.dataset.action!=='website-content-page')return false;const offset=Number(el.dataset.offset);if(!Number.isSafeInteger(offset)||offset<0)return true;
  if(el.dataset.projectPage)recordOffsets.set(el.dataset.projectPage,offset);else{projectOffset=offset;recordOffsets.clear();}openMedia=null;render();
  (el.dataset.projectPage?document.querySelector('[data-project="'+el.dataset.projectPage+'"] [data-publish-entry]'):document.querySelector('[data-project-share]'))?.focus({preventScroll:true});return true;
 }
 function bind(){for(const panel of document.querySelectorAll('[data-content-media]'))panel.addEventListener('toggle',()=>{
   if(!panel.isConnected||panel.open===(openMedia===panel.dataset.contentMedia))return;
   openMedia=panel.open?panel.dataset.contentMedia:null;render();document.querySelector('[data-content-media="'+panel.dataset.contentMedia+'"] summary')?.focus({preventScroll:true});
  });}
 return {view,input,action,bind,sync};
}
