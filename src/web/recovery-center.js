import {language,t} from './i18n/index.js';
import {researchContext} from './project-context.js';
import {researchId} from './research-reference.js';
import {revisionId} from './revision-model.js';

const text=(key,args)=>t('recordDrafts',key,args);
const limit=15;
const science='/api/research/materials/scientific-draft-',website='/api/website-files/recovery/',pdf='/api/pdf/settings-draft-';

export function recoveryCenter({state,api,esc,showRecords,chooseBook,selectPublicationOwner,openScience,openWebsite,openDocument,notify}){
 const dialog=document.createElement('dialog');
 dialog.className='record-recovery';dialog.setAttribute('aria-labelledby','recovery-center-title');
 document.body.append(dialog);
 let scope=null,area=null,items=[],cursor=null,next=null,request=null,origin=null,pdfReview=null;
 const scopeKey=()=>JSON.stringify([researchContext(state),state.book?.id]);
 const usable=()=>state.book&&!state.newWorkspace&&!state.storageUnavailable&&!state.access?.locked;
 const valid=()=>dialog.open&&usable()&&scope===scopeKey();
 const button=(key,action,extra='')=>'<button type="button" class="button" data-recovery-action="'+action+'" '+extra+'>'+esc(text(key))+'</button>';
 function reset(){
  request?.abort();request=null;scope=null;area=null;items=[];cursor=next=pdfReview=null;dialog.replaceChildren();
 }
 function close({returnFocus=false}={}){
  if(dialog.open)dialog.close();
  reset();
  if(returnFocus){
   const target=origin?.isConnected?origin:document.querySelector('[data-tool-card="recovery"] button');
   target?.focus({preventScroll:true});
  }
  origin=null;
 }
 dialog.oncancel=event=>{event.preventDefault();close({returnFocus:true});};
 function render(body){
  dialog.innerHTML='<h2 tabindex="-1" id="recovery-center-title">'+esc(text('center'))+'</h2><div class="inline-actions">'+
   button('recordArea','record')+button('websiteArea','website')+button('documentArea','document')+button('scienceArea','science')+'</div>'+
   (area==='document'?'<p>'+esc(text('publicationOwner',{name:state.book.title}))+' '+button('chooseProject','project')+
    (state.projectOwner?button('workspaceDocuments','workspace'):'')+'</p>':area!=='website'?'<p>'+esc(text('selectedOwner',{name:state.book.title}))+' '+button('chooseBook','book')+'</p>':'')+
   '<div class="record-draft-rows">'+body+'</div><p role="alert" data-recovery-error hidden></p><div class="dialog-actions">'+button('close','close')+'</div>';
  for(const choice of ['website','science','document'])dialog.querySelector('[data-recovery-action="'+choice+'"]').setAttribute('aria-pressed',String(area===choice));
 }
 function show(){
  if(!usable())return;
  close();origin=document.activeElement;scope=scopeKey();render('');
  dialog.showModal();dialog.querySelector('h2').focus();
 }
 const concealed=item=>['access-changed','missing'].includes(item.state);
 function renderList(){
  const rows=items.map((item,index)=>{
   const label=concealed(item)?text('restrictedDraft'):item.title||(area==='website'?item.documentKey:t('scientificEditors','recovery-'+item.kind));
   const time=new Date(item.updatedAt).toLocaleString(language());
   return '<section class="record-draft-row"><h3>'+esc(label)+'</h3><p>'+esc(text('checkpointedAt',{date:time}))+'</p>'+
    '<p>'+esc(text('state_'+item.state))+'</p><details><summary>'+esc(text('recoveryDetails'))+'</summary><p>'+
    esc(text('savedVersion',{revision:item.baseRevision}))+'</p></details><div class="inline-actions">'+
    (concealed(item)?'':button('review','review','data-index="'+index+'"'))+
    (item.capabilities.discard?button('discard','discard','data-index="'+index+'"'):'')+'</div></section>';
  }).join('');
  render((rows||'<p role="status">'+esc(text('centerEmpty'))+'</p>')+'<div class="inline-actions">'+
   (next?button('next','next'):'')+button('refresh','first')+'</div>');
 }
 function accepted(item){
  if(!item||item.surface!==area||!researchId(item.id)||!revisionId(item.revision)||!revisionId(item.baseRevision)||
   !researchId(item.owner?.workspaceId)||!Number.isFinite(Date.parse(item.updatedAt))||typeof item.documentKey!=='string'||
   !item.capabilities||!['ready','available','unchecked','conflict','missing-media','missing','access-changed','retained'].includes(item.state))return false;
  if(area==='website')return researchId(item.owner.websiteId);
  if(area==='document')return researchId(item.owner.documentId)&&item.documentKey===item.owner.documentId&&item.owner.workspaceId===state.book.id&&item.owner.projectId===(state.projectOwner?.projectId??null)&&!state.projectOwner?.labBookId;
  return item.owner.workspaceId===state.book.id&&researchId(item.owner.recordId)&&item.owner.projectId===(state.projectOwner?.projectId??null)&&
   item.owner.labBookId===(state.projectOwner?.labBookId??null);
 }
 async function list(selected,after=null){
  request?.abort();area=selected;items=[];cursor=after;next=pdfReview=null;const operation=new AbortController();request=operation;
  render('<p role="status">'+esc(text('loading'))+'</p>');
  try{
   if(selected==='science')await import('./i18n/catalogues/scientificEditors.js');
   if(operation.signal.aborted||!valid())return;
   const result=area==='website'?await api(website+'list',{cursor,limit},{owner:null,adopt:false,signal:operation.signal}):
    await api(area==='document'?pdf+'list':science+'browse',{workspaceId:state.book.id,cursor,limit},{adopt:false,signal:operation.signal});
   if(operation.signal.aborted||!valid())return;
   if(!Array.isArray(result?.items)||result.items.length>limit||!result.items.every(accepted)||
    new Set(result.items.map(item=>JSON.stringify([item.owner.websiteId??item.owner.recordId,item.documentKey,item.id]))).size!==result.items.length||
    !(result.next===null||typeof result.next==='string'&&result.next.length>0&&result.next.length<=4096))throw Error(text('invalidPage'));
   items=result.items;next=result.next;renderList();
   dialog.querySelector('[data-recovery-action="'+area+'"]').focus({preventScroll:true});
  }catch(error){
   if(operation.signal.aborted||!valid())return;
   render('<p role="alert">'+esc(error.message??text('loadFailed'))+'</p>'+button('retry','retry'));
   dialog.querySelector('[data-recovery-action="retry"]').focus({preventScroll:true});
  }finally{if(request===operation)request=null;}
 }
 const settingsAddress=item=>({workspaceId:item.owner.workspaceId,id:item.id,documentId:item.owner.documentId,revision:item.revision});
 async function reviewSettings(item){
  const operation=new AbortController();request=operation;
  try{
   const details=await api(pdf+'read',settingsAddress(item),{adopt:false,signal:operation.signal});
   if(operation.signal.aborted||!valid())return;
   const {summary,current,proposed}=details;
   if(!accepted(summary)||summary.id!==item.id||summary.owner.documentId!==item.owner.documentId||summary.revision!==item.revision)throw Error(text('invalidPage'));
   const {pdfSettingsChanges}=await import('./pdf-settings-comparison.js');
   if(operation.signal.aborted||!valid())return;
   const changes=summary.capabilities.compare&&current&&proposed?pdfSettingsChanges(current,proposed):[];
   pdfReview=summary.capabilities.recover&&proposed?{item:summary,proposed}:null;
   render('<h3 tabindex="-1" data-settings-review>'+esc(summary.title??text('restrictedDraft'))+'</h3><p>'+esc(text('state_'+summary.state))+'</p>'+
    (changes.length?'<table><thead><tr>'+['setting','savedSetting','pendingSetting'].map(key=>'<th scope="col">'+esc(text(key))+'</th>').join('')+'</tr></thead><tbody>'+
     changes.map(change=>'<tr><th scope="row">'+esc(change.setting)+'</th><td>'+esc(change.saved)+'</td><td>'+esc(change.pending)+'</td></tr>').join('')+'</tbody></table>':'')+
    '<div class="inline-actions">'+button('backToCopies','first')+(pdfReview?button('saveSettings','saveSettings'):'')+'</div>');
   dialog.querySelector('[data-settings-review]').focus();
  }finally{if(request===operation)request=null;}
 }
 dialog.onclick=async event=>{
  const target=event.target.closest('[data-recovery-action]');if(!target||!valid())return;
  const action=target.dataset.recoveryAction;
  if(action==='close'){close({returnFocus:true});return;}
  try{
   if(action==='record'){close({returnFocus:true});await showRecords();return;}
   if(action==='book'){const previous=area;close();chooseBook(()=>{show();if(previous==='science')return list('science');});return;}
   if(action==='project'||action==='workspace'||action==='document'&&state.projectOwner?.labBookId){
    close();await selectPublicationOwner(action,()=>{show();return list('document');});return;
   }
   if(['science','website','document'].includes(action)){await list(action);return;}
   if(action==='first'||action==='retry'||action==='next'){await list(area,action==='next'?next:action==='retry'?cursor:null);return;}
   if(action==='saveSettings'){
    if(!pdfReview||request)return;
    const {item,proposed}=pdfReview,operation=new AbortController();request=operation;target.disabled=true;
    try{
     await api(pdf+'submit',{workspaceId:item.owner.workspaceId,id:item.owner.documentId,commandId:item.id,expectedRevision:item.baseRevision,operation:{type:'header',header:proposed}},{adopt:false,signal:operation.signal});
     if(!operation.signal.aborted&&valid()){close();await openDocument(item);}
    }finally{if(request===operation)request=null;if(target.isConnected)target.disabled=false;}
    return;
   }
   const item=items[Number(target.dataset.index)];if(!item||!accepted(item)||request)return;
   if(action==='review'){
    if(concealed(item))return;
    if(item.surface==='document'){await reviewSettings(item);return;}
    close();await (item.surface==='science'?openScience(item):openWebsite(item));return;
   }
   if(action!=='discard'||!item.capabilities.discard)return;
   if(!target.hasAttribute('data-confirm')){target.setAttribute('data-confirm','');target.textContent=text('confirm');return;}
   const operation=new AbortController();request=operation;target.disabled=true;
   try{
    if(area==='website')await api(website+'discard',{siteId:item.owner.websiteId,path:item.documentKey,id:item.id,revision:item.revision},{adopt:false,owner:null,signal:operation.signal});
    else if(area==='document')await api(pdf+'discard',settingsAddress(item),{adopt:false,signal:operation.signal});
    else await api(science+'discard',{workspaceId:item.owner.workspaceId,recordId:item.owner.recordId,id:item.id,expectedRevision:item.revision},{adopt:false,signal:operation.signal});
    if(!operation.signal.aborted&&valid())await list(area);
   }finally{if(request===operation)request=null;if(target.isConnected)target.disabled=false;}
  }catch(error){
   if(error.name==='AbortError')return;
   if(valid()){const alert=dialog.querySelector('[data-recovery-error]');alert.hidden=false;alert.textContent=error.message??text('readFailed');}
   else if(usable())notify(error.message??text('readFailed'),true);
  }
 };
 return {show,checkContext(){if(dialog.open&&(!usable()||scope!==scopeKey()||state.page!=='tools'))close();}};
}
