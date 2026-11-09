import {AppError} from './errors.js';
import {randomUUID} from 'node:crypto';
import {WebsiteFileStore} from './website-file-store.js';
import {saveWebsiteRecovery,inspectWebsiteRecovery,listWebsiteRecovery,readWebsiteRecovery,discardWebsiteRecovery,websiteRecoveryResource,websiteRecoveryInput,registerRecoveryWrite,finishRecoveryInputs} from './website-recovery.js';
import {writeRecordingDraft} from './website-recovery-input.js';
import {WebsiteFilesCandidate} from './website-files-candidate.js';
import {Publisher} from './publishing.js';
import {websitePublicationMetadata} from './website-publication-metadata.js';
import {rememberPublishTarget,websitePublishTarget} from './website-publish-target.js';
import {savedAppearance} from './website-saved-appearance.js';
import {websiteThemes} from './website-scoped-themes.js';
import {websiteStyleBook} from './website-style-book.js';
import {websiteBreakpoints} from './website-breakpoints.js';
import {websitePageDesigns} from './website-page-designs.js';
import {pageInclusion} from './website-page-inclusion.js';
import {archivedWebsitePages,websitePageLifecycle} from './website-page-lifecycle.js';
import {websiteSiteLifecycle} from './website-site-lifecycle.js';
import {publishWebsiteTransfer,remoteTransferStatus,settleWebsiteTransfer} from './website-remote-transfer.js';
import {operationResponse} from './operation-response.js';
import {operationStage,operationAdvance,operationTotal,operationWork} from './operation-progress.js';
import {savedWebsiteSearches} from './website-saved-searches.js';
import {LocalExport} from './local-export.js';
import {LocalExportManifest} from './local-export-manifest.js';
import {serveContent,contentHash,contentSize} from './file-content.js';
import {publicationExportHttp} from './publication-export-http.js';
import {researchId} from './web/research-reference.js';
import {componentOperation} from './website-component-storage.js';
import {validateWebsiteLibraryRows,websiteLibraryFacets} from './website-file-library.js';
import {websiteSourceUsage,websitesUsingSource,changeWebsitePlacement,placementPresentationOptions,setPlacementPresentation} from './website-file-placements.js';
import {listGalleryItems,openGalleryImage,readSourceGallery,saveSourceGallery} from './website-source-gallery.js';
import {websitePictureUpload} from './website-picture-upload.js';
import {readRecordingUpload,saveRecordingUpload,websiteRecordingLibrary} from './website-recordings.js';
import {onResponseClose} from './response-close.js';
import {websiteVersions} from './website-versions.js';
import {restoreWebsitePageVersion} from './website-version-restore.js';
import {websiteVersionDesign} from './website-version-design.js';

const prefix='/api/website-files/';
const writes=new Set(['create','save','insert-source','insert-sources','feed/save','feed/remove','gallery/source-save','library/saved-searches/save','library/saved-searches/remove','destination/save','plan','publish','publish/settle','publish/verify','folder/plan','folder/apply','folder/discard']);
const revision=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const sshReviewKey='.observanda/website-ssh-review.json';
async function sshReview(metadata,id,revision,etag){
 const value=JSON.parse(await metadata.readMetadata(sshReviewKey,8192));
 if(!value||value.id!==id||value.revision!==revision||value.configEtag!==etag)throw new AppError('PUBLISH_STALE');
 return value;
}
// Only files belonging to this saved revision can be embedded. The same
// loopback origin also serves protected research routes.
const previewPolicy=directory=>"default-src 'none'; style-src "+directory+" 'unsafe-inline'; img-src "+directory+" data:; media-src "+directory+"; font-src "+directory+"; script-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";

// Runs after ordinary workspace authentication, before any research routing.
export async function websiteFilesHttp(req,res,{url,workspace,contextId,title,actor,body,json,check,publisherOptions={},blockedValues=[],onWrite=()=>{},preparation,githubAccount,folderPicker,withPublication=work=>work()}={}){
 if(!url.pathname.startsWith(prefix))return false;
 if(!workspace)throw new AppError('MISSING');
 await check();
 const store=new WebsiteFileStore(workspace,{actor}),operation=url.pathname.slice(prefix.length);
 const controller=new AbortController(),abort=()=>{if(!res.writableEnded)controller.abort();},releaseClose=onResponseClose(res,abort);
 const signal=controller.signal;
 const observed=task=>req.headers?.accept==='application/x-ndjson'?operationResponse(req,res,task,json):task().then(json);
 const publisher=async siteId=>{
  const metadata=websitePublicationMetadata(await store.publicationWorkspace(siteId));
  return new Publisher(workspace.root,{...publisherOptions,workspace:metadata,authorizeCandidate:async candidate=>{
   if(!(candidate instanceof WebsiteFilesCandidate)||candidate.store!==store||candidate.siteId!==siteId)throw new AppError('STALE');
   await check();await store.checkRevision(siteId,candidate.revision);
  }},workspace.vault);
 };
 try{
  if(req.method==='GET'&&operation.startsWith('gallery/image/')){
   const match=/^gallery\/image\/([a-f0-9]{64})\/([a-f0-9]{64})\/((?:media|figure)(?:%3A|:)[a-f0-9-]{36})$/i.exec(operation);
   if(!match)throw new AppError('INVALID');
   const file=await openGalleryImage(store,match[1],match[2],decodeURIComponent(match[3]),signal);
   await check();res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
   res.setHeader('Content-Security-Policy',"sandbox; default-src 'none'; style-src 'unsafe-inline'");
   await serveContent(req,res,file.content,file.contentType,{signal});return true;
  }
  if(req.method==='GET'&&(operation.startsWith('preview/')||operation.startsWith('edition/'))){
   const editor=operation.startsWith('preview/');
   const match=/^(?:preview|edition)\/([^/]+)\/([a-f0-9]{64})\/(.+)$/.exec(operation);
   if(!match||!researchId(match[1]))throw new AppError('INVALID');
   const policy=previewPolicy(url.origin+prefix+(editor?'preview/':'edition/')+match[1]+'/'+match[2]+'/');
   if(editor&&url.searchParams.get('canvas')==='1'){
    await store.canvasDocument(match[1],decodeURIComponent(match[3]),match[2],{signal});
    res.setHeader('Content-Security-Policy',policy);res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html><head></head><body></body></html>');return true;
   }
   const privateResource=editor&&/^_recovery\/([a-f0-9-]{36})\/([a-f0-9]{64})\/((?:pictures\/[a-f0-9-]{36}\.png|recordings\/[a-f0-9-]{36}\.(?:mp4|wav|vtt)))$/.exec(match[3]);
   const file=privateResource?await websiteRecoveryResource(store,match[1],{path:url.searchParams.get('page'),id:privateResource[1],revision:privateResource[2],name:privateResource[3],assetStamp:match[2],signal}):await store.file(match[1],decodeURIComponent(match[3]),{revision:match[2],signal,editor});
   if(privateResource)res.setHeader('Cache-Control','no-store');
   await check();res.setHeader('Content-Security-Policy',policy);
   await serveContent(req,res,file.content??file.bytes,file.contentType,{signal});return true;
  }
  if(req.method==='GET'&&operation==='export'){
   const siteId=url.searchParams.get('siteId'),expectedRevision=url.searchParams.get('revision');
   if(!researchId(siteId)||!revision(expectedRevision))throw new AppError('INVALID');
   await store.withSite(siteId,expectedRevision,()=>publicationExportHttp(req,res,async options=>{
    await check();const candidate=await WebsiteFilesCandidate.open(store,siteId,expectedRevision,{blockedValues});await candidate.verify(options);return candidate.files;
   }));return true;
  }
  if(!['GET','POST'].includes(req.method))throw new AppError('NOT_FOUND');
  if(operation==='media/save'&&req.method==='POST'){
   if(req.headers['content-type']!=='application/octet-stream')throw new AppError('INVALID');
   onWrite();await check();const upload=await readRecordingUpload(req,signal);
   json(await saveRecordingUpload(store,upload,{signal,check,recoverInput:ref=>websiteRecoveryInput(store,upload.data.siteId,{...ref,path:upload.data.path,slot:'upload',signal})}));return true;
  }
  if(req.method==='GET'&&!['session','preparation','list','library','pdf-version'].includes(operation))throw new AppError('NOT_FOUND');
  if(operation==='recovery/save-inputs'){
   if(req.headers['content-type']!=='application/octet-stream')throw new AppError('INVALID');
   await check();json(await writeRecordingDraft(store,req,{save:saveWebsiteRecovery,register:registerRecoveryWrite,finishDraft:finishRecoveryInputs},{signal}));return true;
  }
  if(['save-pictures','recovery/save-pictures'].includes(operation)&&req.method==='POST'){
   if(req.headers['content-type']!=='application/octet-stream')throw new AppError('INVALID');
   onWrite();await check();
   const {data,pictures}=await websitePictureUpload(req,signal);
   if(!researchId(data.siteId))throw new AppError('INVALID');
   if(operation==='recovery/save-pictures'){json(await saveWebsiteRecovery(store,data.siteId,{...data,uploadedInputs:undefined,receivePictures:pictures,signal}));return true;}
   if(operation==='components/update-pictures'){
    json(await componentOperation(store,'update',data.siteId,{...data,receivePictures:pictures,signal},true));return true;
   }
   json(await store.save(data.siteId,{html:data.html,css:data.css,path:data.path,expectedRevision:data.expectedRevision,historyKey:data.historyKey,recovery:data.recovery,receivePictures:pictures,signal}));return true;
  }
  const data=req.method==='POST'?await body(req,20*1024*1024):{};
  if(!data||typeof data!=='object'||Array.isArray(data))throw new AppError('INVALID');
  if(writes.has(operation)||operation==='menu/save'||/^components\/(create|insert|wrap|update|detach|remove|customize)$/.test(operation)||/^library\/(remove|move|present)-placement$/.test(operation)){onWrite();await check();}
  if(operation==='session'){
   const [result,progress]=await Promise.all([store.list({limit:100}),preparation()]);
   json({workspaceId:workspace.vault?.id,title,contextId,sites:result.items,next:result.next,preparation:progress,defaultSiteId:progress.defaultSiteId});return true;
  }
  if(operation==='preparation'){json({preparation:await preparation()});return true;}
  if(operation==='list'){json(await store.list(data));return true;}
  if(operation==='recovery/list'){json(await listWebsiteRecovery(store,{...data,signal}));return true;}
  if(operation==='pdf-version'){json({revision:await store.pdfVersion({signal})});return true;}
  if(operation==='library'){json(await store.library(data));return true;}
  if(operation==='library/search'){json(await store.searchLibrary({...data,signal}));return true;}
  if(operation==='library/facets'){json(await store.scope(scope=>websiteLibraryFacets(store,scope,{...data,signal}),{signal}));return true;}
  if(operation==='library/sites'){json(await websitesUsingSource(store,{...data,signal}));return true;}
  if(operation==='library/validate'){json(await store.scope(()=>validateWebsiteLibraryRows(store,{...data,signal}),{signal}));return true;}
  if(operation==='library/preview'){json(await store.previewSource({...data,signal}));return true;}
  if(operation==='library/gallery-items'){json(await listGalleryItems(store,{...data,signal}));return true;}
  if(operation==='create'){json(await store.create({name:data.name,html:data.html,css:data.css,language:data.language,signal}));return true;}
  if(operation.startsWith('connection/')&&githubAccount){await githubAccount(operation.slice('connection/'.length),data);return true;}
  const {siteId,expectedRevision,...options}=data;
  if(!researchId(siteId))throw new AppError('INVALID');
  if(operation==='page/archive-list'){json(await archivedWebsitePages(store,siteId,{...options,expectedRevision,signal}));return true;}
  if(['page/review-lifecycle','page/apply-lifecycle','site/review-lifecycle','site/apply-lifecycle'].includes(operation)){
   const write=operation.includes('/apply-');if(write){onWrite();await check();}
   const handler=operation.startsWith('site/')?websiteSiteLifecycle:websitePageLifecycle;
   json(await handler(store,siteId,{...options,expectedRevision,signal},write));return true;
  }
  if(operation.startsWith('versions/')){
   const action=operation.slice('versions/'.length);
   if(['name','release','restore','restore-design'].includes(action)){onWrite();await check();}
   const request={...options,expectedRevision,signal};
   if(action==='review'||action==='restore')json(await restoreWebsitePageVersion(store,siteId,request,action==='restore'));
   else if(action==='review-design'||action==='restore-design')json(await websiteVersionDesign(store,siteId,request,action==='restore-design'));
   else json(await websiteVersions(store,siteId,action,request));
   return true;
  }
  if(operation==='page/create'){
   onWrite();await check();const {path,title,language,inclusion}=options;
   json(await store.createPage(siteId,{expectedRevision,path,title,language,inclusion,signal}));return true;
  }
  if(operation==='page/review-inclusion'||operation==='page/apply-inclusion'){
   const write=operation==='page/apply-inclusion';if(write){onWrite();await check();}
   json(await pageInclusion(store,siteId,{...options,expectedRevision,signal},write));return true;
  }
  if(operation==='page/delivery'){
   if(!revision(expectedRevision))throw new AppError('INVALID');
   const path=options.path;
   const current=await store.scope(async()=>{
    const manifest=await store.current(siteId,expectedRevision),page=manifest.pages.find(p=>p.path===path);
    if(!page)throw new AppError('NOT_FOUND');
    const file=manifest.publicPageFiles?.find(p=>p.file.name===path)?.file??manifest.files.find(f=>f.name===path);
    return {included:!page.draft,sha256:file.sha256};
   },{signal});
   const target=await publisher(siteId),metadata=target.workspace;
   const selected=await websitePublishTarget(metadata,async()=>{const saved=await target.read();return {...saved,transfer:await remoteTransferStatus(target,saved)};});
   let delivery=null;
   if(selected.kind==='folder')delivery=await new LocalExport(metadata).deliveredMember(selected.directory,path);
   if(selected.kind==='remote'){
    const {receipt,transfer}=selected.destination;
    if(transfer?.uncertain)delivery={state:'unconfirmed'};
    else if(receipt?.fileInventory){
     const member=await new LocalExportManifest(metadata).find(receipt.fileInventory,path);
     delivery={state:'confirmed',releaseId:receipt.releaseId,sha256:member?.sha256??null};
    }else if(receipt)delivery={state:'unconfirmed'};
   }
   await store.checkRevision(siteId,expectedRevision);
   let state='unknown';
   if(delivery?.state==='confirmed'){
    if(delivery.sha256&&current.included){
     const matches=current.sha256===delivery.sha256&&(await WebsiteFilesCandidate.open(store,siteId,expectedRevision)).id===delivery.releaseId;
     state=matches?'delivered':'changed';
    }else if(delivery.sha256)state='withdrawal';
    else state=current.included?'pending':'excluded';
   }
   json({revision:expectedRevision,path,destination:selected.kind,state});return true;
  }
  if(operation==='recovery/page'){json(await inspectWebsiteRecovery(store,siteId,{...options,signal}));return true;}
  if(operation==='recovery/validate'){
   if(!revision(expectedRevision))throw new AppError('INVALID');
   await store.scope(async()=>{const site=await store.current(siteId,expectedRevision);await store.inspectPageSource(site,options.path,options.html,options.css,signal);},{signal});
   json({revision:expectedRevision});return true;
  }
  if(operation==='recovery/read'||operation==='recovery/compare'){json(await readWebsiteRecovery(store,siteId,{...options,compare:operation==='recovery/compare',signal}));return true;}
  if(operation==='recovery/discard'){await check();json(await discardWebsiteRecovery(store,siteId,{...options,signal}));return true;}
  if(operation==='recovery/save'){await check();json(await saveWebsiteRecovery(store,siteId,{...options,receivePictures:undefined,uploadedInputs:undefined,signal}));return true;}
  if(operation==='recovery/track'){
   const ref={...options,slot:'vtt',signal},file=await websiteRecoveryInput(store,siteId,ref),parts=[];
   if(file.size>2*1024*1024)throw new AppError('LIMIT');
   for await(const bytes of file.readStaged({signal}))parts.push(bytes);
   await websiteRecoveryInput(store,siteId,ref);json({text:Buffer.concat(parts,file.size).toString('utf8')});return true;
  }
  if(operation==='page-designs'){
   if(options.action!=='list'){onWrite();await check();}
   json(await websitePageDesigns(store,siteId,{...options,expectedRevision,signal}));return true;
  }
  if(operation==='styles/read'||operation==='styles/change'){
   const action=operation==='styles/read'?'list':options.action;
   if(operation==='styles/change'){if(!action||action==='list')throw new AppError('INVALID');onWrite();await check();}
   json(await websiteStyleBook(store,siteId,{...options,action,expectedRevision,blockedValues,signal}));return true;
  }
  if(operation==='breakpoints/review'||operation==='breakpoints/apply'){
   const apply=operation==='breakpoints/apply';if(apply){onWrite();await check();}
   json(await websiteBreakpoints(store,siteId,{...options,expectedRevision,signal},apply));return true;
  }
  if(operation==='themes/read'||operation==='themes/change'){
   const write=operation==='themes/change';if(write){onWrite();await check();}
   json(await websiteThemes(store,siteId,{...options,expectedRevision,signal},write));return true;
  }
  if(operation==='appearance/read'||operation==='appearance/save'){
   const write=operation==='appearance/save';if(write){onWrite();await check();}
   json(await savedAppearance(store,siteId,{...options,expectedRevision,signal},write));return true;
  }
  if(operation==='review/catalogue'){
   if(!revision(expectedRevision))throw new AppError('INVALID');
   const inventory=await store.publicationInventory(siteId,{expectedRevision,signal});await check();
   json({...inventory,files:[...inventory.files,'publication.json']});return true;
  }
  if(operation==='publish-target'){
   await store.siteVersion(siteId,{signal});
   const target=await publisher(siteId);
   json(await websitePublishTarget(target.workspace,async()=>{
    const saved=await target.read();return {...saved,transfer:await remoteTransferStatus(target,saved)};
   }));return true;
  }
  if(['feed/read','feed/save','feed/remove'].includes(operation)){
   const {readWebsiteFeed,saveWebsiteFeed,removeWebsiteFeed}=await import('./website-dynamic-feeds.js');
   const run=operation==='feed/read'?readWebsiteFeed:operation==='feed/save'?saveWebsiteFeed:removeWebsiteFeed;
   const task=()=>run(store,siteId,{...options,expectedRevision,signal});
   if(operation==='feed/save')await observed(task);else json(await task());return true;
  }
  if(operation.startsWith('library/saved-searches/')){json(await savedWebsiteSearches(store,operation.slice('library/saved-searches/'.length),{...options,siteId,signal}));return true;}
  if(operation==='gallery/source-read'){json(await readSourceGallery(store,siteId,{...options,expectedRevision,signal}));return true;}
  if(operation==='gallery/source-save'){json(await saveSourceGallery(store,siteId,{...options,expectedRevision,signal}));return true;}
  if(operation==='folder/chooser'||operation==='folder/choose'){
   if(Object.keys(options).some(key=>key!=='path')||options.path!==undefined&&typeof options.path!=='string')throw new AppError('INVALID');
   if(operation==='folder/chooser'){json(folderPicker?await folderPicker.capabilities():{mode:'server'});return true;}
   if(!folderPicker)throw new AppError('FOLDER_PICKER_UNAVAILABLE');
   const selection=await folderPicker.choose({path:options.path??'',signal});await check();json(selection);return true;
  }
  if(operation==='library/placements'){json(await websiteSourceUsage(store,siteId,{...options,expectedRevision,signal}));return true;}
  if(operation==='library/presentation-options'){json(await placementPresentationOptions(store,siteId,{...options,expectedRevision,signal}));return true;}
  if(operation==='library/present-placement'){json(await setPlacementPresentation(store,siteId,{...options,expectedRevision,signal}));return true;}
  if(operation==='library/move-placement'||operation==='library/remove-placement'){json(await changeWebsitePlacement(store,siteId,operation==='library/move-placement'?'move':'remove',{...options,expectedRevision,signal}));return true;}
  if(operation.startsWith('components/')){json(await componentOperation(store,operation.slice(11),siteId,{...options,expectedRevision,signal},true));return true;}
  if(operation==='open'){json(await store.open(siteId,{...options,signal}));return true;}
  if(operation==='media/library'){json(await websiteRecordingLibrary(store,siteId,{...options,expectedRevision,signal}));return true;}
  if(operation==='menu'){json(await store.menu(siteId,{expectedRevision,menuId:options.menuId,signal}));return true;}
  if(operation==='menu/save'){await observed(()=>operationStage('menuSave',{unit:'files'},()=>store.saveMenu(siteId,{...options,expectedRevision,signal})));return true;}
  if(operation==='version'){
   if(options.path!==undefined&&(typeof options.path!=='string'||!options.path.endsWith('.html')||!revision(expectedRevision)))throw new AppError('INVALID');
   json(await store.versionStatus(siteId,{path:options.path,historyKey:options.historyKey,media:options.media,expectedRevision,signal}));return true;
  }
  if(operation==='save'){
   if(Object.hasOwn(options,'recordings')||Object.hasOwn(options,'receivePictures'))throw new AppError('INVALID');
   const {path,html,css,title,historyKey,recovery}=options;json(await store.save(siteId,{path,html,css,title,historyKey,recovery,expectedRevision,signal}));return true;
  }
  if(operation==='insert-source'){json(await store.insertSource(siteId,{...options,expectedRevision,signal}));return true;}
  if(operation==='insert-sources'){json(await store.insertSources(siteId,{...options,expectedRevision,signal}));return true;}
  if(operation==='destination'||operation==='destination/save'){
   json(await store.withSite(siteId,undefined,async()=>{
    const target=await publisher(siteId);
    if(operation==='destination'){const saved=await target.read();return {...saved,transfer:await remoteTransferStatus(target,saved)};}
    return target.workspace.withLock(async()=>{
     const previous=await target.read(),transfer=await remoteTransferStatus(target,previous);
     if(transfer?.uncertain)throw new AppError('PUBLISH_PENDING');
     const saved=await target.save(options.config,options.etag);
     await rememberPublishTarget(target.workspace,'remote');return saved;
    });
   }));return true;
  }
  if(operation==='plan/page'){
   if(!revision(expectedRevision))throw new AppError('INVALID');
   json(await store.withSite(siteId,expectedRevision,async()=>{
    const target=await publisher(siteId);
    if(options.kind==='included'){
     const saved=await target.read();
     if(saved.config.kind!=='ssh'||saved.etag!==options.configEtag)throw new AppError('PUBLISH_STALE');
     const review=await sshReview(target.workspace,options.id,expectedRevision,saved.etag);
     const offset=options.offset,rows=await new LocalExportManifest(target.workspace).page(review.inventory,{offset,limit:32});
     return {items:rows.map(row=>row.path),offset,next:offset+rows.length<review.files?offset+rows.length:null};
    }
    const candidate=await WebsiteFilesCandidate.open(store,siteId,expectedRevision);return target.destinationPlanPage(options,candidate.id);
   }));return true;
  }
  if(operation.startsWith('folder/')){
   if(!revision(expectedRevision))throw new AppError('INVALID');
   const metadata=websitePublicationMetadata(await store.publicationWorkspace(siteId));
   let candidate;
   const savedCandidate=async()=>candidate??=await WebsiteFilesCandidate.open(store,siteId,expectedRevision,{blockedValues});
   const local=new LocalExport(metadata,{fileOwner:{locked:(_directory,task)=>store.withSite(siteId,expectedRevision,task),
    completed:plan=>rememberPublishTarget(metadata,'folder',plan.directory,plan.completedAt),candidate:async reviewId=>{
    const value=await savedCandidate();if(value.reviewId!==reviewId)throw new AppError('STALE');
    await operationStage('folderVerify',{unit:'files',total:value.files.size},()=>value.verify({signal,onFile:()=>operationAdvance()}));return value;
   }}});
   if(operation==='folder/plan')await observed(()=>operationStage('folderCompare',{unit:'files'},async()=>{
    const value=await savedCandidate();return {...await local.plan({reviewId:value.reviewId,directory:options.directory}),currentReviewId:value.reviewId};
   }));
   else if(operation==='folder/page')json(await local.page({id:options.id,offset:options.offset}));
   else if(operation==='folder/discard')json(await local.discard({id:options.id}));
   else if(operation==='folder/apply')await observed(()=>operationStage('folderWrite',{unit:'files'},()=>local.apply({id:options.id,reviewed:options.reviewed})));
   else throw new AppError('NOT_FOUND');return true;
  }
  if(operation==='publish/settle'){
   if(!revision(expectedRevision)||!researchId(options.id))throw new AppError('INVALID');
   const target=await publisher(siteId);await observed(()=>operationStage('remoteSettleProgress',{},()=>withPublication(()=>store.withSite(siteId,expectedRevision,()=>settleWebsiteTransfer(target,{...options,signal})))));return true;
  }
  if(operation==='publish/verify'){
   if(!revision(expectedRevision)||typeof options.configEtag!=='string'||typeof options.commit!=='string')throw new AppError('INVALID');
   await store.checkRevision(siteId,expectedRevision);const target=await publisher(siteId);
   await observed(()=>operationStage('remoteLiveCheck',{unit:'files'},()=>{
    let completed=0,bytes=0,total;return target.verifyLive({configEtag:options.configEtag,commit:options.commit,signal,beforeCommit:()=>store.checkRevision(siteId,expectedRevision),
     progress:value=>{operationAdvance(value.done-completed);completed=value.done;operationWork({bytes:value.bytes-bytes});bytes=value.bytes;if(total===undefined){total=value.total;operationTotal(total);}}});
   }));return true;
  }
  if(operation==='plan'||operation==='publish'){
   if(!revision(expectedRevision))throw new AppError('INVALID');
   if(operation==='publish'&&(options.destinationReviewed!==true||!researchId(options.destinationReview)))throw new AppError('PUBLISH_STALE');
   const target=await publisher(siteId);
   await observed(()=>operationStage(operation==='plan'?'remoteReview':'remotePublish',{},async()=>{
    const candidate=await WebsiteFilesCandidate.open(store,siteId,expectedRevision,{blockedValues});await check();
    const saved=await target.read();if(!saved.configured||saved.etag!==options.configEtag)throw new AppError('PUBLISH_STALE');
    if(operation==='plan'&&saved.config.kind==='ssh'){
     await operationStage('remoteCheckFiles',{unit:'files',total:candidate.files.size},()=>candidate.verify({signal,onFile:bytes=>{operationAdvance();operationWork({bytes});}}));
     const list=new LocalExportManifest(target.workspace),files=list.builder('files');
     await operationStage('remoteIndexFiles',{unit:'files',total:candidate.files.size},async()=>{for(const [name,content] of candidate.files){signal.throwIfAborted();await files.append({path:name,bytes:contentSize(content),sha256:contentHash(content)});operationAdvance();}});
     const inventory=await files.finish(),count=candidate.files.size;
     const review={id:randomUUID(),kind:'ssh',requiresReview:true,files:count,revision:expectedRevision,configEtag:options.configEtag};
     await store.withSite(siteId,expectedRevision,()=>target.workspace.writeMetadata(sshReviewKey,JSON.stringify({...review,inventory})));
     const rows=await list.page(inventory,{offset:0,limit:32});
     return {...review,counts:{included:count},included:rows.map(row=>row.path),windows:{included:{offset:0,next:count>rows.length?rows.length:null}}};
    }
    if(operation==='plan')return target.reviewDestination(candidate,options.configEtag,{signal,replaceExisting:options.replaceExisting===true,archiveBranch:options.archiveBranch??null,beforeCommit:()=>store.checkRevision(siteId,expectedRevision)});
    return withPublication(()=>store.withSite(siteId,expectedRevision,async()=>{
     await rememberPublishTarget(target.workspace,'remote');
     return publishWebsiteTransfer(target,candidate,{configEtag:options.configEtag,id:options.destinationReview,ownerId:workspace.vault?.id,signal,retryPages:options.retryPages===true,validateSSH:()=>sshReview(target.workspace,options.destinationReview,expectedRevision,saved.etag)});
    }));
   }));
   return true;
  }
  throw new AppError('NOT_FOUND');
 }finally{releaseClose();}
}
