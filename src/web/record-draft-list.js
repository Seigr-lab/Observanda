import {researchId} from './research-reference.js';
import {readRecordCheckpoint} from './record-draft-transfer.js';
import {recordDraftPreview} from './record-draft-preview.js';
import {recordDraftRecords} from './record-draft-records.js';
import {revisionId} from './revision-model.js';
import {t} from './i18n/index.js';
const text=(key,args)=>t('recordDrafts',key,args);
const validItem=item=>item&&researchId(item.id)&&revisionId(item.revision)&&typeof item.updatedAt==='string'&&Number.isFinite(Date.parse(item.updatedAt))&&Number.isSafeInteger(item.count)&&item.count>0&&Array.isArray(item.titles)&&item.titles.length===Math.min(item.count,3)&&item.titles.every(title=>typeof title==='string'&&title.length<=160);
// Discovery owns one page. No checkpoint body is loaded until Review draft.
export function recordDraftList({api,esc,onChange,recover,recoverWriting,recoverValue,recoverDocument,checkpoint,notify}){
 const preview=recordDraftPreview({api,esc}),selectRecord=recordDraftRecords({api,esc});
 let owner=null,generation=0,controller=null,page=null,cursor=null,available=false,failed=false,busy=false,focusBefore=null;
 const dialog=document.createElement('dialog');dialog.className='record-recovery record-draft-list';dialog.setAttribute('aria-labelledby','draft-list-title');document.body.append(dialog);
 const button=(label,action,extra='')=>'<button type="button" class="button" data-draft-'+action+' '+extra+'>'+esc(text(label))+'</button>';
 const current=(epoch,workspaceId)=>epoch===generation&&owner?.workspaceId===workspaceId;
 function abort(){controller?.abort();controller=null;}
 function close(){const wasOpen=dialog.open;abort();dialog.close();dialog.innerHTML='';page=null;if(wasOpen)(focusBefore?.isConnected?focusBefore:document.querySelector('[data-record-drafts]'))?.focus({preventScroll:true});}
 dialog.oncancel=event=>{event.preventDefault();close();};
 function banner(issue=''){
  return '<div id="record-draft-banner" class="record-draft-banner"'+(available||failed||issue?'':' hidden')+'><p>'+esc(issue||text(failed?'checkFailed':'available'))+'</p><button class="button" data-record-drafts>'+esc(text('reviewDrafts'))+'</button></div>';
 }
 function frame(body,controls=''){
  dialog.innerHTML='<h2 id="draft-list-title" tabindex="-1">'+esc(text('title'))+'</h2><p>'+esc(text('description'))+'</p><div class="record-draft-rows">'+body+'</div>'+controls+'<p data-draft-error role="alert" hidden></p><div class="dialog-actions">'+button('close','close')+'</div>';
 }
 function renderPage(){
  const rows=page.drafts.map(item=>'<section class="record-draft-row"><h3>'+item.titles.map(title=>esc(title||text('untitled'))).join(' · ')+'</h3>'+
   (item.count>item.titles.length?'<p>'+esc(text('additional',{count:item.count-item.titles.length}))+'</p>':'')+
   '<p>'+esc(text('checkpointedAt',{date:new Date(item.updatedAt).toLocaleString()}))+'</p><div class="inline-actions">'+button('review','review','data-id="'+item.id+'"')+button('discard','discard','data-id="'+item.id+'"')+'</div></section>').join('');
  frame((rows||'<p role="status">'+esc(text('empty'))+'</p>')+'<p>'+esc(text('live'))+'</p>','<nav class="inline-actions" aria-label="'+esc(text('pages'))+'">'+button('previous','previous',page.previousCursor?'':'disabled')+button('next','next',page.nextCursor?'':'disabled')+button('refresh','refresh')+'</nav>');
 }
 async function load(next=null,{preview=false,focus=null}={}){
  if(!owner)return;abort();const epoch=generation,workspaceId=owner.workspaceId,request=new AbortController();controller=request;
  if(!preview){cursor=next;frame('<p role="status">'+esc(text('loading'))+'</p>');}
  const limit=preview?1:10;
  try{
   const result=await api('/api/research/drafts/list',{workspaceId,cursor:next,excludeId:owner.id,limit},{adopt:false,signal:request.signal});
   if(request.signal.aborted||!current(epoch,workspaceId))return;
   if(result?.workspaceId!==workspaceId||!Array.isArray(result.drafts)||result.drafts.length>limit||!result.drafts.every(validItem)||new Set(result.drafts.map(d=>d.id)).size!==result.drafts.length||result.drafts.some(d=>d.id===owner.id)||![result.previousCursor,result.nextCursor].every(v=>v===null||typeof v==='string'&&v.length>0&&v.length<=4096))throw Error(text('invalidPage'));
   available=Boolean(result.drafts.length||result.nextCursor||result.previousCursor);failed=false;
   if(!preview){
    page=result;renderPage();
    const target=focus&&dialog.querySelector('[data-draft-'+focus+']');(target&&!target.disabled?target:dialog.querySelector('h2')).focus({preventScroll:true});
   }
  }catch(error){
   if(request.signal.aborted||!current(epoch,workspaceId))return;
   failed=true;if(!preview){frame('<p role="alert">'+esc(text('loadFailed'))+'</p><div class="inline-actions">'+button('retry','retry')+button('refresh','refresh')+'</div>');dialog.querySelector('[data-draft-retry]').focus();}
  }finally{if(controller===request)controller=null;if(!request.signal.aborted&&current(epoch,workspaceId))onChange();}
 }
 async function reset(writer){generation++;close();owner=writer?{id:writer.id,workspaceId:writer.workspaceId}:null;available=false;failed=false;busy=false;onChange();if(owner)await load(null,{preview:true});}
 async function refresh(){if(dialog.open)return load();return load(null,{preview:true});}
 async function show(){
  if(!owner)return;focusBefore=document.activeElement;frame('<p role="status">'+esc(text('loading'))+'</p>');
  if(!dialog.open)dialog.showModal();dialog.querySelector('h2').focus();await load();
 }
 dialog.onclick=async event=>{
  if(event.target.closest('[data-draft-close]')){close();return;}
  if(busy)return;
  if(event.target.closest('[data-draft-refresh]')){await load();return;}
  if(event.target.closest('[data-draft-retry]')){await load(cursor);return;}
  for(const direction of ['previous','next'])if(event.target.closest('[data-draft-'+direction+']')){if(page?.[direction+'Cursor'])await load(page[direction+'Cursor'],{focus:direction});return;}
  const review=event.target.closest('[data-draft-review]'),discard=event.target.closest('[data-draft-discard]');
  const item=page?.drafts.find(d=>d.id===(review??discard)?.dataset.id);if(!item)return;
  if(discard&&discard.dataset.confirm!=='true'){discard.dataset.confirm='true';discard.textContent=text('confirm');return;}
  const epoch=generation,workspaceId=owner.workspaceId,request=new AbortController();abort();controller=request;busy=true;onChange();
  for(const button of dialog.querySelectorAll('button:not([data-draft-close])'))button.disabled=true;
  try{
   if(discard){
    await api('/api/research/drafts/remove',{id:item.id,workspaceId,expectedRevision:item.revision},{adopt:false,signal:request.signal});
    if(!request.signal.aborted&&current(epoch,workspaceId)&&dialog.open)await load();return;
   }
   const options={adopt:false,signal:request.signal};let header=await api('/api/research/drafts/read',{id:item.id,...(recoverDocument?{summary:true}:{})},options);
   if(request.signal.aborted||!current(epoch,workspaceId)||!dialog.open)return;
   if(header?.revision!==item.revision||header.draft?.workspaceId!==workspaceId)throw Error(text('invalidPage'));
   if([5,6].includes(header.draft.formatVersion)){
    const recoverSelected=header.draft.formatVersion===5?recoverWriting:recoverValue;
    if(!recoverSelected)throw Error(text('readFailed'));controller=null;close();await recoverSelected(header);
    if(current(epoch,workspaceId))await refresh();return;
   }
   if([1,2,3].includes(header.draft.formatVersion)&&recoverDocument){
    const position=header.draft.count>1?await selectRecord(header,options):0;if(position===null)return;
    if(request.signal.aborted||!current(epoch,workspaceId)||!dialog.open)return;
    const reviewPlan=await api('/api/research/drafts/review/prepare',{id:item.id,workspaceId,expectedRevision:header.revision,position},options);
    if(request.signal.aborted||!current(epoch,workspaceId)||!dialog.open)return;
    if(reviewPlan.saved){await load();return;}
    header={...header,reviewPlan};
    if(!await preview(header,options))return;
    if(request.signal.aborted||!current(epoch,workspaceId)||!dialog.open)return;
    controller=null;close();await recoverDocument(header,options);if(current(epoch,workspaceId))await refresh();return;
   }
   if(header.draft.formatVersion===4&&recoverDocument){
    if(!await preview(header,options))return;
    if(request.signal.aborted||!current(epoch,workspaceId)||!dialog.open)return;
    controller=null;close();await recoverDocument(header,options);if(current(epoch,workspaceId))await refresh();return;
   }
   if(header.draft.formatVersion===4&&!await preview(header,options))return;
   const result=await readRecordCheckpoint(api,item.id,options,header);
   if(request.signal.aborted||!current(epoch,workspaceId)||!dialog.open)return;
   if(result?.draft?.id!==item.id||result.draft.workspaceId!==workspaceId||!revisionId(result.revision))throw Error(text('invalidPage'));
   controller=null;close();
   const accepted=await recover(result.draft);if(!current(epoch,workspaceId))return;
   if(!accepted){await show();return;}
   if(await checkpoint()){
    if(!current(epoch,workspaceId))return;
    try{await api('/api/research/drafts/remove',{id:item.id,workspaceId,expectedRevision:result.revision},{adopt:false});}
    catch{if(current(epoch,workspaceId))notify(text('recoveredCopy'),true);}
   }
   if(current(epoch,workspaceId))await refresh();
  }catch(error){
   if(request.signal.aborted||!current(epoch,workspaceId))return;
   if(error.code==='RECORD_SELECTION_CANCELLED'){await show();return;}
   if(dialog.open){const label=dialog.querySelector('[data-draft-error]');label.hidden=false;label.textContent=error.message??text('readFailed');}
   else notify(error.message??text('recoverFailed'),true);
  }finally{
   if(controller===request)controller=null;
   if(current(epoch,workspaceId)){busy=false;for(const button of dialog.querySelectorAll('button'))button.disabled=button.hasAttribute('data-draft-previous')?!page?.previousCursor:button.hasAttribute('data-draft-next')?!page?.nextCursor:false;onChange();}
  }
 };
 document.addEventListener('click',event=>{if(event.target.closest('[data-record-drafts]'))void show();});
 return {reset,refresh,banner,close,isBusy:()=>busy};
}
