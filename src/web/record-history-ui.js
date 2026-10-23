import {ownedAssetURL} from './project-context.js';
import {recordChanges,recordRevisionView,recordRevisionComparison} from './record-revision-view.js';
import {t} from './i18n/index.js';
import {historyReadingPage,historyReadingControls} from './record-history-reading.js';
import {resultStatementAnchor} from './figure-result-links.js';

export function recordHistoryUI({state,api,esc,showDialog,notify,revisions,onRestore}){
 const media={assetUrl:id=>ownedAssetURL(state,'/api/media/'+id)};
 const attemptText=key=>esc(t('attempts',key));
 const message=(key,parameters)=>t('recordHistory',key,parameters),text=(key,parameters)=>esc(message(key,parameters));
 let owner=null,context=null,workspaceId=null,versions=[],selected=null,review=null,expected=null,busy=false,pageCursor=null,nextCursor=null,pageTrail=[];
 let sectionOffset=0,windows={},collection='sections',resultFigure=null,contentFocus=null,pendingContent=null,controller=null,epoch=0;
 const dialog=document.getElementById('dialog');dialog.addEventListener('close',()=>{controller?.abort();controller=null;epoch++;});
 const endpoint='/api/research/records/history/';
 const button=(label,action,extra='')=>`<button type="button" class="button" data-action="record-history-${action}" ${extra}>${label}</button>`;
 const command=extra=>({workspaceId,recordId:owner,...extra});
 const guard=()=>{if(context!==state.storage?.contextId||workspaceId!==state.book?.id||owner!==state.selected||!['editor','record-reader'].includes(state.page)||state.access?.locked)throw Error(message('reopen'));};
 const frame=(title,body,actions)=>{showDialog(`<div class="record-history"><h2 id="dialog-title" tabindex="-1">${esc(title)}</h2><div class="record-history-content" tabindex="0">${body}</div><div class="dialog-actions">${actions}</div></div>`);document.querySelector('.record-history h2')?.focus();};
 const date=v=>new Date(v).toLocaleString();
 async function list(cursor=pageCursor){
  controller?.abort();const request=new AbortController(),stamp=++epoch;controller=request;
  try{
  const result=await api(endpoint+'list',command({cursor,limit:20}),{adopt:false,signal:request.signal});if(request.signal.aborted||stamp!==epoch)return;guard();pageCursor=result.cursor??cursor;nextCursor=result.nextCursor??null;versions=result.versions;expected=result.currentRevision;review=null;selected=null;
  const current=versions.find(v=>v.current),total=result.total===undefined?versions.length:result.total;
  const range=versions.length?text(total===null?'rangeContinues':'range',{first:(result.offset??0)+1,last:(result.offset??0)+versions.length,total}):text(nextCursor?'duplicateWindow':'complete',{total});
  frame(message('title'),`<p><strong>${esc(result.title??current?.title??message('record'))}</strong></p><p class="muted">${text('description')}</p>
   ${result.changed?'<p role="status">'+text('changed')+'</p>':''}${result.total===1?'<p>'+text('noEarlier')+'</p>':''}<ol class="record-history-list">${versions.map((v,i)=>`<li><div><strong>${v.current?text('current'):esc(v.title)}${v.source.kind==='retained'?' '+text('retained'):''}</strong><p><time datetime="${esc(v.updatedAt)}">${esc(date(v.updatedAt))}</time> &middot; ${esc(v.status)}</p></div>${button(text(v.current?'viewCurrent':'review'),'select',`data-index="${i}"`)}</li>`).join('')}</ol><p role="status">${range}</p>`,button(text('newer'),'newer',pageTrail.length?'':'disabled')+button(text(versions.length?'older':'continue'),'older',nextCursor?'':'disabled')+button(text('refresh'),'refresh')+button(text('close'),'close'));
  }catch(error){if(!request.signal.aborted)throw error;}finally{if(controller===request)controller=null;}
 }
 async function inspect(index,{keepWindow=false,anchor=null,current=false}={}){
  const comparing=keepWindow&&document.querySelector('[data-history-compare]')?.open;
  selected=versions[index];if(!selected)return;
  if(!keepWindow){sectionOffset=0;windows={};collection='sections';resultFigure=null;}
  if(resultStatementAnchor(anchor))resultFigure=null;
  controller?.abort();const request=new AbortController(),stamp=++epoch;controller=request;
  try{
  const response=await api(endpoint+'read',command({source:selected.source,revision:selected.revision,paged:true,offset:sectionOffset,windows,...(resultFigure?{resultFigure}:{}),...(anchor?{anchor}:{})}),{adopt:false,signal:request.signal});if(request.signal.aborted||stamp!==epoch||!dialog.open)return;guard();review=response;expected=review.currentRevision;
  if(review.paged){resultFigure=review.previous.resultWindow?.figureId??null;sectionOffset=Math.max(review.previous.sections.offset,review.next.sections.offset);windows=Object.fromEntries(Object.keys(review.previous.collections).map(name=>[name,Math.max(review.previous.collections[name]?.offset??0,review.next.collections[name]?.offset??0)]));}
  const changed=review.paged?review.changed.map(key=>({label:message('field_'+key)})):recordChanges(review.record,review.current),isCurrent=selected.revision===expected;
  const previousFigureReference={kind:'record',id:owner,revision:selected.revision,workspaceId},currentFigureReference={kind:'record',id:owner,revision:expected,workspaceId},previousMedia={...media,figureReference:previousFigureReference},currentMedia={...media,figureReference:currentFigureReference};
  const previous=review.paged?historyReadingPage(review.previous,esc,previousMedia):recordRevisionView(review.record,esc,previousMedia);
  const comparison=review.paged?'<p>'+text('contentComparison')+'</p><h3>'+text('current')+'</h3>'+'<div data-history-current>'+historyReadingPage(review.next,esc,currentMedia)+'</div>':recordRevisionComparison(review.record,review.current,esc,{...media,previousFigureReference,currentFigureReference});
  frame(message(isCurrent?'current':'reviewTitle'),`<p><strong>${esc(review.record.title)}</strong><br><time datetime="${esc(review.record.updatedAt)}">${esc(date(review.record.updatedAt))}</time></p>
   ${review.paged?historyReadingControls(review,collection,esc):''}${!isCurrent?`<p>${text('changedSince',{fields:changed.length?changed.map(c=>c.label).join(', '):message('timestampOnly')})}</p><details data-history-compare ${comparing?'open':''}><summary>${text('compare')}</summary>${comparison}</details>`:''}
   <div data-history-retained>${previous}</div>`,button(text('back'),'list')+(!isCurrent?button(text('restoreVersion'),'confirm'):'')+button(text('close'),'close'));
  const currentView=dialog.querySelector('[data-history-current]');
  if(currentView){for(const node of currentView.querySelectorAll('[id^="result-"]'))node.id='history-current-'+node.id;for(const link of currentView.querySelectorAll('a[href^="#"]')){const anchor=resultStatementAnchor(link.getAttribute('href').slice(1));if(anchor)link.setAttribute('href','#history-current-'+anchor);}}
  const scope=current?'[data-history-current]':'[data-history-retained]',target=anchor?dialog.querySelector(scope+' [id="'+(current?'history-current-':'')+(resultStatementAnchor(anchor)??anchor)+'"]'):contentFocus?dialog.querySelector(contentFocus+':not([disabled])')??dialog.querySelector('[data-history-position]'):null;
  if(target){if(!target.matches('button,input,select,a[href]'))target.tabIndex=-1;target.focus({preventScroll:true});target.scrollIntoView({block:'nearest'});}else if(anchor)dialog.querySelector('.record-history-content').insertAdjacentHTML('afterbegin','<p role="status">'+text('resultUnavailable')+'</p>');contentFocus=null;
  }catch(error){if(!request.signal.aborted)throw error;}finally{if(controller===request)controller=null;}
 }
 async function loading(operation){
  busy=true;const buttons=[...document.querySelectorAll('.record-history button,.record-history input,.record-history select')].filter(control=>control.dataset.action!=='record-history-close').map(button=>({button,disabled:button.disabled}));
  buttons.forEach(({button})=>button.disabled=true);
  try{return await operation();}finally{busy=false;buttons.forEach(({button,disabled})=>{if(button.isConnected)button.disabled=disabled;});}
 }
 async function loadContent(options={}){
  pendingContent=options;dialog.querySelector('[data-history-content-error]')?.remove();
  try{await loading(()=>inspect(versions.indexOf(selected),{keepWindow:true,...options}));}
  catch(error){if(dialog.open&&dialog.querySelector('.record-history'))dialog.querySelector('.record-history-content').insertAdjacentHTML('afterbegin','<div data-history-content-error><p role="alert">'+esc(error.message??message('reopen'))+'</p>'+button(text('contentRetry'),'content-retry')+'</div>');}
 }
 async function action(control){
  const name=control.dataset.action;if(!name?.startsWith('record-history-'))return false;
  const act=name.slice('record-history-'.length);
  if(act==='close'){controller?.abort();epoch++;document.getElementById('dialog').close();return true;}
  if(busy)return true;
  if(act==='open'){
   if(state.page!=='record-reader'&&!revisions()[state.selected]){notify(message('saveFirst'));return true;}
   owner=state.selected;context=state.storage?.contextId;workspaceId=state.book.id;pageCursor=null;pageTrail=[];await loading(()=>list());return true;
  }
  guard();
  if(act==='content-retry'){await loadContent(pendingContent??{});return true;}
  if(['results-figure','results-all'].includes(act)&&review?.paged){
   resultFigure=act==='results-all'?null:control.dataset.resultFigure;collection='results';windows={...windows,results:0};contentFocus='[data-history-retained] .result-statements>section';await loadContent();return true;
  }
  if(act.startsWith('content-')&&review?.paged){
   collection=document.querySelector('[data-history-collection]').value;const pages=collection==='sections'?[review.previous.sections,review.next.sections]:[review.previous.collections[collection],review.next.collections[collection]],offset=Math.max(...pages.map(page=>page?.offset??0));
   let position=offset+(act==='content-previous'?-4:4);
   if(act==='content-go'){const input=document.querySelector('[data-history-position]');if(!input.reportValidity())return true;position=Number(input.value)-1;}
   if(collection==='sections')sectionOffset=Math.max(0,position);else windows={...windows,[collection]:Math.max(0,position)};
   contentFocus='[data-action="'+name+'"]';await loadContent();return true;
  }
  if(act==='list')await loading(()=>list());
  if(act==='older'&&nextCursor){pageTrail.push(pageCursor);try{await loading(()=>list(nextCursor));}catch(error){pageTrail.pop();throw error;}}
  if(act==='newer'&&pageTrail.length){const previous=pageTrail.at(-1);pageTrail.pop();try{await loading(()=>list(previous));}catch(error){pageTrail.push(previous);throw error;}}
  if(act==='refresh'){const trail=pageTrail;pageTrail=[];try{await loading(()=>list(null));}catch(error){pageTrail=trail;throw error;}}
  if(act==='select')await loading(()=>inspect(Number(control.dataset.index)));
  if(act==='confirm'){
   if(!review||!selected)return true;
   frame(message('restoreTitle'),`<p>${text('restoreQuestion',{title:review.record.title,date:date(review.record.updatedAt)})}</p>
    <p>${text('restoreScope')}</p>${review.current.attempt?'<p>'+attemptText('restoreNote')+'</p>':''}<p>${text('restorePrivate')}</p>`,button(text('cancel'),'cancel')+button(text('restore'),'restore'));
  }
  if(act==='cancel')await loading(()=>inspect(versions.indexOf(selected)));
  if(act==='restore'){
   if(!review||!selected)return true;
   if(state.dirty){notify(message('unsaved'),true);return true;}
   busy=true;document.querySelectorAll('.record-history button').forEach(b=>b.disabled=true);
   try{
    const result=await api(endpoint+'restore',command({source:selected.source,revision:selected.revision,expectedRevision:expected,baseEtag:state.etag,...(state.page==='record-reader'?{receipt:true}:{})}),state.page==='record-reader'?{adopt:false}:{});guard();
    await onRestore(result);notify(message('restored'));
   }finally{busy=false;document.querySelectorAll('.record-history button').forEach(b=>b.disabled=false);}
  }
  return true;
 }
 document.addEventListener('change',event=>{if(!busy&&event.target.matches('[data-history-collection]')&&review?.paged){collection=event.target.value;event.target.closest('[data-history-reading-controls]').outerHTML=historyReadingControls(review,collection,esc);dialog.querySelector('[data-history-collection]')?.focus();}});
 dialog.addEventListener('click',event=>{
  const link=event.target.closest('.record-history:not(.retained-record-reader) a[href^="#"]'),anchor=resultStatementAnchor(link?.getAttribute('href').slice(1).replace(/^history-current-/,''));
  if(!anchor||!review?.paged||!dialog.open)return;event.preventDefault();event.stopPropagation();if(busy)return;
  try{guard();}catch{return;}collection='results';resultFigure=null;void loadContent({anchor,current:!!link.closest('[data-history-current]')});
 });
 return {action,isBusy:()=>busy,button:({saved=!!revisions()[state.selected]}={})=>button(text('button'),'open',saved?'':'disabled title="'+text('saveFirst')+'"')};
}
