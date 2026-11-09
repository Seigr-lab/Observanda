import './i18n/catalogues/websiteFiles.js';
import {t} from './i18n/index.js';
import {websiteHTML,serializeWebsiteHTML,loadWebsiteCanvas,applyCanvasCSS,websiteCanvasValue,canvasSelection,restoreCanvasSelection,editWebsiteCanvas,rebaseWebsitePlacements} from './website-html-document.js';
import {websiteFilesRecovery} from './website-files-recovery.js';
import {websiteFilesFolder} from './website-files-folder.js';
import {githubConnectionUI} from './github-connection-ui.js';
import {downloadResource} from './session-download.js';
import {destinationPlanRows,destinationConflictCount} from './publication-review.js';
import {remoteAddress,remoteReceiptView,remoteProgressRequest} from './website-remote-receipt.js';
import {createBlock,duplicateBlock,blockTypes} from './website-files-blocks.js';
import {websiteFilesGallery} from './website-files-gallery.js';
import {buttonCSS,editActionLink,showPageChecks} from './website-files-dialogs.js';
import {editWebsiteEquation} from './website-files-equation.js';
import {bindSavedLinks,openSavedPreview} from './website-files-navigation.js';
import {enhanceSavedPreview} from './website-files-preview.js';
import {websiteFileViewport} from './website-file-viewport.js';
import {bindWebsiteVisual} from './website-files-visual.js';
import {websiteHierarchy,websiteLayerAt,movableWebsiteLayer,websiteLayerMove} from './website-files-hierarchy.js';
import {websiteFilesComponents} from './website-files-components.js';
import {websiteFilesRecordings} from './website-files-recordings.js';
import {websiteHistoryMedia} from './website-history-media.js';
import {rebasePageHistory} from './website-history-rebase.js';
import {websiteConflictPanel,websiteConflictReview} from './website-files-conflicts.js';
import {suggestedPagePath,websiteFilesPages} from './website-files-pages.js';
import {websiteFilesLifecycle} from './website-files-lifecycle.js';
import {websiteFilesVersions} from './website-files-versions.js';
import {websiteFilesMenu} from './website-files-menu.js';
import {menuCanvasTarget} from './website-menu-canvas.js';
import {websiteFilesPicker} from './website-files-picker.js';
import {websitePlacementDrag} from './website-files-placement-drag.js';
import {websiteSourceGallery} from './website-files-source-gallery.js';
import {presentationBlock,websitePlacementPresentation} from './website-placement-presentation.js';
import {websiteFileFeeds} from './website-file-feeds.js';
import {reviewSavedWebsite} from './website-site-review.js';
import {editWebsiteAppearance} from './website-files-appearance.js';
import {websiteSourcePane} from './website-source-pane.js';
import {editedSourceText} from './website-source-text.js';
import {assignStyleText} from './website-text-style.js';
import {defaultBreakpoints} from './website-breakpoint-model.js';
import {layerPath,managedWebsiteContent} from './website-layer-model.js';

const tr=(key,args)=>t('websiteFiles',key,args);

const fileRoute=siteId=>'#/websites/'+siteId+'/editor';
const preparationStages=new Set(['checking-saved-editions','capturing-entries','rendering-pages','reading-saved-files','converting-entries','copying-files','saving-files']);

function preparationMessage(preparation){
 if(!preparationStages.has(preparation.stage))return tr('preparing');
 const stage=tr(preparation.stage),{completed,stageTotal}=preparation;
 if(!Number.isSafeInteger(completed)||completed<0)return stage;
 if(Number.isSafeInteger(stageTotal)&&stageTotal>=completed)return tr('stageProgress',{stage,completed,total:stageTotal});
 return completed?tr('stageCompleted',{stage,completed}):stage;
}

export function websiteFilesUI({api,esc,render,notify=()=>{},onDirty=()=>{},onSite=()=>{},onSession=()=>{}}){
 let session=null,sites=[],opened=null,html='',css='',mode='visual',dirty=false,busy=false,error='',stale=false,generation=0,controller=null;
 let destination=null,destinationDirty=false,plan=null,form=null,timer=null,checkBusy=false;
 let visual=null,selected=null,anchor='',trail=[],step=-1;
 const viewport=websiteFileViewport({esc,t:tr,getRanges:()=>opened?.site.breakpoints??defaultBreakpoints(),changed:()=>visual?.viewportChanged()});
 let awaitingAccess=false,conflictingPage=null;
 const conflicts=websiteConflictPanel(tr,esc);
 let waitingView=null,openingAfterFence=false;
 let locatedPlacement=null;
 let pendingCanvas=null,canvasTimer=null;
 let undo=[],redo=[],lastCheckpoint=0,historyBytes=0,historyKey;
 let pendingHistoryFocus=null;
 let recoveringSource=false;
 const request=(operation,data,options={})=>api('/api/website-files/'+operation,data,{...options,owner:null,adopt:false});
 const siteId=()=>opened?.site.id;
 const remoteRequest=(operation,data,options={})=>remoteProgressRequest(request,operation,data,{signal:controller?.signal,t,tr,...options});
 const draftPage=()=>opened?.site.pages.find(page=>page.path===opened.path)?.draft===true;
 let nextSite=null,preparationTimer=null,missingSite=false;
 let requestedSite=null,openPublishing=false;
 const connectionState={get storage(){return session?{contextId:session.contextId}:null;},publishing:{}};
 const github=githubConnectionUI({state:connectionState,api:(route,data)=>api(route,data,{owner:null,adopt:false,signal:controller?.signal}),endpoint:'/api/website-files/connection/',esc,field:(label,control)=>'<label>'+esc(label)+' '+control+'</label>',notify,temporaryCredentials:false,onConnectionChange:()=>{plan=null;document.querySelector('[data-website-files-review]')?.remove();}});
 async function showDestination(){await save();destination=await request('destination',{siteId:siteId()});destinationDirty=false;form=null;mode='destination';render();if(destination.config.kind==='github')await github.refresh();}
 async function showPublishUpdate(){
  await save();if(!opened||stale||dirty)throw Error(tr('changed'));
  const target=await request('publish-target',{siteId:siteId()},{signal:controller.signal});
  plan=null;form=null;
  if(target.kind==='folder'){
   folder.reset(target.directory);mode='folder';render();
   await folder.action('plan');await folder.loadChooser();return;
  }
  if(target.kind==='remote'){
   destination=target.destination;destinationDirty=false;mode='publish-review';render();
   const prior=destination.transfer;
   if(prior&&(['running','failed'].includes(prior.state)||prior.revision===opened.site.revision&&prior.configEtag===destination.etag))return;
   plan=await remoteRequest('plan',{siteId:siteId(),expectedRevision:opened.site.revision,configEtag:destination.etag});render();return;
  }
  mode='publish-choose';render();
 }
 
 const folder=websiteFilesFolder({request,site:()=>opened,esc,render,current:()=>!stale&&!dirty});
 const directory=(stamp=opened.site.revision,route='preview')=>new URL('/api/website-files/'+route+'/'+siteId()+'/'+stamp+'/',location.origin);
 const baseURL=(path=opened.path)=>new URL(path,directory()).href;
 const canvasURL=(path=opened.path)=>new URL(path,directory(opened.historyAssetStamp??opened.assetStamp)).href;
 const sourcePane=websiteSourcePane({t:tr,escape:esc,state:()=>({html,css,site:opened?.site,path:opened?.path}),
  validate:(edit,signal)=>request('source/check',{siteId:edit.site.id,expectedRevision:edit.site.revision,path:edit.path,html:edit.html,css:edit.css},{signal:AbortSignal.any([signal,controller.signal])}),
  locate:(query,signal)=>request('source/locate',{siteId:siteId(),expectedRevision:opened.site.revision,path:opened.path,html,query},{signal:AbortSignal.any([signal,controller.signal])}),
  select:path=>{selected=path;if(mode!=='visual'){mode='visual';render();}else selectSourcePath(path);},
  change:(kind,value)=>{
   const field=document.querySelector('[data-source-input]');if(!field||field.dataset.sourceInput!==kind)return;
   checkpoint(true);if(kind==='html')html=editedSourceText(html,value);else css=editedSourceText(css,value);field.value=value;sourcePane.queue();sourcePane.bind();changed();
  },
  repaint:onlyCSS=>{const frame=document.getElementById('website-files-canvas');if(!frame)return;
   const style=frame.contentDocument?.querySelector('style[data-observanda-editor="css"]');
   if(onlyCSS&&style){applyCanvasCSS(style,css,canvasURL(opened.site.cssPath),recoveredResource);return;}
   visual?.destroy();visual=null;frame.inert=true;frame.src=canvasURL()+'?canvas=1';paintStructure();},
  onAccess:()=>hideUnverifiedPage(true)});
 const previewPages=()=>[...opened.site.pages,...(opened.site.feedPages??[])];
 const recovery=websiteFilesRecovery({request,tr,esc,signal:()=>controller?.signal,
  documentState:()=>{
   if(!opened||stale)return null;const recording=mode==='media'?recordings.draft():null;
   if(!dirty&&!recording)return null;flushCanvas();
   return {workspaceId:session.workspaceId,siteId:siteId(),path:opened.path,baseRevision:opened.site.revision,historyKey,html,css,recording,sourceKind:['html','css'].includes(mode)?mode:document.querySelector('[data-split-code]')?.dataset.splitCode,bookmark:canvasSelection(document.getElementById('website-files-canvas')?.contentDocument)};
  },
  upload:(data,held)=>gallery.body(data,data.path,websiteHTML(data.html),held),
  restore:async value=>{
   checkpoint(true);html=value.html;css=value.css;recoveringSource=Boolean(value.sourceOnly);mode=value.sourceOnly??'visual';
   if(value.recordingForm){await recordings.restore(value.recordingForm);mode='media';}else pendingHistoryFocus={selection:value.bookmark};
   changed();if(mode==='media')onDirty(true);render();
  }
 });
 const recoveredPicture=name=>opened?recovery.restoreURL(name,directory(opened.assetStamp)):null;
 const recoveredResource=url=>{const base=directory(opened.historyAssetStamp??opened.assetStamp).href;return url.startsWith(base)?recoveredPicture(url.slice(base.length)):null;};
 const gallery=websiteFilesGallery({t:tr,esc,recoveredPicture,path:()=>opened.path,url:canvasURL,read:()=>websiteHTML(html),update:doc=>{html=authoredHTML(doc);changed();},checkpoint:(force=true)=>checkpoint(force),render,run,notify,getCSS:()=>css,setCSS:value=>{css=value;changed();}});
 const pagesPanel=websiteFilesPages({site:()=>opened,esc,tr,render,request,adopt:adoptRelated,openPage:async path=>{if(await beforeLeave(true)){mode='visual';await open(siteId(),path);}},edit:documentChange,save,changed:()=>onDirty(dirty||pagesPanel.dirty()),close:()=>{mode='visual';render();}});
 const lifecycle=websiteFilesLifecycle({active:()=>opened,esc,tr,render,request,close:()=>{mode='visual';render();},updated:async value=>{
  mode='visual';
  if(value.archived){
   sites=sites.filter(s=>s.id!==value.siteId);opened=null;requestedSite=null;recovery.reset();onDirty(false);
   if(!sites.length&&nextSite){const list=await request('list',{after:nextSite,limit:100});sites=list.items;nextSite=list.next;}
   if(sites.length)await open(sites[0].id);else{history.replaceState(history.state,'','#/websites');render();}
  }else{adoptRelated(value);history.replaceState(history.state,'',fileRoute(value.site.id));render();}
 }});
 const versions=websiteFilesVersions({site:()=>opened,esc,tr,request,signal:()=>controller?.signal,render,run,adopt:adoptRelated,close:()=>{mode='visual';render();}});
 const menu=websiteFilesMenu({request,site:()=>opened,esc,tr,render,adopt:adoptRelated,baseURL,run,close:()=>{mode='visual';render();},changed:()=>{onDirty(dirty||destinationDirty||menu.dirty());paintStatus();}});
 async function openMenu(id=null){if(await beforeLeave(true)){await menu.open(id,false);mode='menu';render();}}
 const components=websiteFilesComponents({request,t,tr,esc,site:()=>opened,selected:()=>selected,save,adopt:adoptRelated,render,run,notify,
  async showInstance({path,instance},expectedRevision){
   await checkPlacementRevision(expectedRevision);
   const target=opened.path===path?opened:await request('open',{siteId:siteId(),path},{signal:controller.signal});
   const node=websiteHTML(target.html).querySelector('[data-website-instance="'+CSS.escape(instance)+'"]');
   if(target.site.revision!==expectedRevision||!node)throw Error(tr('changed'));
   adopt(target);locatedPlacement=layerPath(node);mode='visual';render();
  }});
 const recordings=websiteFilesRecordings({t:tr,esc,request,read:()=>websiteHTML(html),css:()=>css,path:()=>opened.path,site:()=>opened.site,url:name=>recoveredPicture(name)??canvasURL(name),historyKey:()=>historyKey,
  edited:()=>{onDirty(true);recovery.edited();paintStatus();},settle:recovery.settled,forget:recovery.forget,recoveryRef:recovery.currentRef,
  adopt:value=>{checkpoint(true);adopt(value,{savedCheckpoint:true});},render,run,notify,close:()=>{mode='visual';render();}});
 const figures=websiteSourceGallery({request,site:()=>opened,t:tr,esc,render,adopt:adoptRelated,notify,signal:()=>controller.signal,
  changed:value=>{onDirty(value||dirty);paintStatus();},leave:()=>{mode='visual';render();}});
 async function startFigures(id=null,entry=null){
  const pin=generation,currentId=siteId(),path=opened.path;
  if(mode!=='source-gallery'){
   await save();
   if(pin!==generation||currentId!==siteId()||path!==opened?.path||!await figures.open(id))return;
  }
  if(entry&&!await figures.load(entry))return;
  mode='source-gallery';render();
 }
 async function insertContent(operation,selection){
  await save();
  adoptRelated(await request(operation,{siteId:siteId(),expectedRevision:opened.site.revision,path:opened.path,...selection}));
  render();
 }
 async function checkPlacementRevision(revision){
  await save();
  if(opened.site.revision!==revision)throw Error(tr('changed'));
 }
 const placementDrag=websitePlacementDrag({site:()=>opened,available:()=>mode==='visual'&&!busy&&!stale,t:tr,
  place:selection=>void run(()=>insertContent('insert-source',selection)).catch(reason=>notify(reason.message,true))});
 const presentation=websitePlacementPresentation({t:tr,request,
  refresh:value=>{adoptRelated(value);render();document.querySelector('[data-action="website-files-presentation"]')?.focus();},
  onError:reason=>{if(['ACCESS_LOCKED','AUTH','CONFLICT','NOT_FOUND','WEBSITE_CHANGED','PUBLICATION_PERMISSIONS_CHANGED'].includes(reason.code))hideUnverifiedPage(true);else notify(reason.message||tr('failed'),true);}});
 const feeds=websiteFileFeeds({t:tr,request,refresh:value=>{adoptRelated(value);render();document.querySelector('[data-action="website-files-feeds"]')?.focus();},report:reason=>notify(reason.message||tr('failed'),true)});
 async function openFeed(trigger,newFeed=false){
  await save();const doc=websiteHTML(opened.html);
  const id=newFeed?null:blockAt(doc,selected)?.closest('[data-website-feed]')?.dataset.websiteFeed;
  await feeds.open({site:opened.site,page:opened.path,blocks:structure(doc).map(label),feedId:id,trigger});
 }
 function checkSavedSite(trigger){
  const site=opened.site;
  reviewSavedWebsite({site,directory:directory(site.revision,'edition'),request,signal:controller.signal,t:tr,trigger,
   onError:reason=>{if(['ACCESS_LOCKED','AUTH','WEBSITE_CHANGED','CONFLICT','PUBLICATION_PERMISSIONS_CHANGED'].includes(reason.code))hideUnverifiedPage(true);else notify(reason.message||tr('failed'),true);},
   edit:(path,issue,repair)=>run(async()=>{
    if(siteId()!==site.id||stale||opened.site.revision!==site.revision)throw Object.assign(Error(tr('changed')),{code:'CONFLICT'});
    if(!await beforeLeave(true))return;
    const owner=site.feedPages?.find(p=>p.path===path)?.ownerPage;
    const page=await request('open',{siteId:site.id,path:owner??(path===site.cssPath?'index.html':path)},{signal:controller.signal});
    if(page.site.revision!==site.revision)throw Object.assign(Error(tr('changed')),{code:'CONFLICT'});
    adopt(page);history.replaceState(history.state,'',fileRoute(site.id));mode='visual';
    if(repair){
     documentChange(doc=>{
      const node=websiteLayerAt(doc,issue.elementPath);
      if(!node||node.closest(managedWebsiteContent))throw Error(tr('changed'));
      if(issue.key==='missingAlt'&&node.localName==='img'&&!node.hasAttribute('alt'))node.alt=repair.value;
      else if(['brokenLink','draftLink'].includes(issue.key)&&node.matches('a[href]'))node.setAttribute('href',repair.value);
      else if(issue.key==='emptyLink'&&node.matches('a[href]'))node.setAttribute('aria-label',repair.value);
      else throw Error(tr('changed'));
     });
     locatedPlacement=issue.blockPath??issue.elementPath;render();return;
    }
    if(issue.feedId){render();await feeds.open({site:page.site,page:page.path,blocks:structure(websiteHTML(page.html)).map(label),feedId:issue.feedId});return;}
    if(owner){resetPreview();mode='preview';navigatePreview({path,hash:''});return;}
    if(path===site.cssPath)mode='css';
    if(['missingTitle','missingLang'].includes(issue.key)){mode='pages';pagesPanel.open();return;}
    locatedPlacement=issue.blockPath??null;render();
   })
  });
 }
 const picker=websiteFilesPicker({request,esc,site:()=>opened,blocks:()=>structure().map(label),
  onPickerPaint:placementDrag.paint,onPickerClose:placementDrag.reset,
  onSourceGallery:entry=>startFigures(null,entry),choosingGallerySource:()=>mode==='source-gallery',
  libraryStatus:async()=> (await request('preparation',undefined,{signal:controller?.signal})).preparation?.library,
  insert:selection=>insertContent('insert-source',selection),
  insertMany:selection=>insertContent('insert-sources',selection),
  async mutatePlacement(operation,data){
   const targetSite=data.siteId??siteId(),currentSite=siteId();
   if(targetSite===currentSite)await checkPlacementRevision(data.expectedRevision);
   const currentPath=opened.path;
   const result=await request('library/'+operation+'-placement',{...data,siteId:targetSite});
   if(targetSite!==currentSite)return;
   adoptRelated(result.path===currentPath?result:await request('open',{siteId:currentSite,path:currentPath}));
   render();
  },
  async jumpPlacement({siteId:targetSite=siteId(),path,blockPath,expectedRevision,sourceId,kind,feedId,ownerPage}){
   if(targetSite===siteId())await checkPlacementRevision(expectedRevision);
   else if(!await beforeLeave(true))return false;
   const page=await request('open',{siteId:targetSite,path:kind==='feed'?ownerPage:path});
   if(page.site.revision!==expectedRevision)throw Error(tr('changed'));
   if(kind==='feed'){
    const feed=websiteHTML(page.html).querySelector('section[data-website-feed="'+CSS.escape(feedId)+'"]');
    const onPage=path===ownerPage?feed?.querySelector('[data-website-feed-source="'+CSS.escape(sourceId)+'"]'):page.site.feedPages?.some(p=>p.path===path&&p.ownerPage===ownerPage);
    if(!feed||!onPage)throw Error(tr('changed'));
    adopt(page);selected=null;resetPreview();mode='preview';history.replaceState(history.state,'',fileRoute(targetSite));
    navigatePreview({path,hash:'#website-feed-'+feedId,feedId,sourceId});return true;
   }
   if(blockPath!==null){
    const node=blockAt(websiteHTML(page.html),blockPath);
    if(!node||node.dataset.observandaSource!==sourceId&&node.dataset.observandaLink!==sourceId)throw Error(tr('changed'));
   }
   adopt(page);mode='visual';selected=null;locatedPlacement=blockPath;
   history.replaceState(history.state,'',fileRoute(targetSite));render();
   if(blockPath===null)notify(tr('pickerHeadUse',{page:page.path}));
  }
 });
 const hierarchy=websiteHierarchy({t:tr,site:()=>opened,enabled:()=>!!opened&&!stale&&!form,available:()=>!busy,
  snapshot:()=>{flushCanvas();return html;},read:()=>websiteHTML(html),edit:documentChange,button,escape:esc,
  openPage:path=>run(async()=>{if(await beforeLeave(true)){mode='visual';await open(siteId(),path);}}),
  selectLayer:path=>{if(mode==='visual'&&visual){visual.select(path);return;}void run(async()=>{if(await beforeLeave(true)){mode='visual';selected=path;render();}});},
  retainSelection:path=>{selected=path;},notify:()=>notify(tr('layerMoveUnavailable'),true)});
 function forgetSelection(){visual?.destroy();visual=null;selected=locatedPlacement=null;hierarchy.reset();}
 const previewMemory=new Map();
 function resetPreview(){trail=[];step=-1;anchor='';previewMemory.clear();}
 function navigatePreview(page,remember=true){
  if(remember){
   if(trail[step]?.path===page.path&&trail[step]?.hash===page.hash&&(trail[step]?.search??'')===(page.search??''))return;
   trail.splice(step+1);trail.push(page);if(trail.length>100)trail.shift();step=trail.length-1;
  }
  render();
 }
 function scrollToAnchor(doc,hash){if(!hash)return;let id;try{id=decodeURIComponent(hash.slice(1));}catch{return;}doc.getElementById(id)?.scrollIntoView();}
 function bindNavigation(doc,path,preview,base=directory(),pages=previewPages()){
  bindSavedLinks(doc,{url:new URL(path,base).href,directory:base,pages,unavailable:()=>notify(tr('outsidePreview')),
   external:preview?href=>window.open(href,'_blank','noopener,noreferrer'):null,download:preview?(url,name)=>void downloadResource(url,name).catch(e=>notify(e.message,true)):null,navigate:page=>{
   if(busy||stale)return;
   if(preview){navigatePreview(page);return;}
   if(opened.site.feedPages?.some(member=>member.path===page.path)){
    void run(async()=>{await save();resetPreview();mode='preview';navigatePreview(page);}).catch(reason=>notify(reason.message,true));return;
   }
   if(page.path===opened.path){scrollToAnchor(doc,page.hash);return;}
   void run(async()=>{if(await beforeLeave(true)){anchor=page.hash;await open(siteId(),page.path);}}).catch(e=>notify(e.message,true));
  }});
 }
 function status(){
  if(error)return error;
  if(stale)return tr('changed');
  if(busy)return tr(busy);
  if(!opened)return '';
  return tr(dirty||figures.dirty()||recordings.dirty()?'unsaved':'saved');
 }
 function button(key,action,extra=''){return '<button type="button" class="button" data-action="website-files-'+action+'" '+extra+'>'+esc(tr(key))+'</button>';}
 const field=(key,value,extra='')=>'<label>'+esc(tr(key))+'<input data-website-file-field="'+key+'" value="'+esc(value)+'" '+extra+'></label>';
 function flushCanvas(){
  clearTimeout(canvasTimer);canvasTimer=null;if(!pendingCanvas)return;
  const document=pendingCanvas;pendingCanvas=null;html=websiteCanvasValue(document,html,()=>notify(tr('sourceNormalized')));changed();
 }
 function canvasInput(document){pendingCanvas=document;dirty=true;recovery.edited();plan=null;onDirty(true);paintStatus();clearTimeout(canvasTimer);canvasTimer=setTimeout(flushCanvas,180);}
 function changed(){dirty=html!==opened?.html||css!==opened?.css;if(dirty)recovery.edited();plan=null;onDirty(dirty||destinationDirty);paintStatus();sourcePane.sync();for(const op of ['undo','redo']){const node=document.querySelector('[data-action="website-files-'+op+'"]');if(node)node.disabled=!(op==='undo'?undo:redo).length;}}
 function paintStatus(){
  const resume=document.querySelector('[data-website-files-reopen]');
  if(resume)resume.hidden=!stale||awaitingAccess||Boolean(conflictingPage);
  const host=document.querySelector('[data-website-files-status]');
  if(host){
   host.textContent=status();host.hidden=!host.textContent;
   host.setAttribute('role',error||stale?'alert':'status');
   host.classList.toggle('website-files-error',!!error||stale);
  }
  const controls=document.querySelector('[data-website-file-controls]');
  if(controls){controls.disabled=!!busy;controls.setAttribute('aria-busy',String(!!busy));}
  const canvas=document.querySelector('#website-files-canvas');
  if(canvas)canvas.inert=!!busy||stale||sourcePane.pending;
  const back=document.querySelector('[data-action="website-files-back"]');
  if(back)back.disabled=!!busy;
  for(const node of document.querySelectorAll('[data-website-file-requires-clean]'))node.disabled=stale;
  const transfer=document.querySelector('[data-action="website-files-publish"]');
  if(transfer)transfer.disabled=stale||dirty||destinationDirty||!plan||!document.querySelector('[data-website-files-confirm]')?.checked;
  const saveButton=document.querySelector('[data-action="website-files-save"]');
  if(saveButton)saveButton.disabled=!(dirty||pagesPanel.dirty()||menu.dirty())||stale;
  const discardButton=document.querySelector('[data-action="website-files-discard"]');
  if(discardButton)discardButton.disabled=!dirty||stale;
 }
 function adopt(value,{savedCheckpoint=false}={}){
  if(!value?.site?.id||typeof value.site.revision!=='string'||!Array.isArray(value.site.pages)||typeof value.html!=='string'||typeof value.css!=='string'||typeof value.path!=='string')throw Error(tr('failed'));
  conflicts.select(null);
  const switched=value.path!==opened?.path||value.site.id!==siteId();
  if(switched){sourcePane.reset();forgetSelection();picker.reset();components.pageChange(value.site.id===siteId());recordings.reset();gallery.reset();figures.reset();}
  if(!savedCheckpoint||value.path!==opened?.path||value.site.id!==siteId()||value.sourceStamp!==opened.sourceStamp){
   undo=[];redo=[];historyBytes=0;historyKey=crypto.randomUUID();
  }
  lastCheckpoint=0;recoveringSource=false;
  opened=value;html=value.html;css=value.css;dirty=stale=awaitingAccess=false;conflictingPage=null;error='';plan=null;onDirty(menu.dirty());onSite(value.site);const at=sites.findIndex(site=>site.id===value.site.id);if(at<0)sites.push(value.site);else sites[at]=value.site;
  if(switched)void recovery.select(value.site.id,value.path);
  if(sourcePane.active)sourcePane.open();
 }
 function adoptRelated(value){
  if(!opened||value.path!==opened.path||value.site.id!==siteId())return adopt(value);
  if(value.html===html&&value.css===css&&value.sourceStamp===opened.sourceStamp)return adopt(value,{savedCheckpoint:true});
  const key=historyKey,from={html,css,sourceStamp:opened.sourceStamp},past=rebasePageHistory(undo,from,value),future=rebasePageHistory(redo,from,value);
  adopt(value);historyKey=key;undo=past.entries;redo=future.entries;
  historyBytes=undo.reduce((n,entry)=>n+entry.html.length+entry.css.length,0);
  if(past.skipped||future.skipped)notify(tr('historySharedChanged'));
 }
 function hideUnverifiedPage(retry,saved=null,message='changed'){
  document.querySelector('dialog[data-style-library]')?.close();
  document.querySelector('dialog[data-website-ranges]')?.close();
  if(stale&&awaitingAccess&&retry&&!saved&&!conflictingPage)return;
  if(mode==='versions'){versions.reset();mode='visual';}
  if(sourcePane.pending)mode=sourcePane.kind;
  sourcePane.reset();
  if(!stale&&retry&&mode==='visual'){
   const frame=document.getElementById('website-files-canvas'),doc=frame?.contentDocument;
   if(doc?.body)waitingView={page:opened.path,revision:opened.site.revision,selection:document.activeElement===frame?canvasSelection(doc):null,scroll:doc.scrollingElement?.scrollTop??0};
  }
  feeds.suspend();
  if(mode==='source-gallery')figures.suspend();
  conflictingPage=saved;if(!saved)conflicts.select(null);
  awaitingAccess=retry;
  stale=true;plan=null;error=tr(awaitingAccess?'checkingPageAccess':message);
  components.reset();picker.reset();
  for(const dialog of document.querySelectorAll('dialog.website-author-dialog[open]'))dialog.close();
  render();
 }
 async function run(operation,progress='working'){
  if(busy)return;
  const epoch=generation;busy=progress;error='';paintStatus();
  try{return await operation();}
  catch(reason){
   if(reason.name==='AbortError'||epoch!==generation)return;
   if(reason.code==='ACCESS_LOCKED'||reason.code==='AUTH'){if(opened)hideUnverifiedPage(true);throw reason;}
   if(['CONFLICT','WEBSITE_CHANGED','PUBLICATION_PERMISSIONS_CHANGED'].includes(reason.code)&&opened){
    hideUnverifiedPage(reason.code==='PUBLICATION_PERMISSIONS_CHANGED');return;
   }
   if(reason.code==='PUBLISH_STALE')plan=null;
   error=stale?tr('changed'):reason.message||tr('failed');
   if(stale||reason.code==='PUBLISH_STALE')render();
  }
  finally{if(epoch===generation){busy=false;paintStatus();}}
 }
 async function open(id,path='index.html'){
  const epoch=generation,value=await request('open',{siteId:id,path},{signal:controller?.signal});
  if(epoch!==generation)return;
  missingSite=false;adopt(value);history.replaceState(history.state,'',fileRoute(value.site.id));render();
 }
 async function initialPage(){
  const epoch=generation;
  const id=requestedSite??session.preparation?.defaultSiteId??session.defaultSiteId??sites[0]?.id;
  if(!id){render();return;}
  try{await open(id);}
  catch(reason){
   const listed=sites.find(site=>site.id===id);
   if(reason.code==='CONFLICT'&&listed&&epoch===generation){
    opened={site:listed,path:'index.html'};openingAfterFence=true;hideUnverifiedPage(true);return;
   }
   if(reason.code!=='NOT_FOUND')throw reason;
   if(!requestedSite&&sites[0]?.id&&sites[0].id!==id)await open(sites[0].id);
   else{missingSite=true;render();return;}
  }
  if(epoch===generation&&openPublishing&&opened)await run(showDestination,'loading');
 }
 function waitForPreparation(){
  if(preparationTimer!==null||session?.preparation?.state!=='preparing')return;
  const epoch=generation;
  preparationTimer=setTimeout(async()=>{
   preparationTimer=null;
   try{
    if(document.hidden||busy)return;
    const result=await request('preparation',undefined,{signal:controller.signal});
    if(epoch!==generation)return;
    if(result.preparation?.state==='preparing'){
     session.preparation=result.preparation;
     const status=document.querySelector('[data-website-preparation]');
     if(status){const message=preparationMessage(session.preparation);if(status.textContent!==message)status.textContent=message;}
     return;
    }
    if(result.preparation?.state!=='ready'){
     session.preparation=result.preparation;render();return;
    }
    // Only the workspace produces saved files. This view checks its receipt,
    // then refreshes the file list once when preparation finishes.
    const page=await request('list',{limit:100},{signal:controller.signal});
    if(epoch!==generation)return;
    session.preparation=result.preparation;sites=page.items;nextSite=page.next;error='';
    if(!opened)await initialPage();
    else if(!form&&!dirty&&!destinationDirty)render();
   }catch(reason){
    if(epoch===generation&&reason.name!=='AbortError'){
     session.preparation={state:'failed'};error=reason.message||tr('failed');render();
    }
   }finally{if(epoch===generation)waitForPreparation();}
  },2000);
 }
 async function load({id=null,publishing=false}={}){
  clear();compactViewport.addEventListener('change',resizeTools);const epoch=generation;controller=new AbortController();
  const result=await request('session',undefined,{signal:controller.signal});
  if(epoch!==generation)return;
  session=result;onSession(session);sites=session.sites??[];nextSite=session.next??null;
  requestedSite=id??/^#\/websites\/([a-f0-9-]{36})\//.exec(location.hash)?.[1]??null;openPublishing=publishing;
  await initialPage();waitForPreparation();
 }
 function clear(){
  recovery.reset();sourcePane.reset();versions.reset();lifecycle.reset();
  waitingView=null;openingAfterFence=false;
  presentation.close();
  viewport.reset();
  feeds.clear();
  figures.reset();
  conflictingPage=null;awaitingAccess=false;conflicts.select(null);
  compactViewport.removeEventListener('change',resizeTools);clearTimeout(preparationTimer);preparationTimer=null;missingSite=false;requestedSite=null;openPublishing=false;pendingCanvas=null;clearTimeout(canvasTimer);canvasTimer=null;generation++;folder.reset();menu.reset();components.reset();recordings.reset();pagesPanel.reset();gallery.reset();picker.reset();forgetSelection();resetPreview();controller?.abort();controller=null;clearInterval(timer);timer=null;mode='visual';session=null;opened=null;sites=[];nextSite=null;destination=null;destinationDirty=false;plan=null;form=null;dirty=busy=stale=false;html=css=error='';undo=[];redo=[];historyBytes=0;onDirty(false);
 }
 function historyEntry(){return {html,css,sourceStamp:opened?.sourceStamp,selection:canvasSelection(document.getElementById('website-files-canvas')?.contentDocument)};}
 function checkpoint(force=false){const now=Date.now();if(force||now-lastCheckpoint>350||!undo.length){flushCanvas();undo.push(historyEntry());historyBytes+=html.length+css.length;while(undo.length>50||historyBytes>8*1024*1024&&undo.length>1){const oldest=undo.shift();historyBytes-=oldest.html.length+oldest.css.length;}lastCheckpoint=now;}redo=[];gallery.trimHistory(html,undo.toReversed());}
 const authoredHTML=doc=>serializeWebsiteHTML(doc,html,()=>notify(tr('sourceNormalized')));
 function documentChange(operation){flushCanvas();checkpoint(true);const document=websiteHTML(html);operation(document);html=authoredHTML(document);changed();render();}
 function ensureStyle(doc){const url=baseURL(opened.site.cssPath);if(![...doc.querySelectorAll('link[rel="stylesheet"][href]')].some(link=>new URL(link.getAttribute('href'),baseURL()).href===url)){const link=doc.createElement('link');link.rel='stylesheet';link.href='../'.repeat(opened.path.split('/').length-1)+opened.site.cssPath;doc.head.append(link);}}
 function blockDialog(edit,style=''){
  const doc=websiteHTML(html),site=opened,original=html;
  const current=()=>opened===site&&html===original&&!stale;
  return edit({doc,at:blockAt(doc,selected),t:tr,path:site.path,directory:directory(),pages:site.site.pages,current,apply:value=>{
   if(!current()){notify(tr('changed'),true);return;}
   checkpoint(true);if(style){ensureStyle(value);if(!css.includes(style))css+=style;}html=authoredHTML(value);changed();render();
  }});
 }
 async function save(){
  if(sourcePane.pending&&!await sourcePane.check())throw Error(tr('sourceCorrect'));
  flushCanvas();if(!opened||!dirty)return opened;if(stale)throw Error(tr('changed'));
  await recovery.settled();
  const submitted={html,css},epoch=generation,data={siteId:siteId(),expectedRevision:opened.site.revision,path:opened.path,historyKey,recovery:recovery.ref(),...submitted};
  const upload=gallery.body(data);let value;
  try{value=await request(upload?'save-pictures':'save',upload??data,{signal:controller?.signal});}
  catch(reason){if(epoch===generation&&dirty)recovery.edited();throw reason;}
  if(epoch!==generation||data.siteId!==siteId()||data.path!==opened?.path)return;
  if(upload)gallery.acknowledged(websiteHTML(submitted.html),data.path);
  await recovery.forget({saved:true});
  flushCanvas();
  const newer=html!==submitted.html||css!==submitted.css;
  if(newer&&opened.sourceStamp!==value.sourceStamp)updateFromSaved(value);
  else if(newer){opened=value;stale=false;error='';changed();}
  else{adopt(value,{savedCheckpoint:true});if(mode==='gallery')gallery.open(selected);}
  return value;
 }
 async function saveAuthoring(){
  if(figures.dirty())await figures.action('apply');
  if(menu.dirty())await menu.save();
  if(pagesPanel.dirty())await pagesPanel.save();
  await save();
 }
 async function manageBreakpoints(){
  if(!await beforeLeave(true))return;
  const base=opened,trigger=document.activeElement,{editWebsiteBreakpoints}=await import('./website-breakpoint-editor.js');
  const current=()=>opened===base&&!stale;
  const command=async(operation,ranges,reviewId)=>{
   if(!current())throw Error(tr('changed'));
   const result=await request('breakpoints/'+operation,{siteId:base.site.id,path:base.path,expectedRevision:base.site.revision,ranges,reviewId},{signal:controller.signal});
   if(!current())throw Error(tr('changed'));return result;
  };
  editWebsiteBreakpoints({site:base.site,t:tr,current,trigger,signal:controller.signal,review:ranges=>command('review',ranges),
   apply:async(ranges,reviewId)=>{const result=await command('apply',ranges,reviewId);adoptRelated(result);render();}});
 }
 async function beforeLeave(fromAction=false){
  if(busy&&!fromAction)return false;
  if(recordings.dirty()){if(!confirm(tr('recordingDiscard')))return false;await recovery.forget();recordings.reset();}
  if(figures.dirty()&&!figures.canSave()){if(!confirm(tr('discardConfirm')))return false;figures.reset();onDirty(dirty);}
  if(!dirty&&!destinationDirty&&!menu.dirty()&&!pagesPanel.dirty()&&!figures.dirty())return true;
  if(!confirm(tr('saveBeforeLeave')))return false;
  if(figures.dirty())await figures.action('apply');
  if(dirty)await save();if(destinationDirty)await saveDestination();if(menu.dirty())await menu.save();if(pagesPanel.dirty())await pagesPanel.save();return true;
 }
 async function discard(){
  if(figures.dirty()&&!confirm(tr('discardConfirm')))return false;
  if((dirty||menu.dirty()||pagesPanel.dirty()||recordings.dirty()||destinationDirty)&&!confirm(tr('discardConfirm')))return false;
  if(!opened)return true;
  // Read the replacement first. A failed read leaves the editable draft intact.
  const current=opened,replacement=await request('open',{siteId:siteId(),path:opened.path},{signal:controller?.signal});if(opened!==current)return false;
  await recovery.forget();
  menu.reset();pagesPanel.reset();components.reset();picker.reset();gallery.reset();recordings.reset();forgetSelection();resetPreview();
  figures.reset();destinationDirty=false;destination=null;mode='visual';adopt(replacement);render();return true;
 }
 function updateFromSaved(value){
  flushCanvas();
  awaitingAccess=false;
  components.reset();picker.reset();
  for(const dialog of document.querySelectorAll('dialog.website-author-dialog'))dialog.close();
  if(mode==='media'){recordings.reset();mode='visual';}
  if(!dirty){adopt(value);if(mode==='gallery')gallery.open(selected);render();return;}
  if(opened.pageId&&opened.pageId!==value.pageId){hideUnverifiedPage(false,null,'changedPageAccess');return;}
  const protectedMedia=Boolean(opened.protectedFiles?.length||value.protectedFiles?.length);
  const simple=protectedMedia&&opened.sourceStamp!==value.sourceStamp?null:rebaseWebsitePlacements(opened.html,html,value.html);
  const style=css===opened.css?value.css:value.css===opened.css||css===value.css?css:null;
  let result=simple===null||style===null?null:{html:simple,css:style};
  if(!result){
   const review=websiteConflictReview(opened,{html,css},value);
   if(!review){hideUnverifiedPage(false,null,'changedPageAccess');return;}
   if(review.rows.length){conflicts.select(review);hideUnverifiedPage(false,value);return;}
   result=review.result();if(!result){hideUnverifiedPage(false,null,'changedPageAccess');return;}
  }
  adoptMerge(value,result);if(mode==='gallery')gallery.open(selected);render();
 }
 function adoptMerge(value,result){
  adopt(value);
  if(value.html!==result.html||value.css!==result.css){checkpoint(true);html=result.html;css=result.css;changed();}
 }
 async function poll(){
  if(checkBusy||busy||!opened||document.hidden)return;const epoch=generation,id=siteId(),revision=opened.site.revision;checkBusy=true;
  const samePage=()=>epoch===generation&&id===siteId()&&revision===opened?.site.revision;
  try{
   const observed=opened,path=observed.path;
   const current=await request('version',{siteId:id,path,expectedRevision:revision},{signal:controller.signal});
   if(!samePage())return;
   if(opened!==observed||busy)return;
   if(openingAfterFence){
    const value=await request('open',{siteId:id,path},{signal:controller.signal});
    if(!samePage()||busy)return;openingAfterFence=false;adopt(value);render();
    if(openPublishing)await run(showDestination,'loading');return;
   }
   if(current.revision===conflictingPage?.site.revision)return;
   if(current.revision!==revision){
    if(!stale&&mode==='visual'&&!sourcePane.pending&&!form&&!document.querySelector('dialog[open]')&&opened.surfaceStamp&&opened.surfaceStamp===current.surfaceStamp&&current.site?.revision===current.revision){
     opened={...opened,site:current.site};plan=null;onSite(current.site);
     const at=sites.findIndex(site=>site.id===id);if(at>=0)sites[at]=current.site;
     const pages=document.querySelector('[data-website-file-page]');
     if(pages)pages.innerHTML=pagesPanel.options();
     const heading=document.querySelector('.website-workspace-heading h1');if(heading)heading.textContent=current.site.name;
     const option=document.querySelector('[data-website-file-site]')?.selectedOptions[0];if(option)option.textContent=current.site.name;
     paintStatus();return;
    }
    if(!stale||conflictingPage)hideUnverifiedPage(true);
    const page=opened.path,value=await request('open',{siteId:id,path:page},{signal:controller.signal});
    if(samePage()&&opened.path===page){
     if(mode==='source-gallery')await figures.recover(value);
     if(samePage()&&opened.path===page)updateFromSaved(value);
    }
   }else if(awaitingAccess){
    if(mode==='source-gallery')await figures.recover(opened);
    awaitingAccess=stale=false;error='';render();
   }else{await picker.revalidate({signal:controller.signal});await presentation.revalidate(controller.signal);if(mode==='source-gallery')await figures.revalidate();}
  }catch(reason){
   if(reason.name==='AbortError'||!samePage())return;
   if(mode==='source-gallery'&&['GALLERY_EDIT_CONFLICT','NOT_FOUND'].includes(reason.code)){
    hideUnverifiedPage(false);awaitingAccess=false;error=tr('galleryConcurrent');paintStatus();
   }else if(mode==='source-gallery'||['CONFLICT','PUBLICATION_PERMISSIONS_CHANGED','WEBSITE_CHANGED','ACCESS_LOCKED','AUTH'].includes(reason.code))hideUnverifiedPage(true);
   else{error=reason.message||tr('failed');paintStatus();}
  }
  finally{checkBusy=false;}
 }
 function siteSelector(inGroup=false){
  if(!sites.length)return '';
  const choose=opened?'':'<option value="" selected disabled>'+esc(tr('chooseSite'))+'</option>';
  const options=sites.map(site=>'<option value="'+esc(site.id)+'" '+(site.id===siteId()?'selected':'')+'>'+esc(site.name)+'</option>').join('');
  const select='<select class="website-file-select" data-website-file-site aria-label="'+esc(tr('site'))+'">'+choose+options+'</select>';
  return (inGroup?select:'<label>'+esc(tr('site'))+' '+select+'</label>')+(nextSite?button('more','sites-more'):'');
 }
 const compactViewport=window.matchMedia('(max-width:760px)');
 function extraTools(title,content){
  const label=esc(tr(title));
  return '<details class="website-task-group" data-website-tools aria-label="'+label+'" '+(compactViewport.matches?'':'open')+'><summary>'+label+'</summary><span class="website-task-label" aria-hidden="true">'+label+'</span><div class="website-extra-tools">'+content+'</div></details>';
 }
 function resizeTools(){for(const group of document.querySelectorAll('[data-website-tools]'))group.open=!compactViewport.matches;}
 function siteToolbar(){
  const options=mode==='preview'?'<option>'+esc(trail[step]?.path??opened.path)+'</option>':pagesPanel.options();
  const page='<select class="website-file-select" data-website-file-page aria-label="'+esc(tr('page'))+'">'+options+'</select>';
  return extraTools('site',siteSelector(true)+button('create','new')+button('lifeManageSite','manage-site')+button('versionsTitle','versions'))+extraTools('page',page+button('pagePanel','pages')+button('addPage','new-page'))+
   extraTools('siteDesignTools',button('menu','menu')+button('siteAppearance','appearance')+button('designThemes','themes')+button('styleLibrary','styles'))+
   extraTools('siteReleaseTools',button('checkWebsite','check-website')+button('destination','destination')+button('folderPublish','folder')+button('download','download','data-website-file-requires-clean'));
 }
 function unopenedView(){
  const state=session.preparation?.state;
  if(state==='preparing')return '<p role="status" data-website-preparation>'+esc(preparationMessage(session.preparation))+'</p>';
  if(missingSite||state!=='ready'){
   const message=missingSite?'unavailable':state==='failed'?'preparationFailed':'workspaceCheck';
   return '<section class="panel">'+(error?'':'<p>'+esc(tr(message))+'</p>')+button('create','new')+button('retry','retry')+'</section>';
  }
  return '<section class="panel"><p>'+esc(tr('noWebsite'))+'</p>'+button('create','new')+'</section>';
 }
 function view(){
  flushCanvas();
  if(!session)return '<p role="status">'+esc(tr('loading'))+'</p>';
  const title=opened?.site.name??tr('title');
  const composing=mode==='source-gallery';
  const choosingTarget=mode==='publish-choose'||mode==='publish-review';
  const authoring=opened&&!form&&!stale&&!composing&&!choosingTarget&&!['menu','destination','folder'].includes(mode);
  const currentTask=({menu:'menu',preview:'preview',pages:'pagePanel',gallery:'gallery',media:'recordings',destination:'destination',folder:'folderPublish','source-gallery':'galleryFromEntries','publish-review':'publishUpdate','publish-choose':'publishUpdate'})[mode]??'title';
  const headerActions=authoring?'<div class="website-primary-actions">'+button('save','save','data-website-file-requires-clean')+button('preview','preview','data-website-file-requires-clean')+button('publishUpdate','publish-update','data-website-file-requires-clean')+'</div>':'';
  const guideButton='<button type="button" class="button subtle" data-action="context-help" data-saved-website-guide>'+esc(tr('websiteGuide'))+'</button>';
  let body;
  if(stale)body=conflictingPage?conflicts.view():awaitingAccess?'<section class="panel"><h2>'+esc(tr('savedPageWaiting'))+'</h2><p>'+esc(tr('savedPageWaitingDetail'))+'</p>'+button('retry','check-access')+'</section>':'';
  else if(form)body=formView();
  else if(mode==='lifecycle')body=lifecycle.view();
  else if(!opened)body=unopenedView()+button('lifeArchivedSites','archived-sites');
  else if(mode==='folder')body=button('closePreview','visual')+folder.view();
  else if(choosingTarget)body=publishUpdateView();
  else if(mode==='destination')body=destinationView();
  else if(mode==='menu')body=menu.view();
  else if(mode==='pages')body=pagesPanel.view();
  else if(mode==='versions')body=versions.view();
  else if(mode==='media')body=recordings.view();
  else if(composing)body=figures.view(picker.view());
  else if(mode==='gallery'){
   const groups=[...websiteHTML(html).querySelectorAll('[data-website-source-gallery]')];
   body='<section class="panel"><h2>'+esc(tr('galleryFromEntries'))+'</h2>'+button('galleryChooseFigures','figures-new')+
    groups.map((node,i)=>'<button type="button" class="button" data-action="website-files-figures-edit" data-gallery="'+esc(node.dataset.websiteSourceGallery)+'">'+esc(node.querySelector('h2,h3')?.textContent||tr('galleryNumber',{number:i+1}))+'</button>').join('')+'</section>'+gallery.view();
  }
  else if(mode==='preview')body='<div class="website-files-toolbar">'+button('prevPage','preview-back',step>0?'':'disabled')+button('nextPage','preview-forward',step<trail.length-1?'':'disabled')+button('closePreview','visual')+viewport.controls()+'</div>'+viewport.frame('website-files-preview',tr('preview'));
  else body=editorView();
  const toolbar=authoring?siteToolbar():!opened&&!form?siteSelector():'';
  return '<fieldset class="website-file-controls" data-website-file-controls><header class="website-workspace-heading"><div class="website-workspace-identity"><span class="website-task-label">'+esc(tr(currentTask))+'</span><h1>'+esc(title)+'</h1></div><p class="website-files-status" role="status" data-website-files-status></p>'+headerActions+'<div class="website-workspace-utilities">'+guideButton+'</div></header>'+
   (toolbar?'<nav class="website-files-toolbar website-page-controls" aria-label="'+esc(tr('site'))+'">'+toolbar+'</nav>':'')+
   (opened&&!stale&&!form?'<div data-website-recovery></div>':'')+
   (!form&&draftPage()?'<p class="hint">'+esc(tr('draftNotice'))+'</p>':'')+
   button('reopen','reopen','data-website-files-reopen '+(stale&&!awaitingAccess&&!conflictingPage?'':'hidden'))+body+'</fieldset>';
 }
 function formView(){
  if(form.type==='design'){
   const name=field('designName',form.name,'required maxlength="160"');
   const remove=form.local?button('designForget','design-forget'):'';
   return '<section class="panel website-page-form"><form data-website-files-form><h2>'+esc(tr('designManage'))+'</h2><code>'+esc(opened.path)+'</code><p>'+esc(tr('designHelp'))+'</p>'+name+'<div class="inline-actions"><button type="submit" class="button primary">'+esc(tr('designSave'))+'</button>'+remove+button('cancel','form-cancel')+'</div></form></section>';
  }
  const isPage=form.type==='page',label=isPage?'addPage':'create';
  const name=field(isPage?'pageTitle':'name',isPage?form.title:'','required maxlength="160"');
  const path=isPage?field('pagePath',form.path,'required pattern="[a-zA-Z0-9_.\\/\\-]+[.]html"'):'';
  const inclusion=isPage?'<label>'+esc(tr('pageInclusion'))+'<select data-website-file-field="inclusion"><option value="private">'+esc(tr('pagePrivate'))+'</option><option value="included"'+(form.inclusion==='included'?' selected':'')+'>'+esc(tr('pageIncludeNext'))+'</option></select></label>':'';
  return '<section class="panel website-page-form"><form data-website-files-form><h2>'+esc(tr(label))+'</h2><div class="website-page-form-fields">'+name+path+inclusion+'</div>'+(isPage?pageDesignChoice():'')+
   '<div class="inline-actions"><button class="button primary" type="submit">'+esc(tr(label))+'</button>'+button('cancel','form-cancel')+'</div></form></section>';
 }
 function pageDesignChoice(){
  if(!form.designs)return button('designChoose','design-choose')+'<p class="hint">'+esc(tr('designDiscover'))+'</p>';
  const {items,total,next,previous}=form.designs;
  const options='<option value="">'+esc(tr('designBlank'))+'</option>'+items.map(item=>'<option value="'+esc(item.id)+'"'+(item.id===form.designId?' selected':'')+'>'+esc(item.name)+'</option>').join('');
  const filter=total>8||form.designQuery?'<div class="website-page-design-search">'+field('designSearch',form.designQuery??'','maxlength="160"')+button('pickerFind','design-search')+'</div>':'';
  return '<fieldset><legend>'+esc(tr('designChoose'))+'</legend>'+filter+
   '<label>'+esc(tr('designSelect'))+' <select data-website-file-field="designId">'+options+'</select></label>'+
   '<p class="hint">'+esc(tr('designHelp'))+'</p>'+
   (total>items.length?'<p>'+esc(tr('componentResults',{first:form.designOffset+1,last:form.designOffset+items.length,total}))+'</p>':(!total?'<p>'+esc(tr('designDiscover'))+'</p>':''))+
   (form.designOffset?button('pickerPrevious','design-previous','data-offset="'+previous+'"'):'')+(next!==null?button('pickerNext','design-next','data-offset="'+next+'"'):'')+'</fieldset>';
 }
 function designs(action,options={}){
  return request('page-designs',{siteId:siteId(),expectedRevision:opened.site.revision,path:opened.path,action,...options},{signal:controller.signal});
 }
 function editorView(){
  const tools='<span class="website-editor-modes">'+['visual','html','css'].map(key=>button(key,key,'aria-pressed="'+String(mode===key&&(key!=='visual'||!sourcePane.active))+'"')).join('')+button('splitSource','split-source','aria-pressed="'+(mode==='visual'&&sourcePane.active)+'"')+'</span>';
  const history=button('undo','undo',undo.length?'':'disabled')+button('redo','redo',redo.length?'':'disabled');
  const sizes=viewport.controls()+button('breakpointManage','breakpoints');
  const toolbar='<div class="website-files-toolbar website-authoring-tools" role="group" aria-label="'+esc(tr('title'))+'">'+tools+'<div class="website-command-set">'+history+button('discard','discard')+'</div><div class="website-command-set">'+button('gallery','galleries')+button('recordings','media')+(mode==='visual'?button('feedEditor','feeds')+button('placementTitle','presentation'):'')+'</div><div class="website-canvas-tools">'+button('checkPage','check-page')+(mode==='visual'?sizes:'')+'</div></div>';
  if(mode!=='visual')return toolbar+sourcePane.view(mode);
  const blocks='<label>'+esc(tr('block'))+' <select data-website-file-block>'+blockTypes.map(key=>'<option value="'+key+'">'+esc(tr(key==='heading'?'addHeading':key==='paragraph'?'addText':key))+'</option>').join('')+'<option value="feed">'+esc(tr('feedBlock'))+'</option></select></label>'+button('addBlock','add-block');
  return toolbar+'<div class="website-files-editor" '+(sourcePane.active?'data-source-open':'')+'><aside tabindex="0" aria-label="'+esc(tr('structure'))+'">'+components.tabs()+components.view()+'<div class="website-files-toolbar">'+blocks+'</div><section class="panel"><h2>'+esc(tr('structure'))+'</h2><ol class="website-files-structure" data-website-files-structure></ol></section>'+picker.view()+'</aside><section class="website-files-stage">'+viewport.frame('website-files-canvas',tr('visual'))+'<nav class="website-selection-trail" data-layer-trail aria-label="'+esc(tr('selectionTrail'))+'"></nav></section>'+(sourcePane.active?sourcePane.view():'')+'<aside class="website-files-inspection" tabindex="0" aria-label="'+esc(tr('sectionAppearance'))+'"><section data-website-visual-inspector></section></aside></div>';
 }
 const main=doc=>doc.querySelector('main:not([hidden])')??doc.body;
 function structure(doc=websiteHTML(html)){return [...main(doc).children].filter(node=>!['SCRIPT','STYLE','LINK'].includes(node.tagName));}
 function label(node){return (node.querySelector('h1,h2,h3')?.textContent||node.textContent).trim().slice(0,70)||node.localName;}
 function paintStructure(doc){
  const list=document.querySelector('[data-website-files-structure]');if(!list)return;
  hierarchy.paint(list,doc??websiteHTML(html));
 }
 function bindStructure(list){
  hierarchy.bindList(list);
 }
 function blockAt(doc,path){return websiteLayerAt(doc,path);}
 function selectSourcePath(path){
  while(path){if(visual?.select(path))return;const end=path.lastIndexOf('/');if(end<0)break;path=path.slice(0,end);}
 }
 function movable(node){return movableWebsiteLayer(node);}
 function bind(){
  recovery.paint();
  viewport.bind();
  sourcePane.bind();
  visual?.destroy();visual=null;
  const designFilter=document.querySelector('[data-website-file-field="designSearch"]');
  if(designFilter)designFilter.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();designFilter.form.querySelector('[data-action="website-files-design-search"]').click();}};
  for(const name of ['website-files','website-files-visual','website-files-hierarchy','website-files-menu']){
   if(!document.querySelector('link[data-sheet="'+name+'"]')){const link=document.createElement('link');link.rel='stylesheet';link.href='/'+name+'.css';link.dataset.sheet=name;document.head.append(link);}
  }
  hierarchy.bindHost(document);picker.bind();gallery.bind();figures.bind();components.bind();recordings.bind();
  if(mode==='menu')menu.bind();
  const preview=document.getElementById('website-files-preview');
  if(preview){
   const entry=trail[step]??{path:opened.path,hash:''};
   const all=previewPages(),privatePage=all.find(p=>p.path===entry.path)?.draft;
   const base=directory(opened.site.revision,privatePage?'preview':'edition'),members=privatePage?all:all.filter(p=>!p.draft);
   openSavedPreview(preview,new URL(entry.path,base).href+(entry.search??'')+entry.hash,doc=>{
    hierarchy.bindKeys(doc);enhanceSavedPreview(doc,{directory:base,pages:members,memory:previewMemory,navigate:navigatePreview,failed:()=>notify(tr('failed'),true)});
    bindNavigation(doc,entry.path,true,base,members);
    if(entry.feedId&&entry.sourceId){
     const item=doc.querySelector('section[data-website-feed="'+CSS.escape(entry.feedId)+'"] [data-website-feed-source="'+CSS.escape(entry.sourceId)+'"]');
     if(!item){notify(tr('changed'),true);return;}
     // The preview remains inert until its binding callback returns.
     requestAnimationFrame(()=>{
      if(!preview.isConnected||preview.contentDocument!==doc)return;
      item.tabIndex=-1;item.focus({preventScroll:true});item.scrollIntoView({block:'center'});
     });
    }else scrollToAnchor(doc,entry.hash);
   },()=>notify(tr('failed'),true));
  }
  const frame=document.getElementById('website-files-canvas'),historyFocus=pendingHistoryFocus;pendingHistoryFocus=null;if(frame){frame.onload=()=>{
   const doc=frame.contentDocument;if(!doc||!frame.isConnected||!opened)return;
   const draft=sourcePane.accepted();loadWebsiteCanvas(doc,draft.html,draft.css,canvasURL(opened.site.cssPath),recoveredResource);frame.inert=!!busy||stale||sourcePane.pending;gallery.paint(doc);editWebsiteCanvas(doc);
   components.bindCanvas(doc);bindNavigation(doc,opened.path,false);
   const inspector=document.querySelector('[data-website-visual-inspector]');
   visual=bindWebsiteVisual({document:doc,inspector,t:tr,layerDrag:hierarchy.canvasDrag,
    menuTarget:menuCanvasTarget,openMenu:nav=>void run(()=>openMenu(nav.dataset.websiteMenuId??null)),
   getWidth:viewport.width,previewWidth:viewport.previewWidth,getRanges:()=>opened.site.breakpoints??defaultBreakpoints(),manageRanges:()=>void run(manageBreakpoints).catch(()=>{}),
   beforeChange:()=>checkpoint(true),change:()=>canvasInput(doc),getCSS:()=>css,setCSS:value=>{css=value;changed();},stylesheet:canvasURL(opened.site.cssPath),getViewport:viewport.breakpoint,onSelect:item=>{
    selected=item?.path??null;hierarchy.selection(selected);components.selection();sourcePane.fromCanvas(selected);
    const control=inspector.parentElement.querySelector('[data-placement-context]');
    if(control)control.hidden=!presentationBlock(blockAt(doc,selected));
    const feedControl=inspector.parentElement.querySelector('[data-feed-context]');
    if(feedControl)feedControl.hidden=!blockAt(doc,selected)?.closest('[data-website-feed]');
    const nav=menuCanvasTarget(blockAt(doc,selected)),menuControl=inspector.parentElement.querySelector('[data-menu-context]');
    if(menuControl){menuControl.hidden=!nav;menuControl.dataset.menuId=nav?.dataset.websiteMenuId??'';inspector.hidden=Boolean(nav);}
   }});
   inspector.parentElement.querySelector('[data-menu-context]')?.remove();
   inspector.insertAdjacentHTML('beforebegin',button('menuEdit','menu','data-menu-context hidden'));
   inspector.parentElement.querySelector('[data-placement-context]')?.remove();
   inspector.insertAdjacentHTML('beforebegin',button('placementTitle','presentation','data-placement-context hidden'));
   inspector.parentElement.querySelector('[data-feed-context]')?.remove();
   inspector.insertAdjacentHTML('beforebegin',button('feedEdit','feeds','data-feed-context hidden'));
   hierarchy.bindCanvas(doc);placementDrag.bindCanvas(doc,frame);
   if(locatedPlacement!==null){
    const target=blockAt(doc,locatedPlacement);
    if(target&&!visual.select(locatedPlacement)){
     target.scrollIntoView({block:'center',inline:'nearest'});
     target.animate([{outline:'3px solid Highlight'},{outline:'3px solid Highlight'}],1800);
    }
    locatedPlacement=null;
   }else if(selected!==null)selectSourcePath(selected);
   doc.body.addEventListener('beforeinput',()=>checkpoint());doc.body.addEventListener('input',()=>canvasInput(doc));
   doc.addEventListener('keydown',event=>{
    if(!(event.ctrlKey||event.metaKey)||event.altKey)return;
    const op=({s:'save',y:'redo',z:event.shiftKey?'redo':'undo'})[event.key.toLowerCase()];if(!op)return;
    event.preventDefault();void action({dataset:{action:'website-files-'+op},fromCanvas:true}).catch(e=>notify(e.message,true));
   });
   scrollToAnchor(doc,anchor);anchor='';
   if(waitingView){
    const held=waitingView;waitingView=null;
    if(held.page===opened.path&&held.revision===opened.site.revision){
     if(held.selection&&(document.activeElement===document.body||document.activeElement===frame))restoreCanvasSelection(doc,held.selection);
     if(doc.scrollingElement)doc.scrollingElement.scrollTop=held.scroll;
    }
   }
   if(historyFocus&&(document.activeElement===document.body||document.activeElement===frame))restoreCanvasSelection(doc,historyFocus.selection);
  };frame.src=canvasURL()+'?canvas=1';}
  const list=document.querySelector('[data-website-files-structure]');if(list)bindStructure(list);
  paintStructure();paintStatus();if(opened&&!timer)timer=setInterval(()=>void poll(),5000);
 }
 function publishUpdateView(){
  const title='<h2>'+esc(tr('publishUpdate'))+'</h2>';
  if(mode==='publish-choose')return '<section class="panel website-files-publish">'+title+'<p>'+esc(tr('choosePublishTarget'))+'</p><div class="inline-actions">'+button('folderPublish','folder')+button('destination','destination')+button('checkWebsite','check-website')+button('closePreview','visual')+'</div></section>';
  return '<section class="panel website-files-publish">'+title+'<p>'+esc(opened.site.name)+' · '+esc(destination.config.kind==='github'?'GitHub':'SSH')+'</p>'+(!plan?'<p>'+esc(remoteAddress(destination.config))+'</p>':'')+transferView()+reviewView()+
   '<div class="inline-actions">'+(plan||destination.transfer?.uncertain?'':button('review','plan'))+button('destination','destination')+button('checkWebsite','check-website')+button('closePreview','visual')+'</div></section>';
 }
 function transferView(){return remoteReceiptView(destination,opened.site.revision,{esc,t,tr,button});}
 function destinationView(){if(!destination)return '<p role="status">'+esc(tr('loading'))+'</p>';const config=destination.config;
  return '<section class="panel website-files-publish"><h2>'+esc(tr('destination'))+'</h2><label>'+esc(tr('destination'))+'<select data-website-file-field="kind"><option value="github" '+(config.kind==='github'?'selected':'')+'>GitHub</option><option value="ssh" '+(config.kind==='ssh'?'selected':'')+'>SSH</option></select></label>'+(config.kind==='github'?github.view()+['owner','repository','branch','directory'].map(key=>field(key,config.github[key]??'','data-destination-group="github"')).join('')+'<label><input type="checkbox" data-website-file-field="pages" data-destination-group="github" '+(config.github.pages?'checked':'')+'>'+esc(tr('pages'))+'</label>':['host','port','user','directory','identity'].map(key=>field(key,config.ssh[key==='identity'?'identityFile':key]??'','data-destination-group="ssh"')).join(''))+field('publicUrl',config.publicUrl??'')+'<div class="inline-actions">'+button('saveDestination','save-destination')+button('review','plan','data-website-file-requires-clean')+button('closePreview','visual')+'</div>'+(destinationDirty?'':transferView())+reviewView()+'</section>';
 }
 function reviewView(){
  if(!plan)return '';
  const review=plan.plan??plan,address=remoteAddress(destination.config);
  const lists=['included','added','replaced','removed','unchanged','preserved','conflicts'].filter(key=>Array.isArray(review[key])).map(key=>{
   const count=review.counts?.[key]??review[key].length;
   const label=key==='included'?t('localExport','files')+' ('+count+')':t('publication',key,{count});
   return '<details class="website-files-diff"><summary>'+esc(label)+'</summary><div data-file-plan-rows>'+destinationPlanRows(review,key,{esc,action:'website-files-plan-page'})+'</div></details>';
  });
  const confirm=destinationConflictCount(review)?'<p role="alert">'+esc(tr('conflicts'))+'</p>'+button('replacement','replacement-plan')
   :'<label><input type="checkbox" data-website-files-confirm>'+esc(tr('confirm'))+'</label>'+button('publish','publish','data-website-file-requires-clean disabled');
  return '<section data-website-files-review><h3>'+esc(tr('review'))+'</h3><p>'+esc(address)+'</p>'+lists.join('')+confirm+'</section>';
 }
 async function saveDestination(){if(!destination)return;destination=await request('destination/save',{siteId:siteId(),config:destination.config,etag:destination.etag});destinationDirty=false;onDirty(dirty);plan=null;render();}
 async function remoteAction(operation){
  if(stale||dirty||destinationDirty||!destination)throw Error(tr('changed'));
  const id=siteId(),transfer=destination.transfer,epoch=generation,signal=controller?.signal;
  const data={siteId:id,expectedRevision:opened.site.revision,configEtag:destination.etag};
  const active=()=>epoch===generation&&id===opened?.site.id&&!signal?.aborted&&!stale;
  const refresh=async()=>{const latest=await request('destination',{siteId:id},{signal});if(active())destination=latest;};
  try{
   if(operation==='publish'||operation==='publish-retry'||operation==='publish-pages'){
    const retry=operation!=='publish';
    if(retry?(!transfer||transfer.revision!==data.expectedRevision||transfer.configEtag!==data.configEtag):(!plan||!document.querySelector('[data-website-files-confirm]')?.checked))throw Error(tr('confirm'));
    const result=await remoteRequest('publish',{...data,destinationReview:retry?transfer.id:(plan.plan??plan).id,destinationReviewed:true,...(operation==='publish-pages'?{retryPages:true}:{})},{signal});
    if(!active())return;
    destination={...destination,receipt:result.receipt,transfer:result.transfer};notify(t('publication','livePending'));
   }else if(operation==='publish-settle'){
    if(!transfer)throw Error(tr('changed'));
    await remoteRequest('publish/settle',{...data,id:transfer.id},{signal});if(active())await refresh();
   }else{
    await remoteRequest('publish/verify',{...data,commit:destination.receipt.commit},{signal});if(active())await refresh();
   }
  }catch(reason){
   if(active()&&!['ACCESS_LOCKED','AUTH','CONFLICT','WEBSITE_CHANGED','PUBLICATION_PERMISSIONS_CHANGED'].includes(reason.code)){
    try{await refresh();}catch{/* Retain the last authenticated destination if disconnected. */}
   }
   throw reason;
  }finally{if(active()){plan=null;render();}}
 }
 async function action(element){const name=element.dataset.action;if(name?.startsWith('github-')&&mode==='destination'){await run(()=>github.action(element));return true;}if(!name?.startsWith('website-files-'))return false;const operation=name.slice('website-files-'.length);if(busy)return true;flushCanvas();
  if(recoveringSource&&!['html','css','discard','reopen','undo','redo'].includes(operation)){
   try{await request('recovery/validate',{siteId:siteId(),path:opened.path,expectedRevision:opened.site.revision,html,css},{signal:controller.signal});recoveringSource=false;}
   catch(reason){if(['AUTH','ACCESS_LOCKED','CONFLICT'].includes(reason.code))hideUnverifiedPage(true);else notify(tr('recoverySourceCorrect'),true);return true;}
  }
  if(operation==='check-access'){await poll();return true;}
  if(sourcePane.pending&&!['discard','reopen','undo','redo','html','css'].includes(operation)&&!await sourcePane.check())return true;
  await run(async()=>{
   if(mode==='media'&&recordings.dirty()&&!operation.startsWith('recovery-')&&!['save','reopen'].includes(operation)){if(!confirm(tr('recordingDiscard')))return;await recovery.forget();recordings.reset();mode='visual';}
   if(mode==='pages'&&pagesPanel.dirty()&&!operation.startsWith('pages-')&&operation!=='discard')await pagesPanel.save();
   if(mode==='menu'&&menu.dirty()&&!operation.startsWith('menu-')&&operation!=='discard')await menu.save();

   if(operation.startsWith('recovery-'))await recovery.action(operation.slice(9),element.dataset.recoveryId);
   else if((operation==='manage-site'||operation==='manage-page')&&opened&&await beforeLeave(true)){mode='lifecycle';lifecycle.open(operation==='manage-site'?'site':'page');}
   else if(operation==='archived-sites'){mode='lifecycle';await lifecycle.archivedSites();}
   else if(mode==='lifecycle'&&operation.startsWith('life-'))await lifecycle.action(operation.slice(5),element);
   else if(operation==='versions'&&await beforeLeave(true)){mode='versions';await versions.open();}
   else if(operation.startsWith('versions-')&&mode==='versions')await versions.action(operation.slice(9));
   else if(operation==='save'){await saveAuthoring();render();}
   else if(operation==='undo'||operation==='redo'){
    const from=operation==='undo'?undo:redo,to=operation==='undo'?redo:undo;
    if(from.length){
     const prior=from.at(-1),base=opened,beforeHTML=html,beforeCSS=css;
     const media=websiteHistoryMedia(prior.html,prior.css,base.path,base.site.cssPath,name=>gallery.hasPending(name)||recovery.held(name));
     let verified;
     try{verified=await request('version',{siteId:siteId(),path:base.path,expectedRevision:base.site.revision,...(media.length?{media,historyKey}:{})},{signal:controller.signal});}
     catch(reason){if(reason.code!=='CONFLICT')throw reason;hideUnverifiedPage(true);return;}
     if(base!==opened)return;
     if(verified.revision!==base.site.revision||prior.sourceStamp!==base.sourceStamp){hideUnverifiedPage(true);return;}
     if(verified.mediaAvailable===false){error=tr('historyMediaUnavailable',{operation:tr(operation)});paintStatus();return;}
     flushCanvas();
     if(from.at(-1)!==prior||html!==beforeHTML||css!==beforeCSS)return;
     if(verified.historyAssetStamp)opened={...opened,historyAssetStamp:verified.historyAssetStamp};
     to.push(historyEntry());from.pop();({html,css}=prior);
     gallery.trimHistory(html,[...undo.toReversed(),...redo.toReversed()]);
     if(mode==='gallery')gallery.open(selected);
     if(element.fromCanvas)pendingHistoryFocus={selection:prior.selection};
     historyBytes=undo.reduce((n,item)=>n+item.html.length+item.css.length,0);lastCheckpoint=0;if(sourcePane.active)sourcePane.queue();changed();render();}
   }
   else if(operation.startsWith('merge-')&&conflictingPage){
    const op=operation.slice(6);
    if(op!=='apply'){if(conflicts.action(op)){render();document.querySelector('[data-action="website-files-merge-'+op+'"]:not([disabled])')?.focus({preventScroll:true});}return;}
    const reviewed=conflictingPage,base=opened,value=await request('open',{siteId:siteId(),path:base.path},{signal:controller.signal});
    if(opened!==base||conflictingPage!==reviewed)return;
    if(value.site.revision!==reviewed.site.revision||value.sourceStamp!==reviewed.sourceStamp){updateFromSaved(value);return;}
    const result=conflicts.result();if(!result){hideUnverifiedPage(false,null,'changedPageAccess');return;}
    adoptMerge(value,result);await save();render();
   }
   else if(operation==='discard'||operation==='reopen')await discard();
   else if(operation==='new'){if(await beforeLeave(true)){form={type:'new'};render();}}
   else if(operation==='new-page'){if(await beforeLeave(true)){
    form={type:'page',title:'',path:'',customPath:false,designId:'',designQuery:'',designOffset:0,taken:new Set(opened.site.pages.map(page=>page.path.toLowerCase()))};render();
   }}
   else if(operation==='design-manage'&&await beforeLeave(true)){
    const {local,revision}=await designs('list');form={type:'design',local,revision,name:local?.name??''};render();
   }
   else if(['design-choose','design-search','design-next','design-previous'].includes(operation)&&form?.type==='page'){
    const offset=Number(element.dataset.offset??0);form.designs=await designs('list',{offset,query:form.designQuery});form.designOffset=offset;
    if(!form.designs.items.some(item=>item.id===form.designId))form.designId='';render();
   }
   else if(operation==='design-forget'&&form?.type==='design'&&form.local){
    const result=await designs('forget',{expectedRevision:form.revision});adoptRelated(result);form=null;mode='pages';pagesPanel.open();
   }
   else if(operation==='sites-more'){const result=await request('list',{limit:100,after:nextSite});sites.push(...result.items.filter(item=>!sites.some(site=>site.id===item.id)));nextSite=result.next;render();}

   else if(operation==='form-cancel'){form=null;render();}
   else if(operation==='pages'){if(await beforeLeave(true)){mode='pages';pagesPanel.open();}}
   else if(operation.startsWith('pages-'))await pagesPanel.handle(operation,element);
   else if(operation==='menu')await openMenu(element.dataset.menuId||null);
   else if(operation.startsWith('menu-'))await menu.handle(operation,element);
   else if(operation.startsWith('picker-'))await picker.action(operation,element);
   else if(operation.startsWith('component-'))await components.action(operation,element);
   else if(operation==='presentation'){
    await save();const doc=websiteHTML(opened.html);
    await presentation.open({site:opened.site,page:opened.path,document:doc,selected:blockAt(doc,selected),trigger:element});
   }
   else if(operation==='media'){await save();await recordings.open(selected);mode='media';render();}
   else if(operation==='feeds')await openFeed(element);
   else if(operation==='galleries'){
    const node=blockAt(websiteHTML(html),selected),group=node?.closest('[data-website-source-gallery]');
    if(group)await startFigures(group.dataset.websiteSourceGallery);else{gallery.open(selected);mode='gallery';render();}
   }
   else if(operation==='figures-new'||operation==='figures-edit')await startFigures(element.dataset.gallery);
   else if(operation.startsWith('figures-'))await figures.action(operation.slice(8),element);
   else if(operation==='gallery-close'){mode='visual';render();}
   else if(operation.startsWith('gallery-'))gallery.action(operation.slice(8),element);
   else if(['visual','html','css','split-source'].includes(operation)){
    if(mode==='menu'&&!await beforeLeave(true))return;
    if(sourcePane.pending&&['html','css'].includes(operation)){mode=operation;render();void sourcePane.check();return;}
    if(sourcePane.pending&&!await sourcePane.check())return;
    const next=mode==='preview'?trail[step]:null;
    if(operation==='split-source'){
     sourcePane.open();mode='visual';
    }else{sourcePane.reset();mode=operation;if(['html','css'].includes(mode))sourcePane.open(mode);}
    form=null;
    const owner=opened.site.feedPages?.find(member=>member.path===next?.path)?.ownerPage;
    if(next&&(owner??next.path)!==opened.path){anchor=owner?'':next.hash;await open(siteId(),owner??next.path);}else render();
   }
   else if(operation==='preview'){if(menu.dirty())await menu.save();await save();if(stale)throw Error(tr('changed'));resetPreview();mode='preview';navigatePreview({path:opened.path,hash:''});}
   else if(operation==='preview-back'||operation==='preview-forward'){const next=step+(operation==='preview-back'?-1:1);if(trail[next]){step=next;navigatePreview(trail[next],false);}}
   else if(operation==='download'){await save();if(stale)throw Error(tr('changed'));await downloadResource('/api/website-files/export?siteId='+siteId()+'&revision='+opened.site.revision,'observanda-site.zip');}
   else if(operation==='add-block'||operation==='paragraph'||operation==='heading'){
    const type=operation==='add-block'?document.querySelector('[data-website-file-block]').value:operation;
    if(type==='feed'){await openFeed(element,true);return;}
    if(type==='actionLink'){blockDialog(editActionLink,buttonCSS);return;}
    if(type==='equationEdit'){await blockDialog(editWebsiteEquation);return;}
    if(type==='gallery'){gallery.open(selected);mode='gallery';gallery.action('new',element);return;}
    documentChange(doc=>{if(type==='columns'&&!css.includes('.website-columns{')){ensureStyle(doc);css+='\n.website-columns{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,16rem),1fr));gap:1rem}\n';}
    const node=createBlock(doc,type,tr);const at=blockAt(doc,selected);if(movable(at)&&main(doc).contains(at))at.after(node);else main(doc).append(node);});
   }
   else if(operation==='edit-block'){visual?.select(element.dataset.path,{edit:true});}
   else if(operation==='check-page')showPageChecks({doc:websiteHTML(html),path:opened.path,directory:directory(),pages:previewPages(),t:tr,select:path=>visual?.select(path,{edit:true})});
   else if(operation==='check-website'){if(await beforeLeave(true))checkSavedSite(element);}
   else if(operation==='styles'){
    const text=visual?.textStyleSelection(),blockPath=selected;
    if(!await beforeLeave(true))return;
    const {editWebsiteStyles}=await import('./website-files-styles.js');
    let base=opened;
    const current=()=>opened===base&&!stale,options=values=>({siteId:base.site.id,path:base.path,expectedRevision:base.site.revision,...values});
    const read=async values=>{
     if(!current())throw Error(tr('changed'));const result=await request('styles/read',options(values),{signal:controller.signal});
     if(!current()||result.revision!==base.site.revision)throw Error(tr('changed'));return result;
    };
    const write=async values=>{
     if(!current())throw Error(tr('changed'));const result=await request('styles/change',options(values),{signal:controller.signal});
     if(!current())throw Error(tr('changed'));adoptRelated(result);base=opened;render();return result;
    };
    await editWebsiteStyles({t:tr,opened:base,blockPath,selection:text,target:()=>visual?.styleTarget()??document.getElementById('website-files-canvas')?.contentDocument?.body,
     instance:blockPath&&blockAt(websiteHTML(base.html),blockPath)?.closest('[data-website-instance]')?.dataset.websiteInstance,read,write,current,trigger:element,signal:controller.signal,
     assignText:async(pin,id,group,ids)=>{
      if(!current())return false;
      const doc=websiteHTML(html);if(!assignStyleText(doc,pin,id,group,ids))return false;
      checkpoint(true);html=authoredHTML(doc);changed();render();await save();base=opened;return true;
     }});
   }
   else if(operation==='breakpoints')await manageBreakpoints();
   else if(['appearance','themes'].includes(operation)&&await beforeLeave(true)){
    const base=opened,current=()=>opened===base&&!stale;
    const themes=operation==='themes',node=themes&&selected!=null?blockAt(websiteHTML(base.html),selected):null;
    await editWebsiteAppearance({opened:base,directory:directory(),request,t:tr,signal:controller.signal,current,trigger:element,themes,blockPath:node?selected:null,sectionTitle:node?label(node):'',
     apply:values=>run(async()=>{
      if(!current())throw Object.assign(Error(tr('changed')),{code:'WEBSITE_CHANGED'});
      const saved=await request(themes?'themes/change':'appearance/save',{siteId:base.site.id,path:base.path,expectedRevision:base.site.revision,...(themes?values:{values})},{signal:controller.signal});
      adoptRelated(saved);render();return true;
     },'saving')});
   }
   else if(['duplicate','remove','move-up','move-down'].includes(operation)){
    documentChange(doc=>{const node=blockAt(doc,element.dataset.path);if(!node)return;
     if(operation==='duplicate'){if(movable(node))duplicateBlock(node);}else if(operation==='remove'){if(movable(node))node.remove();}
     else{const up=operation==='move-up',move=websiteLayerMove(node,up?node.previousElementSibling:node.nextElementSibling,up?'before':'after');if(move)selected=move();}
    });
   }
   else if(operation==='folder'){await save();folder.reset();mode='folder';render();await folder.loadChooser();}
   else if(operation.startsWith('folder-'))await folder.action(operation.slice(7));
   else if(operation==='publish-update')await showPublishUpdate();
   else if(operation==='destination')await showDestination();
   else if(operation==='plan-page'){if(!plan||stale||dirty||destinationDirty)throw Error(tr('changed'));const result=await request('plan/page',{siteId:siteId(),expectedRevision:opened.site.revision,configEtag:destination.etag,id:(plan.plan??plan).id,kind:element.dataset.kind,offset:Number(element.dataset.offset)});const current=plan.plan??plan,kind=element.dataset.kind;current[kind]=result.items;current.windows[kind]={offset:result.offset,next:result.next};const host=element.closest('details');if(host)host.querySelector('[data-file-plan-rows]').innerHTML=destinationPlanRows(current,kind,{esc,action:'website-files-plan-page'});}
   else if(operation==='save-destination')await saveDestination();
   else if(operation==='plan'||operation==='replacement-plan'){await save();if(destinationDirty)await saveDestination();plan=await remoteRequest('plan',{siteId:siteId(),expectedRevision:opened.site.revision,configEtag:destination.etag,...(operation==='replacement-plan'?{replaceExisting:true}:{})});render();}
   else if(['publish','publish-retry','publish-pages','publish-settle','publish-verify'].includes(operation))await remoteAction(operation);
  },operation==='save'||operation==='save-destination'?'saving':operation==='publish'?'publishing':'working');return true;
 }
 function input(element){
  if(mode==='versions'&&versions.input(element))return true;
  if(element.matches('[data-source-language]')){sourcePane.language(element.value);return true;}
  if(element.matches('[data-source-input]')){
   if(!sourcePane.active)sourcePane.open(element.dataset.sourceInput);
   checkpoint();if(element.dataset.sourceInput==='html')html=editedSourceText(html,element.value);else css=editedSourceText(css,element.value);
   sourcePane.queue();changed();return true;
  }
  if(element.matches('[data-website-files-confirm]')){paintStatus();return true;}
  if(form?.type==='page'&&element.closest('[data-website-files-form]')){
   if(element.dataset.websiteFileField==='pageTitle'){
    form.title=element.value;
    if(!form.customPath){
     form.path=suggestedPagePath(form.title,form.taken);
     element.form.querySelector('[data-website-file-field="pagePath"]').value=form.path;
    }
   }else if(element.dataset.websiteFileField==='pagePath'){form.path=element.value;form.customPath=Boolean(form.path);}
   else if(element.dataset.websiteFileField==='designId')form.designId=element.value;
   else if(element.dataset.websiteFileField==='inclusion')form.inclusion=element.value;
   else if(element.dataset.websiteFileField==='designSearch')form.designQuery=element.value;
   return true;
  }
  if(lifecycle.input(element)||components.input(element)||pagesPanel.input(element)||folder.input(element)||picker.input(element)||menu.input(element)||gallery.input(element)||figures.input(element))return true;
  if(viewport.change(element))return true;
  if(element.matches('[data-website-file-site],[data-website-file-page]')){
   const id=element.matches('[data-website-file-site]')?element.value:siteId(),path=element.matches('[data-website-file-page]')?element.value:'index.html';void run(async()=>{if(await beforeLeave(true)){if(mode==='preview'&&id===siteId()){navigatePreview({path,hash:''});return;}mode='visual';await open(id,path);}else render();}).catch(()=>{});return true;
  }
  if(element.dataset.websiteFileField&&destination&&mode==='destination'){
   const key=element.dataset.websiteFileField==='identity'?'identityFile':element.dataset.websiteFileField,target=element.dataset.destinationGroup?destination.config[element.dataset.destinationGroup]:destination.config;target[key]=element.type==='checkbox'?element.checked:key==='port'?Number(element.value):element.value;destinationDirty=true;onDirty(true);plan=null;if(key==='kind'){render();if(element.value==='github')void github.refresh().catch(reason=>notify(reason.message,true));}else document.querySelector('[data-website-files-review]')?.remove();return true;
  }
  return element.closest('[data-website-files-form]')!==null;
 }
 async function submit(element){if(!element.matches('[data-website-files-form]'))return false;if(!element.reportValidity())return true;await run(async()=>{
  const value=key=>element.querySelector('[data-website-file-field="'+key+'"]')?.value.trim();let result;
  if(form.type==='new')result=await request('create',{name:value('name'),language:document.documentElement.lang||'en'});
  else if(form.type==='design'){
   result=await designs('name',{expectedRevision:form.revision,name:value('designName')});adoptRelated(result);form=null;mode='pages';pagesPanel.open();return;
  }
  else if(form.type==='page'){
   const title=value('pageTitle'),path=value('pagePath');
   if(form.taken.has(path.toLowerCase()))throw Error(tr('duplicatePage'));
   const inclusion=value('inclusion'),language=websiteHTML(opened.html).documentElement.lang||document.documentElement.lang||'en';
   if(form.designId)result=await designs('use',{expectedRevision:form.designs.revision,design:form.designId,destination:path,title,language,inclusion,labels:{heading:tr('heading'),text:tr('paragraph'),image:tr('altText')}});
   else result=await request('page/create',{siteId:siteId(),expectedRevision:opened.site.revision,path,title,language,inclusion});
  }
  else return;
  form=null;mode='visual';adopt(result);history.replaceState(history.state,'',fileRoute(result.site.id));render();
 });return true;}
 async function openRecovery(row){
  if(!row||row.surface!=='website'||row.owner?.workspaceId!==session?.workspaceId)throw Error(tr('changed'));
  if(!await beforeLeave())return;mode='visual';
  if(siteId()!==row.owner.websiteId||opened?.path!==row.documentKey)await open(row.owner.websiteId,row.documentKey);
  await recovery.select(row.owner.websiteId,row.documentKey,row.id);
 }
 return {load,clear,view,bind,openRecovery,checkVersion:poll,action,input,submit,save:()=>run(saveAuthoring,'saving'),discard:()=>run(discard),beforeLeave,isDirty:()=>dirty||destinationDirty||menu.dirty()||pagesPanel.dirty()||recordings.dirty()||figures.dirty(),current:()=>opened,session:()=>session};
}
