import './i18n/catalogues/websiteFiles.js';
import {t} from './i18n/index.js';
import {websiteHTML,serializeWebsiteHTML,loadWebsiteCanvas,websiteCanvasValue,editWebsiteCanvas,rebaseWebsitePlacements} from './website-html-document.js';
import {websiteFilesFolder} from './website-files-folder.js';
import {githubConnectionUI} from './github-connection-ui.js';
import {downloadResource} from './session-download.js';
import {destinationPlanRows,destinationConflictCount} from './publication-review.js';

const tr=(key,args)=>t('websiteFiles',key,args);

const fileRoute=siteId=>'#/websites/'+siteId+'/editor';

export function websiteFilesUI({api,esc,render,notify=()=>{},onDirty=()=>{},onSite=()=>{},onSession=()=>{}}){
 let session=null,sites=[],opened=null,html='',css='',mode='visual',dirty=false,busy=false,error='',stale=false,generation=0,controller=null;
 let library=null,libraryNext=null,destination=null,destinationDirty=false,plan=null,form=null,timer=null,checkBusy=false;
 let pendingCanvas=null,canvasTimer=null;
 let undo=[],redo=[],lastCheckpoint=0,historyBytes=0;
 const request=(operation,data,options={})=>api('/api/website-files/'+operation,data,{...options,owner:null,adopt:false});
 const siteId=()=>opened?.site.id;
 let nextSite=null,preparationTimer=null,missingSite=false;
 let requestedSite=null,openPublishing=false;
 const connectionState={get storage(){return session?{contextId:session.contextId}:null;},publishing:{}};
 const github=githubConnectionUI({state:connectionState,api:(route,data)=>api(route,data,{owner:null,adopt:false,signal:controller?.signal}),endpoint:'/api/website-files/connection/',esc,field:(label,control)=>'<label>'+esc(label)+' '+control+'</label>',notify,temporaryCredentials:false,onConnectionChange:()=>{plan=null;document.querySelector('[data-website-files-review]')?.remove();}});
 async function showDestination(){await save();destination=await request('destination',{siteId:siteId()});destinationDirty=false;form=null;mode='destination';render();if(destination.config.kind==='github')await github.refresh();}
 
 const folder=websiteFilesFolder({request,site:()=>opened,esc,render});
 const baseURL=()=>new URL('/api/website-files/preview/'+siteId()+'/'+opened.site.revision+'/'+opened.path,location.origin).href;
 function status(){
  if(error)return error;
  if(stale)return tr('changed');
  if(busy)return tr(busy);
  if(!opened)return '';
  return tr(dirty?'unsaved':'saved');
 }
 const button=(key,action,extra='')=>'<button type="button" class="button" data-action="website-files-'+action+'" '+extra+'>'+esc(tr(key))+'</button>';
 const field=(key,value,extra='')=>'<label>'+esc(tr(key))+'<input data-website-file-field="'+key+'" value="'+esc(value)+'" '+extra+'></label>';
 function flushCanvas(){
  clearTimeout(canvasTimer);canvasTimer=null;if(!pendingCanvas)return;
  const document=pendingCanvas;pendingCanvas=null;html=websiteCanvasValue(document);changed();paintStructure();
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
  if(saveButton)saveButton.disabled=!dirty||stale;
  const discardButton=document.querySelector('[data-action="website-files-discard"]');
  if(discardButton)discardButton.disabled=!dirty||stale;
 }
 function adopt(value){
  if(!value?.site?.id||typeof value.site.revision!=='string'||!Array.isArray(value.site.pages)||typeof value.html!=='string'||typeof value.css!=='string'||typeof value.path!=='string')throw Error(tr('failed'));
  opened=value;html=value.html;css=value.css;dirty=stale=false;error='';plan=null;undo=[];redo=[];historyBytes=0;onDirty(false);onSite(value.site);const at=sites.findIndex(site=>site.id===value.site.id);if(at<0)sites.push(value.site);else sites[at]=value.site;
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
    if(epoch!==generation||result.preparation?.state==='preparing')return;
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
  clear();const epoch=generation;controller=new AbortController();
  const result=await request('session',undefined,{signal:controller.signal});
  if(epoch!==generation)return;
  session=result;onSession(session);sites=session.sites??[];nextSite=session.next??null;
  requestedSite=id??/^#\/websites\/([a-f0-9-]{36})\//.exec(location.hash)?.[1]??null;openPublishing=publishing;
  await initialPage();waitForPreparation();
 }
 function clear(){clearTimeout(preparationTimer);preparationTimer=null;missingSite=false;requestedSite=null;openPublishing=false;pendingCanvas=null;clearTimeout(canvasTimer);canvasTimer=null;generation++;folder.reset();controller?.abort();controller=null;clearInterval(timer);timer=null;mode='visual';session=null;opened=null;sites=[];nextSite=null;library=null;libraryNext=null;destination=null;destinationDirty=false;plan=null;form=null;dirty=busy=stale=false;html=css=error='';undo=[];redo=[];historyBytes=0;onDirty(false);}
 function checkpoint(){const now=Date.now();if(now-lastCheckpoint>350||!undo.length){flushCanvas();undo.push({html,css});historyBytes+=html.length+css.length;while(undo.length>50||historyBytes>8*1024*1024&&undo.length>1){const oldest=undo.shift();historyBytes-=oldest.html.length+oldest.css.length;}lastCheckpoint=now;}redo=[];}
 function documentChange(operation){checkpoint();const document=websiteHTML(html);operation(document);html=serializeWebsiteHTML(document);changed();render();}
 async function save(){
  flushCanvas();if(!opened||!dirty)return opened;if(stale)throw Error(tr('changed'));
  const submitted={html,css},epoch=generation,value=await request('save',{siteId:siteId(),expectedRevision:opened.site.revision,path:opened.path,...submitted});
  if(epoch!==generation)return;
  const newer=html!==submitted.html||css!==submitted.css;if(newer){opened=value;stale=false;error='';changed();}else adopt(value);
  return value;
 }
 async function beforeLeave(fromAction=false){if(busy&&!fromAction)return false;if(!dirty&&!destinationDirty)return true;if(!confirm(tr('saveBeforeLeave')))return false;if(dirty)await save();if(destinationDirty)await saveDestination();return true;}
 async function discard(){if(dirty&&!confirm(tr('discardConfirm')))return false;if(opened)await open(siteId(),opened.path);return true;}
 function updateFromSaved(value){
  flushCanvas();
  if(!dirty){adopt(value);render();return;}
  const merged=rebaseWebsitePlacements(opened.html,html,value.html),styleConflict=opened.css!==value.css&&css!==opened.css&&css!==value.css;
  if(merged===null||styleConflict){stale=true;plan=null;render();return;}
  const authoredCSS=css===opened.css?value.css:css;adopt(value);html=merged;css=authoredCSS;changed();render();
 }
 async function poll(){
  if(checkBusy||busy||!opened||document.hidden)return;const epoch=generation,id=siteId(),revision=opened.site.revision;checkBusy=true;
  try{const current=await request('version',{siteId:id},{signal:controller?.signal});if(epoch!==generation||id!==siteId()||revision!==opened.site.revision)return;if(current.revision!==revision){const page=opened.path,value=await request('open',{siteId:id,path:page},{signal:controller.signal});if(epoch!==generation||siteId()!==id||opened.path!==page||opened.site.revision!==revision)return;updateFromSaved(value);}}
  catch(reason){if(reason.name!=='AbortError'&&epoch===generation){error=reason.message||tr('failed');if(['CONFLICT','PUBLICATION_PERMISSIONS_CHANGED','WEBSITE_CHANGED','ACCESS_LOCKED'].includes(reason.code)){stale=true;render();}else paintStatus();}}
  finally{checkBusy=false;}
 }
 function siteSelector(){
  if(!sites.length)return '';
  const choose=opened?'':'<option value="" selected disabled>'+esc(tr('chooseSite'))+'</option>';
  const options=sites.map(site=>'<option value="'+esc(site.id)+'" '+(site.id===siteId()?'selected':'')+'>'+esc(site.name)+'</option>').join('');
  return '<label>'+esc(tr('site'))+' <select class="website-file-select" data-website-file-site>'+choose+options+'</select></label>'+(nextSite?button('more','sites-more'):'');
 }
 function pageToolbar(){
  const options=opened.site.pages.map(page=>'<option value="'+esc(page.path)+'" '+(page.path===opened.path?'selected':'')+'>'+esc(page.title||page.path)+'</option>').join('');
  return '<label>'+esc(tr('page'))+' <select class="website-file-select" data-website-file-page>'+options+'</select></label>'+
   button('addPage','new-page')+button('save','save','data-website-file-requires-clean')+button('discard','discard')+
   button('preview','preview','data-website-file-requires-clean')+button('download','download','data-website-file-requires-clean');
 }
 function unopenedView(){
  const state=session.preparation?.state;
  if(state==='preparing')return '<p role="status">'+esc(tr('preparing'))+'</p>';
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
  const headerActions=opened&&!form?button('create','new')+button('destination','destination')+button('folderPublish','folder'):'';
  let body;
  if(stale&&['visual','preview'].includes(mode))body='';
  else if(form)body=formView();
  else if(!opened)body=unopenedView();
  else if(mode==='folder')body=button('closePreview','visual')+folder.view();
  else if(mode==='destination')body=destinationView();
  else if(mode==='preview')body=button('closePreview','visual')+'<iframe class="website-files-canvas" title="'+esc(tr('preview'))+'" src="'+esc(baseURL())+'" sandbox="allow-same-origin"></iframe>';
  else body=editorView();
  const toolbar=form?'':siteSelector()+(opened?pageToolbar():'');
  return '<fieldset class="website-file-controls" data-website-file-controls><header><h1>'+esc(title)+'</h1>'+headerActions+'</header>'+
   (toolbar?'<div class="website-files-toolbar">'+toolbar+'</div>':'')+
   '<p class="website-files-status" role="status" data-website-files-status></p>'+
   button('reopen','reopen','data-website-files-reopen '+(stale?'':'hidden'))+body+'</fieldset>';
 }
 function formView(){
  const isPage=form.type==='page',label=isPage?'addPage':'create';
  const name=field(isPage?'pageTitle':'name','','required maxlength="160"');
  const path=isPage?field('pagePath',crypto.randomUUID()+'.html','required pattern="[a-zA-Z0-9_./\\-]+[.]html"'):'';
  return '<section class="panel"><form data-website-files-form><h2>'+esc(tr(label))+'</h2>'+name+path+
   '<div class="inline-actions"><button class="button primary" type="submit">'+esc(tr(label))+'</button>'+button('cancel','form-cancel')+'</div></form></section>';
 }
 function editorView(){return '<div class="website-files-toolbar" role="group" aria-label="'+esc(tr('title'))+'">'+['visual','html','css'].map(key=>button(key,key,'aria-pressed="'+String(mode===key)+'"')).join('')+button('undo','undo',undo.length?'':'disabled')+button('redo','redo',redo.length?'':'disabled')+button('addText','paragraph')+button('addHeading','heading')+'</div><div class="website-files-editor"><aside><section class="panel"><h2>'+esc(tr('structure'))+'</h2><ol class="website-files-structure" data-website-files-structure></ol></section><section class="panel"><h2>'+esc(tr('library'))+'</h2><p>'+esc(tr('libraryNotice'))+'</p>'+button('library','library')+'<div class="website-files-library">'+(library===null?'':library.length?library.map(item=>'<button type="button" class="button" data-action="website-files-insert" data-source="'+esc(item.id)+'">'+esc(item.title)+'</button>').join(''):'<p>'+esc(tr('emptyLibrary'))+'</p>')+(libraryNext?button('more','library-more'):'')+'</div></section></aside><section>'+(mode==='visual'?'<iframe id="website-files-canvas" class="website-files-canvas" title="'+esc(tr('visual'))+'" sandbox="allow-same-origin"></iframe>':'<label>'+esc(tr(mode))+'<textarea class="website-files-code" aria-label="'+esc(tr(mode))+'" data-website-file-code="'+mode+'" spellcheck="false">'+esc(mode==='html'?html:css)+'</textarea></label>')+'</section></div>';}
 function structure(){const document=websiteHTML(html),container=document.querySelector('main')??document.body;return [...container.children].filter(node=>!['SCRIPT','STYLE','LINK'].includes(node.tagName));}
 function paintStructure(){const list=document.querySelector('[data-website-files-structure]');if(!list)return;const items=structure();list.innerHTML=items.map((node,index)=>'<li><span>'+esc(node.querySelector('h1,h2,h3')?.textContent||node.textContent.trim().slice(0,70)||node.tagName.toLowerCase())+'</span>'+button('up','move-up','data-index="'+index+'" '+(index?'':'disabled'))+button('down','move-down','data-index="'+index+'" '+(index===items.length-1?'disabled':''))+button('remove','remove','data-index="'+index+'"')+'</li>').join('');}
 function bind(){
  if(!document.querySelector('link[data-website-files-css]')){const link=document.createElement('link');link.rel='stylesheet';link.href='/website-files.css';link.dataset.websiteFilesCss='';document.head.append(link);}
  const frame=document.getElementById('website-files-canvas');if(frame){frame.onload=()=>{
   const document=frame.contentDocument;if(!document||!frame.isConnected||!opened)return;loadWebsiteCanvas(document,html,css,new URL('/api/website-files/preview/'+siteId()+'/'+opened.site.revision+'/'+opened.site.cssPath,location.origin).href);editWebsiteCanvas(document);
   document.addEventListener('click',event=>{if(event.target.closest('a'))event.preventDefault();});
   document.body.addEventListener('beforeinput',()=>checkpoint());document.body.addEventListener('input',()=>canvasInput(document));
   document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();void run(save).catch(()=>{});}});
  };frame.src=baseURL()+'?canvas=1';}
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
   if(operation==='save'){await save();render();}
   else if(operation==='undo'||operation==='redo'){const from=operation==='undo'?undo:redo,to=operation==='undo'?redo:undo;if(from.length){to.push({html,css});({html,css}=from.pop());changed();render();}}
   else if(operation==='discard'||operation==='reopen')await discard();
   else if(operation==='new'){if(await beforeLeave(true)){form={type:'new'};render();}}
   else if(operation==='new-page'){if(await beforeLeave(true)){form={type:'page'};render();}}
   else if(operation==='sites-more'){const result=await request('list',{limit:100,after:nextSite});sites.push(...result.items.filter(item=>!sites.some(site=>site.id===item.id)));nextSite=result.next;render();}

   else if(operation==='form-cancel'){form=null;render();}
   else if(['visual','html','css'].includes(operation)){mode=operation;form=null;render();}
   else if(operation==='preview'){await save();if(stale)throw Error(tr('changed'));mode='preview';render();}
   else if(operation==='download'){await save();if(stale)throw Error(tr('changed'));await downloadResource('/api/website-files/export?siteId='+siteId()+'&revision='+opened.site.revision,'observanda-site.zip');}
   else if(operation==='paragraph'||operation==='heading'){documentChange(document=>{const node=document.createElement(operation==='paragraph'?'p':'h2');node.textContent=tr(operation);(document.querySelector('main')??document.body).append(node);});}
   else if(operation==='remove'||operation==='move-up'||operation==='move-down'){
    const index=Number(element.dataset.index);documentChange(document=>{const parent=document.querySelector('main')??document.body,nodes=[...parent.children].filter(node=>!['SCRIPT','STYLE','LINK'].includes(node.tagName)),node=nodes[index];if(!node)return;if(operation==='remove')node.remove();else if(operation==='move-up'&&index)nodes[index-1].before(node);else if(operation==='move-down'&&nodes[index+1])nodes[index+1].after(node);});
   }
   else if(operation==='library'||operation==='library-more'){const value=await request('library',{target:'website',limit:25,...(operation==='library-more'?{after:libraryNext}:{})});library=operation==='library-more'?[...library,...value.items]:value.items;libraryNext=value.next;render();}
   else if(operation==='insert'){await save();adopt(await request('insert-source',{siteId:siteId(),expectedRevision:opened.site.revision,path:opened.path,sourceId:element.dataset.source}));render();}
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
  if(folder.input(element))return true;
  if(element.matches('[data-website-file-code]')){checkpoint();if(element.dataset.websiteFileCode==='html')html=element.value;else css=element.value;changed();return true;}
  if(element.matches('[data-website-file-site],[data-website-file-page]')){
   const id=element.matches('[data-website-file-site]')?element.value:siteId(),path=element.matches('[data-website-file-page]')?element.value:'index.html';void run(async()=>{if(await beforeLeave(true)){mode='visual';await open(id,path);}else render();}).catch(()=>{});return true;
  }
  if(element.dataset.websiteFileField&&destination&&mode==='destination'){
   const key=element.dataset.websiteFileField==='identity'?'identityFile':element.dataset.websiteFileField,target=element.dataset.destinationGroup?destination.config[element.dataset.destinationGroup]:destination.config;target[key]=element.type==='checkbox'?element.checked:key==='port'?Number(element.value):element.value;destinationDirty=true;onDirty(true);plan=null;if(key==='kind'){render();if(element.value==='github')void github.refresh().catch(reason=>notify(reason.message,true));}else document.querySelector('[data-website-files-review]')?.remove();return true;
  }
  return element.closest('[data-website-files-form]')!==null;
 }
 async function submit(element){if(!element.matches('[data-website-files-form]'))return false;if(!element.reportValidity())return true;await run(async()=>{
  const value=key=>element.querySelector('[data-website-file-field="'+key+'"]')?.value.trim();let result;
  if(form.type==='new')result=await request('create',{name:value('name')});
  else if(form.type==='page'){const title=value('pageTitle'),path=value('pagePath');if(opened.site.pages.some(page=>page.path===path))throw Error(tr('duplicatePage'));result=await request('save',{siteId:siteId(),expectedRevision:opened.site.revision,path,title,html:'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(title)+'</title><link rel="stylesheet" href="'+'../'.repeat(path.split('/').length-1)+esc(opened.site.cssPath)+'"></head><body><main><h1>'+esc(title)+'</h1></main></body></html>',css});}
  else return;
  form=null;mode='visual';adopt(result);history.replaceState(history.state,'',fileRoute(result.site.id));render();
 });return true;}
 return {load,clear,view,bind,checkVersion:poll,action,input,submit,save:()=>run(save,'saving'),discard:()=>run(discard),beforeLeave,isDirty:()=>dirty||destinationDirty,current:()=>opened,session:()=>session};
}
