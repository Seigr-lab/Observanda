import {validatePublicationPages} from './publication-input-pages.js';
import {publicationWorkspace,validWebsitePin,retainedWebsitePin} from './publication-pin.js';
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
import {selectedContent} from './web/website-model.js';
import {researchId} from './web/research-reference.js';
import {Publisher} from './publishing.js';
import {verifyPublication,verifyPublicationManifest} from './publication.js';
import {retainPublicationInput,publicationDescriptor,removePublicationInput} from './publication-input.js';
import {buildPublicationEdition} from './publication-edition.js';
import {assertPublicFiles,admitRetainedPublicFile} from './privacy.js';
import {FileContent,writeContent,contentStream,contentBuffer,contentSize,contentHash} from './file-content.js';
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const inputFile=id=>{if(!researchId(id))throw new AppError('INVALID');return '.observanda/release-inputs/'+id+'.json';};
const candidateFile=id=>{if(!hash(id))throw new AppError('INVALID');return '.observanda/release-candidates/'+id+'.json';};
export class PublicationJobs{
 constructor(workspace,{sources,sourceReader}={}){workspace=publicationWorkspace(workspace);if(sources!==undefined&&!validPublicationSources(sources))throw new AppError('INVALID');this.workspace=workspace;this.sources=sources===undefined?undefined:structuredClone(sources);this.sourceReader=sourceReader;this.feed=new MetadataFeed(workspace,'.observanda/release-list');}
 async pin({etag,websitePin,websiteDraft,book,workspaceId,draft:command,edition,blockedValues=[]},{signal,workspace=this.workspace,id=randomUUID()}={}){
   let capturedPin;
   const input=await publicationSource(workspace,{etag,websitePin,websiteDraft,book,workspaceId,draft:command},{signal,consume:async(metadata,records,options)=>{capturedPin=options.websitePin;const sources=this.sources??metadata.website.researchSources??[];if(!validPublicationSources(sources))throw new AppError('INVALID');const input=await retainPublicationInput(workspace,id,metadata,records,{...options,signal,sourceReader:this.sourceReader,edition,deferFinalization:!!sources.length});return sources.length?retainPublicationSources(workspace,id,input,sources,await this.sourceReader?.({signal}),{signal,sourceReader:this.sourceReader}):input;}});
   const destination=await new Publisher(workspace.root,{workspace},workspace.vault).read();
   const source={version:input.pageInputs?4:3,id,reviewId:digest(id),workspaceId:input.metadata.id,websiteId:capturedPin.websiteId,websitePin:capturedPin,createdAt:new Date().toISOString(),etag:capturedPin.researchSnapshotId,...input,blockedValues,
    configEtag:destination.etag,destination:destination.configured?destination.config:null};
   signal?.throwIfAborted();
   await workspace.writeMetadata(inputFile(id),serialize(source));
   return source;
 }
 async start(command,queue){
  return withPublicationCapture(this.workspace,async(workspace,id,finish)=>{
   const source=await this.pin(command,{workspace,id});
   return finish(async()=>{
    await this.feed.ensureLocked();
    await this.workspace.writeMetadata('.observanda/release-list/'+id+'.json',serialize({id,reviewId:source.reviewId,createdAt:source.createdAt,summary:source.summary}));
    await this.feed.putLocked(source);
    return queue.enqueueLocked({id,type:'publication.prepare',scope:source.workspaceId,input:{revision:digest(serialize(source))}});
   });
  },{write:fn=>queue.transaction(fn)});
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
  }finally{await this.clean(source.id,{only:job.lease.token});if(!committed)await this.workspace.withLock(()=>removePublicationInput(this.workspace,source.id));}
 }
 async source(id){const raw=await this.workspace.readMetadata(inputFile(id),16*1024*1024);if(raw===null)throw new AppError('NOT_FOUND');const s=JSON.parse(raw);if(![1,2,3,4].includes(s.version)||s.id!==id||s.reviewId!==digest(id)||!researchId(s.workspaceId)||(s.websiteId??null)!==(this.workspace.websiteId??null)||(s.version===1?s.book?.id:s.metadata?.id)!==s.workspaceId||s.version>=2&&(!Array.isArray(s.records)||s.records.some(r=>!researchId(r.id)||!hash(r.sha256)||!hash(r.revision)))||s.version>=3&&(!validWebsitePin(s.websitePin)||s.websitePin.websiteId!==s.websiteId||s.websitePin.researchSnapshotId!==s.etag))throw new AppError('JOB_DAMAGED');validatePublicationPages(s);return s;}
 async authorize(job){await this.workspace.requireStorageKey();const s=await this.source(job.id);if(job.scope!==s.workspaceId||job.input.revision!==digest(serialize(s)))throw new AppError('JOB_CHANGED');}
 async directory(id,attempt){if(!researchId(id)||attempt!==undefined&&!researchId(attempt))throw new AppError('INVALID');return privateDirectory(this.workspace.root,'.observanda/releases/'+id+(attempt?'/'+attempt:''));}
 async prepare(job,{signal,progress}){
  const source=await this.source(job.id),blockedValues=[...source.blockedValues,this.workspace.root,os.homedir(),os.hostname()].filter(Boolean);
  if(source.version===1){const {entries,...metadata}=source.book;void entries;source.metadata=metadata;source.records=selectedContent(source.book).entries.map(record=>publicationDescriptor(record,metadata));}
  const websitePin=await retainedWebsitePin(this.workspace,source);
  const directory=await this.directory(job.id,job.lease.token),files=[];
  const candidate=await buildPublicationEdition(this.workspace,source,{blockedValues,signal,progress,retain:async(name,content)=>{
   assertPublicFiles(new Map([[name,content]]),blockedValues);
   signal.throwIfAborted();const index=files.length,type=content instanceof FileContent?(isDownloadPath(name)?'binary':'media'):typeof content==='string'?'text':'binary';
   const saved=await writeContent(this.workspace,path.join(directory,index+'.blob'),contentStream(content),{signal});
   if(saved.size!==contentSize(content)||saved.sha256!==contentHash(content))throw new AppError('STALE');
   files.push({name,index,...saved,type,...(type==='media'?{header:content.header.toString('hex')}: {})});
  }});
  return {version:2,jobId:job.id,attempt:job.lease.token,reviewId:source.reviewId,websiteId:websitePin.websiteId,websitePin,id:candidate.id,etag:source.etag,createdAt:source.createdAt,
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
  if(!stored||![1,2].includes(stored.version)||(stored.websiteId??null)!==(this.workspace.websiteId??null)||stored.version===2&&(!validWebsitePin(stored.websitePin)||stored.websitePin.websiteId!==stored.websiteId||stored.websitePin.researchSnapshotId!==stored.etag)||stored.reviewId!==id||!researchId(stored.jobId)||!researchId(stored.attempt)||!hash(stored.id)||!Array.isArray(stored.files))throw new AppError('JOB_DAMAGED');
  return stored;
 }
 async *contents(stored,options){const {projectPublicationContents}=await import('./project-publication-content.js');yield* projectPublicationContents(this.workspace,stored,options);}
 async verifyFiles(id){
  try{
  const stored=await this.stored(id);if(!stored)throw new AppError('JOB_DAMAGED');
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
 async read(id){
  const stored=await this.stored(id);if(!stored)return null;
  const files=new Map(),blockedValues=[...stored.blockedValues,this.workspace.root,os.homedir(),os.hostname()];
  for await(const {file:f,content} of this.contents(stored)){
   if(f.name==='publication.json')files.set(f.name,(await contentBuffer(content)).toString('utf8'));
   else if(f.type==='media'){await content.verify();files.set(f.name,content);}
   else files.set(f.name,await admitRetainedPublicFile(f.name,content,{type:f.type,blockedValues}));
  }
  const candidate={...stored,files,blockedValues};verifyPublication(candidate);return candidate;
 }
 summary(c){return {id:c.reviewId,releaseId:c.id,...(c.websitePin?{websitePin:c.websitePin}:{}),createdAt:c.createdAt,summary:c.summary,researchReview:c.researchReview,configEtag:c.configEtag,destination:c.destination,entries:c.entries,projects:c.projects,pages:c.pages,files:[...c.files.keys()],url:'/preview/'+c.reviewId+'/'+c.defaultPage};}
 async page(queue,options){
  await this.feed.ensure();
  return this.workspace.catalogue(async()=>{
   const page=await this.feed.page(options),items=[];
   for(const entry of page.items){const s=JSON.parse(await this.workspace.readMetadata('.observanda/release-list/'+entry.id+'.json',8192)),job=await queue.read(entry.id);if(s.id!==entry.id||!job&&!s.synchronous)throw new AppError('JOB_DAMAGED');if(!job)continue;items.push({id:s.id,reviewId:s.reviewId,createdAt:s.createdAt,summary:s.summary,job});}
   return {items,next:page.next};
  });
 }
 async clean(id,{only}={}){
  const source=await this.source(id),raw=await this.workspace.readMetadata(candidateFile(source.reviewId),16*1024*1024),retained=raw?JSON.parse(raw).attempt:null,directory=await this.directory(id);
  for(const attempt of await readdir(directory)){
   if(!researchId(attempt)||attempt===retained||only&&attempt!==only)continue;
   const target=path.join(directory,attempt);await assertRegular(target,{directory:true});await rm(target,{recursive:true,force:true});
  }
 }
}
export function publicationJobDefinitions(workspace,queue){const releases=new PublicationJobs(workspace);return {'publication.prepare':{
 authorize:job=>releases.authorize(job),
 prepare:async(job,options)=>{await queue().transaction(async()=>{await queue().held(job.id,job.lease.token);await releases.clean(job.id);});return releases.prepare(job,options);},
 commit:(job,candidate)=>releases.commit(job,candidate),discard:job=>releases.clean(job.id,{only:job.lease.token})
}};}
