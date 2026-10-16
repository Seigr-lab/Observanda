import {t} from './i18n/index.js';
import {bookSourceMap} from './book-source-map.js';
export function migrationProvenanceUI({state,api,esc}){
 const text=(key,values)=>esc(t('migrationImport',key,values)),dialog=document.createElement('dialog');dialog.className='provenance-dialog';dialog.setAttribute('aria-labelledby','provenance-title');document.body.append(dialog);
 let owner=null,controller=null,generation=0,page=null,trail=[],after=null,pending=null,busy=false,error='',prior=null;
 const identity=()=>['editor','record-reader'].includes(state.page)&&!state.access?.locked&&!state.storageUnavailable&&state.book&&state.selected?JSON.stringify([state.storage?.contextId,state.book.id,state.selected,state.page]):null;
 const current=token=>dialog.open&&owner===identity()&&generation===token;
 const button=(key,action,disabled=false)=>'<button type="button" class="button" data-provenance-action="'+action+'"'+(disabled?' disabled':'')+'>'+text(key)+'</button>';
 function stop(){controller?.abort();controller=null;generation++;owner=null;busy=false;pending=null;page=null;trail=[];after=null;error='';}
 function close(){stop();dialog.close();if(prior?.isConnected)prior.focus({preventScroll:true});}
 dialog.addEventListener('close',()=>{if(!dialog.open)stop();});dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 function body(result){
  return result.items.length?result.items.map(({ref,batch,source,mapping,conversion})=>'<section><h3>'+esc(source.title)+'</h3><p>'+esc(ref.namespace)+' / '+esc(ref.sourceId)+' @ '+esc(ref.sourceRevision)+'</p><p>'+text('importTime',{time:batch.receipt?.committedAt??batch.createdAt})+'</p>'+
   '<p>'+text('state-'+batch.state)+'</p><dl>'+source.dates.map(d=>'<dt>'+esc(d.meaning)+'</dt><dd>'+esc(d.value??t('migrationImport','unknown'))+'</dd>').join('')+'</dl>'+
   '<ul>'+source.files.map((f,i)=>'<li><a download href="/api/migration/original/'+ref.batchId+'/'+ref.index+'/'+i+'?context='+encodeURIComponent(state.storage?.contextId??'')+'">'+esc(f.path)+'</a><p>'+esc(f.sha256)+' · '+f.bytes+'</p><pre>'+esc(JSON.stringify(f.selector))+'</pre></li>').join('')+'</ul>'+
   bookSourceMap(conversion,source.files[mapping.contentFile],esc)+'<details><summary>'+text('sourceDetails')+'</summary><pre>'+esc(JSON.stringify({source,mapping,conversion},null,2))+'</pre></details></section>').join(''):'<p>'+text('noProvenance')+'</p>';
 }
 function paint(){
  dialog.innerHTML='<div class="migration-import"><h2 id="provenance-title" tabindex="-1">'+text('provenance')+'</h2><div data-provenance-content>'+(page?.html??'')+'</div><p role="status">'+(busy?text('provenanceLoading'):'')+'</p><p role="alert">'+esc(error)+'</p><div class="dialog-actions">'+button('provenancePrevious','previous',busy||!trail.length)+button('provenanceNext','next',busy||!page?.next)+(error?button('provenanceRetry','retry',busy):'')+(busy?button('provenanceCancel','cancel'):'')+button('close','close')+'</div></div>';
 }
 async function load(request){
  controller?.abort();controller=new AbortController();const token=++generation;pending=request;busy=true;error='';paint();
  try{
   const result=await api('/api/migration/import/provenance',{workspaceId:state.book.id,recordId:state.selected,after:request.after},{adopt:false,signal:controller.signal});if(!current(token))return;
   if(!result||!Array.isArray(result.items)||result.items.length>20||result.next!==null&&(typeof result.next!=='string'||!result.next||result.next===request.after))throw Error(t('migrationImport','provenanceIncomplete'));
   const html=body(result);after=request.after;trail=request.trail;page={html,next:result.next};pending=null;
  }catch(failure){if(current(token)&&failure.name!=='AbortError')error=failure.message;}
  finally{if(current(token)){busy=false;paint();dialog.querySelector(error?'[data-provenance-action="retry"]':'#provenance-title')?.focus({preventScroll:true});}}
 }
 dialog.addEventListener('click',event=>{
  const action=event.target.closest('[data-provenance-action]')?.dataset.provenanceAction;if(!action)return;
  if(action==='close'){close();return;}
  if(action==='cancel'){controller?.abort();generation++;busy=false;error=t('migrationImport','provenanceCancelled');paint();return;}
  if(busy||owner!==identity())return;
  const request=action==='retry'?pending:action==='next'&&page?.next?{after:page.next,trail:[...trail,after]}:action==='previous'&&trail.length?{after:trail.at(-1),trail:trail.slice(0,-1)}:null;
  if(request)void load(request);
 });
 return {
  button:()=>'<button type="button" class="button" data-action="migration-provenance-open">'+text('provenance')+'</button>',
  release(){if(owner&&owner!==identity())close();},
  async action(control){if(control.dataset.action!=='migration-provenance-open')return false;const key=identity();if(!key)return true;stop();owner=key;prior=document.activeElement;paint();dialog.showModal();await load({after:null,trail:[]});return true;}
 };
}
