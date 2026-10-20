import {githubPlanReader,requireGithubPlanCollections} from './github-plan-index.js';
import {contentHash} from './file-content.js';
import {contentBuffer} from './file-content.js';
import {buildGithubTree,verifyRemoteGithubTree} from './github-trees.js';
import {admitGithubPlan} from './github-publication-plan.js';
import messages from './web/locales/en/githubTransfer.json' with {type:'json'};
import {digest} from './storage.js';
import {AppError} from './errors.js';
import {pagesSource} from './publishing.js';
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
// Both synchronous publishing and durable jobs use this one GitHub adapter.
// Checkpoints precede the branch write. Retrying a lost response reconciles it;
// content-addressed blobs, trees and explicitly dated commits are reusable.
export async function deployGithub(publisher,candidate,config,{plan=null,journal,save,guard,progress=async()=>{},signal,pushed=async()=>{}}){
 const c=config.github,base=`/repos/${c.owner}/${c.repository}`;
 const call=async(route,method='GET',data,missing=false)=>{signal?.throwIfAborted();await guard(method==='GET'?{phase:'read'}:undefined);return publisher.github(base+route,method,data,missing,signal);};
 const checkpoint=async()=>{await guard(journal.receipt?{phase:'receipt'}:undefined);await save(journal);};
 if(!journal.entries&&!journal.document){
  await guard();await publisher.check({plan});
  const reviewed=admitGithubPlan(plan??await publisher.buildDestinationPlan(candidate,(await publisher.read()).etag,{signal}));
  if(githubPlanReader(publisher.workspace,reviewed).count('conflicts'))throw new AppError('PUBLISH_CONFLICT');
  if(!plan&&reviewed.requiresReview)throw new AppError('PUBLISH_OWNERSHIP');
  // Recheck after hashing and tree inspection, before the first network write.
  await publisher.check({plan:reviewed});
  Object.assign(journal,{...(reviewed.document?{document:reviewed.document,uploadedCount:0}:{entries:reviewed.entries,preservedEntries:reviewed.preservedEntries,removed:reviewed.removed,uploaded:[]}),baseTree:reviewed.baseTree,repositoryId:reviewed.repositoryId,parent:reviewed.head,createdAt:journal.createdAt??new Date().toISOString()});await checkpoint();
 }
 if(!journal.document&&!journal.preservedEntries||!Number.isSafeInteger(journal.repositoryId))throw new AppError('PUBLISH_STALE');
 if(journal.document)requireGithubPlanCollections(journal.document);
 const reader=githubPlanReader(publisher.workspace,journal,{signal}),uploaded=journal.document?null:new Set(journal.uploaded),total=reader.count('uploads');
 if(journal.document&&(!Number.isSafeInteger(journal.uploadedCount)||journal.uploadedCount<0||journal.uploadedCount>total))throw new AppError('PUBLISH_STALE');
 journal.total=total;const report=stage=>progress({stage,done:journal.uploadedCount??uploaded.size,total});
 const expected={count:reader.count('entries')+reader.count('preservedEntries'),get:async path=>await reader.get('entries',path)??await reader.get('preservedEntries',path)};
 const repo=await call('');if(repo.id!==journal.repositoryId||!repo.permissions?.push)throw new AppError('PUBLISH_STALE');
 const head=await call(`/git/ref/heads/${c.branch}`,'GET',undefined,true),current=head?.object?.sha??null;
 if(current!==journal.parent&&(!journal.commit||current!==journal.commit))throw new AppError('PUBLISH_OWNERSHIP');
 if(!journal.commit||current!==journal.commit){
  for await(const entry of reader.values('uploads',{offset:journal.document?journal.uploadedCount:0})){
   if(uploaded?.has(entry.sha))continue;
   await report(messages.uploading);
   const source=c.directory?entry.path.slice(c.directory.length+1):entry.path;
   const blob=await call('/git/blobs','POST',{content:(await contentBuffer(await candidate.files.get(source))).toString('base64'),encoding:'base64'});
   if(blob.sha!==entry.sha)throw new AppError('PUBLISH_REMOTE');if(journal.document)journal.uploadedCount++;else{journal.uploaded.push(entry.sha);uploaded.add(entry.sha);}await checkpoint();
  }
  await buildGithubTree(call,journal,{reader,checkpoint,signal,onProgress:(done,total)=>progress({stage:messages.buildingTree,done,total})});
  await verifyRemoteGithubTree(call,journal.tree,expected,{signal});
  await report(messages.committing);
  if(!journal.commit){
   const identity={name:'Observanda Publisher',email:'publisher@observanda.invalid',date:journal.createdAt};
   const commit=await call('/git/commits','POST',{message:`Publish Observanda release ${candidate.id}`,tree:journal.tree,parents:journal.parent?[journal.parent]:[],author:identity,committer:identity});
   if(!sha(commit.sha))throw new AppError('PUBLISH_REMOTE');journal.commit=commit.sha;await checkpoint();
  }
  const latest=await call(`/git/ref/heads/${c.branch}`,'GET',undefined,true);
  if((await call('')).id!==journal.repositoryId)throw new AppError('PUBLISH_STALE');
  if((latest?.object?.sha??null)!==journal.parent){if(latest?.object?.sha!==journal.commit)throw new AppError('PUBLISH_STALE');}
  else{
   // Never erase this marker on cancellation or error: the request can succeed
   // even if its response is lost. A later retry must inspect the remote head.
   journal.pushAttempted=true;await checkpoint();await report(messages.pushing);
   if(journal.parent)await call(`/git/refs/heads/${c.branch}`,'PATCH',{sha:journal.commit,force:false});
   else await call('/git/refs','POST',{ref:`refs/heads/${c.branch}`,sha:journal.commit});
  }
 }
 const verified=await call(`/git/ref/heads/${c.branch}`);
 if(verified.object?.sha!==journal.commit)throw new AppError('PUBLISH_STALE');
 journal.receipt??={releaseId:candidate.id,commit:journal.commit,at:new Date().toISOString(),status:'uploaded',manifestHash:contentHash(await candidate.files.get('publication.json'))};
 await checkpoint();await pushed(journal.receipt,journal);
 await report(messages.verifying);
 await verifyRemoteGithubTree(call,journal.tree,expected,{signal});
 if(c.pages===false){
  journal.receipt.status='uploaded-repository-only';await checkpoint();await pushed(journal.receipt,journal);
  await report(messages.repositoryVerified);return journal.receipt;
 }
 const pages=await call('/pages','GET',undefined,true),matches=p=>p?.build_type==='legacy'&&p.source?.branch===c.branch&&p.source?.path==='/';
 if(pages&&!matches(pages)&&(!plan||JSON.stringify(pagesSource(pages))!==JSON.stringify(plan.pages)))throw new AppError('PUBLISH_PAGES');
 journal.receipt.status='uploaded-awaiting-pages';
 if(!matches(pages)){
  // Keep authorization errors outside the provider's optional Pages fallback.
  await guard();signal?.throwIfAborted();
  try{
   await publisher.github(base+'/pages',pages?'PUT':'POST',{source:{branch:c.branch,path:'/'},build_type:'legacy'},false,signal);
   if(!matches(await call('/pages')))throw new AppError('PUBLISH_PAGES');
  }catch(error){signal?.throwIfAborted();if(['JOB_LEASE','JOB_CANCELLED','PUBLISH_STALE'].includes(error.code))throw error;journal.receipt.status='uploaded-pages-setup-required';}
 }
 await checkpoint();await pushed(journal.receipt,journal);await report(messages.livePending);return journal.receipt;
}
