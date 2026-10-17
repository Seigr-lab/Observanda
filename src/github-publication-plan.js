import {createHash} from 'node:crypto';
import {contentSize,contentStream} from './file-content.js';
import {serialize} from './storage.js';
import {AppError} from './errors.js';
import {githubTreeEntries} from './github-trees.js';

const same=(a,b)=>a?.sha===b?.sha&&a?.mode===b?.mode&&a?.type===b?.type;
const ownershipPath=key=>`.observanda/publishing-ownership/${key}.json`;
// Reviews and durable deployments still use the existing metadata envelope.
// Until those owners are independently paged, refuse an unreadable journal
// before any provider write, including the duplicated reviewed intent, uploaded
// hashes and fixed-size commit/receipt state accumulated during continuation.
export function admitGithubPlan(plan){
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
 if(value.version!==1||!Number.isSafeInteger(value.repositoryId)||value.commit!==receipt?.commit||value.releaseId!==receipt?.releaseId||!Array.isArray(value.files))throw new AppError('PUBLISH_OWNERSHIP');
 githubTreeFiles({tree:value.files});
 return value;
}
// Called inside the same storage transaction as the confirmed-push receipt.
// No ownership metadata is placed in the public repository.
export async function writeGithubOwnership(workspace,key,journal){
 if(!journal.receipt)return;
 if(!Number.isSafeInteger(journal.repositoryId)||!Array.isArray(journal.entries))throw new AppError('PUBLISH_OWNERSHIP');
 await workspace.writeMetadata(ownershipPath(key),serialize({version:1,repositoryId:journal.repositoryId,commit:journal.receipt.commit,releaseId:journal.receipt.releaseId,files:journal.entries}));
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
