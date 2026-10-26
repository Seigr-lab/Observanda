import {withWebsiteSourceSelections} from './website-source-selections.js';
import {publicationEditionChoices} from './publication-edition-selections.js';
import {isPublicationDocumentBlockName} from './publication-document.js';
import {withWorkspaceMetadataBatch} from './metadata-batch.js';
import {withPublicationOutputWriter} from './publication-output.js';
import {RetainedPublicationFiles} from './retained-publication-files.js';
import {openPublicationInput} from './publication-input-reader.js';
import {validatePublicationPresentation} from './publication-input-presentation.js';
import {validatePublicationPages} from './publication-input-pages.js';
import {publicationWorkspace,publicationResearchWorkspace,validWebsitePin,retainedWebsitePin} from './publication-pin.js';
import {withPublicationCapture} from './publication-capture.js';
import {retainPublicationSources} from './publication-source-input.js';
import {validPublicationSources} from './web/publication-sources-model.js';
import {isDownloadPath} from './web/website-file.js';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {readdir,rm} from 'node:fs/promises';
import {AppError} from './errors.js';
import {MetadataFeed} from './metadata-feed.js';
import {digest,serialize,privateDirectory,assertRegular} from './storage.js';
import {publicationSource} from './publication-source.js';
import {assertPublicationSourcePermissions} from './publication-permission-admission.js';
import {SOURCE_PUBLICATION_VERSION} from './web/source-publication-permissions.js';
import {selectedContent} from './web/website-model.js';
import {researchId} from './web/research-reference.js';
import {Publisher} from './publishing.js';
import {verifyPublication,verifyPublicationManifest} from './publication.js';
import {retainPublicationInput,publicationDescriptor,removePublicationInput} from './publication-input.js';
import {buildPublicationEdition} from './publication-edition.js';
import {assertPublicFiles,admitRetainedPublicFile} from './privacy.js';
import {FileContent,writeContent,contentStream,contentBuffer,contentSize,contentHash} from './file-content.js';
const permissionHeads=new WeakMap();
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const inputFile=id=>{if(!researchId(id))throw new AppError('INVALID');return '.observanda/release-inputs/'+id+'.json';};
const candidateFile=id=>{if(!hash(id))throw new AppError('INVALID');return '.observanda/release-candidates/'+id+'.json';};
export class PublicationJobs{
 constructor(workspace,{sources,sourceReader,sourceAccess}={}){workspace=publicationWorkspace(workspace);if(sources!==undefined&&!validPublicationSources(sources))throw new AppError('INVALID');this.workspace=workspace;this.sources=sources===undefined?undefined:structuredClone(sources);this.sourceReader=sourceReader;this.sourceAccess=sourceAccess;this.feed=new MetadataFeed(workspace,'.observanda/release-list');}
 async pin({etag,websitePin,websiteDraft,book,workspaceId,draft:command,edition,blockedValues=[]},{signal,workspace=this.workspace,id=randomUUID()}={}){
   const editionChoices=await publicationEditionChoices(workspace,edition,{source:{workspaceId,etag,websitePin,...(websiteDraft===undefined?{}:{websiteDraft})},signal});
   let capturedPin;
   const input=await publicationSource(workspace,{etag,websitePin,websiteDraft,book,workspaceId,draft:command},{signal,consume:async(metadata,records,options)=>{
    capturedPin=options.websitePin;
    const capture=async sources=>{
     const count=Array.isArray(sources)?sources.length:sources.count;
     if(Array.isArray(sources)&&!validPublicationSources(sources))throw new AppError('INVALID');
     const input=await retainPublicationInput(workspace,id,metadata,records,{...options,signal,sourceReader:this.sourceReader,edition,editionChoices,hasSources:count>0,deferFinalization:count>0});
     return count?retainPublicationSources(workspace,id,input,sources,await this.sourceReader?.({signal}),{signal,sourceReader:this.sourceReader}):input;
    };
    if(this.sources===undefined&&options.websiteSourcesDocument)return withWebsiteSourceSelections(options.websiteSourcesDocument,capture,{signal});
    return capture(this.sources??metadata.website.researchSources??[]);
   }});
   const destination=await new Publisher(workspace.root,{workspace},workspace.vault).read();
   const source={sourcePermissionVersion:SOURCE_PUBLICATION_VERSION,version:input.document?6:input.layoutInputs?5:input.pageInputs?4:3,id,reviewId:digest(id),workspaceId:input.metadata.id,websiteId:capturedPin.websiteId,websitePin:capturedPin,createdAt:new Date().toISOString(),etag:capturedPin.researchSnapshotId,...input,blockedValues,
    configEtag:destination.etag,destination:destination.configured?destination.config:null};
   signal?.throwIfAborted();
   await workspace.writeMetadata(inputFile(id),serialize(source));
   return source;
 }
 async start(command,queue){
  let revoke;
  try{return await withPublicationCapture(this.workspace,async(workspace,id,finish)=>{
   const source=await this.pin(command,{workspace,id});
   return finish(async()=>{
    await this.feed.ensureLocked();
    await this.workspace.writeMetadata('.observanda/release-list/'+id+'.json',serialize({id,reviewId:source.reviewId,createdAt:source.createdAt,summary:source.summary}));
    await this.feed.putLocked(source);
    if(source.hasSources||source.sourceGroups)revoke=this.sourceAccess?.bind(id,this.sourceReader);
    return queue.enqueueLocked({id,type:'publication.prepare',scope:source.workspaceId,input:{revision:digest(serialize(source))}});
   });
  },{write:fn=>queue.transaction(fn)});}catch(error){revoke?.();throw error;}
 }
 async control(queue,id,action){
  const job=await queue.read(id);if(!job||job.type!=='publication.prepare')throw new AppError('NOT_FOUND');await queue.authorize(job);
  if(!['cancel','retry'].includes(action))throw new AppError('INVALID');
  if(action==='retry'&&!['failed','cancelled'].includes(job.state))throw new AppError('JOB_CHANGED');
  let revoke;this.sourceAccess?.forget(id);
  try{
   if(action==='retry'){
    const source=await this.source(id);await assertPublicationSourcePermissions(this.workspace,source,{sourceReader:this.sourceReader});
    if(source.hasSources||source.sourceGroups)revoke=this.sourceAccess?.bind(id,this.sourceReader);
   }
   return await queue.control(id,action);
  }catch(error){revoke?.();throw error;}
 }
 // Compatibility callers wait for their reply, but use the same pinned input,
 // page renderer and retained-file reader as durable background preparations.
 async inline(command,{signal}={}){
  signal??=new AbortController().signal;
  const source=await withPublicationCapture(this.workspace,async(workspace,id,finish)=>{const source=await this.pin(command,{signal,workspace,id});return finish(()=>source);},{signal}),job={id:source.id,lease:{token:randomUUID()}};
  let committed=false;
  try{
   const candidate=await this.prepare(job,{signal,progress:async()=>{}});signal.throwIfAborted();
   await this.workspace.withLock(async()=>{signal.throwIfAborted();await this.commit(job,candidate);});committed=true;
   return this.read(source.reviewId);
  }finally{
   const cleanup=async()=>{await this.clean(source.id,{only:job.lease.token});if(!committed)await this.workspace.withLock(()=>withWorkspaceMetadataBatch(this.workspace,()=>removePublicationInput(this.workspace,source.id)));};
   if(await this.workspace.storageKind()==='catalogue')await publicationResearchWorkspace(this.workspace).withCatalogueConnections(cleanup);else await cleanup();
  }
 }
 async source(id){
  // Validate the immutable source in one owned read snapshot. Reuse an
  // existing enqueue/worker transaction instead of opening one per node.
  const read=async()=>{const raw=await this.workspace.readMetadata(inputFile(id),16*1024*1024);if(raw===null)throw new AppError('NOT_FOUND');const s=JSON.parse(raw);if(![1,2,3,4,5,6].includes(s.version)||s.id!==id||s.reviewId!==digest(id)||!researchId(s.workspaceId)||(s.websiteId??null)!==(this.workspace.websiteId??null)||(s.version===1?s.book?.id:s.metadata?.id)!==s.workspaceId||s.version>=2&&s.version<6&&(!Array.isArray(s.records)||s.records.some(r=>!researchId(r.id)||!hash(r.sha256)||!hash(r.revision)))||s.version>=3&&(!validWebsitePin(s.websitePin)||s.websitePin.websiteId!==s.websiteId||s.websitePin.researchSnapshotId!==s.etag))throw new AppError('JOB_DAMAGED');if(s.version===6)await openPublicationInput(this.workspace,s);else{validatePublicationPages(s);validatePublicationPresentation(s);}return s;};
  return await this.workspace.storageKind()==='catalogue'?this.workspace.catalogue(read):read();
 }
 async authorize(job){await this.workspace.requireStorageKey();const s=await this.source(job.id);if(job.scope!==s.workspaceId||job.input.revision!==digest(serialize(s)))throw new AppError('JOB_CHANGED');}
 async directory(id,attempt){if(!researchId(id)||attempt!==undefined&&!researchId(attempt))throw new AppError('INVALID');return privateDirectory(this.workspace.root,'.observanda/releases/'+id+(attempt?'/'+attempt:''));}
 async prepare(job,{signal,progress,write}){
  const source=await this.source(job.id);await assertPublicationSourcePermissions(this.workspace,source,{sourceReader:this.sourceReader,signal});
  const blockedValues=[...source.blockedValues,this.workspace.root,os.homedir(),os.hostname()].filter(Boolean);
  if(source.version===1){const {entries,...metadata}=source.book;void entries;source.metadata=metadata;source.records=selectedContent(source.book).entries.map(record=>publicationDescriptor(record,metadata));}
  const websitePin=await retainedWebsitePin(this.workspace,source);
  const directory=await this.directory(job.id,job.lease.token),files=[];
  if(source.version===6){
   return withPublicationOutputWriter(this.workspace,source,job,{directory,signal,write,blockedValues},async writer=>{
   const rendered=await buildPublicationEdition(this.workspace,source,{writer,blockedValues,signal,progress});
   const candidate=await writer.finish({defaultPage:rendered.defaultPage});
   return {sourcePermissionVersion:SOURCE_PUBLICATION_VERSION,version:3,workspaceId:source.workspaceId,jobId:job.id,attempt:job.lease.token,reviewId:source.reviewId,websiteId:websitePin.websiteId,websitePin,...candidate,etag:source.etag,createdAt:source.createdAt,
    source:{jobId:source.id,document:source.document},hasSources:!!source.hasSources,blockedValues,summary:source.summary,researchReview:source.researchReview,configEtag:source.configEtag,destination:source.destination};
   });
  }
  const candidate=await buildPublicationEdition(this.workspace,source,{blockedValues,signal,progress,retain:async(name,content)=>{
   assertPublicFiles(new Map([[name,content]]),blockedValues);
   signal.throwIfAborted();const index=files.length,type=content instanceof FileContent?(isDownloadPath(name)?'binary':'media'):typeof content==='string'?'text':'binary';
   const saved=await writeContent(this.workspace,path.join(directory,index+'.blob'),contentStream(content),{signal});
   if(saved.size!==contentSize(content)||saved.sha256!==contentHash(content))throw new AppError('STALE');
   files.push({name,index,...saved,type,...(type==='media'?{header:content.header.toString('hex')}: {})});
  }});
  return {sourcePermissionVersion:SOURCE_PUBLICATION_VERSION,version:2,jobId:job.id,attempt:job.lease.token,reviewId:source.reviewId,websiteId:websitePin.websiteId,websitePin,id:candidate.id,etag:source.etag,createdAt:source.createdAt,
   files,pages:candidate.pages,entries:candidate.entries,projects:candidate.projects,defaultPage:candidate.defaultPage,blockedValues,
   sourceRevisions:source.sourceRevisions,sourceMaterials:source.sourceMaterials,...(source.sourceGroups?{workspaceId:source.workspaceId,sourceGroups:source.sourceGroups,sourceSnapshots:source.sourceSnapshots}:{}),summary:source.summary,researchReview:source.researchReview,configEtag:source.configEtag,destination:source.destination};
 }
 async commit(job,candidate){
  if(candidate.jobId!==job.id||candidate.attempt!==job.lease.token||candidate.reviewId!==digest(job.id))throw new AppError('JOB_CHANGED');
  await this.workspace.writeMetadata(candidateFile(candidate.reviewId),serialize(candidate));
  // Synchronous preparation also yields a selectable edition, even without a
  // durable job. The shared list must describe every completed preparation.
  await this.feed.ensureLocked();const entry={id:job.id,reviewId:candidate.reviewId,createdAt:candidate.createdAt,summary:candidate.summary,...(!job.type?{synchronous:true}:{})};
  await this.workspace.writeMetadata('.observanda/release-list/'+job.id+'.json',serialize(entry));await this.feed.putLocked(entry);
  if(this.workspace.websiteId)await this.workspace.writeMetadata('.observanda/website-editions/'+candidate.reviewId+'.json',serialize({websiteId:this.workspace.websiteId}));return {id:candidate.reviewId};
 }
 async stored(id){
  const raw=await this.workspace.readMetadata(candidateFile(id),16*1024*1024);if(raw===null)return null;let stored;
  try{stored=JSON.parse(raw);}catch{throw new AppError('JOB_DAMAGED');}
  if(!stored||![1,2,3].includes(stored.version)||(stored.websiteId??null)!==(this.workspace.websiteId??null)||stored.version>=2&&(!validWebsitePin(stored.websitePin)||stored.websitePin.websiteId!==stored.websiteId||stored.websitePin.researchSnapshotId!==stored.etag)||stored.reviewId!==id||!researchId(stored.jobId)||!researchId(stored.attempt)||!hash(stored.id)||stored.version<3&&!Array.isArray(stored.files)||stored.version===3&&(!researchId(stored.workspaceId)||stored.source?.jobId!==stored.jobId))throw new AppError('JOB_DAMAGED');
  return stored;
 }
 async *contents(stored,options){const {projectPublicationContents}=await import('./project-publication-content.js');yield* projectPublicationContents(this.workspace,stored,options);}
 async verifyFiles(id){
  try{
  const stored=await this.stored(id);if(!stored)throw new AppError('JOB_DAMAGED');
  if(stored.version===3){const files=await RetainedPublicationFiles.open(this.workspace,stored);await files.verify({privacy:false});return;}
  // Restore verifies each retained blob without buffering a whole website or
  // rebuilding it from today's records, theme or renderer.
  const files=new Map();
  for await(const {file,content} of this.contents(stored)){
   await content.verify();files.set(file.name,file.name==='publication.json'?(await contentBuffer(content)).toString('utf8'):content);
  }
  if(!files.has('publication.json'))throw new AppError('JOB_DAMAGED');
  verifyPublicationManifest({...stored,files});
  }catch(error){if(error.code==='ENOENT')throw new AppError('JOB_DAMAGED');throw error;}
 }
 async assertSourcePermissions(candidate,{signal}={}){
  if(candidate.sourcePermissionVersion!==SOURCE_PUBLICATION_VERSION)throw new AppError('PUBLICATION_PERMISSIONS_CHANGED');
  let checkedSnapshots=permissionHeads.get(candidate);if(!checkedSnapshots){checkedSnapshots=new Map();permissionHeads.set(candidate,checkedSnapshots);}
  await assertPublicationSourcePermissions(this.workspace,await this.source(candidate.jobId),{sourceReader:this.sourceReader,signal,checkedSnapshots});
 }
 async read(id){
  const stored=await this.stored(id);if(!stored)return null;
  await this.assertSourcePermissions(stored);return this.#readCandidate(stored);
 }
 // Only a persisted, still-active deployment with an uncertain activation can
 // inspect its retained edition for remote reconciliation. No review ID is
 // accepted here, and adapters must admit source consent before any new write.
 async readForDeploymentRecovery(deploymentId){
  if(!researchId(deploymentId))throw new AppError('INVALID');
  const read=async(file,limit)=>{const raw=await this.workspace.readMetadata(file,limit);if(raw===null)throw new AppError('JOB_DAMAGED');try{return JSON.parse(raw);}catch{throw new AppError('JOB_DAMAGED');}};
  const deployment=await read('.observanda/deployments/'+deploymentId+'.json',16*1024*1024),intent=deployment?.intent,journal=deployment?.journal;
  if(![1,2].includes(deployment?.version)||deployment.id!==deploymentId||!researchId(deployment.scope)||!hash(intent?.reviewId)||!hash(intent?.releaseId)||!hash(intent?.key)||journal?.pushAttempted!==true||!['github','ssh'].includes(intent?.config?.kind))throw new AppError('JOB_DAMAGED');
  if(intent.config.kind==='github'?!/^[a-f0-9]{40}$/.test(journal.commit??''):journal.commit!==intent.releaseId)throw new AppError('JOB_DAMAGED');
  const job=await read('.observanda/jobs/'+deploymentId+'.json',16*1024*1024),active=await read('.observanda/deployment-active/'+intent.key+'.json',4096);
  if(job?.format!==1||job.id!==deploymentId||job.type!=='publication.deploy'||job.scope!==deployment.scope||job.input?.revision!==digest(serialize(intent))||active?.id!==deploymentId)throw new AppError('JOB_CHANGED');
  if((await this.workspace.currentOutline()).metadata.id!==deployment.scope)throw new AppError('WORKSPACE_CHANGED');
  const stored=await this.stored(intent.reviewId);
  if(!stored||stored.id!==intent.releaseId)throw new AppError('JOB_DAMAGED');
  // Older retained database editions bind their owner through captured input.
  const scope=stored.workspaceId??(stored.version<3?(await this.source(stored.jobId)).workspaceId:undefined);
  if(scope!==deployment.scope)throw new AppError('JOB_DAMAGED');
  return this.#readCandidate(stored);
 }
 async #readCandidate(stored){
  const files=new Map(),blockedValues=[...stored.blockedValues,this.workspace.root,os.homedir(),os.hostname()];
  if(stored.version===3)return {...stored,files:await RetainedPublicationFiles.open(this.workspace,stored,{blockedValues}),blockedValues};
  for await(const {file:f,content} of this.contents(stored)){
   if(f.name==='publication.json')files.set(f.name,(await contentBuffer(content)).toString('utf8'));
   else if(f.type==='media'){await content.verify();files.set(f.name,content);}
   else files.set(f.name,await admitRetainedPublicFile(f.name,content,{type:f.type,blockedValues}));
  }
  const candidate={...stored,files,blockedValues};verifyPublication(candidate);return candidate;
 }
 async pageChoices(candidate,{offset=0,cursor=null,limit=32,path,signal}={}){
  if(!(candidate.files instanceof RetainedPublicationFiles)){
   const pages=candidate.pages??[],at=path?pages.findIndex(page=>page.path===path):offset;
   if(cursor!==null||!Number.isSafeInteger(at)||at<0||!Number.isSafeInteger(limit)||limit<1||limit>128)throw new AppError('INVALID');
   return {items:pages.slice(at,at+limit),offset:at,total:pages.length,next:null};
  }
  const output=candidate.files.output;
  if(path){const at=await output.position('pages',path,{signal});if(at===null)throw new AppError('NOT_FOUND');offset=at;cursor=null;}
  const page=await output.window('pages',{offset,cursor,limit,signal});return {...page,items:page.items.map(row=>row.value)};
 }
 async referenceChoices(candidate,options={}){
  if(candidate.version<3){const items=candidate.researchReview?.references?.items??[],offset=options.offset??0,limit=options.limit??32;if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>128)throw new AppError('INVALID');return {items:items.slice(offset,offset+limit),offset,total:items.length,next:null};}
  const source=await this.source(candidate.jobId),input=await openPublicationInput(this.workspace,source,{signal:options.signal});return input.window('referenceReviews',options);
 }
 async summary(c){
  const common={id:c.reviewId,releaseId:c.id,...(c.websitePin?{websitePin:c.websitePin}:{}),createdAt:c.createdAt,summary:c.summary,researchReview:c.researchReview,configEtag:c.configEtag,destination:c.destination,url:'/preview/'+c.reviewId+'/'+c.defaultPage};
  if(c.version!==3)return {...common,entries:c.entries,projects:c.projects,pages:c.pages,files:[...c.files.keys()]};
  const pagesWindow=await this.pageChoices(c),referenceReviewsWindow=await this.referenceChoices(c,{limit:16});
  return {...common,pages:pagesWindow.items,pagesWindow,referenceReviewsWindow,fileCount:c.files.size,entryCount:c.files.output.count('entries'),projectCount:c.files.output.count('projects')};
 }
 async page(queue,options){
  await this.feed.ensure();
  return this.workspace.catalogue(async()=>{
   const page=await this.feed.page(options),items=[];
   for(const entry of page.items){const s=JSON.parse(await this.workspace.readMetadata('.observanda/release-list/'+entry.id+'.json',8192)),job=await queue.read(entry.id);if(s.id!==entry.id||!job&&!s.synchronous)throw new AppError('JOB_DAMAGED');if(!job)continue;items.push({id:s.id,reviewId:s.reviewId,createdAt:s.createdAt,summary:s.summary,job});}
   return {items,next:page.next};
  });
 }
 async clean(id,{only,write=operation=>this.workspace.withLock(()=>withWorkspaceMetadataBatch(this.workspace,operation))}={}){
  if(!researchId(id)||only!==undefined&&!researchId(only))throw new AppError('INVALID');
  const source=await this.source(id),retained=async()=>{const raw=await this.workspace.readMetadata(candidateFile(source.reviewId),16*1024*1024);return raw?JSON.parse(raw).attempt:null;},directory=await this.directory(id),prefix='.observanda/release-outputs/'+id;
  for(const attempt of await readdir(directory)){
   if(!researchId(attempt)||only&&attempt!==only)continue;
   await write(async()=>{if(attempt===await retained())return;const target=path.join(directory,attempt);await assertRegular(target,{directory:true});await rm(target,{recursive:true,force:true});});
  }
  // Failed attempts can leave immutable nodes even when no blob completed.
  // Delete bounded batches while rechecking the committed attempt identity.
  for await(const attempt of this.workspace.metadataNames(prefix)){
   if(!researchId(attempt))throw new AppError('JOB_DAMAGED');if(only&&attempt!==only)continue;
   for(;;){const removed=await write(async()=>{
    if(attempt===await retained())return 0;const names=[];
    for await(const name of this.workspace.metadataNames(prefix+'/'+attempt)){if(!isPublicationDocumentBlockName(name))throw new AppError('JOB_DAMAGED');names.push(name);if(names.length===32)break;}
    for(const name of names)await this.workspace.removeMetadata(prefix+'/'+attempt+'/'+name);return names.length;
   });if(!removed)break;}
  }
 }

}
export function publicationJobDefinitions(workspace,queue,{sourceAccess}={}){const releases=new PublicationJobs(workspace);return {'publication.prepare':{
 authorize:job=>releases.authorize(job),
 prepare:async(job,options)=>{const sourceReader=sourceAccess?.take(job.id),prepared=new PublicationJobs(workspace,{sourceReader}),write=options.write??(operation=>queue().transaction(async()=>{await queue().held(job.id,job.lease.token);return withWorkspaceMetadataBatch(workspace,operation);}));await releases.clean(job.id,{write});return prepared.prepare(job,{...options,write});},
 commit:(job,candidate)=>releases.commit(job,candidate),discard:job=>releases.clean(job.id,{only:job.lease.token})
}};}
