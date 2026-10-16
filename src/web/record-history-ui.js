import {ownedAssetURL} from './project-context.js';
import {recordChanges,recordRevisionView,recordRevisionComparison} from './record-revision-view.js';
import {t} from './i18n/index.js';
import {historyReadingPage,historyReadingControls} from './record-history-reading.js';

export function recordHistoryUI({state,api,esc,showDialog,notify,revisions,onRestore}){
 const media={assetUrl:id=>ownedAssetURL(state,'/api/media/'+id)};
 const attemptText=key=>esc(t('attempts',key));
 const message=(key,parameters)=>t('recordHistory',key,parameters),text=(key,parameters)=>esc(message(key,parameters));
 let owner=null,context=null,workspaceId=null,versions=[],selected=null,review=null,expected=null,busy=false,pageCursor=null,nextCursor=null,pageTrail=[];
 let sectionOffset=0,windows={},collection='sections';
 const endpoint='/api/research/records/history/';
 const button=(label,action,extra='')=>`<button type="button" class="button" data-action="record-history-${action}" ${extra}>${label}</button>`;
 const command=extra=>({workspaceId,recordId:owner,...extra});
 const guard=()=>{if(context!==state.storage?.contextId||workspaceId!==state.book?.id||owner!==state.selected||!['editor','record-reader'].includes(state.page)||state.access?.locked)throw Error(message('reopen'));};
 const frame=(title,body,actions)=>{showDialog(`<div class="record-history"><h2 id="dialog-title" tabindex="-1">${esc(title)}</h2><div class="record-history-content" tabindex="0">${body}</div><div class="dialog-actions">${actions}</div></div>`);document.querySelector('.record-history h2')?.focus();};
 const date=v=>new Date(v).toLocaleString();
 async function list(cursor=pageCursor){
  const result=await api(endpoint+'list',command({cursor,limit:20}));guard();pageCursor=result.cursor??cursor;nextCursor=result.nextCursor??null;versions=result.versions;expected=result.currentRevision;review=null;selected=null;
  const current=versions.find(v=>v.current),total=result.total===undefined?versions.length:result.total;
  const range=versions.length?text(total===null?'rangeContinues':'range',{first:(result.offset??0)+1,last:(result.offset??0)+versions.length,total}):text(nextCursor?'duplicateWindow':'complete',{total});
  frame(message('title'),`<p><strong>${esc(result.title??current?.title??message('record'))}</strong></p><p class="muted">${text('description')}</p>
   ${result.changed?'<p role="status">'+text('changed')+'</p>':''}${result.total===1?'<p>'+text('noEarlier')+'</p>':''}<ol class="record-history-list">${versions.map((v,i)=>`<li><div><strong>${v.current?text('current'):esc(v.title)}${v.source.kind==='retained'?' '+text('retained'):''}</strong><p><time datetime="${esc(v.updatedAt)}">${esc(date(v.updatedAt))}</time> &middot; ${esc(v.status)}</p></div>${button(text(v.current?'viewCurrent':'review'),'select',`data-index="${i}"`)}</li>`).join('')}</ol><p role="status">${range}</p>`,button(text('newer'),'newer',pageTrail.length?'':'disabled')+button(text(versions.length?'older':'continue'),'older',nextCursor?'':'disabled')+button(text('refresh'),'refresh')+button(text('close'),'close'));
 }
 async function inspect(index,{keepWindow=false}={}){
  const comparing=keepWindow&&document.querySelector('[data-history-compare]')?.open;
  selected=versions[index];if(!selected)return;
  if(!keepWindow){sectionOffset=0;windows={};collection='sections';}
  review=await api(endpoint+'read',command({source:selected.source,revision:selected.revision,paged:true,offset:sectionOffset,windows}),{adopt:false});guard();expected=review.currentRevision;
  const changed=review.paged?review.changed.map(key=>({label:message('field_'+key)})):recordChanges(review.record,review.current),isCurrent=selected.revision===expected;
  const previous=review.paged?historyReadingPage(review.previous,esc,media):recordRevisionView(review.record,esc,media);
  const comparison=review.paged?'<p>'+text('contentComparison')+'</p><h3>'+text('current')+'</h3>'+historyReadingPage(review.next,esc,media):recordRevisionComparison(review.record,review.current,esc,media);
  frame(message(isCurrent?'current':'reviewTitle'),`<p><strong>${esc(review.record.title)}</strong><br><time datetime="${esc(review.record.updatedAt)}">${esc(date(review.record.updatedAt))}</time></p>
   ${review.paged?historyReadingControls(review,collection,esc):''}${!isCurrent?`<p>${text('changedSince',{fields:changed.length?changed.map(c=>c.label).join(', '):message('timestampOnly')})}</p><details data-history-compare ${comparing?'open':''}><summary>${text('compare')}</summary>${comparison}</details>`:''}
   ${previous}`,button(text('back'),'list')+(!isCurrent?button(text('restoreVersion'),'confirm'):'')+button(text('close'),'close'));
 }
 async function loading(operation){
  busy=true;const buttons=[...document.querySelectorAll('.record-history button')].map(button=>({button,disabled:button.disabled}));
  buttons.forEach(({button})=>button.disabled=true);
  try{return await operation();}finally{busy=false;buttons.forEach(({button,disabled})=>{if(button.isConnected)button.disabled=disabled;});}
 }
 async function action(control){
  const name=control.dataset.action;if(!name?.startsWith('record-history-'))return false;
  if(busy)return true;
  const act=name.slice('record-history-'.length);
  if(act==='close'){document.getElementById('dialog').close();return true;}
  if(act==='open'){
   if(state.page!=='record-reader'&&!revisions()[state.selected]){notify(message('saveFirst'));return true;}
   owner=state.selected;context=state.storage?.contextId;workspaceId=state.book.id;pageCursor=null;pageTrail=[];await loading(()=>list());return true;
  }
  guard();
  if(act.startsWith('content-')&&review?.paged){
   collection=document.querySelector('[data-history-collection]').value;const pages=collection==='sections'?[review.previous.sections,review.next.sections]:[review.previous.collections[collection],review.next.collections[collection]],offset=Math.max(...pages.map(page=>page?.offset??0));
   let position=offset+(act==='content-previous'?-4:4);
   if(act==='content-go'){const input=document.querySelector('[data-history-position]');if(!input.reportValidity())return true;position=Number(input.value)-1;}
   if(collection==='sections')sectionOffset=Math.max(0,position);else windows={...windows,[collection]:Math.max(0,position)};
   await loading(()=>inspect(versions.indexOf(selected),{keepWindow:true}));return true;
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
 document.addEventListener('change',event=>{if(event.target.matches('[data-history-collection]')&&review?.paged){collection=event.target.value;event.target.closest('nav').outerHTML=historyReadingControls(review,collection,esc);}});
 return {action,isBusy:()=>busy,button:({saved=!!revisions()[state.selected]}={})=>button(text('button'),'open',saved?'':'disabled title="'+text('saveFirst')+'"')};
}
