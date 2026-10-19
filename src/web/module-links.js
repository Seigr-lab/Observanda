import {FEATURE_MODULES,enabledModule,moduleForEntity} from './feature-modules.js';
import {moduleItemPages} from './modules/item-pages.js';
import {connectedReferencePages} from './module-connected-references.js';
import {t} from './i18n/index.js';
const tr=key=>t('moduleConnected',key);
export function moduleLinks({state,api,esc}){
 let pages=null,key=null;
 const active=()=>['editor','record-reader'].includes(state.page)&&!state.access?.locked&&!state.storageUnavailable;
 const selectedTypes=()=>[...new Set(FEATURE_MODULES.filter(m=>enabledModule(state.dashboardSettings,m.id)).flatMap(m=>m.entityTypes??[]))];
 function clear(){pages?.clear();pages=null;key=null;}
 function paint(){
  const node=document.querySelector('[data-module-links]');if(!node||!pages||!active())return;
  node.hidden=false;
  node.innerHTML=`<div class="inline-actions"><h3>${esc(tr('heading'))}</h3><button type="button" class="button" data-action="connected-work-page" data-command="connected-refresh" ${pages.busy?'disabled':''}>${esc(tr('refresh'))}</button></div>${pages.view(item=>{
   const module=moduleForEntity({type:item.type,data:{}},[]);
   if(item.reference)return `<p><button type="button" class="text-button" data-action="module-reference-open" data-reference-workspace="${esc(item.reference.workspaceId)}" data-reference-type="${esc(item.reference.type)}" data-reference-id="${esc(item.reference.id)}" ${module&&enabledModule(state.dashboardSettings,module.id)?'':'disabled'}>${esc(item.title)}</button>${item.owner?.projectTitle||item.owner?.notebookTitle?` <small>${esc([item.owner.projectTitle,item.owner.notebookTitle].filter(Boolean).join(' / '))}</small>`:''}</p>`;
   return `<p><button type="button" class="text-button" data-action="module-open" data-module-id="${esc(module?.id??'')}" data-module-path="${esc(item.openType+'/'+item.openId)}" ${module&&enabledModule(state.dashboardSettings,module.id)?'':'disabled'}>${esc(item.title)}</button></p>`;
  })}${!state.recordReading&&enabledModule(state.dashboardSettings,'resources')?`<button type="button" class="button" data-action="module-open" data-module-id="resources" data-module-path="bom" data-create-type="bom" data-record-id="${esc(state.selected)}">${esc(tr('newBOM'))}</button>`:''}`;
  node.onclick=event=>{const button=event.target.closest('[data-action="connected-work-page"]');if(button&&node.contains(button)){event.stopPropagation();void pages?.action(button.dataset.command);}};
 }
 return {view:()=>'<section class="research-links" data-module-links hidden></section>',
  bind(){
   if(!active()){clear();return;}
   const types=selectedTypes(),next=JSON.stringify([state.storage?.contextId,state.book.id,state.selected,types,state.book.projects.map(p=>[p.id,p.tools])]);
   if(!types.length){clear();const node=document.querySelector('[data-module-links]');if(node)node.hidden=true;return;}
   if(key!==next){
    clear();key=next;pages=state.storage?.researchStorage==='catalogue'&&state.storage.researchFormatVersion===21?connectedReferencePages({state,api,esc,draw:paint}):moduleItemPages({api,workspaceId:state.book.id,esc,draw:paint,prefix:'connected',action:'connected-work-page'});
    void pages.load({types,reference:{workspaceId:state.book.id,type:'record',id:state.selected}});
   }
   paint();
  }
 };
}
