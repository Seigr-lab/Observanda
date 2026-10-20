import {GithubPlanIndex,githubPlanReader,validGithubPlanIndex,requireGithubPlanCollections,githubReviewKinds} from './github-plan-index.js';
import {createHash} from 'node:crypto';
import {contentSize,contentStream} from './file-content.js';
import {serialize} from './storage.js';
import {AppError} from './errors.js';
import {githubTreeEntries} from './github-trees.js';

const same=(a,b)=>a?.sha===b?.sha&&a?.mode===b?.mode&&a?.type===b?.type;
const ownershipPath=key=>`.observanda/publishing-ownership/${key}.json`;
// Earlier retained inline reviews keep their original envelope admission.
// New reviews and deployment cursors pin independently indexed collections.
export function admitGithubPlan(plan){
 if(plan?.version===2){requireGithubPlanCollections(plan.document);return plan;}
 const journal={entries:plan.entries,preservedEntries:plan.preservedEntries,removed:plan.removed,uploaded:[...new Set(plan.entries.map(entry=>entry.sha))]};
 const requestedBytes=Buffer.byteLength(serialize({intent:{plan},journal}))+64*1024,maxBytes=16*1024*1024;
 if(requestedBytes>maxBytes)throw new AppError('PUBLISH_PLAN_CAPACITY',[{owner:'github-deployment-review',requestedBytes,maxBytes}]);
 return plan;
}
export const githubDirectory=value=>typeof value==='string'&&value.length<=240&&(value===''||value.split('/').every(part=>/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(part)&&!['.','..'].includes(part)));
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
 if(![1,2].includes(value.version)||!Number.isSafeInteger(value.repositoryId)||value.commit!==receipt?.commit||value.releaseId!==receipt?.releaseId||(value.version===1?!Array.isArray(value.files):!validGithubPlanIndex(value.document)))throw new AppError('PUBLISH_OWNERSHIP');
 if(value.version===1)githubTreeFiles({tree:value.files});else requireGithubPlanCollections(value.document,{ownership:true});
 return value;
}
// Called inside the same storage transaction as the confirmed-push receipt.
// No ownership metadata is placed in the public repository.
export async function writeGithubOwnership(workspace,key,journal){
 if(!journal.receipt)return;
 if(!Number.isSafeInteger(journal.repositoryId)||!journal.document&&!Array.isArray(journal.entries))throw new AppError('PUBLISH_OWNERSHIP');
 if(journal.document)requireGithubPlanCollections(journal.document);
 const owned=journal.document?{version:2,document:{version:1,collections:{entries:journal.document.collections.entries}}}:{version:1,files:journal.entries};
 await workspace.writeMetadata(ownershipPath(key),serialize({...owned,repositoryId:journal.repositoryId,commit:journal.receipt.commit,releaseId:journal.receipt.releaseId}));
}
export async function githubFilePlan(candidate,files,ownership,directory='',{signal}={}){
 signal?.throwIfAborted();
 const prefix=directory?directory+'/':'',entries=[];
 for await(const [name,content] of candidate.files)entries.push({path:prefix+name,mode:'100644',type:'blob',sha:await githubBlobHash(content,{signal})});
 const remote=new Map(files.map(f=>[f.path,f])),owned=new Map((ownership?.files??[]).map(f=>[f.path,f])),desired=new Map(entries.map(f=>[f.path,f]));
 const added=[],replaced=[],removed=[],unchanged=[],preserved=[],conflicts=new Set();
 for(const old of owned.values())if(!same(old,remote.get(old.path)))conflicts.add(old.path);
 for(const entry of entries){
  const current=remote.get(entry.path);
  if(!current)added.push(entry.path);
  else if(same(entry,current))unchanged.push(entry.path);
  else if(owned.has(entry.path))replaced.push(entry.path);
  else conflicts.add(entry.path);
 }
 for(const entry of files){
  if(!desired.has(entry.path)){
   if(owned.has(entry.path))removed.push(entry.path);else preserved.push(entry.path);
  }
 }
 // Catch directory/file boundaries, symlinks, submodules and case aliases.
 // Never let a new tree entry implicitly replace somebody else's subtree.
 const targets=new Set(entries.map(e=>e.path.toLowerCase())),ancestors=new Set();
 for(const name of targets){const parts=name.split('/');parts.pop();while(parts.length){ancestors.add(parts.join('/'));parts.pop();}}
 const folded=new Map();
 for(const entry of files){
  const lower=entry.path.toLowerCase();folded.set(lower,[...(folded.get(lower)??[]),entry.path]);
  if(ancestors.has(lower))conflicts.add(entry.path);
  const parts=lower.split('/');parts.pop();while(parts.length){if(targets.has(parts.join('/')))conflicts.add(entry.path);parts.pop();}
 }
 for(const entry of entries)for(const name of folded.get(entry.path.toLowerCase())??[])if(name!==entry.path)conflicts.add(name);
 const retained=files.filter(f=>!desired.has(f.path)&&!owned.has(f.path));
 return {entries,preservedEntries:retained,added,replaced,removed,unchanged,preserved,conflicts:[...conflicts].sort()};
}

// Stream remote, owned and desired entries through independently counted rows.
// Intermediate rows remain private and no review header exists until all roots
// are durable. Every provider write subsequently uses this immutable plan.
export function indexedGithubFilePlan(workspace,candidate,files,ownership,directory='',options={}){return workspace.withCatalogueConnections(()=>buildIndexedGithubFilePlan(workspace,candidate,files,ownership,directory,options));}
async function buildIndexedGithubFilePlan(workspace,candidate,files,ownership,directory='',{signal}={}){
 const index=GithubPlanIndex.builder(workspace,{signal}),prefix=directory?directory+'/':'';
 const mark=(kind,path)=>index.add(kind,path,{path});
 for await(const entry of files){signal?.throwIfAborted();githubTreeFiles({tree:[entry]});if(await index.get('remote',entry.path))throw new AppError('PUBLISH_REMOTE');await index.add('remote',entry.path,entry);}
 await index.flush();
 const owned=ownership?.version===2?githubPlanReader(workspace,ownership,{signal}):{get:async(kind,path)=>(ownership?.files??[]).find(row=>row.path===path)??null,async *values(){yield* ownership?.files??[];}};
 for await(const old of owned.values('entries'))if(!same(old,await index.get('remote',old.path)))await mark('conflicts',old.path);
 for await(const [name,content] of candidate.files){
  signal?.throwIfAborted();const entry={path:prefix+name,mode:'100644',type:'blob',sha:await githubBlobHash(content,{signal})};githubTreeFiles({tree:[entry]});
  await index.add('entries',entry.path,entry);if(!await index.get('uploads',entry.sha))await index.add('uploads',entry.sha,entry);
  const lower=entry.path.toLowerCase(),target=await index.get('targets',lower);
  if(target&&target.path!==entry.path){await mark('conflicts',entry.path);await mark('conflicts',target.path);}else await index.add('targets',lower,{path:entry.path});
  const parts=lower.split('/');parts.pop();while(parts.length){await mark('ancestors',parts.join('/'));parts.pop();}
  const current=await index.get('remote',entry.path);
  if(!current)await mark('added',entry.path);else if(same(entry,current))await mark('unchanged',entry.path);else if(await owned.get('entries',entry.path))await mark('replaced',entry.path);else await mark('conflicts',entry.path);
 }
 await index.flush();
 for await(const entry of index.values('remote')){
  if(!await index.get('entries',entry.path)){if(await owned.get('entries',entry.path))await mark('removed',entry.path);else{await mark('preserved',entry.path);await index.add('preservedEntries',entry.path,entry);}}
  const lower=entry.path.toLowerCase(),target=await index.get('targets',lower);
  if(await index.get('ancestors',lower)||target&&target.path!==entry.path)await mark('conflicts',entry.path);
  const parts=lower.split('/');parts.pop();while(parts.length){if(await index.get('targets',parts.join('/')))await mark('conflicts',entry.path);parts.pop();}
 }
 const document=await index.finish();
 // Build-only indexes have no role in review, resume or retained ownership.
 for(const key of ['remote','targets','ancestors'])delete document.collections[key];
 return {document,counts:Object.fromEntries(['entries','uploads','preservedEntries',...githubReviewKinds].map(key=>[key,index.count(key)]))};
}
export async function githubPlanReview(workspace,plan){
 const reader=githubPlanReader(workspace,plan),{entries,preservedEntries,document,...review}=plan;
 review.counts=Object.fromEntries(githubReviewKinds.map(key=>[key,reader.count(key)]));review.windows={};
 for(const key of githubReviewKinds){const page=await reader.page(key);review[key]=page.items.map(row=>row.path);review.windows[key]={offset:page.offset,next:page.next};}
 return review;
}
