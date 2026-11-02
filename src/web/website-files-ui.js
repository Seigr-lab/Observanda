import './i18n/catalogues/websiteFiles.js';
import {t} from './i18n/index.js';
import {websiteHTML,serializeWebsiteHTML,loadWebsiteCanvas,websiteCanvasValue,editWebsiteCanvas,rebaseWebsitePlacements} from './website-html-document.js';
import {websiteFilesFolder} from './website-files-folder.js';
import {githubConnectionUI} from './github-connection-ui.js';
import {downloadResource} from './session-download.js';
import {destinationPlanRows,destinationConflictCount} from './publication-review.js';
import {createBlock,duplicateBlock,blockTypes} from './website-files-blocks.js';
import {websiteFilesGallery} from './website-files-gallery.js';
import {buttonCSS,editActionLink,showPageChecks} from './website-files-dialogs.js';
import {editWebsiteEquation} from './website-files-equation.js';
import {bindSavedLinks,openSavedPreview} from './website-files-navigation.js';
import {enhanceSavedPreview} from './website-files-preview.js';
import {bindWebsiteVisual} from './website-files-visual.js';
import {websiteHierarchy,websiteLayerAt,movableWebsiteLayer,websiteLayerMove} from './website-files-hierarchy.js';
import {websiteFilesComponents} from './website-files-components.js';
import {websiteFilesRecordings} from './website-files-recordings.js';
import {websiteFilesPages} from './website-files-pages.js';
import {websiteFilesMenu} from './website-files-menu.js';
import {websiteFilesPicker} from './website-files-picker.js';

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
 let viewport='desktop',visual=null,selected=null,anchor='',trail=[],step=-1;
 let locatedPlacement=null;
 let pendingCanvas=null,canvasTimer=null;
 let undo=[],redo=[],lastCheckpoint=0,historyBytes=0;
 const request=(operation,data,options={})=>api('/api/website-files/'+operation,data,{...options,owner:null,adopt:false});
 const siteId=()=>opened?.site.id;
 const draftPage=()=>opened?.site.pages.find(page=>page.path===opened.path)?.draft===true;
 let nextSite=null,preparationTimer=null,missingSite=false;
 let requestedSite=null,openPublishing=false;
 const connectionState={get storage(){return session?{contextId:session.contextId}:null;},publishing:{}};
 const github=githubConnectionUI({state:connectionState,api:(route,data)=>api(route,data,{owner:null,adopt:false,signal:controller?.signal}),endpoint:'/api/website-files/connection/',esc,field:(label,control)=>'<label>'+esc(label)+' '+control+'</label>',notify,temporaryCredentials:false,onConnectionChange:()=>{plan=null;document.querySelector('[data-website-files-review]')?.remove();}});
 async function showDestination(){await save();destination=await request('destination',{siteId:siteId()});destinationDirty=false;form=null;mode='destination';render();if(destination.config.kind==='github')await github.refresh();}
 
 const folder=websiteFilesFolder({request,site:()=>opened,esc,render});
 const directory=()=>new URL('/api/website-files/preview/'+siteId()+'/'+opened.site.revision+'/',location.origin);
 const baseURL=(path=opened.path)=>new URL(path,directory()).href;
 const gallery=websiteFilesGallery({t:tr,esc,path:()=>opened.path,url:baseURL,read:()=>websiteHTML(html),update:doc=>{html=serializeWebsiteHTML(doc);changed();},checkpoint:(force=true)=>checkpoint(force),render,run,notify,getCSS:()=>css,setCSS:value=>{css=value;changed();}});
 const pagesPanel=websiteFilesPages({site:()=>opened,esc,tr,render,openPage:async path=>{if(await beforeLeave(true)){mode='visual';await open(siteId(),path);}},edit:documentChange,save,changed:()=>onDirty(dirty||pagesPanel.dirty()),close:()=>{mode='visual';render();}});
 const menu=websiteFilesMenu({request,site:()=>opened,esc,tr,render,adopt,close:()=>{mode='visual';render();},changed:()=>{onDirty(dirty||destinationDirty||menu.dirty());paintStatus();}});
 const components=websiteFilesComponents({request,tr,esc,site:()=>opened,selected:()=>selected,save,adopt,render,run});
 const recordings=websiteFilesRecordings({t:tr,esc,request,read:()=>websiteHTML(html),css:()=>css,path:()=>opened.path,site:()=>opened.site,url:baseURL,adopt,render,run,notify,close:()=>{mode='visual';render();}});
 async function insertContent(operation,selection){
  await save();
  adopt(await request(operation,{siteId:siteId(),expectedRevision:opened.site.revision,path:opened.path,...selection}));
  render();
 }
 async function checkPlacementRevision(revision){
  await save();
  if(opened.site.revision!==revision)throw Error(tr('changed'));
 }
 const picker=websiteFilesPicker({request,esc,site:()=>opened,blocks:()=>structure().map(label),
  libraryStatus:async()=> (await request('preparation',undefined,{signal:controller?.signal})).preparation?.library,
  insert:selection=>insertContent('insert-source',selection),
  insertMany:selection=>insertContent('insert-sources',selection),
  async mutatePlacement(operation,data){
   const targetSite=data.siteId??siteId(),currentSite=siteId();
   if(targetSite===currentSite)await checkPlacementRevision(data.expectedRevision);
   const currentPath=opened.path;
   const result=await request('library/'+operation+'-placement',{...data,siteId:targetSite});
   if(targetSite!==currentSite)return;
   adopt(result.path===currentPath?result:await request('open',{siteId:currentSite,path:currentPath}));
   render();
  },
  async jumpPlacement({siteId:targetSite=siteId(),path,blockPath,expectedRevision,sourceId}){
   if(targetSite===siteId())await checkPlacementRevision(expectedRevision);
   else if(!await beforeLeave(true))return false;
   const page=await request('open',{siteId:targetSite,path});
   if(page.site.revision!==expectedRevision)throw Error(tr('changed'));
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
 function bindNavigation(doc,path,preview){
  bindSavedLinks(doc,{url:baseURL(path),directory:directory(),pages:opened.site.pages,unavailable:()=>notify(tr('outsidePreview')),download:preview?(url,name)=>void downloadResource(url,name).catch(e=>notify(e.message,true)):null,navigate:page=>{
   if(busy||stale)return;
   if(preview){navigatePreview(page);return;}
   if(page.path===opened.path){scrollToAnchor(doc,page.hash);return;}
   void run(async()=>{if(await beforeLeave(true)){anchor=page.hash;await open(siteId(),page.path);}}).catch(e=>notify(e.message,true));
  }});
 }
 function status(){
  if(error)return error;
  if(stale)return tr('changed');
  if(busy)return tr(busy);
  if(!opened)return '';
  return tr(dirty?'unsaved':'saved');
 }
 function button(key,action,extra=''){return '<button type="button" class="button" data-action="website-files-'+action+'" '+extra+'>'+esc(tr(key))+'</button>';}
 const field=(key,value,extra='')=>'<label>'+esc(tr(key))+'<input data-website-file-field="'+key+'" value="'+esc(value)+'" '+extra+'></label>';
 function flushCanvas(){
  clearTimeout(canvasTimer);canvasTimer=null;if(!pendingCanvas)return;
  const document=pendingCanvas;pendingCanvas=null;html=websiteCanvasValue(document);changed();paintStructure(document);
 }
 function canvasInput(document){pendingCanvas=document;dirty=true;plan=null;onDirty(true);paintStatus();clearTimeout(canvasTimer);canvasTimer=setTimeout(flushCanvas,180);}
 function changed(){dirty=html!==opened?.html||css!==opened?.css;plan=null;onDirty(dirty||destinationDirty);paintStatus();for(const op of ['undo','redo']){const node=document.querySelector('[data-action="website-files-'+op+'"]');if(node)node.disabled=!(op==='undo'?undo:redo).length;}}
 function paintStatus(){
  const resume=document.querySelector('[data-website-files-reopen]');
  if(resume)resume.hidden=!stale;
  const host=document.querySelector('[data-website-files-status]');
  if(host){
   host.textContent=status();host.hidden=!host.textContent;
   host.setAttribute('role',error||stale?'alert':'status');
   host.classList.toggle('website-files-error',!!error||stale);
  }
  const controls=document.querySelector('[data-website-file-controls]');
  if(controls){controls.disabled=!!busy;controls.setAttribute('aria-busy',String(!!busy));}
  const canvas=document.querySelector('#website-files-canvas');
  if(canvas)canvas.inert=!!busy||stale;
  const back=document.querySelector('[data-action="website-files-back"]');
  if(back)back.disabled=!!busy;
  for(const node of document.querySelectorAll('[data-website-file-requires-clean]'))node.disabled=stale;
  const saveButton=document.querySelector('[data-action="website-files-save"]');
  if(saveButton)saveButton.disabled=!(dirty||pagesPanel.dirty()||menu.dirty())||stale;
  const discardButton=document.querySelector('[data-action="website-files-discard"]');
  if(discardButton)discardButton.disabled=!dirty||stale;
 }
 function adopt(value){
  if(!value?.site?.id||typeof value.site.revision!=='string'||!Array.isArray(value.site.pages)||typeof value.html!=='string'||typeof value.css!=='string'||typeof value.path!=='string')throw Error(tr('failed'));
  if(value.path!==opened?.path||value.site.id!==siteId()){forgetSelection();picker.reset();components.reset();recordings.reset();gallery.reset();}
  opened=value;html=value.html;css=value.css;dirty=stale=false;error='';plan=null;undo=[];redo=[];lastCheckpoint=historyBytes=0;onDirty(menu.dirty());onSite(value.site);const at=sites.findIndex(site=>site.id===value.site.id);if(at<0)sites.push(value.site);else sites[at]=value.site;
 }
 async function run(operation,progress='working'){
  if(busy)return;
  const epoch=generation;busy=progress;error='';paintStatus();
  try{return await operation();}
  catch(reason){
   if(reason.name==='AbortError'||epoch!==generation)return;
   if(reason.code==='ACCESS_LOCKED'||reason.code==='AUTH')throw reason;
   if(['CONFLICT','WEBSITE_CHANGED'].includes(reason.code))stale=true;
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
  catch(reason){if(reason.code!=='NOT_FOUND')throw reason;missingSite=true;render();return;}
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
 function clear(){compactViewport.removeEventListener('change',resizeTools);clearTimeout(preparationTimer);preparationTimer=null;missingSite=false;requestedSite=null;openPublishing=false;pendingCanvas=null;clearTimeout(canvasTimer);canvasTimer=null;generation++;folder.reset();menu.reset();components.reset();recordings.reset();pagesPanel.reset();gallery.reset();picker.reset();forgetSelection();resetPreview();controller?.abort();controller=null;clearInterval(timer);timer=null;mode='visual';session=null;opened=null;sites=[];nextSite=null;destination=null;destinationDirty=false;plan=null;form=null;dirty=busy=stale=false;html=css=error='';undo=[];redo=[];historyBytes=0;onDirty(false);}
 function checkpoint(force=false){const now=Date.now();if(force||now-lastCheckpoint>350||!undo.length){flushCanvas();undo.push({html,css});historyBytes+=html.length+css.length;while(undo.length>50||historyBytes>8*1024*1024&&undo.length>1){const oldest=undo.shift();historyBytes-=oldest.html.length+oldest.css.length;}lastCheckpoint=now;}redo=[];}
 function documentChange(operation){flushCanvas();checkpoint(true);const document=websiteHTML(html);operation(document);html=serializeWebsiteHTML(document);changed();render();}
 function ensureStyle(doc){const url=baseURL(opened.site.cssPath);if(![...doc.querySelectorAll('link[rel="stylesheet"][href]')].some(link=>new URL(link.getAttribute('href'),baseURL()).href===url)){const link=doc.createElement('link');link.rel='stylesheet';link.href='../'.repeat(opened.path.split('/').length-1)+opened.site.cssPath;doc.head.append(link);}}
 function blockDialog(edit,style=''){
  const doc=websiteHTML(html),site=opened,original=html;
  const current=()=>opened===site&&html===original&&!stale;
  return edit({doc,at:blockAt(doc,selected),t:tr,path:site.path,directory:directory(),pages:site.site.pages,current,apply:value=>{
   if(!current()){notify(tr('changed'),true);return;}
   checkpoint(true);if(style){ensureStyle(value);if(!css.includes(style))css+=style;}html=serializeWebsiteHTML(value);changed();render();
  }});
 }
 async function save(){
  flushCanvas();if(!opened||!dirty)return opened;if(stale)throw Error(tr('changed'));
  const submitted={html,css},epoch=generation,data={siteId:siteId(),expectedRevision:opened.site.revision,path:opened.path,...submitted};
  const upload=gallery.body(data),value=await request(upload?'save-pictures':'save',upload??data,{signal:controller?.signal});
  if(epoch!==generation)return;
  const newer=html!==submitted.html||css!==submitted.css;if(newer){opened=value;stale=false;error='';changed();}else{adopt(value);gallery.reset();if(mode==='gallery')gallery.open(selected);}
  return value;
 }
 async function beforeLeave(fromAction=false){if(busy&&!fromAction)return false;if(recordings.dirty()){if(!confirm(tr('recordingDiscard')))return false;recordings.reset();}if(!dirty&&!destinationDirty&&!menu.dirty()&&!pagesPanel.dirty())return true;if(!confirm(tr('saveBeforeLeave')))return false;if(dirty)await save();if(destinationDirty)await saveDestination();if(menu.dirty())await menu.save();if(pagesPanel.dirty())await pagesPanel.save();return true;}
 async function discard(){
  if((dirty||menu.dirty()||pagesPanel.dirty()||recordings.dirty()||destinationDirty)&&!confirm(tr('discardConfirm')))return false;
  if(!opened)return true;
  // Read the replacement first. A failed read leaves the editable draft intact.
  const current=opened,replacement=await request('open',{siteId:siteId(),path:opened.path},{signal:controller?.signal});if(opened!==current)return false;
  menu.reset();pagesPanel.reset();components.reset();picker.reset();gallery.reset();recordings.reset();forgetSelection();resetPreview();
  destinationDirty=false;destination=null;mode='visual';adopt(replacement);render();return true;
 }
 function updateFromSaved(value){
  flushCanvas();
  components.reset();picker.reset();
  for(const dialog of document.querySelectorAll('dialog.website-author-dialog'))dialog.close();
  if(mode==='media'){recordings.reset();mode='visual';}
  if(!dirty){adopt(value);if(mode==='gallery')gallery.open(selected);render();return;}
  const merged=rebaseWebsitePlacements(opened.html,html,value.html),styleConflict=opened.css!==value.css&&css!==opened.css&&css!==value.css;
  if(merged===null||styleConflict){stale=true;plan=null;render();return;}
  const authoredCSS=css===opened.css?value.css:css;adopt(value);html=merged;css=authoredCSS;if(mode==='gallery')gallery.open(selected);changed();render();
 }
 async function poll(){
  if(checkBusy||busy||!opened||document.hidden)return;const epoch=generation,id=siteId(),revision=opened.site.revision;checkBusy=true;
  try{await picker.revalidate({signal:controller?.signal});const current=await request('version',{siteId:id},{signal:controller?.signal});if(epoch!==generation||id!==siteId()||revision!==opened.site.revision)return;if(current.revision!==revision){const page=opened.path,value=await request('open',{siteId:id,path:page},{signal:controller.signal});if(epoch!==generation||siteId()!==id||opened.path!==page||opened.site.revision!==revision)return;updateFromSaved(value);}}
  catch(reason){if(reason.name!=='AbortError'&&epoch===generation){error=reason.message||tr('failed');if(['CONFLICT','PUBLICATION_PERMISSIONS_CHANGED','WEBSITE_CHANGED','ACCESS_LOCKED'].includes(reason.code)){stale=true;render();}else paintStatus();}}
  finally{checkBusy=false;}
 }
 function siteSelector(){
  if(!sites.length)return '';
  const choose=opened?'':'<option value="" selected disabled>'+esc(tr('chooseSite'))+'</option>';
  const options=sites.map(site=>'<option value="'+esc(site.id)+'" '+(site.id===siteId()?'selected':'')+'>'+esc(site.name)+'</option>').join('');
  return '<label>'+esc(tr('site'))+' <select class="website-file-select" data-website-file-site>'+choose+options+'</select></label>'+(nextSite?button('more','sites-more'):'');
 }
 const compactViewport=window.matchMedia('(max-width:760px)');
 function extraTools(title,content){
  return '<details data-website-tools '+(compactViewport.matches?'':'open')+'><summary>'+esc(tr(title))+'</summary><div class="website-extra-tools">'+content+'</div></details>';
 }
 function resizeTools(){for(const group of document.querySelectorAll('[data-website-tools]'))group.open=!compactViewport.matches;}
 function pageToolbar(){
  const options=mode==='preview'?'<option>'+esc(trail[step]?.path??opened.path)+'</option>':pagesPanel.options();
  return '<label>'+esc(tr('page'))+' <select class="website-file-select" data-website-file-page>'+options+'</select></label>'+
   button('save','save','data-website-file-requires-clean')+button('preview','preview','data-website-file-requires-clean')+
   extraTools('pagePanel',button('pagePanel','pages')+button('addPage','new-page')+button('discard','discard')+button('download','download','data-website-file-requires-clean'));

 }
 function unopenedView(){
  const state=session.preparation?.state;
  if(state==='preparing')return '<p role="status" data-website-preparation>'+esc(preparationMessage(session.preparation))+'</p>';
  if(missingSite||state!=='ready'){
   const message=missingSite?'unavailable':state==='failed'?'preparationFailed':'workspaceCheck';
   return '<section class="panel">'+(error?'':'<p>'+esc(tr(message))+'</p>')+button('retry','retry')+'</section>';
  }
  return '<section class="panel"><p>'+esc(tr('noWebsite'))+'</p>'+button('create','new')+'</section>';
 }
 function view(){
  flushCanvas();
  if(!session)return '<p role="status">'+esc(tr('loading'))+'</p>';
  const title=opened?.site.name??tr('title');
  const headerActions=opened&&!form&&!stale?extraTools('site',button('create','new')+button('destination','destination')+button('folderPublish','folder')):'';
  let body;
  if(stale)body='';
  else if(form)body=formView();
  else if(!opened)body=unopenedView();
  else if(mode==='folder')body=button('closePreview','visual')+folder.view();
  else if(mode==='destination')body=destinationView();
  else if(mode==='menu')body=menu.view();
  else if(mode==='pages')body=pagesPanel.view();
  else if(mode==='media')body=recordings.view();
  else if(mode==='gallery')body=gallery.view();
  else if(mode==='preview')body='<div class="website-files-toolbar">'+button('prevPage','preview-back',step>0?'':'disabled')+button('nextPage','preview-forward',step<trail.length-1?'':'disabled')+button('closePreview','visual')+'</div><iframe id="website-files-preview" class="website-files-canvas" title="'+esc(tr('preview'))+'" sandbox="allow-same-origin"></iframe>';
  else body=editorView();
  const toolbar=form||stale?'':(opened?extraTools('chooseSite',siteSelector()):siteSelector())+(opened?pageToolbar():'');
  return '<fieldset class="website-file-controls" data-website-file-controls><header class="website-workspace-heading"><h1>'+esc(title)+'</h1><p class="website-files-status" role="status" data-website-files-status></p>'+headerActions+'</header>'+
   (toolbar?'<div class="website-files-toolbar website-page-controls">'+toolbar+'</div>':'')+
   (!form&&draftPage()?'<p class="hint">'+esc(tr('draftNotice'))+'</p>':'')+
   button('reopen','reopen','data-website-files-reopen '+(stale?'':'hidden'))+body+'</fieldset>';
 }
 function formView(){
  const isPage=form.type==='page',label=isPage?'addPage':'create';
  const name=field(isPage?'pageTitle':'name','','required maxlength="160"');
  const path=isPage?field('pagePath',crypto.randomUUID()+'.html','required pattern="[a-zA-Z0-9_.\\/\\-]+[.]html"'):'';
  return '<section class="panel"><form data-website-files-form><h2>'+esc(tr(label))+'</h2>'+name+path+
   '<div class="inline-actions"><button class="button primary" type="submit">'+esc(tr(label))+'</button>'+button('cancel','form-cancel')+'</div></form></section>';
 }
 function editorView(){
  const tools='<span class="website-editor-modes">'+['visual','html','css'].map(key=>button(key,key,'aria-pressed="'+String(mode===key)+'"')).join('')+'</span>';
  const history=button('undo','undo',undo.length?'':'disabled')+button('redo','redo',redo.length?'':'disabled');
  const sizes='<label>'+esc(tr('viewport'))+' <select data-website-file-viewport>'+['desktop','tablet','phone'].map(key=>'<option value="'+key+'" '+(viewport===key?'selected':'')+'>'+esc(tr(key))+'</option>').join('')+'</select></label>';
  const toolbar='<div class="website-files-toolbar" role="group" aria-label="'+esc(tr('title'))+'">'+history+extraTools('title',tools+button('menu','menu')+button('checkPage','check-page')+button('gallery','galleries')+button('recordings','media')+(mode==='visual'?sizes:''))+'</div>';
  if(mode!=='visual')return toolbar+'<label>'+esc(tr(mode))+'<textarea class="website-files-code" aria-label="'+esc(tr(mode))+'" data-website-file-code="'+mode+'" spellcheck="false">'+esc(mode==='html'?html:css)+'</textarea></label>';
  const blocks='<label>'+esc(tr('block'))+' <select data-website-file-block>'+blockTypes.map(key=>'<option value="'+key+'">'+esc(tr(key==='heading'?'addHeading':key==='paragraph'?'addText':key))+'</option>').join('')+'</select></label>'+button('addBlock','add-block');
  return toolbar+'<div class="website-files-editor"><aside><div class="website-files-toolbar">'+blocks+'</div><section class="panel"><h2>'+esc(tr('structure'))+'</h2><ol class="website-files-structure" data-website-files-structure></ol></section>'+picker.view()+components.view()+'</aside><section class="website-files-stage"><div class="website-files-viewport" data-size="'+viewport+'"><iframe id="website-files-canvas" class="website-files-canvas" title="'+esc(tr('visual'))+'" sandbox="allow-same-origin"></iframe></div></section><aside class="website-files-inspection"><section data-website-visual-inspector></section></aside></div>';
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
 function movable(node){return movableWebsiteLayer(node);}
 function bind(){
  visual?.destroy();visual=null;
  for(const name of ['website-files','website-files-visual','website-files-hierarchy']){
   if(!document.querySelector('link[data-sheet="'+name+'"]')){const link=document.createElement('link');link.rel='stylesheet';link.href='/'+name+'.css';link.dataset.sheet=name;document.head.append(link);}
  }
  hierarchy.bindHost(document);picker.bind();gallery.bind();components.bind();recordings.bind();
  const preview=document.getElementById('website-files-preview');
  if(preview){
   const entry=trail[step]??{path:opened.path,hash:''};
   openSavedPreview(preview,baseURL(entry.path)+(entry.search??'')+entry.hash,doc=>{
    hierarchy.bindKeys(doc);enhanceSavedPreview(doc,{directory:directory(),pages:opened.site.pages,memory:previewMemory,navigate:navigatePreview,failed:()=>notify(tr('failed'),true)});
    bindNavigation(doc,entry.path,true);scrollToAnchor(doc,entry.hash);
   },()=>notify(tr('failed'),true));
  }
  const frame=document.getElementById('website-files-canvas');if(frame){frame.onload=()=>{
   const doc=frame.contentDocument;if(!doc||!frame.isConnected||!opened)return;
   loadWebsiteCanvas(doc,html,css,baseURL(opened.site.cssPath));gallery.paint(doc);editWebsiteCanvas(doc);
   components.bindCanvas(doc);bindNavigation(doc,opened.path,false);
   visual=bindWebsiteVisual({document:doc,inspector:document.querySelector('[data-website-visual-inspector]'),t:tr,beforeChange:()=>checkpoint(true),change:()=>canvasInput(doc),getCSS:()=>css,setCSS:value=>{css=value;changed();},stylesheet:baseURL(opened.site.cssPath),getViewport:()=>viewport,onSelect:item=>{selected=item?.path??null;hierarchy.selection(selected);}});
   hierarchy.bindCanvas(doc);
   if(locatedPlacement!==null){
    const target=blockAt(doc,locatedPlacement);
    if(target&&!visual.select(locatedPlacement)){
     target.scrollIntoView({block:'center',inline:'nearest'});
     target.animate([{outline:'3px solid Highlight'},{outline:'3px solid Highlight'}],1800);
    }
    locatedPlacement=null;
   }else if(selected!==null)visual.select(selected);
   doc.body.addEventListener('beforeinput',()=>checkpoint());doc.body.addEventListener('input',()=>canvasInput(doc));
   doc.addEventListener('keydown',event=>{
    if(!(event.ctrlKey||event.metaKey)||event.altKey)return;
    const op=({s:'save',y:'redo',z:event.shiftKey?'redo':'undo'})[event.key.toLowerCase()];if(!op)return;
    event.preventDefault();void action({dataset:{action:'website-files-'+op}}).catch(e=>notify(e.message,true));
   });
   scrollToAnchor(doc,anchor);anchor='';
  };frame.src=baseURL()+'?canvas=1';}
  const list=document.querySelector('[data-website-files-structure]');if(list)bindStructure(list);
  paintStructure();paintStatus();if(opened&&!timer)timer=setInterval(()=>void poll(),5000);
 }
 function destinationView(){if(!destination)return '<p role="status">'+esc(tr('loading'))+'</p>';const config=destination.config;
  return '<section class="panel website-files-publish"><h2>'+esc(tr('destination'))+'</h2><label>'+esc(tr('destination'))+'<select data-website-file-field="kind"><option value="github" '+(config.kind==='github'?'selected':'')+'>GitHub</option><option value="ssh" '+(config.kind==='ssh'?'selected':'')+'>SSH</option></select></label>'+(config.kind==='github'?github.view()+['owner','repository','branch','directory'].map(key=>field(key,config.github[key]??'','data-destination-group="github"')).join('')+'<label><input type="checkbox" data-website-file-field="pages" data-destination-group="github" '+(config.github.pages?'checked':'')+'>'+esc(tr('pages'))+'</label>':['host','port','user','directory','identity'].map(key=>field(key,config.ssh[key==='identity'?'identityFile':key]??'','data-destination-group="ssh"')).join(''))+field('publicUrl',config.publicUrl??'')+'<div class="inline-actions">'+button('saveDestination','save-destination')+button('review','plan','data-website-file-requires-clean')+button('closePreview','visual')+'</div>'+reviewView()+'</section>';
 }
 function reviewView(){if(!plan)return '';const review=plan.plan??plan;
  return '<section data-website-files-review><h3>'+esc(tr('review'))+'</h3><p>'+esc(destination.config.kind==='github'?destination.config.github.owner+'/'+destination.config.github.repository+' / '+destination.config.github.branch+' / '+(destination.config.github.directory||''):destination.config.ssh.host+':'+destination.config.ssh.directory)+'</p>'+(['added','replaced','removed','unchanged','preserved','conflicts'].filter(kind=>Array.isArray(review[kind])).map(kind=>'<details class="website-files-diff"><summary>'+esc(t('publication',kind,{count:review.counts?.[kind]??review[kind].length}))+'</summary><div data-file-plan-rows>'+destinationPlanRows(review,kind,{esc,action:'website-files-plan-page'})+'</div></details>').join(''))+(destinationConflictCount(review)?'<p role="alert">'+esc(tr('conflicts'))+'</p>'+button('replacement','replacement-plan'):'<label><input type="checkbox" data-website-files-confirm>'+esc(tr('confirm'))+'</label>'+button('publish','publish','data-website-file-requires-clean'))+'</section>';
 }
 async function saveDestination(){if(!destination)return;destination=await request('destination/save',{siteId:siteId(),config:destination.config,etag:destination.etag});destinationDirty=false;onDirty(dirty);plan=null;render();}
 async function action(element){const name=element.dataset.action;if(name?.startsWith('github-')&&mode==='destination'){await run(()=>github.action(element));return true;}if(!name?.startsWith('website-files-'))return false;const operation=name.slice('website-files-'.length);if(busy)return true;flushCanvas();
  await run(async()=>{
   if(mode==='media'&&recordings.dirty()&&!['save','reopen'].includes(operation)){if(!confirm(tr('recordingDiscard')))return;recordings.reset();mode='visual';}
   if(mode==='pages'&&pagesPanel.dirty()&&!operation.startsWith('pages-')&&operation!=='discard')await pagesPanel.save();
   if(mode==='menu'&&menu.dirty()&&!operation.startsWith('menu-')&&operation!=='discard')await menu.save();

   if(operation==='save'){if(menu.dirty())await menu.save();if(pagesPanel.dirty())await pagesPanel.save();await save();render();}
   else if(operation==='undo'||operation==='redo'){const from=operation==='undo'?undo:redo,to=operation==='undo'?redo:undo;if(from.length){to.push({html,css});({html,css}=from.pop());historyBytes=undo.reduce((n,item)=>n+item.html.length+item.css.length,0);lastCheckpoint=0;changed();render();}}
   else if(operation==='discard'||operation==='reopen')await discard();
   else if(operation==='new'){if(await beforeLeave(true)){form={type:'new'};render();}}
   else if(operation==='new-page'){if(await beforeLeave(true)){form={type:'page'};render();}}
   else if(operation==='sites-more'){const result=await request('list',{limit:100,after:nextSite});sites.push(...result.items.filter(item=>!sites.some(site=>site.id===item.id)));nextSite=result.next;render();}

   else if(operation==='form-cancel'){form=null;render();}
   else if(operation==='pages'){if(await beforeLeave(true)){mode='pages';pagesPanel.open();}}
   else if(operation.startsWith('pages-'))await pagesPanel.handle(operation,element);
   else if(operation==='menu'){if(await beforeLeave(true)){await menu.open();mode='menu';render();}}
   else if(operation.startsWith('menu-'))await menu.handle(operation,element);
   else if(operation.startsWith('picker-'))await picker.action(operation,element);
   else if(operation.startsWith('component-'))await components.action(operation,element);
   else if(operation==='media'){await save();await recordings.open(selected);mode='media';render();}
   else if(operation==='galleries'){gallery.open(selected);mode='gallery';render();}
   else if(operation==='gallery-close'){mode='visual';render();}
   else if(operation.startsWith('gallery-'))gallery.action(operation.slice(8),element);
   else if(['visual','html','css'].includes(operation)){
    if(mode==='menu'&&!await beforeLeave(true))return;
    const next=mode==='preview'?trail[step]:null;mode=operation;form=null;
    if(next&&next.path!==opened.path){anchor=next.hash;await open(siteId(),next.path);}else render();
   }
   else if(operation==='preview'){if(menu.dirty())await menu.save();await save();if(stale)throw Error(tr('changed'));resetPreview();mode='preview';navigatePreview({path:opened.path,hash:''});}
   else if(operation==='preview-back'||operation==='preview-forward'){const next=step+(operation==='preview-back'?-1:1);if(trail[next]){step=next;navigatePreview(trail[next],false);}}
   else if(operation==='download'){await save();if(stale)throw Error(tr('changed'));await downloadResource('/api/website-files/export?siteId='+siteId()+'&revision='+opened.site.revision,'observanda-site.zip');}
   else if(operation==='add-block'||operation==='paragraph'||operation==='heading'){
    const type=operation==='add-block'?document.querySelector('[data-website-file-block]').value:operation;
    if(type==='actionLink'){blockDialog(editActionLink,buttonCSS);return;}
    if(type==='equationEdit'){await blockDialog(editWebsiteEquation);return;}
    if(type==='gallery'){gallery.open(selected);mode='gallery';gallery.action('new',element);return;}
    documentChange(doc=>{if(type==='columns'&&!css.includes('.website-columns{')){ensureStyle(doc);css+='\n.website-columns{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,16rem),1fr));gap:1rem}\n';}
    const node=createBlock(doc,type,tr);const at=blockAt(doc,selected);if(movable(at)&&main(doc).contains(at))at.after(node);else main(doc).append(node);});
   }
   else if(operation==='edit-block'){visual?.select(element.dataset.path,{edit:true});}
   else if(operation==='check-page')showPageChecks({doc:websiteHTML(html),path:opened.path,directory:directory(),pages:opened.site.pages,t:tr,select:path=>visual?.select(path,{edit:true})});
   else if(['duplicate','remove','move-up','move-down'].includes(operation)){
    documentChange(doc=>{const node=blockAt(doc,element.dataset.path);if(!movable(node))return;
     if(operation==='duplicate'){duplicateBlock(node);}else if(operation==='remove')node.remove();
     else{const up=operation==='move-up',move=websiteLayerMove(node,up?node.previousElementSibling:node.nextElementSibling,up?'before':'after');if(move)selected=move();}
    });
   }
   else if(operation==='folder'){await save();folder.reset();mode='folder';render();}
   else if(operation.startsWith('folder-'))await folder.action(operation.slice(7));
   else if(operation==='destination')await showDestination();
   else if(operation==='plan-page'){if(!plan||stale||dirty||destinationDirty)throw Error(tr('changed'));const result=await request('plan/page',{siteId:siteId(),expectedRevision:opened.site.revision,configEtag:destination.etag,id:(plan.plan??plan).id,kind:element.dataset.kind,offset:Number(element.dataset.offset)});const current=plan.plan??plan,kind=element.dataset.kind;current[kind]=result.items;current.windows[kind]={offset:result.offset,next:result.next};const host=element.closest('details');if(host)host.querySelector('[data-file-plan-rows]').innerHTML=destinationPlanRows(current,kind,{esc,action:'website-files-plan-page'});}
   else if(operation==='save-destination')await saveDestination();
   else if(operation==='plan'||operation==='replacement-plan'){await save();if(destinationDirty)await saveDestination();plan=await request('plan',{siteId:siteId(),expectedRevision:opened.site.revision,configEtag:destination.etag,...(operation==='replacement-plan'?{replaceExisting:true}:{})});render();}
   else if(operation==='publish'){
    if(!document.querySelector('[data-website-files-confirm]')?.checked||!plan||stale||dirty||destinationDirty)throw Error(tr('confirm'));
    const result=await request('publish',{siteId:siteId(),expectedRevision:opened.site.revision,configEtag:destination.etag,destinationReview:(plan.plan??plan).id,destinationReviewed:true});plan=null;notify(result.message||tr('published'));render();
   }
  },operation==='save'||operation==='save-destination'?'saving':operation==='publish'?'publishing':'working');return true;
 }
 function input(element){
  if(components.input(element)||pagesPanel.input(element)||folder.input(element)||picker.input(element)||menu.input(element)||gallery.input(element))return true;
  if(element.matches('[data-website-file-viewport]')){viewport=element.value;document.querySelector('.website-files-viewport').dataset.size=viewport;visual?.viewportChanged();return true;}
  if(element.matches('[data-website-file-code]')){checkpoint();if(element.dataset.websiteFileCode==='html')html=element.value;else css=element.value;changed();return true;}
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
  if(form.type==='new')result=await request('create',{name:value('name')});
  else if(form.type==='page'){
   const title=value('pageTitle'),path=value('pagePath');
   if(opened.site.pages.some(page=>page.path===path))throw Error(tr('duplicatePage'));
   // A newly added page uses the public site's stylesheet even when the
   // current page has private CSS dedicated to its unpublished draft.
   const publicPage=draftPage()?await request('open',{siteId:siteId(),path:'index.html'}):opened;
   const style='../'.repeat(path.split('/').length-1)+publicPage.site.cssPath;
   result=await request('save',{siteId:siteId(),expectedRevision:opened.site.revision,path,title,html:'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(title)+'</title><link rel="stylesheet" href="'+esc(style)+'"></head><body><main><h1>'+esc(title)+'</h1></main></body></html>',css:publicPage.css});
  }
  else return;
  form=null;mode='visual';adopt(result);history.replaceState(history.state,'',fileRoute(result.site.id));render();
 });return true;}
 return {load,clear,view,bind,checkVersion:poll,action,input,submit,save:()=>run(save,'saving'),discard:()=>run(discard),beforeLeave,isDirty:()=>dirty||destinationDirty||menu.dirty()||pagesPanel.dirty()||recordings.dirty(),current:()=>opened,session:()=>session};
}
