import {collectionRecords,recordCollectionRoute,recordCollectionCommand,validRecordOwner,collectionAccessError} from './record-collection-client.js';
import {ownedAssetURL} from './project-context.js';
import {t} from './i18n/index.js';
import {revisionId} from './revision-model.js';
import {viewQuery} from './record-view-model.js';
import {recordTypeFilter} from './record-type-filter.js';
import {recordDomainChoices} from './record-query-ui.js';
import {recordBrowse,browseIssue,browseActive} from './record-query.js';
import {readBookPage,bookReadingView,scopeReadingAnchors,styleReadingRecords,bookReadingWindows,READING_PAGE_SIZE} from './lab-book-reader.js';
const text=(key,args)=>t('recordLists',key,args);

// The record list owns its asynchronous query and paging lifecycle. It never
// substitutes summaries for editable records in the workspace model.
export function recordListUI({state,api,esc,table,showDialog,chooseType,render,decorate=()=>{},access=operation=>operation()}){
 let key='',result=null,error=null,loading=false,controller=null,timer=null,generation=0,typeScope='',knownDomains=new Set();
 const snapshot=()=>result?.snapshotId??state.etag;
 const types=recordTypeFilter({state,api,esc,showDialog,snapshot,choose:chooseType});
 const active=()=>state.page==='entries'&&state.book&&!state.access?.locked&&!state.newWorkspace;
 const reading=()=>state.notebook!=='all'&&state.bookReading===true;
 const bookWindows=bookReadingWindows({api,esc,records:()=>result?.readingRecords??[],active:()=>active()&&reading(),decorate,assetUrl:id=>ownedAssetURL(state,'/api/media/'+id)});
 const queryKey=()=>JSON.stringify([state.storage?.contextId,state.book?.id,reading()?null:state.etag,viewQuery(state),reading()]);
 const issue=()=>browseIssue(recordBrowse(state.recordBrowse));
 const button=(label,action,disabled=false)=>`<button class="button" type="button" data-action="record-list-${action}" ${disabled?'disabled':''}>${esc(text(label))}</button>`;
 function stop({clear=false}={}){bookWindows.stop();if(clear||!active())types.stop();clearTimeout(timer);timer=null;controller?.abort();controller=null;generation++;loading=false;if(clear){key='';result=null;error=null;typeScope='';knownDomains.clear();}}
 function sync(){const scope=JSON.stringify([state.storage?.contextId,state.book?.id,state.etag,state.project,state.notebook]);if(scope!==typeScope){typeScope=scope;knownDomains.clear();}const next=queryKey();if(key!==next){stop();key=next;result=null;error=null;}}
 function count(){sync();return issue()?0:result?.total??'...';}
 function view(){
  sync();if(issue())return `<p role="alert" class="record-filter-error">${esc(issue())}</p>`;
  if(error)return `<section><p role="alert">${esc(error.message)}</p>${button(collectionAccessError(error)?'unlock':'refresh','refresh')}</section>`;
  if(loading||!result)return `<p role="status">${esc(text('loading'))}</p>`;
  const {counts,records,total,offset,nextCursor,changed}=result,b=recordBrowse(state.recordBrowse);
  const range=total?text('range',{first:offset+1,last:offset+records.length,total}):text('emptyRange');
  const status=`<p tabindex="-1" data-record-list-status>${esc(range)}</p>`;
  const controls=`<nav class="inline-actions record-list-pages" aria-label="${esc(text('pages'))}">${button('previous','previous',!result.previousCursor)}${button('next','next',!nextCursor)}${button('refresh','refresh')}</nav>`;
  const empty=(state.search||state.filter!=='all'||browseActive(b))?`<section class="workspace-empty"><h3>${esc(text('noMatches'))}</h3><p>${esc(text('adjust'))}</p><button class="button" data-action="clear-record-filters">${esc(text('clear'))}</button></section>`:table([]);
  return `${changed?`<p role="status">${esc(text('changed'))}</p>`:''}${status}<p class="record-counts">${esc(text('experiments',{count:counts.experiments}))} &middot; ${esc(text('runs',{count:counts.runs}))} &middot; ${esc(text('other',{count:counts.other}))}</p>${total?(reading()?bookReadingView(result.readingRecords,esc,{assetUrl:id=>ownedAssetURL(state,'/api/media/'+id)}):table(records)):empty}${controls}`;
 }
 function paint(){if(!active())return;const area=document.getElementById('entry-results'),badge=document.getElementById('record-count');if(area){area.innerHTML=view();scopeReadingAnchors(area);decorate(area);bookWindows.bind(area);}if(badge)badge.textContent=count();const domain=document.querySelector('[data-record-browse="domain"]');if(domain){const current=recordBrowse(state.recordBrowse).domain;domain.innerHTML=recordDomainChoices([...knownDomains],current).map(c=>'<option value="'+esc(c.value)+'"'+(c.value===current?' selected':'')+'>'+esc(c.label)+'</option>').join('');}}
 async function load(cursor=null,focus=false,unlock=false){
  bookWindows.stop();if(!active()||issue())return false;sync();const requestedKey=key,request=++generation;
  controller?.abort();controller=new AbortController();loading=true;error=null;paint();
  try{
   const aggregate=collectionRecords(state),route=aggregate?recordCollectionRoute(state):'/api/research/records/query',command=aggregate?recordCollectionCommand(state,{cursor,limit:25}):{workspaceId:state.book.id,query:viewQuery(state),cursor,limit:reading()?READING_PAGE_SIZE:25},signal=controller.signal;
   const run=()=>api(route,command,{adopt:false,signal}),data=await (unlock?access(run):run());
   if(aggregate&&(!Array.isArray(data.records)||data.records.some(row=>!validRecordOwner(row.owner))))throw Error(text('invalidPage'));
   if(request!==generation||!active()||queryKey()!==requestedKey)return false;
   if(data.workspaceId!==state.book.id||!revisionId(data.snapshotId)||!Array.isArray(data.records)||data.records.length>(reading()?READING_PAGE_SIZE:25)||!Number.isSafeInteger(data.total)||data.total<0||!Number.isSafeInteger(data.offset)||data.offset<0||data.offset+data.records.length>data.total||!Array.isArray(data.domains)||data.domains.some(id=>typeof id!=='string'||!id)||!data.counts||['experiments','runs','other'].some(k=>!Number.isSafeInteger(data.counts[k])||data.counts[k]<0)||typeof data.cursor!=='string'||data.previousCursor!==null&&typeof data.previousCursor!=='string'||data.nextCursor!==null&&typeof data.nextCursor!=='string')throw Error(text('invalidPage'));
   if(reading())data.readingRecords=await readBookPage({state,api,page:data,signal:controller.signal});
   if(request!==generation||!active()||queryKey()!==requestedKey)return false;
   for(const id of data.domains)knownDomains.add(id);
   result=data;if(data.readingRecords)styleReadingRecords(data.readingRecords,document);loading=false;paint();types.bind();if(focus)document.querySelector('[data-record-list-status]')?.focus();return true;
  }catch(e){
   if(request!==generation||!active()||queryKey()!==requestedKey)return false;
   if(e.name!=='AbortError'){error=e;loading=false;paint();}return false;
  }
 }
 function bind({delay=0}={}){
  if(!active()){stop();return;}sync();types.bind();const area=document.getElementById('entry-results');if(area){scopeReadingAnchors(area);decorate(area);bookWindows.bind(area);}if(result||error||loading||timer||issue())return;
  timer=setTimeout(()=>{timer=null;void load();},delay);
 }
 async function action(control){
  if(await bookWindows.action(control))return true;
  if(await types.action(control))return true;
  const name=control.dataset.action;if(!name?.startsWith('record-list-'))return false;
  if(name==='record-list-reading'||name==='record-list-table'){state.bookReading=name==='record-list-reading';stop({clear:true});render();return true;}
  if(loading)return true;sync();let cursor;
  if(name==='record-list-next'&&result?.nextCursor){cursor=result.nextCursor;}
  else if(name==='record-list-previous'&&result?.previousCursor)cursor=result.previousCursor;
  else if(name==='record-list-refresh'){cursor=null;}
  else return true;
  await load(cursor,true,collectionAccessError(error));return true;
 }
 function modes(){return state.notebook==='all'?'':`<nav class="record-reading-modes" aria-label="${esc(t('recordReading','view'))}">${[['reading','read'],['table','list']].map(([mode,label])=>`<button class="button" type="button" data-action="record-list-${mode}" aria-pressed="${(mode==='reading')===reading()}">${esc(t('recordReading',label))}</button>`).join('')}</nav>`;}
 return {view,count,snapshot,modes,hasPinnedReading:()=>active()&&reading()&&!!result,typeFilter:types.view,input:types.input,domains:()=>[...knownDomains],bind,stop,action};
}
