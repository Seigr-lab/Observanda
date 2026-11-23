import {GithubPlanIndex,githubPlanReader,validGithubPlanIndex,requireGithubPlanCollections,githubReviewKinds} from './github-plan-index.js';
import {createHash} from 'node:crypto';
import {contentSize,contentStream} from './file-content.js';
import {serialize} from './storage.js';
import {AppError} from './errors.js';
import {githubTreeEntries} from './github-trees.js';
import {operationStage,operationAdvance} from './operation-progress.js';

const same=(a,b)=>a?.sha===b?.sha&&a?.mode===b?.mode&&a?.type===b?.type;
const ownershipPath=key=>`.observanda/publishing-ownership/${key}.json`;
// Every review and deployment cursor pins independently indexed collections.
export function admitGithubPlan(plan){
 if(plan?.version===3){
  if(plan.replacement?.policy!==1||!(plan.replacement.archiveBranch===null||githubArchiveBranch(plan.replacement.archiveBranch))||plan.replacement.archiveBranch&&!plan.head||!githubDirectory(plan.replacement.directory)||plan.requiresReview!==true||!plan.pagesProtection||!Object.hasOwn(plan.pagesProtection,'cname')||typeof plan.pagesProtection.httpsEnforced!=='boolean')throw new AppError('PUBLISH_STALE');
  requireGithubPlanCollections(plan.document);return plan;
 }
 if(plan?.version!==2)throw new AppError('PUBLISH_STALE');
 requireGithubPlanCollections(plan.document);return plan;
}
export const githubDirectory=value=>typeof value==='string'&&value.length<=240&&(value===''||value.split('/').every(part=>/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(part)&&!['.','..'].includes(part)));
// Keep repository domain and legal files byte-for-byte, including license
// directories. An exported file cannot silently replace one of these paths.
export const protectedGithubPath=name=>name.split('/').some(part=>/^(?:cname|licen[cs]es?|copying|copyright|notice)(?:[._-].*)?$/i.test(part));
export const githubArchiveBranch=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(value);
export const githubPagesProtection=pages=>({cname:pages?.cname??null,httpsEnforced:pages?.https_enforced===true});
export async function githubBlobHash(content,{signal}={}){
 signal?.throwIfAborted();
 const hash=createHash('sha1').update(`blob ${contentSize(content)}\0`);
 for await(const bytes of contentStream(content)){signal?.throwIfAborted();hash.update(bytes);}
 return hash.digest('hex');
}
export function githubTreeFiles(tree){
 return githubTreeEntries(tree).filter(entry=>entry.type!=='tree');
}
export async function readGithubOwnership(publisher,config,receipt){
 const raw=await publisher.workspace.readMetadata(ownershipPath(publisher.destinationKey(config)),16*1024*1024);
 if(raw===null)return null;
 const value=JSON.parse(raw);
 if(value.version!==2||!Number.isSafeInteger(value.repositoryId)||value.commit!==receipt?.commit||value.releaseId!==receipt?.releaseId||!validGithubPlanIndex(value.document))throw new AppError('PUBLISH_OWNERSHIP');
 requireGithubPlanCollections(value.document,{ownership:true});
 return value;
}
// Called inside the same storage transaction as the confirmed-push receipt.
// No ownership metadata is placed in the public repository.
export async function writeGithubOwnership(workspace,key,journal){
 if(!journal.receipt)return;
 if(!Number.isSafeInteger(journal.repositoryId)||!journal.document)throw new AppError('PUBLISH_OWNERSHIP');
 requireGithubPlanCollections(journal.document);
 const owned={version:2,document:{version:1,collections:{entries:journal.document.collections.entries}}};
 await workspace.writeMetadata(ownershipPath(key),serialize({...owned,repositoryId:journal.repositoryId,commit:journal.receipt.commit,releaseId:journal.receipt.releaseId}));
}
// Stream remote, owned and desired entries through independently counted rows.
// Intermediate rows remain private and no review header exists until all roots
// are durable. Every provider write subsequently uses this immutable plan.
export function indexedGithubFilePlan(workspace,candidate,files,ownership,directory='',options={}){const build=()=>buildIndexedGithubFilePlan(workspace,candidate,files,ownership,directory,options);return workspace.withPublicationMetadataSnapshot?build():workspace.withCatalogueConnections(build);}
async function buildIndexedGithubFilePlan(workspace,candidate,files,ownership,directory='',{signal,replaceExisting=false,onProgress=async()=>{},write}={}){
 const index=GithubPlanIndex.builder(workspace,{signal,write}),prefix=directory?directory+'/':'';
 if(typeof replaceExisting!=='boolean'||!githubDirectory(directory))throw new AppError('INVALID');
 const replaceable=name=>replaceExisting&&(!prefix||name.startsWith(prefix))&&!protectedGithubPath(name);
 let visited=0;const report=async stage=>{if(++visited%32===0)await onProgress({stage:stage+' ('+visited+')',done:0,total:0});};
 const mark=(kind,path)=>index.add(kind,path,{path});
 const step=(stage,total,work)=>workspace.websiteContext?operationStage(stage,{total,unit:'files'},work):work();
 await step('remoteReadRepository',undefined,async()=>{
  for await(const entry of files){signal?.throwIfAborted();githubTreeFiles({tree:[entry]});if(await index.get('remote',entry.path))throw new AppError('PUBLISH_REMOTE');await index.add('remote',entry.path,entry);await report('Reading repository files');operationAdvance(1,'remoteReadRepository');}
 });
 await index.flush();
 const owned=ownership?githubPlanReader(workspace,ownership,{signal}):{get:async()=>null,async *values(){}};
 for await(const old of owned.values('entries'))if(!replaceable(old.path)&&!same(old,await index.get('remote',old.path)))await mark('conflicts',old.path);
 await step('remoteCompareFiles',candidate.files.size,async()=>{for await(const [name,content] of candidate.files){
  signal?.throwIfAborted();await report('Checking exported website files');const entry={path:prefix+name,mode:'100644',type:'blob',sha:await githubBlobHash(content,{signal})};githubTreeFiles({tree:[entry]});
  await index.add('entries',entry.path,entry);if(!await index.get('uploads',entry.sha))await index.add('uploads',entry.sha,entry);
  const lower=entry.path.toLowerCase(),target=await index.get('targets',lower);
  if(target&&target.path!==entry.path){await mark('conflicts',entry.path);await mark('conflicts',target.path);}else await index.add('targets',lower,{path:entry.path});
  const parts=lower.split('/');parts.pop();while(parts.length){await mark('ancestors',parts.join('/'));parts.pop();}
  const current=await index.get('remote',entry.path);
  if(!current)await mark('added',entry.path);else if(same(entry,current))await mark('unchanged',entry.path);else if(!protectedGithubPath(entry.path)&&(replaceable(entry.path)||await owned.get('entries',entry.path)))await mark('replaced',entry.path);else await mark('conflicts',entry.path);
  operationAdvance(1,'remoteCompareFiles');
 }});
 await index.flush();
 await step('remoteCompareRepository',index.count('remote'),async()=>{for await(const entry of index.values('remote')){
  await report('Comparing repository files');
  let removed=false;
  if(!await index.get('entries',entry.path)){if(!protectedGithubPath(entry.path)&&(replaceable(entry.path)||!replaceExisting&&await owned.get('entries',entry.path))){await mark('removed',entry.path);removed=true;}else{await mark('preserved',entry.path);await index.add('preservedEntries',entry.path,entry);}}
  // A replacement builds a new tree, so explicitly removed files, submodules
  // and case aliases cannot create implicit directory/file overwrites.
  if(removed&&replaceExisting){operationAdvance(1,'remoteCompareRepository');continue;}
  const lower=entry.path.toLowerCase(),target=await index.get('targets',lower);
  if(await index.get('ancestors',lower)||target&&target.path!==entry.path)await mark('conflicts',entry.path);
  const parts=lower.split('/');parts.pop();while(parts.length){if(await index.get('targets',parts.join('/')))await mark('conflicts',entry.path);parts.pop();}
  operationAdvance(1,'remoteCompareRepository');
 }});
 const document=await index.finish();
 // Build-only indexes have no role in review, resume or retained ownership.
 for(const key of ['remote','targets','ancestors'])delete document.collections[key];
 return {document,counts:Object.fromEntries(['entries','uploads','preservedEntries',...githubReviewKinds].map(key=>[key,index.count(key)]))};
}
export async function githubPlanReview(workspace,plan){
 const reader=githubPlanReader(workspace,plan),{document,...review}=plan;
 review.counts=Object.fromEntries(githubReviewKinds.map(key=>[key,reader.count(key)]));review.windows={};
 for(const key of githubReviewKinds){const page=await reader.page(key);review[key]=page.items.map(row=>row.path);review.windows[key]={offset:page.offset,next:page.next};}
 return review;
}
