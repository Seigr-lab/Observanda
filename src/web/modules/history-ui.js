import '../i18n/catalogues/moduleHistory.js';
import {t,messageLanguage} from '../i18n/index.js';
const tr=(key,values)=>t('moduleHistory',key,values);
// Retain one summary page, one selected body and a bounded return trail.
export function moduleHistoryUI({api,esc,draw,current}){
 let id=null,page=null,selected=null,trail=[],busy=false,error=null,request=0,retry=null,controller=null;
 const button=(label,action,disabled=false,extra='')=>`<button type="button" class="button" data-action="module-command" data-command="history-${action}" ${disabled?'disabled':''} ${extra}>${esc(label)}</button>`;
 function clear(){request++;controller?.abort();controller=null;id=null;page=null;selected=null;trail=[];busy=false;error=null;retry=null;}
 const token=value=>typeof value==='string'&&value.length>0&&value.length<=4096;
 function validPage(value,target){return value?.id===target&&Array.isArray(value.items)&&value.items.length>0&&value.items.length<=20&&Number.isSafeInteger(value.total)&&value.total>0&&Number.isSafeInteger(value.offset)&&value.offset>=0&&value.offset+value.items.length<=value.total&&Number.isSafeInteger(value.currentRevision)&&value.currentRevision>=value.total&&token(value.cursor)&&(value.nextCursor===null||token(value.nextCursor))&&value.items.every((item,i)=>item?.entityId===target&&item.revision===value.total-value.offset-i&&typeof item.at==='string'&&Number.isFinite(Date.parse(item.at))&&typeof item.action==='string');}
 async function load(cursor=null,nextTrail=[]){
  const ticket=++request,target=id;controller?.abort();controller=new AbortController();busy=true;error=null;retry=()=>load(cursor,nextTrail);draw();
  try{
   const value=await api('/api/modules/history?id='+encodeURIComponent(target)+(cursor?'&cursor='+encodeURIComponent(cursor):''),undefined,{signal:controller.signal});
   if(ticket!==request||current()?.id!==target)return;
   if(!validPage(value,target))throw Error(tr('invalid'));
   page=value;selected=null;trail=nextTrail.slice(-32);retry=null;
  }catch(e){if(ticket===request)error=e;}
  finally{if(ticket===request){busy=false;draw();document.querySelector('[data-module-history-status]')?.focus({preventScroll:true});}}
 }
 async function open(target){clear();id=target;if(current()?.expectedRevision!==null)await load();else draw();}
 async function read(revision){
  const ticket=++request,target=id;controller?.abort();controller=new AbortController();busy=true;error=null;retry=()=>read(revision);selected=null;draw();
  try{
   const value=await api('/api/modules/history?id='+encodeURIComponent(target)+'&revision='+revision,undefined,{signal:controller.signal});
   if(ticket!==request||current()?.id!==target)return;
   if(value.entity?.id!==target||value.entity.revision!==revision)throw Error(tr('invalid'));
   selected=value;retry=null;
  }catch(e){if(ticket===request)error=e;}
  finally{if(ticket===request){busy=false;draw();document.querySelector('[data-module-history-revision]')?.focus({preventScroll:true});}}
 }
 function view(){
  const hasSaved=current()?.expectedRevision!==null;
  return `<section class="module-block" lang="${messageLanguage('moduleHistory')}"><h2>${esc(tr('heading'))}</h2>
   ${error?`<div role="alert"><p>${esc(error.message)}</p>${button(tr('retry'),'retry',busy)}</div>`:''}
   <p role="status" tabindex="-1" data-module-history-status>${esc(busy?tr('loading'):page?tr('range',{first:page.offset+1,last:page.offset+page.items.length,total:page.total}):tr('empty'))}</p>
   ${page?.changed?`<p>${esc(tr('changed'))}</p>`:''}
   ${hasSaved?`<nav class="module-actions" aria-label="${esc(tr('pages'))}">${button(tr('first'),'first',busy||!page?.offset)}${button(tr('previous'),'previous',busy||!trail.length)}${button(tr('next'),'next',busy||!page?.nextCursor)}${button(tr('refresh'),'refresh',busy)}</nav>`:''}
   <div class="module-collection">${(page?.items??[]).map(item=>`<article class="module-item">${button(tr('open',{revision:item.revision}),'open',busy,`data-revision="${item.revision}" aria-expanded="${selected?.entity.revision===item.revision}"`)}<p>${esc(new Date(item.at).toLocaleString())} / ${esc(item.action)}</p>${selected?.entity.revision===item.revision?`<section class="module-history" aria-label="${esc(tr('selected',{revision:selected.entity.revision}))}"><h3 tabindex="-1" data-module-history-revision>${esc(tr('selected',{revision:selected.entity.revision}))}</h3>${button(tr('close'),'close',busy)}<pre>${esc(JSON.stringify(selected.entity.data,null,2))}</pre></section>`:''}</article>`).join('')}</div></section>`;
 }
 async function action(name,node){
  if(!name.startsWith('history-'))return false;
  if(busy||id!==current()?.id)return true;
  if(name==='history-next'&&page?.nextCursor)await load(page.nextCursor,[...trail,page.cursor]);
  else if(name==='history-previous'&&trail.length)await load(trail.at(-1),trail.slice(0,-1));
  else if(name==='history-first'||name==='history-refresh')await load();
  else if(name==='history-open')await read(Number(node.dataset.revision));
  else if(name==='history-close'){const revision=selected.entity.revision;selected=null;draw();document.querySelector('[data-command="history-open"][data-revision="'+revision+'"]')?.focus({preventScroll:true});}
  else if(name==='history-retry')await retry?.();
  return true;
 }
 return {open,view,action,clear};
}
