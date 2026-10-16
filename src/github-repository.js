import {randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {digest,serialize} from './storage.js';
import {validatePublishing} from './publishing.js';
import {researchId} from './web/research-reference.js';
import messages from './web/locales/en/repositorySetup.json' with {type:'json'};
const activeFile='.observanda/repository-setup.json';
const reviewFile='.observanda/repository-setup-review.json';
const file=id=>{if(!researchId(id))throw new AppError('INVALID');return '.observanda/repository-setups/'+id+'.json';};
const emptyBlob='e69de29bb2d1d6434b8b29ae775ad8c2e48c5391';
export class GithubRepositorySetup{
 constructor(workspace,publisher,queue){this.workspace=workspace;this.publisher=publisher;this.queue=queue;}
 async read(id){const raw=await this.workspace.readMetadata(file(id),32768);if(!raw)throw new AppError('NOT_FOUND');const d=JSON.parse(raw);if(d.version!==1||d.id!==id||!researchId(d.scope)||!d.intent||!d.journal)throw new AppError('JOB_DAMAGED');return d;}
 async current(){const raw=await this.workspace.readMetadata(activeFile,4096);return raw?this.queue.read(JSON.parse(raw).id):null;}
 async review({configEtag}){
  const saved=await this.publisher.read();
  if(!saved.configured||saved.etag!==configEtag||saved.config.kind!=='github')throw new AppError('PUBLISH_STALE');
  const c=saved.config.github,base=`/repos/${c.owner}/${c.repository}`,repo=await this.publisher.github(base);
  if(!Number.isSafeInteger(repo.id)||repo.full_name?.toLowerCase()!==`${c.owner}/${c.repository}`.toLowerCase()||typeof repo.private!=='boolean'||typeof repo.default_branch!=='string'||!repo.permissions?.push)throw new AppError('PUBLISH_OWNERSHIP');
  const branches=await this.publisher.github(base+'/branches?per_page=2'),tags=await this.publisher.github(base+'/tags?per_page=1');
  if(!Array.isArray(branches)||!Array.isArray(tags))throw new AppError('PUBLISH_REMOTE');
  if(branches.length||tags.length)throw new AppError('PUBLISH_OWNERSHIP');
  const review={id:randomUUID(),configEtag,repositoryId:repo.id,name:repo.full_name,private:repo.private,defaultBranch:repo.default_branch,branch:c.branch};
  await this.queue.transaction(async()=>{if((await this.publisher.read()).etag!==configEtag)throw new AppError('PUBLISH_STALE');await this.workspace.writeMetadata(reviewFile,serialize(review));});
  return review;
 }
 async initialize({review:reviewId,configEtag,confirmed}){
  if(confirmed!==true||!researchId(reviewId))throw new AppError('PUBLISH_CONFIG');
  return this.queue.transaction(async()=>{
   const saved=await this.publisher.read(),raw=await this.workspace.readMetadata(reviewFile,32768),review=raw?JSON.parse(raw):null;
   if(!saved.configured||saved.config.kind!=='github'||saved.etag!==configEtag||review?.configEtag!==configEtag||review?.id!==reviewId)throw new AppError('PUBLISH_STALE');
   const intent={config:saved.config,etag:configEtag,visibility:review.private?'private':'public',initialize:{repositoryId:review.repositoryId,defaultBranch:review.defaultBranch}},revision=digest(serialize(intent)),previous=await this.current();
   if(previous){if(previous.input.revision===revision)return previous;if(['queued','running'].includes(previous.state))throw new AppError('PUBLISH_PENDING');}
   const id=randomUUID(),scope=(await this.workspace.outline()).metadata.id;
   await this.workspace.writeMetadata(file(id),serialize({version:1,id,scope,intent,journal:{repositoryId:review.repositoryId}}));await this.workspace.writeMetadata(activeFile,serialize({id}));
   return this.queue.enqueueLocked({id,type:'publication.repository',scope,input:{revision}});
  });
 }
 async start({config,etag,visibility,confirmed}){
  validatePublishing(config);
  if(confirmed!==true||config.kind!=='github'||config.github.branch!=='main'||!['private','public'].includes(visibility))throw new AppError('PUBLISH_CONFIG');
  return this.queue.transaction(async()=>{
   const saved=await this.publisher.read();if(saved.etag!==etag||saved.configured)throw new AppError('PUBLISH_STALE');
   const intent={config,etag,visibility},revision=digest(serialize(intent)),previous=await this.current();
   if(previous){if(previous.input.revision===revision)return previous;if(['queued','running'].includes(previous.state))throw new AppError('PUBLISH_PENDING');}
   const id=randomUUID(),scope=(await this.workspace.outline()).metadata.id;
   await this.workspace.writeMetadata(file(id),serialize({version:1,id,scope,intent,journal:{}}));await this.workspace.writeMetadata(activeFile,serialize({id}));
   return this.queue.enqueueLocked({id,type:'publication.repository',scope,input:{revision}});
  });
 }
 async authorize(job){await this.workspace.requireStorageKey();const d=await this.read(job.id);if(d.scope!==job.scope||digest(serialize(d.intent))!==job.input.revision)throw new AppError('JOB_CHANGED');}
 async prepare(job,{signal,progress}){
  const d=await this.read(job.id),{config,etag,visibility}=d.intent,c=config.github,base=`/repos/${c.owner}/${c.repository}`,journal=d.journal;
  const guard=async()=>{signal.throwIfAborted();await this.workspace.catalogue(async()=>{await this.queue.held(job.id,job.lease.token);if((await this.publisher.read()).etag!==etag)throw new AppError('PUBLISH_STALE');});};
  const checkpoint=()=>this.queue.transaction(async()=>{await this.queue.held(job.id,job.lease.token);await this.workspace.writeMetadata(file(job.id),serialize(d));});
  const call=async(route,method='GET',data,missing=false)=>{await guard();return this.publisher.github(route,method,data,missing,signal);};
  await progress({stage:messages.checking,done:0,total:3});
  let repo=await call(base,'GET',undefined,true);
  if(!journal.repositoryId){
   // A lost creation reply may leave a repository behind. Never assume a
   // repository with that name belongs to this operation on a later retry.
   if(repo)throw new AppError('PUBLISH_REPO_EXISTS');
   const account=await call('/user'),owner=await call('/users/'+c.owner);
   if(owner.type!=='Organization'&&account.login.toLowerCase()!==c.owner.toLowerCase())throw new AppError('PUBLISH_CONFIG');
   journal.createAttempted=true;await checkpoint();
   repo=await call(owner.type==='Organization'?'/orgs/'+c.owner+'/repos':'/user/repos','POST',{name:c.repository,private:visibility==='private',auto_init:false,has_issues:false,has_wiki:false});
   if(!Number.isSafeInteger(repo.id)||repo.full_name?.toLowerCase()!==`${c.owner}/${c.repository}`.toLowerCase()||repo.private!==(visibility==='private'))throw new AppError('PUBLISH_REMOTE');
   journal.repositoryId=repo.id;await checkpoint();
   repo=await call(base);
  }
  if(!repo||repo.id!==journal.repositoryId||repo.full_name?.toLowerCase()!==`${c.owner}/${c.repository}`.toLowerCase()||repo.private!==(visibility==='private')||!repo.permissions?.push)throw new AppError('PUBLISH_OWNERSHIP');
  if(d.intent.initialize&&repo.default_branch!==d.intent.initialize.defaultBranch&&!(journal.initialHead&&repo.default_branch===c.branch))throw new AppError('PUBLISH_STALE');
  await progress({stage:messages.initializing,done:1,total:3});
  const tags=await call(base+'/tags?per_page=1');if(!Array.isArray(tags))throw new AppError('PUBLISH_REMOTE');if(tags.length)throw new AppError('PUBLISH_OWNERSHIP');
  let branches=await call(base+'/branches?per_page=2');
  if(!Array.isArray(branches))throw new AppError('PUBLISH_REMOTE');
  if(!branches.length){
   journal.seedAttempted=true;await checkpoint();
   const seeded=await call(base+'/contents/.nojekyll','PUT',{message:'Initialize Observanda website '+job.id,content:''});
   journal.initialHead=seeded.commit?.sha;await checkpoint();branches=await call(base+'/branches?per_page=2');
  }
  if(branches.length!==1)throw new AppError('PUBLISH_OWNERSHIP');
  const branch=branches[0];
  if(!journal.seedAttempted)throw new AppError('PUBLISH_OWNERSHIP');
  const commit=await call(base+'/git/commits/'+branch.commit.sha),tree=await call(base+'/git/trees/'+commit.tree.sha+'?recursive=1');
  if(commit.message!=='Initialize Observanda website '+job.id||tree.truncated||tree.tree?.length!==1||tree.tree[0].path!=='.nojekyll'||tree.tree[0].sha!==emptyBlob||tree.tree[0].mode!=='100644'||commit.parents?.length!==0)throw new AppError('PUBLISH_OWNERSHIP');
  if(!journal.initialHead){
   journal.initialHead=branch.commit.sha;await checkpoint();
  }
  if(branch.commit.sha!==journal.initialHead)throw new AppError('PUBLISH_OWNERSHIP');
  if(branch.name!==c.branch)await call(base+'/branches/'+encodeURIComponent(branch.name)+'/rename','POST',{new_name:c.branch});
  repo=await call(base);const main=await call(base+'/git/ref/heads/'+c.branch);
  if(repo.id!==journal.repositoryId||repo.default_branch!==c.branch||main.object?.sha!==journal.initialHead)throw new AppError('PUBLISH_REMOTE');
  await guard();await progress({stage:messages.saving,done:3,total:3});return {repositoryId:repo.id,commit:journal.initialHead,initialized:!!d.intent.initialize};
 }
 async commit(job,result){
  const d=await this.read(job.id),saved=await this.publisher.read();
  if(saved.etag!==d.intent.etag||result.repositoryId!==d.journal.repositoryId||result.commit!==d.journal.initialHead)throw new AppError('PUBLISH_STALE');
  await this.workspace.writeMetadata('.observanda/publishing.json',serialize(d.intent.config));return result;
 }
}
export function repositoryJobDefinitions(workspace,publisher,queue){const service=()=>new GithubRepositorySetup(workspace,publisher,queue());return {'publication.repository':{authorize:job=>service().authorize(job),prepare:(job,options)=>service().prepare(job,options),commit:(job,result)=>service().commit(job,result)}};}
