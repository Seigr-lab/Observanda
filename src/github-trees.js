import {AppError} from './errors.js';

const validSha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const fail=()=>{throw new AppError('PUBLISH_REMOTE');};
const validPath=value=>typeof value==='string'&&value.length<=4096&&!value.includes('\0')&&value.split('/').every(part=>part&&part!=='.'&&part!=='..');
export function githubTreeEntries(value,{sha=null,flat=false}={}){
 if(value?.truncated||!Array.isArray(value?.tree)||sha&&value.sha!==undefined&&value.sha!==sha)fail();
 const names=new Set();
 return value.tree.map(entry=>{
  if(!entry||!validPath(entry.path)||flat&&entry.path.includes('/')||names.has(entry.path)||!validSha(entry.sha)||
   !({tree:['040000'],blob:['100644','100755','120000'],commit:['160000']}[entry.type]?.includes(entry.mode)))fail();
  names.add(entry.path);return {path:entry.path,mode:entry.mode,type:entry.type,sha:entry.sha};
 });
}

// A truncated recursive response is not a partial inventory we can publish
// against. Discard it and walk immutable subtrees, as required by GitHub's API.
// Repeated subtree SHAs at different paths are valid; only ancestry is cyclic.
export async function* githubTreeRecords(call,root,{signal}={}){
 if(!validSha(root))fail();signal?.throwIfAborted();
 const recursive=await call(`/git/trees/${root}?recursive=1`);
 signal?.throwIfAborted();
 if(recursive?.truncated!==true){
  for(const entry of githubTreeEntries(recursive,{sha:root})){signal?.throwIfAborted();if(entry.type!=='tree')yield entry;}
  return;
 }
 const ancestors=new Set();
 async function* walk(sha,prefix){
  signal?.throwIfAborted();if(ancestors.has(sha))fail();ancestors.add(sha);
  try{
   const response=await call(`/git/trees/${sha}`);signal?.throwIfAborted();
   if(response?.truncated===true)throw new AppError('PUBLISH_TREE_INCOMPLETE');
   for(const entry of githubTreeEntries(response,{sha,flat:true})){
    signal?.throwIfAborted();const path=prefix+entry.path;if(!validPath(path))fail();
    if(entry.type==='tree')yield* walk(entry.sha,path+'/');else yield {...entry,path};
   }
  }finally{ancestors.delete(sha);}
 }
 yield* walk(root,'');
}

export async function verifyRemoteGithubTree(call,root,expected,{signal}={}){
 const remaining=new Map();
 for(const entry of expected){if(remaining.has(entry.path))fail();remaining.set(entry.path,entry);}
 for await(const entry of githubTreeRecords(call,root,{signal})){
  const wanted=remaining.get(entry.path);
  if(!wanted||wanted.sha!==entry.sha||wanted.mode!==entry.mode||wanted.type!==entry.type)fail();
  remaining.delete(entry.path);
 }
 if(remaining.size)fail();
}

// Limits belong to each provider request, not the number of files in a release.
// Every acknowledged batch has its own content-addressed tree and durable
// cursor. A lost response replays the same batch on the same immutable base.
const TREE_BATCH_ENTRIES=256,TREE_BATCH_BYTES=128*1024;
export async function buildGithubTree(call,journal,{checkpoint,signal,onProgress=async()=>{}}){
 const total=journal.entries.length+journal.removed.length;
 const at=index=>index<journal.entries.length?journal.entries[index]:{path:journal.removed[index-journal.entries.length],mode:'100644',type:'blob',sha:null};
 let state=journal.treeBuild;
 if(state&&(state.version!==1||state.baseTree!==journal.baseTree||state.total!==total||!Number.isSafeInteger(state.applied)||state.applied<0||state.applied>total||!validSha(state.tree)))throw new AppError('PUBLISH_STALE');
 if(journal.tree){if(!validSha(journal.tree)||state&&(state.applied!==total||state.tree!==journal.tree))throw new AppError('PUBLISH_STALE');return journal.tree;}
 if(!total&&journal.baseTree){journal.tree=journal.baseTree;await checkpoint();return journal.tree;}
 do{
  signal?.throwIfAborted();const start=state?.applied??0,batch=[];let bytes=128;
  while(start+batch.length<total&&batch.length<TREE_BATCH_ENTRIES){
   const entry=at(start+batch.length),size=Buffer.byteLength(JSON.stringify(entry))+1;
   if(batch.length&&bytes+size>TREE_BATCH_BYTES)break;
   if(size+128>TREE_BATCH_BYTES)fail();batch.push(entry);bytes+=size;
  }
  const base=state?.tree??journal.baseTree;
  await onProgress(start,total);
  const result=await call('/git/trees','POST',{...(base?{base_tree:base}:{}),tree:batch});
  if(!validSha(result?.sha))fail();
  state={version:1,baseTree:journal.baseTree,total,applied:start+batch.length,tree:result.sha};
  journal.treeBuild=state;if(state.applied===total)journal.tree=state.tree;
  await checkpoint();
 }while(state.applied<total);
 return journal.tree;
}
