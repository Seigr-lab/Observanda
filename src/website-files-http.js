import {AppError} from './errors.js';
import {WebsiteFileStore} from './website-file-store.js';
import {WebsiteFilesCandidate} from './website-files-candidate.js';
import {Publisher} from './publishing.js';
import {websitePublicationMetadata} from './website-publication-metadata.js';
import {LocalExport} from './local-export.js';
import {serveContent} from './file-content.js';
import {publicationExportHttp} from './publication-export-http.js';
import {researchId} from './web/research-reference.js';

const prefix='/api/website-files/';
const writes=new Set(['create','save','insert-source','convert-existing','destination/save','plan','publish','folder/plan','folder/apply','folder/discard']);
const revision=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const previewPolicy="default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; font-src 'self'; script-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";

// Runs after ordinary workspace authentication, before any research routing.
export async function websiteFilesHttp(req,res,{url,workspace,contextId,title,body,json,check,publisherOptions={},blockedValues=[],onWrite=()=>{},convertExisting,listExisting}={}){
 if(!url.pathname.startsWith(prefix))return false;
 if(!workspace)throw new AppError('MISSING');
 await check();
 const store=new WebsiteFileStore(workspace),operation=url.pathname.slice(prefix.length);
 const controller=new AbortController(),abort=()=>{if(!res.writableEnded)controller.abort();};res.once('close',abort);
 const signal=controller.signal;
 const publisher=async siteId=>{
  const metadata=websitePublicationMetadata(await store.publicationWorkspace(siteId));
  return new Publisher(workspace.root,{...publisherOptions,workspace:metadata,authorizeCandidate:async candidate=>{
   if(!(candidate instanceof WebsiteFilesCandidate)||candidate.store!==store||candidate.siteId!==siteId)throw new AppError('STALE');
   await check();await store.checkRevision(siteId,candidate.revision);
  }},workspace.vault);
 };
 try{
  if(req.method==='GET'&&operation.startsWith('preview/')){
   const match=/^preview\/([^/]+)\/([a-f0-9]{64})\/(.+)$/.exec(operation);
   if(!match||!researchId(match[1]))throw new AppError('INVALID');
   if(url.searchParams.get('canvas')==='1'){
    const site=await store.checkRevision(match[1],match[2]);
    if(!site.pages.some(page=>page.path===decodeURIComponent(match[3])))throw new AppError('NOT_FOUND');
    res.setHeader('Content-Security-Policy',previewPolicy);res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html><head></head><body></body></html>');return true;
   }
   const file=await store.file(match[1],decodeURIComponent(match[3]),{revision:match[2],signal});
   await check();res.setHeader('Content-Security-Policy',previewPolicy);
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
  if(req.method==='GET'&&!['session','list','library'].includes(operation))throw new AppError('NOT_FOUND');
  const data=req.method==='POST'?await body(req,20*1024*1024):{};
  if(!data||typeof data!=='object'||Array.isArray(data))throw new AppError('INVALID');
  if(writes.has(operation)){onWrite();await check();}
  if(operation==='session'){
   const result=await store.list({limit:100});
   json({workspaceId:workspace.vault?.id,title,contextId,sites:result.sites??result.items??[],next:result.next??null,legacyAvailable:true});return true;
  }
  if(operation==='list'){json(await store.list(data));return true;}
  if(operation==='library'){json(await store.library(data));return true;}
  if(operation==='create'){json(await store.create(data));return true;}
  if(operation==='legacy-list'){json(await listExisting(data,{signal}));return true;}
  if(operation==='convert-existing'){json(await convertExisting(store,data,{signal,blockedValues}));return true;}
  const {siteId,expectedRevision,...options}=data;
  if(!researchId(siteId))throw new AppError('INVALID');
  if(operation==='open'){json(await store.open(siteId,{...options,signal}));return true;}
  if(operation==='version'){
   const current=await store.checkRevision(siteId);json({revision:typeof current==='string'?current:current.revision??current.site?.revision});return true;
  }
  if(operation==='save'){json(await store.save(siteId,{...options,expectedRevision,signal}));return true;}
  if(operation==='insert-source'){json(await store.insertSource(siteId,{...options,expectedRevision,signal}));return true;}
  if(operation==='destination'){json(await (await publisher(siteId)).read());return true;}
  if(operation==='destination/save'){json(await (await publisher(siteId)).save(options.config,options.etag));return true;}
  if(operation.startsWith('folder/')){
   if(!revision(expectedRevision))throw new AppError('INVALID');
   const metadata=websitePublicationMetadata(await store.publicationWorkspace(siteId));
   const local=new LocalExport(metadata,{fileOwner:{locked:(_directory,task)=>store.withSite(siteId,expectedRevision,task),candidate:async reviewId=>{
    const value=await WebsiteFilesCandidate.open(store,siteId,expectedRevision,{blockedValues});if(value.reviewId!==reviewId)throw new AppError('STALE');await value.verify({signal});return value;
   }}});
   if(operation==='folder/plan'){const candidate=await WebsiteFilesCandidate.open(store,siteId,expectedRevision,{blockedValues});json(await local.plan({reviewId:candidate.reviewId,directory:options.directory}));}
   else if(operation==='folder/page')json(await local.page({id:options.id,offset:options.offset}));
   else if(operation==='folder/discard')json(await local.discard({id:options.id}));
   else if(operation==='folder/apply')json(await local.apply({id:options.id,reviewed:options.reviewed}));
   else throw new AppError('NOT_FOUND');return true;
  }
  if(operation==='plan'||operation==='publish'){
   if(!revision(expectedRevision))throw new AppError('INVALID');
   const candidate=await WebsiteFilesCandidate.open(store,siteId,expectedRevision,{blockedValues}),target=await publisher(siteId);
   await candidate.verify({signal});await check();
   if(operation==='plan'){
    const saved=await target.read();if(!saved.configured||saved.etag!==options.configEtag)throw new AppError('PUBLISH_STALE');
    if(saved.config.kind==='ssh')json({id:null,kind:'ssh',requiresReview:true,files:candidate.files.size,revision:expectedRevision});
    else json(await target.reviewDestination(candidate,options.configEtag,{signal,replaceExisting:options.replaceExisting===true,archiveBranch:options.archiveBranch??null,beforeCommit:()=>store.checkRevision(siteId,expectedRevision)}));
   }
   else {if(options.destinationReviewed!==true)throw new AppError('PUBLISH_STALE');json({receipt:await target.deploy(candidate,options.configEtag,workspace.vault?.id,{...(options.destinationReview?{destinationReview:options.destinationReview}:{}),destinationReviewed:true})});}
   return true;
  }
  throw new AppError('NOT_FOUND');
 }finally{res.off('close',abort);}
}
