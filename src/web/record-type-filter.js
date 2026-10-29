import {collectionRecords,recordCollectionRoute} from './record-collection-client.js';
import {lookupRecordTypes} from './record-type-lookup.js';
import {viewQuery} from './record-view-model.js';
import {RECORD_TYPES} from './record-types.js';
import {recordTypeLabel} from './record-type-presentation.js';
import {t} from './i18n/index.js';
const text=(key,args)=>t('recordTypes',key,args);
// The list keeps one type page. Browsing additional types is a dedicated,
// cancellable dialog; it never accumulates a workspace-sized option list.
export function recordTypeFilter({state,api,esc,showDialog,snapshot,choose}){
 let key='',result=null,pending=null,error=false,modal=null,timer=null;
 const dialog=()=>document.querySelector('#dialog');
 const command=()=>{const q=viewQuery(state);return {workspaceId:state.book.id,etag:collectionRecords(state)?state.etag:snapshot(),projectId:q.projectId,notebookId:q.notebookId,selected:q.filter,search:'',cursor:null,limit:25};};
 const identity=()=>JSON.stringify([state.storage?.contextId,command()]);
 const button=(label,action,extra='')=>`<button type="button" class="button" data-action="record-type-${action}" ${extra}>${esc(text(label))}</button>`;
 function cancel(){clearTimeout(timer);pending?.abort();pending=null;}
 function stop(){cancel();key='';result=null;error=false;if(modal){modal=null;dialog().close();}}
 function sync(){const next=identity();if(key!==next){stop();key=next;}return next;}
 function choices(){
  const values=result?.items??RECORD_TYPES.map(v=>({value:v.id,label:v.label}));
  const selected=state.filter;
  return [{value:'all',label:text('all')},...values,...(selected!=='all'&&!values.some(v=>v.value===selected)?[result?.selected??{value:selected,label:text(result?'unavailable':'saved')}]:[])];
 }
 function view(){sync();return `<span id="record-type-control" class="record-type-control">${control()}</span>`;}
 function control(){return `<select id="type-filter" class="filter-select" aria-label="${esc(text('filter'))}">${choices().map(v=>`<option value="${esc(v.value)}" ${v.value===state.filter?'selected':''}>${esc(recordTypeLabel(v.value,v.label))}</option>`).join('')}</select>${button('find','open')}`;}
 function paint(){
  const node=document.getElementById('record-type-control');if(!node)return;
  const focused=node.contains(document.activeElement),id=document.activeElement?.id;node.innerHTML=control();
  if(focused)(id==='type-filter'?node.querySelector('select'):node.querySelector('button')).focus({preventScroll:true});
 }
 async function load({cursor=null,search='',inDialog=false,focus=null}={}){
  cancel();const request=new AbortController(),requestedKey=key,requestedModal=modal;pending=request;error=false;
  if(inDialog){modal.cursor=cursor;modal.loading=true;modal.error=false;paintDialog();}
  try{
   const transport=collectionRecords(state)?(_route,data,options)=>api(recordCollectionRoute(state).replace(/query$/,'types'),data,options):api;
   const page=await lookupRecordTypes(transport,{...command(),search,cursor},{signal:request.signal});
   if(request.signal.aborted||identity()!==requestedKey||key!==requestedKey||inDialog&&modal!==requestedModal)return;
   if(inDialog){modal.page=page;modal.loading=false;}else result=page;
  }catch(e){
   if(request.signal.aborted||key!==requestedKey||inDialog&&modal!==requestedModal)return;
   if(inDialog){modal.loading=false;modal.error=true;}else error=true;
  }finally{if(pending===request)pending=null;}
  if(request.signal.aborted)return;
  if(inDialog){paintDialog();const target=focus&&dialog().querySelector('[data-action="record-type-'+focus+'"]');(target&&!target.disabled?target:dialog().querySelector('[data-type-search]')).focus({preventScroll:true});}
  else paint();
 }
 function bind(){sync();if(!result&&!pending&&!error)void load();}
 function paintDialog(){
  const host=dialog().querySelector('[data-type-results]');if(!modal||!host)return;
  const page=modal.page;
  host.innerHTML=modal.loading?`<p role="status">${esc(text('loading'))}</p>`:modal.error?`<p role="alert">${esc(text('error'))}</p>${button('retry','retry')}`:page?`<p role="status">${esc(page.total?text('range',{first:page.offset+1,last:page.offset+page.items.length,total:page.total}):text('empty'))}</p>
   <ul class="record-type-options">${page.items.map(v=>`<li><button type="button" class="button" data-action="record-type-choose" data-value="${esc(v.value)}" aria-pressed="${v.value===state.filter}">${esc(recordTypeLabel(v.value,v.label))}</button></li>`).join('')}</ul>
   <nav class="inline-actions" aria-label="${esc(text('pages'))}">${button('previous','previous',page.previousCursor?'':'disabled')}${button('next','next',page.nextCursor?'':'disabled')}</nav>`:'';
 }
 function open(){
  sync();cancel();modal={page:result,search:'',loading:!result,error:false};
  showDialog(`<section class="record-type-picker"><h2 id="dialog-title">${esc(text('title'))}</h2><label>${esc(text('search'))}<input type="search" data-type-search maxlength="160"></label><div data-type-results></div><div class="dialog-actions">${button('all','all')}${button('cancel','cancel')}</div></section>`);
  paintDialog();dialog().querySelector('[data-type-search]').focus();if(!result)void load({inDialog:true});
 }
 function input(el){
  if(!modal||!el.hasAttribute('data-type-search'))return false;
  cancel();modal.search=el.value;modal.loading=true;paintDialog();timer=setTimeout(()=>void load({search:modal.search,inDialog:true}),180);return true;
 }
 async function action(el){
  const name=el.dataset.action;if(!name?.startsWith('record-type-'))return false;
  if(name==='record-type-open'){open();return true;}
  if(!modal)return true;
  if(identity()!==key){stop();return true;}
  if(name==='record-type-cancel'){dialog().close();return true;}
  if(name==='record-type-all'||name==='record-type-choose'){
   const selected=name==='record-type-all'?{value:'all'}:modal.page?.items.find(v=>v.value===el.dataset.value);
   if(selected){dialog().close();choose(selected.value);}return true;
  }
  const direction=name.slice('record-type-'.length);
  if(direction==='retry')await load({search:modal.search,cursor:modal.cursor,inDialog:true});
  else if(!modal.loading&&['next','previous'].includes(direction)&&modal.page?.[direction+'Cursor'])await load({search:modal.search,cursor:modal.page[direction+'Cursor'],inDialog:true,focus:direction});
  return true;
 }
 dialog().addEventListener('close',()=>{if(modal){cancel();modal=null;document.querySelector('[data-action="record-type-open"]')?.focus({preventScroll:true});}});
 return {view,bind,stop,input,action};
}
