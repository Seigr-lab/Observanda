import {sameWebsitePin} from './website-pin.js';
import {websiteSnapshot} from './website-context.js';
import {t} from './i18n/index.js';
import {draftWorkspace} from './workspace-snapshot.js';
import {enhanceAppearanceReading} from './appearance-preview-reading.js';

export function appearancePreview({state,api,option}){
 let generation=0,controller=null,timer=null,choiceGeneration=0,choiceHistory=[],choiceCursor=null;
 const active=()=>state.page==='appearance'&&!state.access?.locked&&!state.newWorkspace&&!state.storageUnavailable;
 function stop(){clearTimeout(timer);timer=null;generation++;choiceGeneration++;controller?.abort();controller=null;state.designResult=null;choiceHistory=[];choiceCursor=null;for(const button of document.querySelectorAll('#design-page-paging button'))button.disabled=true;}
 function choices(result,selected){
  const selector=document.querySelector('#design-page');if(!selector)return;
  const pages=[...result.pages];if(selected&&!pages.some(p=>p.path===selected.path))pages.unshift(selected);
  selector.innerHTML=pages.map(p=>option(p.path,p.title,state.designPage)).join('');selector.disabled=false;
  const controls=document.querySelector('#design-page-paging');if(controls)controls.hidden=!result.pagesUrl;
  const previous=document.querySelector('[data-action="theme-preview-previous-pages"]'),next=document.querySelector('[data-action="theme-preview-next-pages"]');
  if(previous)previous.disabled=!choiceHistory.length;if(next)next.disabled=!result.nextCursor;
 }
 async function pages(direction){
  const result=state.designResult,version=generation,request=++choiceGeneration;if(!result?.pagesUrl)return;
  const cursor=direction==='next'?result.nextCursor:choiceHistory.at(-1);if(direction==='next'&&!cursor||direction==='previous'&&!choiceHistory.length)return;
  try{
   const page=await api(result.pagesUrl+(cursor?'?cursor='+encodeURIComponent(cursor):''),undefined,{adopt:false,websitePin:result.websitePin});
   if(version!==generation||request!==choiceGeneration||state.designResult!==result)return;
   const selected=document.querySelector('#design-page')?.selectedOptions[0],current=selected?{path:selected.value,title:selected.textContent}:null;
   if(direction==='next')choiceHistory.push(choiceCursor);else choiceHistory.pop();choiceCursor=cursor;
   Object.assign(result,page);choices(result,current);document.querySelector('#design-preview-note').textContent=t('appearance','websiteNote');
  }catch(error){if(version===generation&&request===choiceGeneration)document.querySelector('#design-preview-note').textContent=error.message??t('appearance','previewFailed');}
 }
 function schedule(){stop();if(active())timer=setTimeout(update,250);}
 async function update(){
  stop();if(!active())return;
  const frame=document.querySelector('#design-preview'),selector=document.querySelector('#design-page'),note=document.querySelector('#design-preview-note');
  if(!frame||!selector||!note)return;
  const version=generation,context=websiteSnapshot(state),workspace=state.book.id,request=new AbortController();controller=request;
  const current=()=>version===generation&&context===websiteSnapshot(state)&&workspace===state.book?.id&&active()&&frame.isConnected;
  frame.removeAttribute('src');selector.disabled=true;selector.innerHTML=option('',t('appearance','loadingPage'),'');note.textContent=t('appearance','loadingPreview');
  const retry=document.querySelector('[data-action="theme-preview-retry"]');if(retry)retry.hidden=true;
  try{
   const indexed=state.storage.researchStorage==='catalogue'&&state.storage.researchFormatVersion===21;
   const result=await api(indexed?'/api/appearance-preview':'/api/design-preview',indexed?
    {workspaceId:workspace,etag:state.etag,websitePin:state.websitePin,appearance:state.book.appearance,mode:state.designSource??'auto'}:
    {book:draftWorkspace(state.book),websitePin:state.websitePin,mode:state.designSource??'auto'},{signal:request.signal});
   if(!current())return;
   if(indexed&&state.websitePin&&!sameWebsitePin(result.websitePin,state.websitePin))throw Error(t('appearance','previewFailed'));
   if(state.designEffectiveSource!==result.source)state.designPage=result.defaultPage;
   state.designEffectiveSource=result.source;
   let selected=result.pages.find(p=>p.path===state.designPage);
   if(!selected&&state.designPage&&result.pagesUrl){try{selected=(await api(result.pagesUrl+'?path='+encodeURIComponent(state.designPage),undefined,{adopt:false,signal:request.signal,websitePin:result.websitePin})).pages[0];}catch(error){if(error.code!=='NOT_FOUND')throw error;}if(!current())return;}
   if(!selected)state.designPage=result.defaultPage;
   state.designResult=result;
   choices(result,selected);
   document.querySelector('#design-source').value=result.source;
   note.textContent=t('appearance',result.source==='examples'?'examplesNote':'websiteNote');
   frame.src=result.baseUrl+state.designPage;
   frame.onload=async()=>{if(!current())return;try{
    enhanceAppearanceReading(frame);
    const currentURL=new URL(frame.contentWindow.location.href),path=currentURL.pathname;if(!path.startsWith(result.baseUrl))return;
    const page=path.slice(result.baseUrl.length)+currentURL.search;
    if(result.pagesUrl&&!frame.contentDocument.body?.dataset.page){state.designPage=page;let failure;try{failure=JSON.parse(frame.contentDocument.body.textContent).message;}catch{/* Use the generic retry message for an unreadable response. */}throw new Error(failure??t('appearance','previewFailed'));}
    // Navigation has already completed. Keep its cursor and filters even when
    // a design edit cancels the slower request for this page's selector label.
    state.designPage=page;
    let selected=result.pages.find(p=>p.path===page);
    if(!selected&&result.pagesUrl)selected=(await api(result.pagesUrl+'?path='+encodeURIComponent(page),undefined,{adopt:false,signal:request.signal,websitePin:result.websitePin})).pages[0];
    if(!current()||frame.contentWindow.location.href!==currentURL.href)return;
    if(selected){state.designPage=page;choices(result,selected);}
   }catch(error){if(current()&&error.name!=='AbortError'){note.textContent=error.message??t('appearance','previewFailed');if(retry)retry.hidden=false;}}};
  }catch(error){if(current()&&error.name!=='AbortError'){note.textContent=error.message??t('appearance','previewFailed');if(retry)retry.hidden=false;}}
  finally{if(controller===request)controller=null;}
 }
 return {update,schedule,stop,pages};
}
