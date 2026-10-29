import {recordBrowse} from './record-query.js';
import {researchTargets} from './research-target-presentation.js';
import {researchId} from './research-reference.js';
import {revisionId} from './revision-model.js';
import {t} from './i18n/index.js';
const text=(key,parameters)=>t('researchPicker',key,parameters);

// One page of record summaries. Saved record bodies are read only after an
// explicit choice to retain a revision, by the existing materials service.
export function researchTargetPicker({state,api,esc,field,showDialog,active=()=>['editor','record-reader'].includes(state.page),excludeId=()=>state.selected}){
 const limit=25;
 let session=null,controller=null,timer=null,generation=0;
 const identity=()=>JSON.stringify([state.storage?.contextId,state.book?.id,state.projectOwner?.projectId??null,state.page,excludeId()]);
 const button=(label,action,extra='')=>`<button type="button" class="button" data-action="research-target-${action}" ${extra}>${label}</button>`;
 const valid=s=>session===s&&s?.identity===identity()&&s.root.isConnected&&s.dialog.open&&active()&&!state.access?.locked&&!state.storageUnavailable;
 function cancel(){controller?.abort();controller=null;clearTimeout(timer);timer=null;if(session)session.choosing=false;generation++;}
 function stop(){cancel();if(session){session.dialog.removeEventListener('close',stop);session.unbind?.();}session=null;}
 function sync(){if(session&&!valid(session))stop();}
 function paint(){
  const s=session;if(!valid(s))return;
  const result=s.result;
  s.root.querySelector('[data-target-results]').setAttribute('aria-busy',String(s.loading||s.choosing));
  s.root.querySelector('[data-target-results]').innerHTML=`${s.error?`<p role="alert">${esc(s.error)}</p>${button(esc(text('refresh')),'refresh')}`:''}
   ${s.loading?`<p role="status">${esc(text('loading'))}</p>`:result?`${result.changed?`<p role="status">${esc(text('changed'))}</p>`:''}
    <p role="status" tabindex="-1" data-target-status>${esc(result.total?text('range',{first:result.offset+1,last:result.offset+result.items.length,total:result.total}):text('empty'))}</p>
    <ul class="research-link-targets">${result.items.map((item,i)=>`<li>${button(`<span>${esc(item.title)}<small> — ${esc(item.context)}</small></span>`,'choose',`data-index="${i}" ${s.choosing?'disabled':''}`)}</li>`).join('')}</ul>
    <div class="inline-actions">${result.previousCursor!==null?button(esc(text('previous')),'previous',s.choosing?'disabled':''):''}${result.nextCursor!==null?button(esc(text('next')),'next',s.choosing?'disabled':''):''}${s.error?'':button(esc(text('refresh')),'refresh',s.choosing?'disabled':'')}</div>`:''}`;
 }
 function validate(result,s){
  if(result?.workspaceId!==state.book.id||!Array.isArray(result.records)||result.records.length>limit||!Number.isSafeInteger(result.total)||result.total<0||!Number.isSafeInteger(result.offset)||result.offset<0||result.offset%limit||result.offset+result.records.length>result.total||result.records.length!==Math.min(limit,result.total-result.offset)||typeof result.cursor!=='string'||!result.cursor||![result.previousCursor,result.nextCursor].every(c=>c===null||typeof c==='string'&&c.length>0)||Boolean(result.previousCursor)!==Boolean(result.offset)||Boolean(result.nextCursor)!==(result.offset+result.records.length<result.total)||new Set(result.records.map(r=>r.id)).size!==result.records.length||result.records.some(r=>!researchId(r.id)||r.id===s.recordId||!revisionId(r.revision)||typeof r.title!=='string'||!researchId(r.notebookId)||s.recordType==='run'&&r.type!=='run'||s.recordType==='non-run'&&r.type==='run'))throw Error(text('invalid'));
 }
 async function load(cursor=null,{focus=false}={}){
  cancel();const s=session;if(!valid(s))return;
  const request=generation;controller=new AbortController();const signal=controller.signal;
  s.loading=true;s.error='';s.result=null;paint();
  try{
   let result;
   if(s.kind==='record'){
    const page=await api('/api/research/records/query',{workspaceId:state.book.id,query:{projectId:null,notebookId:null,filter:'all',search:s.search,browse:recordBrowse({sort:'title'})},selection:{excludeId:s.recordId,recordType:s.recordType},cursor,limit},{adopt:false,signal});
    if(!valid(s)||request!==generation)return;validate(page,s);
    result={...page,items:page.records.map(r=>({workspaceId:page.workspaceId,kind:'record',id:r.id,revision:r.revision,title:r.title,context:state.book.notebooks.find(n=>n.id===r.notebookId)?.title??text('record')}))};
    delete result.records;
   }else{
    // Structural metadata is already present in the workspace outline. Page it
    // separately rather than constructing a duplicate list of record bodies.
    const matches=researchTargets({...state.book,entries:[]}).filter(t=>t.kind===s.kind&&(t.title+' '+t.context).toLocaleLowerCase().includes(s.search.toLocaleLowerCase())),offset=cursor??0;
    result={items:matches.slice(offset,offset+limit),total:matches.length,offset,previousCursor:offset?Math.max(0,offset-limit):null,nextCursor:offset+limit<matches.length?offset+limit:null};
   }
   if(!valid(s)||request!==generation)return;s.result=result;
  }catch(error){if(!valid(s)||request!==generation||signal.aborted)return;s.error=error.message??text('searchFailed');}
  finally{if(valid(s)&&request===generation){s.loading=false;controller=null;paint();if(focus)(s.root.querySelector('[data-action="research-target-choose"]')??s.root.querySelector('[data-target-status]')??s.root.querySelector('[data-action="research-target-refresh"]'))?.focus();}}
 }
 function open({title=text('title'),controls='',recordType='all',recordsOnly=false,kinds=['record','notebook','project','workspace'],onChoose,root:host=null,onCancel}){
  stop();
  const markup=`<${host?'h3':'h2 id="dialog-title"'}>${esc(title)}</${host?'h3':'h2'}><div data-research-picker>${controls}
   ${field(esc(text('find')),`<input id="research-target-search" type="search" maxlength="512" placeholder="${esc(text('placeholder'))}">`)}
   <div data-target-kind ${recordsOnly?'hidden':''}>${field(esc(text('kind')),`<select id="research-target-kind">${[['record','records'],['notebook','notebooks'],['project','projects'],['workspace','workspace']].filter(([kind])=>kinds.includes(kind)).map(([value,key])=>`<option value="${value}">${esc(text(key))}</option>`).join('')}</select>`)}</div>
   <div data-target-results aria-busy="false"></div></div><div class="dialog-actions">${button(esc(text('cancel')),'cancel')}</div>`;
  if(host)host.innerHTML=markup;else showDialog(markup);
  const root=(host??document).querySelector('[data-research-picker]'),dialog=root.closest('dialog');
  session={root,dialog,identity:identity(),recordId:excludeId()??null,recordType,kind:'record',search:'',onChoose,onCancel,loading:false,choosing:false,result:null,error:''};
  if(host){
   // Embedded discovery keeps the caller's form and its unsaved values mounted.
   // Its events belong to this picker, not another picker in the app shell.
   const click=event=>{const control=event.target.closest('[data-action^="research-target-"]');if(control&&host.contains(control)){event.preventDefault();event.stopPropagation();void action(control);}};
   const change=event=>{if(event.type==='input'&&event.target.id==='research-target-search'||event.type==='change'&&event.target.id==='research-target-kind'){if(input(event.target))event.stopPropagation();}};
   const keydown=event=>{if(event.key==='Enter'&&event.target.id==='research-target-search')event.preventDefault();};
   host.addEventListener('click',click);host.addEventListener('input',change);host.addEventListener('change',change);host.addEventListener('keydown',keydown);
   session.unbind=()=>{host.removeEventListener('click',click);host.removeEventListener('input',change);host.removeEventListener('change',change);host.removeEventListener('keydown',keydown);};
  }
  dialog.addEventListener('close',stop,{once:true});void load();root.querySelector('#research-target-search').focus();
 }
 function recordsOnly(value){const s=session;if(!valid(s))return;const kind=s.root.querySelector('#research-target-kind');s.root.querySelector('[data-target-kind]').hidden=value;if(value&&s.kind!=='record'){kind.value=s.kind='record';void load();}}
 function input(el){
  const s=session;if(!valid(s)||!s.root.contains(el))return false;
  if(el.id==='research-target-search'){cancel();s.search=el.value;s.result=null;s.loading=true;s.error='';paint();timer=setTimeout(()=>void load(),180);return true;}
  if(el.id==='research-target-kind'){s.kind=el.value;void load();return true;}
  return false;
 }
 async function action(control){
  const name=control.dataset.action;if(!name?.startsWith('research-target-'))return false;
  const s=session;if(!valid(s))return false;
  if(name==='research-target-cancel'){stop();if(s.onCancel)s.onCancel();else s.dialog.close();return true;}
  if(s.choosing)return true;
  if(name==='research-target-refresh'){await load();return true;}
  if(name==='research-target-next'||name==='research-target-previous'){const cursor=s.result?.[name.endsWith('next')?'nextCursor':'previousCursor'];if(cursor!==null&&cursor!==undefined)await load(cursor,{focus:true});return true;}
  if(name==='research-target-choose'){
   const item=s.result?.items[Number(control.dataset.index)];if(!item||s.loading)return true;
   cancel();const request=generation;controller=new AbortController();const signal=controller.signal,stillCurrent=()=>valid(s)&&request===generation&&!signal.aborted;
   s.choosing=true;s.error='';paint();
   try{await s.onChoose(item,{signal,stillCurrent});}
   catch(error){if(stillCurrent())s.error=error.code==='RECORD_CHANGED'?text('recordChanged'):error.message??text('chooseFailed');}
   finally{if(valid(s)&&request===generation){s.choosing=false;controller=null;paint();}}
   return true;
  }
  return false;
 }
 return {open,input,action,stop,sync,recordsOnly};
}
