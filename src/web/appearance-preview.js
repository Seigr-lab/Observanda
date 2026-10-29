import {sameWebsitePin} from './website-pin.js';
import {websiteSnapshot} from './website-context.js';
import {t} from './i18n/index.js';
import {draftWorkspace} from './workspace-snapshot.js';
import {enhanceAppearanceReading} from './appearance-preview-reading.js';

export function appearancePreview({state,api,option,documents}){
 let generation=0,controller=null,timer=null,choiceGeneration=0,choiceHistory=[],choiceCursor=null;
 const sameSource=(a,b)=>sameWebsitePin(a.websitePin,b.websitePin)&&(a.websiteDraft?.id??null)===(b.websiteDraft?.id??null)&&(a.websiteDraft?.revision??null)===(b.websiteDraft?.revision??null);
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
 async function selectedPage(result,path,signal){const value=await api(result.pagesUrl+'?path='+encodeURIComponent(path),undefined,{adopt:false,signal,websitePin:result.websitePin});if(!sameSource(value,result))throw Error(t('appearance','previewFailed'));return value.pages[0];}
 async function pages(direction){
  const result=state.designResult,version=generation,request=++choiceGeneration;if(!result?.pagesUrl)return;
  const cursor=direction==='next'?result.nextCursor:choiceHistory.at(-1);if(direction==='next'&&!cursor||direction==='previous'&&!choiceHistory.length)return;
  try{
   const page=await api(result.pagesUrl+(cursor?'?cursor='+encodeURIComponent(cursor):''),undefined,{adopt:false,websitePin:result.websitePin});
   if(version!==generation||request!==choiceGeneration||state.designResult!==result)return;
   if(!sameSource(page,result))throw Error(t('appearance','previewFailed'));
   const selected=document.querySelector('#design-page')?.selectedOptions[0],current=selected?{path:selected.value,title:selected.textContent}:null;
   if(direction==='next')choiceHistory.push(choiceCursor);else choiceHistory.pop();choiceCursor=cursor;
   Object.assign(result,page);choices(result,current);document.querySelector('#design-preview-note').textContent=t('appearance','websiteNote');
  }catch(error){if(version===generation&&request===choiceGeneration)document.querySelector('#design-preview-note').textContent=error.message??t('appearance','previewFailed');}
 }
 function schedule(){
  // A page can finish parsing before its load handler runs (for example while
  // an image loads). Preserve the visible navigation when a theme edit races it.
  const frame=document.querySelector('#design-preview'),base=state.designResult?.baseUrl;
  if(state.designPage&&base&&frame?.contentDocument?.body?.dataset.page){const url=new URL(frame.contentWindow.location.href);if(url.pathname.startsWith(base))state.designPage=url.pathname.slice(base.length)+url.search;}
  stop();if(active())timer=setTimeout(update,250);
 }
 async function update(){
  stop();if(!active())return;
  const frame=document.querySelector('#design-preview'),selector=document.querySelector('#design-page'),note=document.querySelector('#design-preview-note');
  if(!frame||!selector||!note)return;
  const version=generation,context=websiteSnapshot(state),workspace=state.book.id,request=new AbortController();controller=request;
  const current=()=>version===generation&&context===websiteSnapshot(state)&&workspace===state.book?.id&&active()&&frame.isConnected;
  // Keep the last readable page while a replacement is prepared. A failed or
  // superseded request must not turn a working preview into an empty frame.
  selector.disabled=true;selector.innerHTML=option('',t('appearance','loadingPage'),'');note.textContent=t('appearance','loadingPreview');
  const retry=document.querySelector('[data-action="theme-preview-retry"]');if(retry)retry.hidden=true;
  const expand=document.querySelector('[data-action="theme-preview-expand"]');if(expand)expand.disabled=true;
  try{
   const indexed=documents?.enabled()||state.storage.researchStorage==='catalogue'&&state.storage.researchFormatVersion===21,source=documents?.enabled()?await documents.preview():{websitePin:state.websitePin};
   const result=await api(indexed?'/api/appearance-preview':'/api/design-preview',indexed?
    {workspaceId:workspace,etag:state.etag,...source,appearance:state.book.appearance,mode:state.designSource??'auto'}:
    {book:draftWorkspace(state.book),websitePin:state.websitePin,mode:state.designSource??'auto'},{signal:request.signal});
   if(!current()){if(version===generation&&active()&&frame.isConnected)schedule();return;}
   if(indexed&&source.websitePin&&!sameSource(result,source))throw Error(t('appearance','previewFailed'));
   if(state.designEffectiveSource!==result.source)state.designPage=result.defaultPage;
   state.designEffectiveSource=result.source;
   let selected=result.pages.find(p=>p.path===state.designPage);
   if(!selected&&state.designPage&&result.pagesUrl){try{selected=await selectedPage(result,state.designPage,request.signal);}catch(error){if(error.code!=='NOT_FOUND')throw error;}if(!current()){if(version===generation&&active()&&frame.isConnected)schedule();return;}}
   if(!selected)state.designPage=result.defaultPage;
   state.designResult=result;
   choices(result,selected);
   document.querySelector('#design-source').value=result.source;
   note.textContent=t('appearance',result.source==='examples'?'examplesNote':'websiteNote');
   frame.onload=async()=>{if(!current()){if(version===generation&&active()&&frame.isConnected)schedule();return;}try{
    enhanceAppearanceReading(frame);
    const currentURL=new URL(frame.contentWindow.location.href),path=currentURL.pathname;if(!path.startsWith(result.baseUrl))return;
    const page=path.slice(result.baseUrl.length)+currentURL.search;
    if(result.pagesUrl&&!frame.contentDocument.body?.dataset.page){state.designPage=page;let failure;try{failure=JSON.parse(frame.contentDocument.body.textContent).message;}catch{/* Use the generic retry message for an unreadable response. */}throw new Error(failure??t('appearance','previewFailed'));}
    // Navigation has already completed. Keep its cursor and filters even when
    // a design edit cancels the slower request for this page's selector label.
    state.designPage=page;
    if(expand)expand.disabled=false;
    let selected=result.pages.find(p=>p.path===page);
    if(!selected&&result.pagesUrl)selected=await selectedPage(result,page,request.signal);
    if(!current()||frame.contentWindow.location.href!==currentURL.href)return;
    if(selected){state.designPage=page;choices(result,selected);}
   }catch(error){if(current()&&error.name!=='AbortError'){note.textContent=error.message??t('appearance','previewFailed');if(retry)retry.hidden=false;}}};
   frame.contentWindow.location.replace(result.baseUrl+state.designPage);
  }catch(error){if(current()&&error.name!=='AbortError'){note.textContent=error.message??t('appearance','previewFailed');if(retry)retry.hidden=false;}}
  finally{if(controller===request)controller=null;}
 }
 return {update,schedule,stop,pages};
}
