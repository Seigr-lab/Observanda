import {publicationWorkspace} from './publication-pin.js';
import {publicationRevisionCurrent} from './publication-freshness.js';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {unlink} from 'node:fs/promises';
import {AppError} from './errors.js';
import {digest,serialize} from './storage.js';
import {PublicationJobs} from './publication-jobs.js';
import {AnalysisPublicationReview} from './analysis-publication-review.js';
import {verifyPublicationCandidate} from './retained-publication-files.js';
import {contentHash,contentSize} from './file-content.js';
import {researchId} from './web/research-reference.js';
import {destinationDirectory,within,outputName,memberPath,fingerprint,sameFile,stageFiles,checkOriginals,applyFiles,cleanFiles,temporary,regular} from './local-export-files.js';
import {LocalExportManifest,emptyExportCounts,validExportCounts,validateExportMember} from './local-export-manifest.js';
import {withWorkspaceMetadataBatch} from './metadata-batch.js';

const folder='.observanda/local-exports/';
const planFile=id=>{if(!researchId(id))throw new AppError('INVALID');return folder+id+'.json';};
const directoryKey=directory=>process.platform==='win32'?directory.toLowerCase():directory;
const ownerFile=directory=>folder+'owners/'+digest(directoryKey(directory))+'.json';
const reviewFile=id=>{if(!/^[a-f0-9]{64}$/.test(id??''))throw new AppError('INVALID');return folder+'reviews/'+id+'.json';};
const states=['planned','staging','applying','completed','discarded'];
const limit=16*1024*1024;
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const storedDirectory=value=>typeof value==='string'&&(path.posix.isAbsolute(value)||path.win32.isAbsolute(value));
function checkMembers(files,changes=false){
 const seen=new Set();
 for(const f of files){
  if(!f||typeof f!=='object')throw new AppError('LOCAL_EXPORT_DAMAGED');
  outputName(f.path);if(seen.has(f.path.toLowerCase()))throw new AppError('LOCAL_EXPORT_DAMAGED');seen.add(f.path.toLowerCase());
  validateExportMember(f,changes?'changes':'files');
 }
}

export class LocalExport {
 constructor(workspace,{checkpoint=async()=>{},sourceReader}={}){workspace=publicationWorkspace(workspace);this.workspace=workspace;this.sourceReader=sourceReader;this.checkpoint=checkpoint;this.manifest=new LocalExportManifest(workspace);}
 async read(file){const raw=await this.workspace.readMetadata(file,limit);if(raw===null)return null;try{return JSON.parse(raw);}catch{throw new AppError('LOCAL_EXPORT_DAMAGED');}}
 async save(plan,owner){
  if(Buffer.byteLength(serialize(plan))>(plan.version===2?16384:limit))throw new AppError('LIMIT');
  await this.workspace.withLock(()=>withWorkspaceMetadataBatch(this.workspace,async()=>{
   await this.workspace.writeMetadata(planFile(plan.id),serialize(plan));
   if(owner)await this.workspace.writeMetadata(ownerFile(plan.directory),serialize(owner));
   await this.workspace.writeMetadata(reviewFile(plan.reviewId),serialize({id:plan.id}));
  }));
 }
 async directory(value){
  const directory=await destinationDirectory(value),workspace=await destinationDirectory(this.workspace.root),application=fileURLToPath(new URL('..',import.meta.url));
  if(within(workspace,directory)||within(directory,workspace)||within(application,directory)||within(directory,application)||path.resolve(os.homedir())===directory)throw new AppError('UNSAFE');
  return directory;
 }
 // A session lock lasts across short, separately durable journal transactions.
 // It is released by PostgreSQL on process failure, without a stale disk lock.
 async locked(directory,operation){
  const db=await this.workspace.openCatalogue({detached:true});
  try{if(!(await db.get('SELECT pg_catalog.pg_try_advisory_lock(pg_catalog.hashtextextended($1,0)) AS locked','local-export:'+directoryKey(directory))).locked)throw new AppError('LOCKED');return await operation();}
  finally{await db.close();}
 }
 async candidate(id,{fresh=false}={}){
  const candidate=await new PublicationJobs(this.workspace,{sourceReader:this.sourceReader}).read(id);if(!candidate)throw new AppError('NOT_FOUND');
  await verifyPublicationCandidate(candidate);await new AnalysisPublicationReview(this.workspace,{sourceReader:this.sourceReader}).assert(candidate);
  if(fresh&&!await publicationRevisionCurrent(this.workspace,candidate))throw new AppError('PUBLISH_STALE');
  return candidate;
 }
 async plan({reviewId,directory}){
  const candidate=await this.candidate(reviewId,{fresh:true});directory=await this.directory(directory);
  return this.locked(directory,async()=>{
   const owner=await this.read(ownerFile(directory))??{version:2,directory,files:{version:1,type:'files',root:null},pending:null};
   this.validateOwner(owner,directory);
   if(owner.pending){const prior=await this.get(owner.pending);if(prior.state!=='planned')return this.summary(prior);}
   let before=owner.files;
   if(owner.version===1){const builder=this.manifest.builder('files');for(const item of owner.files)await builder.append(item);before=await builder.finish();}
   const changes=this.manifest.builder('changes'),counts=emptyExportCounts();
   const add=async(name,previous,next)=>{
    const actual=await fingerprint(await memberPath(directory,name)),kind=!sameFile(actual,previous)?'conflict':sameFile(previous,next)?'unchanged':!previous?'added':!next?'removed':'replaced';
    await changes.append({path:name,kind,before:previous,after:next});counts[kind]++;
   };
   for await(const [name,content] of candidate.files){
    outputName(name);const previous=await this.manifest.find(before,name);
    // A case-only replacement cannot be represented as two independent owned
    // paths on every supported filesystem. Do not adopt either spelling.
    if(previous&&previous.path!==name)throw new AppError('UNSAFE');
    await add(name,previous?{bytes:previous.bytes,sha256:previous.sha256}:null,{bytes:contentSize(content),sha256:contentHash(content)});
   }
   for await(const previous of this.manifest.entries(before))if(!await candidate.files.has(previous.path))await add(previous.path,{bytes:previous.bytes,sha256:previous.sha256},null);
   const plan={version:2,id:randomUUID(),reviewId,releaseId:candidate.id,defaultPage:candidate.defaultPage,directory,state:'planned',createdAt:new Date().toISOString(),changes:await changes.finish(),counts,cleaned:false,applied:0};
   await this.save(plan,{...owner,version:2,files:before,pending:plan.id});return this.summary(plan);
  });
 }
 async get(id){
  const plan=await this.read(planFile(id));if(!plan)throw new AppError('NOT_FOUND');
  if(![1,2].includes(plan.version)||plan.id!==id||!states.includes(plan.state)||!hash(plan.reviewId)||!hash(plan.releaseId)||!storedDirectory(plan.directory)||typeof plan.cleaned!=='boolean'||!Number.isSafeInteger(plan.applied)||plan.applied<0)throw new AppError('LOCAL_EXPORT_DAMAGED');
  if(plan.version===1){if(!Array.isArray(plan.changes))throw new AppError('LOCAL_EXPORT_DAMAGED');checkMembers(plan.changes,true);}
  else{this.manifest.validate(plan.changes,'changes');if(!validExportCounts(plan.counts,this.total(plan)))throw new AppError('LOCAL_EXPORT_DAMAGED');}
  if(plan.applied>this.total(plan))throw new AppError('LOCAL_EXPORT_DAMAGED');outputName(plan.defaultPage);
  const entry=plan.version===1?plan.changes.find(c=>c.path===plan.defaultPage):await this.manifest.find(plan.changes,plan.defaultPage);
  if(!entry?.after||entry.path!==plan.defaultPage)throw new AppError('LOCAL_EXPORT_DAMAGED');
  return plan;
 }
 total(plan){return plan.version===1?plan.changes.length:plan.changes.root?.count??0;}
 changes(plan){return plan.version===1?plan.changes:this.manifest.entries(plan.changes);}
 counts(plan){if(plan.version===2)return plan.counts;const counts=emptyExportCounts();for(const item of plan.changes)counts[item.kind]++;return counts;}
 validateOwner(owner,directory){
  if(!owner||![1,2].includes(owner.version)||!storedDirectory(owner.directory)||owner.directory!==directory||owner.pending!==null&&!researchId(owner.pending)||owner.releaseId!==undefined&&!hash(owner.releaseId))throw new AppError('LOCAL_EXPORT_DAMAGED');
  if(owner.version===1){if(!Array.isArray(owner.files))throw new AppError('LOCAL_EXPORT_DAMAGED');checkMembers(owner.files);}
  else this.manifest.validate(owner.files,'files');
 }
 async verifyPlan(plan){
  const counts=emptyExportCounts();for await(const item of this.changes(plan))counts[item.kind]++;
  if(!validExportCounts(counts,this.total(plan))||Object.keys(counts).some(kind=>counts[kind]!==this.counts(plan)[kind]))throw new AppError('LOCAL_EXPORT_DAMAGED');
 }
 summary(plan){
  return {id:plan.id,reviewId:plan.reviewId,releaseId:plan.releaseId,previewUrl:'/preview/'+plan.reviewId+'/'+plan.defaultPage,directory:plan.directory,state:plan.state,createdAt:plan.createdAt,completedAt:plan.completedAt??null,cleaned:plan.cleaned,counts:this.counts(plan),total:this.total(plan),applied:plan.applied};
 }
 async current({reviewId}){const pointer=await this.read(reviewFile(reviewId));return {plan:pointer?this.summary(await this.get(pointer.id)):null};}
 async page({id,offset=0}){
  if(!Number.isSafeInteger(offset)||offset<0)throw new AppError('INVALID');const plan=await this.get(id);
  const files=plan.version===1?plan.changes.slice(offset,offset+50):await this.manifest.page(plan.changes,{offset});
  return {...this.summary(plan),offset,files,next:offset+50<this.total(plan)?offset+50:null};
 }
 async apply({id,reviewed}){
  if(reviewed!==true)throw new AppError('LOCAL_EXPORT_REVIEW');
  let plan=await this.get(id);const directory=await this.directory(plan.directory);
  return this.locked(directory,async()=>{
   plan=await this.get(id);const owner=await this.read(ownerFile(directory));
   this.validateOwner(owner,directory);const changes=()=>this.changes(plan);await this.verifyPlan(plan);
   if(plan.state==='completed'){
    if(!plan.cleaned){await cleanFiles(plan,changes);plan.cleaned=true;await this.save(plan,owner?.pending===id?{...owner,pending:null}:null);}return this.summary(plan);
   }
   if(plan.state==='discarded'||owner?.pending!==id||this.counts(plan).conflict)throw new AppError('LOCAL_EXPORT_CHANGED');
   const candidate=await this.candidate(plan.reviewId,{fresh:plan.state==='planned'});
   if(candidate.id!==plan.releaseId)throw new AppError('LOCAL_EXPORT_DAMAGED');
   if(plan.state!=='applying'){
    await checkOriginals(plan,changes);
    plan.state='staging';await this.save(plan);
    try{await stageFiles(plan,candidate,this.checkpoint,changes);}catch(error){if(['ENOSPC','EDQUOT'].includes(error.code))throw new AppError('STORAGE_FULL');throw error;}
    await checkOriginals(plan,changes);
    plan.state='applying';await this.save(plan);await this.checkpoint('ready');
   }
   // File fingerprints, retained originals and no-clobber stage links prove
   // the unfinished tail on recovery. Checkpoint small batches instead of
   // rewriting the journal for every file; always retain the final position.
   await applyFiles(plan,this.checkpoint,async count=>{if(count-plan.applied>=32||count===this.total(plan)&&count>plan.applied){plan.applied=count;await this.save(plan);}},changes);
   await this.checkpoint('verified');
   plan.state='completed';plan.completedAt=new Date().toISOString();
   const files=this.manifest.builder('files');for await(const change of changes())if(change.after)await files.append({path:change.path,...change.after});
   const receipt={version:2,directory,releaseId:plan.releaseId,files:await files.finish(),pending:id};
   await this.save(plan,receipt);await this.checkpoint('committed');
   await cleanFiles(plan,changes);plan.cleaned=true;await this.save(plan,{...receipt,pending:null});return this.summary(plan);
  });
 }
 async discard({id}){
  let plan=await this.get(id);const directory=await this.directory(plan.directory);
  return this.locked(directory,async()=>{
   plan=await this.get(id);const owner=await this.read(ownerFile(directory));
   this.validateOwner(owner,directory);await this.verifyPlan(plan);
   if(!['planned','staging','discarded'].includes(plan.state))throw new AppError('LOCAL_EXPORT_RECOVER');
   for await(const change of this.changes(plan)){
    const file=await memberPath(directory,change.path);if(!file)continue;
    if(await regular(temporary(file,id,'old'),{missing:true}))throw new AppError('LOCAL_EXPORT_RECOVER');
    const stage=temporary(file,id,'new');if(await regular(stage,{missing:true}))await unlink(stage);
   }
   plan.state='discarded';plan.cleaned=true;await this.save(plan,owner?.pending===id?{...owner,pending:null}:null);return this.summary(plan);
  });
 }
}
