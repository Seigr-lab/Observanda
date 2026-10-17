import {AppearancePreviewSessions} from './appearance-preview-sessions.js';
import {appearancePreviewSource} from './appearance-preview.js';
import {WorkspaceFonts} from './workspace-fonts.js';
import {buildDesignExamples} from './design-preview.js';
import {publicationRevisionCurrent} from './publication-freshness.js';
// A project publication session owns its previews, editions and durable jobs.
// Website selection is an argument of each request, never mutable server state.
import os from 'node:os';
import {randomBytes} from 'node:crypto';
import {WebsiteSites} from './website-sites.js';
import {WebsiteResearch} from './website-research.js';
import {WorkspaceEdits} from './workspace-edits.js';
import {MediaStore} from './media.js';
import {PublicationJobs} from './publication-jobs.js';
import {PublicationRollback} from './publication-rollback.js';
import {AnalysisPublicationReview} from './analysis-publication-review.js';
import {PublicationLinks} from './publication-links.js';
import {publicationReferences} from './publication-revisions.js';
import {publicationSelection} from './publication-selection.js';
import {LocalExport} from './local-export.js';
import {DeploymentJobs} from './deployment-jobs.js';
import {GithubRepositorySetup} from './github-repository.js';
import {PublicationVerificationJobs} from './publication-verification-jobs.js';
import {websiteWorkspace,websiteJobQueue} from './website-workspace.js';
import {websitePublisher} from './workspace-jobs.js';
import {publicationDesignPreview} from './publication-design-preview.js';
import {DesignCandidates} from './design-candidates.js';
import {verifyPublication} from './publication.js';
import {jobSummary} from './jobs.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
export class ProjectPublications{
 constructor(entry){this.entry=entry;this.candidates=new DesignCandidates();this.designs=new DesignCandidates();this.appearancePreviews=new AppearancePreviewSessions();}
 clear(){this.candidates.clear();this.designs.clear();this.appearancePreviews.clear();}
 previewUrl(id,file=''){return (this.entry.routePrefix??'/api/projects/'+this.entry.storage.projectId)+'/publication-preview/'+id+'/'+file;}
 appearanceUrl(id,file=''){return (this.entry.routePrefix??'/api/projects/'+this.entry.storage.projectId)+'/appearance-preview/'+id+'/'+file;}
 summary(releases,candidate){return {...releases.summary(candidate),url:this.previewUrl(candidate.reviewId,candidate.defaultPage)};}
 async run(request,data,{websiteId=null,websitePin,websiteContext=false,query={},signal,headless=true,check=async()=>{},binary,sourceReader}={}){
  const {storage,publisher:basePublisher,queue:baseQueue,worker}=this.entry,operation=request.publication;
  await check();signal?.throwIfAborted();if(websiteId!==null&&!researchId(websiteId))throw new AppError('INVALID');
  // Iframe and download requests carry their edition identity in their own URL.
  // Resolve its saved website owner only within this authorized project.
  if(request.id&&!websiteContext&&websiteId===null&&['file','export'].includes(operation)){const raw=await storage.readMetadata('.observanda/website-editions/'+request.id+'.json',4096);if(raw)websiteId=JSON.parse(raw).websiteId;}
  const workspace=websiteWorkspace(storage,websiteId,{websitePin});
  const publisher=websitePublisher(basePublisher,workspace),queue=websiteJobQueue(baseQueue,websiteId),releases=new PublicationJobs(workspace,{sourceReader}),blockedValues=[storage.root,os.homedir(),os.hostname()],cacheKey=id=>(websiteId??'')+':'+id;
  const candidate=async id=>{
   if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))throw new AppError('INVALID');
   let value=this.candidates.get(cacheKey(id));if(!value){value=await releases.read(id);if(value)this.candidates.set(cacheKey(id),value);}return value;
  };
  const retained=async id=>{const value=await candidate(id);if(!value)throw new AppError('NOT_FOUND');return value;};
  const rollback=async value=>data.rollbackReview?new PublicationRollback(workspace,publisher,{sourceReader}).project(value,await new PublicationRollback(workspace,publisher,{sourceReader}).authorize(value,data.rollbackReview)):value;
  const control=async(type,kind)=>{const job=await queue.read(data.id);if(!job||job.type!==type)throw new AppError('NOT_FOUND');await queue.authorize(job);if(kind==='status')return jobSummary(job);const next=await (type==='publication.deploy'?new DeploymentJobs(workspace,publisher,queue,{sourceReader,sourceAccess:this.entry.sourceAccess}).control(job.id,kind):queue.control(job.id,kind));if(kind==='cancel')worker.cancel(job.id);else worker.wake();return jobSummary(next);};
  if(operation.startsWith('websites/')){
   const sites=new WebsiteSites(storage),method=operation.slice(9);
   if(method==='list')return sites.list(data);if(method==='open')return sites.read(data.id,{signal,websitePin:data.websitePin});if(method==='version')return sites.version(data.id,{websitePin:data.websitePin});if(method==='change')return sites.change(data);return sites.save(data.id,data.command);
  }
  if(operation==='workspace/save')return new WorkspaceEdits(storage,new MediaStore(storage)).save(data);
  if(operation.startsWith('website/research/'))return new WebsiteResearch(workspace).run(operation.slice(17),data,{signal});
  if(operation==='design-preview'){
   const result=await publicationDesignPreview(workspace,data,{signal,blockedValues,sourceReader}),id=randomBytes(32).toString('hex');this.designs.set(id,result.candidate);
   return {url:this.previewUrl(id,result.defaultPage),baseUrl:this.previewUrl(id),defaultPage:result.defaultPage,source:result.source,pages:result.candidate.pages,...(result.websitePin?{websitePin:result.websitePin}:{}),...(result.editor?{editor:result.editor}:{})};
  }
  if(operation==='appearance-preview'){
   const source=await appearancePreviewSource(workspace,data,{signal,sourceReader}),fonts=new WorkspaceFonts(workspace);
   if(source.source==='website'){
    const result=await this.appearancePreviews.create(workspace,{...data,websitePin:source.websitePin,mode:'website'},{signal,media:new MediaStore(workspace),fonts,blockedValues,sourceReader});
    const id=result.baseUrl.split('/').filter(Boolean).at(-1);
    return {...result,baseUrl:this.appearanceUrl(id),url:this.appearanceUrl(id,result.defaultPage),pagesUrl:this.appearanceUrl(id,'pages')};
   }
   const fontFiles=await fonts.files(source.book.appearance,{preview:true,signal}),result=buildDesignExamples(source.book.appearance,{blockedValues,fontFiles}),id=randomBytes(32).toString('hex');
   signal?.throwIfAborted();this.designs.set(id,result.candidate);return {url:this.previewUrl(id,result.defaultPage),baseUrl:this.previewUrl(id),defaultPage:result.defaultPage,source:source.source,websitePin:source.websitePin,pages:result.candidate.pages};
  }
  if(operation==='appearance-pages')return this.appearancePreviews.choices(request.id,{cursor:query.cursor??null,path:query.path??null,signal});
  if(operation==='appearance-file'){
   const search=new URLSearchParams(query);for(const key of ['workspace','context'])search.delete(key);
   const file=await this.appearancePreviews.file(request.id,request.file+(search.size?'?'+search:''),{signal});await check();return binary(file);
  }
  if(operation==='preview'){const value=await releases.inline({...data,blockedValues},{signal});this.candidates.set(cacheKey(value.reviewId),value);return this.summary(releases,value);}
  if(operation==='file'){
   const design=this.designs.get(request.id),value=design??await retained(request.id);if(!value.files.has(request.file))throw new AppError('NOT_FOUND');verifyPublication(value,{allowDesign:!!design});await check();return binary({name:request.file,content:value.files.get(request.file)});
  }
  if(operation==='export'){
   const value=await rollback(await retained(request.id??data.id));if(!data.rollbackReview&&!await publicationRevisionCurrent(workspace,value))throw new AppError('STALE');await new AnalysisPublicationReview(workspace,{sourceReader}).assert(value);verifyPublication(value);await check();return binary({archive:value.files});
  }
  if(operation.startsWith('local-export/')){const result=await new LocalExport(workspace,{sourceReader})[operation.slice(13)](data),project=value=>value?.previewUrl?{...value,previewUrl:this.previewUrl(value.reviewId,value.previewUrl.split('/').slice(3).join('/'))}:value;return result?.plan?{...result,plan:project(result.plan)}:project(result);}
  if(operation.startsWith('publication-links/')){const links=new PublicationLinks(workspace);return operation.endsWith('/save')?links.save(data):links.read();}
  if(operation==='publication-selection'||operation==='publication-references')return (operation==='publication-selection'?publicationSelection:publicationReferences)(workspace,data,{signal});
  if(operation.startsWith('publication-jobs/')){
   const method=operation.slice(17);
   if(method==='start'){const job=await releases.start({...data,blockedValues},queue);worker.wake();return {job:jobSummary(job)};}
   if(method==='list'){const page=await releases.page(queue,data);return {...page,items:page.items.map(item=>({...item,job:jobSummary(item.job)}))};}
   if(method==='open'){const value=await retained(data.id);return {...this.summary(releases,value),analysisReview:await new AnalysisPublicationReview(workspace,{sourceReader}).status(value),stale:!await publicationRevisionCurrent(workspace,value)||value.configEtag!==(await publisher.read()).etag};}
   if(method==='rollback-review'){const value=await retained(data.id),owner=new PublicationRollback(workspace,publisher,{sourceReader}),approval=await owner.review(data),reviewed=owner.project(value,approval.review);return {...this.summary(releases,reviewed),destination:approval.destination,configEtag:approval.configEtag,rollback:approval.review,analysisReview:await new AnalysisPublicationReview(workspace,{sourceReader}).status(reviewed),stale:false};}
   if(method==='analysis-review')return new AnalysisPublicationReview(workspace,{sourceReader}).save(await rollback(await retained(data.id)),data.decisions);
   return {job:await control('publication.prepare',method)};
  }
  if(operation.startsWith('deployment-jobs/')){
   const method=operation.slice(16),deployments=new DeploymentJobs(workspace,publisher,queue,{sourceReader,sourceAccess:this.entry.sourceAccess});
   if(method==='start'){const job=await deployments.start(data);worker.wake();return {job:jobSummary(job)};}
   if(method==='list'){const page=await deployments.page(data);return {...page,items:page.items.map(item=>({...item,job:jobSummary(item.job)}))};}
   const job=await control('publication.deploy',method);return method==='status'?{...deployments.summary(await deployments.read(data.id)),job}:{job};
  }
  if(operation.startsWith('repository-setup/')){
   const method=operation.slice(17),setup=new GithubRepositorySetup(workspace,publisher,queue);
   if(['start','initialize'].includes(method)){const job=await setup[method](data);worker.wake();return {job:jobSummary(job)};}
   if(method==='review')return setup.review(data);if(method==='current')return {job:jobSummary(await setup.current())};return {job:await control('publication.repository',method)};
  }
  const githubIdle=async()=>{if(await baseQueue.hasActive(['publication.deploy','publication.repository']))throw new AppError('GITHUB_PUBLICATION_BUSY');};
  if(operation.startsWith('github-connection/')){
   const method=operation.slice(18),connection=publisher.connection;
   if(!connection){if(method==='status')return {available:false,accounts:[],selected:null,connected:false,signIn:null,error:null};throw new AppError('GITHUB_HELPER_MISSING');}
   if(method==='status')return connection.status();if(method==='cancel')return connection.cancel();await githubIdle();
   if(method==='start'){if(headless)throw new AppError('GITHUB_BROWSER_UNAVAILABLE');publisher.token=null;return connection.start();}
   if(method==='choose'){publisher.token=null;return connection.choose(data.login);}if(method==='disconnect'){publisher.token=null;return connection.disconnect({forget:data.forget===true});}
   throw new AppError('INVALID');
  }
  if(operation==='publishing')return publisher.read();
  const method=operation.slice(11);
  if(method==='save')return publisher.save(data.config,data.etag);
  if(method==='connect'){await githubIdle();await publisher.connection?.cancel();return publisher.connect(data.token);}
  if(method==='disconnect'){await githubIdle();publisher.token=null;return publisher.read();}
  if(method==='check')return publisher.check({reviewExisting:true});
  if(method==='plan'){const value=await retained(data.id);if(data.rollbackReview)await new PublicationRollback(workspace,publisher,{sourceReader}).authorize(value,data.rollbackReview);else if(value.configEtag!==data.configEtag||!await publicationRevisionCurrent(workspace,value))throw new AppError('PUBLISH_STALE');return publisher.reviewDestination(value,data.configEtag,{signal});}
  if(['verify','verification','verification-cancel','verification-retry'].includes(method)){
   const checks=new PublicationVerificationJobs(workspace,publisher,queue);
   if(method==='verify'){const job=await checks.start(data);worker.wake();return {job:jobSummary(job)};}
   const job=await checks.current();if(method==='verification')return {job:jobSummary(job),receipt:(await publisher.read()).receipt};
   if(!job||job.id!==data.id)throw new AppError('PUBLISH_STALE');return {job:await control('publication.verify',method==='verification-cancel'?'cancel':'retry')};
  }
  if(method==='deploy'){const value=await rollback(await retained(data.id));if(data.reviewed!==true||!data.rollbackReview&&value.configEtag!==data.configEtag)throw new AppError('PUBLISH_STALE');await new AnalysisPublicationReview(workspace,{sourceReader}).assert(value);const job=await new DeploymentJobs(workspace,publisher,queue,{sourceReader,sourceAccess:this.entry.sourceAccess}).start(data);worker.wake();return {job:jobSummary(job)};}
  throw new AppError('NOT_FOUND');
 }
}
