import {sameWebsitePin} from './website-pin.js';
import {websiteSnapshot} from './website-context.js';
import {enhanceAppearanceReading} from './appearance-preview-reading.js';
import {draftWorkspace} from './workspace-snapshot.js';
import {t} from './i18n/index.js';

// Browsing a draft never commits the website or creates a publication job.
// The existing preview owner renders selected pages and enforces source consent.
export async function websiteReadingPreview({state,api,documents,showDialog,esc,path}){
 const text=key=>esc(t('websiteEditor',key)),controller=new AbortController(),context=websiteSnapshot(state);
 let result=null,cursor=null,history=[],busy=false,selected=path;
 showDialog(`<div class="expanded-preview website-reading-preview"><div class="preview-toolbar"><h2 id="dialog-title">${text('readingPreview')}</h2><button class="button" data-action="close-dialog">${text('readingBack')}</button></div><p>${text('readingDraftNote')}</p><div class="inline-actions"><label class="field"><span id="reading-page-label">${text('readingPage')}</span><select aria-labelledby="reading-page-label" data-reading-page disabled></select></label><button class="button" data-reading-previous disabled>${text('readingPrevious')}</button><button class="button" data-reading-next disabled>${text('readingNext')}</button><label class="field"><span id="reading-width-label">${text('readingViewport')}</span><select aria-labelledby="reading-width-label" data-reading-width><option value="full">${text('readingDesktop')}</option><option value="phone">${text('readingPhone')}</option></select></label></div><p role="status" data-reading-status>${text('readingLoading')}</p><button class="button" data-reading-retry hidden>${text('readingRetry')}</button><div data-reading-canvas><iframe title="${text('readingPreview')}" sandbox="allow-same-origin"></iframe></div></div>`);
 const dialog=document.querySelector('#dialog'),root=dialog.querySelector('.website-reading-preview'),frame=root.querySelector('iframe'),selector=root.querySelector('[data-reading-page]'),status=root.querySelector('[data-reading-status]'),retry=root.querySelector('[data-reading-retry]');
 const active=()=>!controller.signal.aborted&&root.isConnected&&context===websiteSnapshot(state);
 const sameSource=value=>sameWebsitePin(value.websitePin,result.websitePin)&&(value.websiteDraft?.id??null)===(result.websiteDraft?.id??null)&&(value.websiteDraft?.revision??null)===(result.websiteDraft?.revision??null);
 const request=(route,data)=>api(route,data,{adopt:false,signal:controller.signal});
 function controls(page){
  const pages=[...result.pages];if(page&&!pages.some(value=>value.path===page.path))pages.unshift(page);
  selector.innerHTML=pages.map(value=>`<option value="${esc(value.path)}"${value.path===selected?' selected':''}>${esc(value.title)}</option>`).join('');selector.disabled=false;
  root.querySelector('[data-reading-previous]').disabled=!history.length;root.querySelector('[data-reading-next]').disabled=!result.nextCursor;
 }
 async function choice(path){
  const known=result.pages.find(value=>value.path===path);if(known||!result.pagesUrl)return known;
  const value=await request(result.pagesUrl+'?path='+encodeURIComponent(path));if(!sameSource(value))throw Error(t('websiteEditor','readingChanged'));return value.pages[0];
 }
 function failure(error){if(active()&&error.name!=='AbortError'){status.textContent=error.message;retry.hidden=false;}}
 function navigate(path){status.textContent=t('websiteEditor','readingLoading');retry.hidden=true;frame.contentWindow.location.replace(result.baseUrl+path);}
 frame.addEventListener('load',async()=>{
  if(!active()||!result)return;
  try{
   const url=new URL(frame.contentWindow.location.href),base=new URL(result.baseUrl,location.href);
   if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname))return;
   if(!frame.contentDocument?.querySelector('main'))throw Error(t('websiteEditor','pageLoadFailed'));
   enhanceAppearanceReading(frame);const path=url.pathname.slice(base.pathname.length),page=await choice(path);
   if(!active()||frame.contentWindow.location.href!==url.href)return;
   selected=path;controls(page);status.textContent='';retry.hidden=true;
  }catch(error){failure(error);}
 });
 dialog.addEventListener('close',()=>controller.abort(),{once:true});
 selector.addEventListener('change',()=>{selected=selector.value;navigate(selected);});
 root.querySelector('[data-reading-width]').addEventListener('change',event=>root.querySelector('[data-reading-canvas]').classList.toggle('phone-preview',event.target.value==='phone'));
 async function turn(direction){
  if(busy||!result?.pagesUrl)return;busy=true;
  try{
   const next=direction==='next'?result.nextCursor:history.at(-1),value=await request(result.pagesUrl+(next?'?cursor='+encodeURIComponent(next):''));
   if(!active())return;if(!sameSource(value))throw Error(t('websiteEditor','readingChanged'));
   const page={path:selected,title:selector.selectedOptions[0]?.textContent??selected};
   if(direction==='next')history.push(cursor);else history.pop();cursor=next;Object.assign(result,value);controls(page);
  }catch(error){failure(error);}finally{busy=false;}
 }
 root.querySelector('[data-reading-next]').addEventListener('click',()=>void turn('next'));
 root.querySelector('[data-reading-previous]').addEventListener('click',()=>void turn('previous'));
 async function open(){
  if(busy)return;busy=true;retry.hidden=true;status.textContent=t('websiteEditor','readingLoading');
  try{
   const native=documents?.enabled(),source=native?await documents.preview():null;
   if(!active())return;
   result=await request(native?'/api/appearance-preview':'/api/design-preview',native?{workspaceId:state.book.id,etag:state.etag,...source,appearance:state.book.appearance,mode:'website'}:{book:draftWorkspace(state.book),websitePin:state.websitePin,mode:'website'});
   if(!active())return;if(native&&!sameSource(source))throw Error(t('websiteEditor','readingChanged'));
   let page;try{page=selected?await choice(selected):null;}catch(error){if(error.code!=='NOT_FOUND')throw error;}
   if(!active())return;selected=page?.path??result.defaultPage;history=[];cursor=null;controls(page);navigate(selected);
  }catch(error){failure(error);}finally{busy=false;}
 }
 retry.addEventListener('click',()=>void open());
 await open();
}
