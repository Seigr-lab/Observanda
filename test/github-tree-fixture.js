import {sha} from './github-fixture.js';

// Adapt the flat Git fixture to the provider's directory-tree response shape.
// Recursive responses deliberately truncate; flat responses include all direct
// children. The underlying publication fixture still owns commits and writes.
export function truncatedGithubTrees(remote,{threshold=8}={}){
 const children=new Map(),reads=[];
 function hierarchy(files){
  const entries=[],groups=new Map();
  for(const file of files){
   const at=file.path.indexOf('/');
   if(at===-1)entries.push({...file});
   else{const name=file.path.slice(0,at);if(!groups.has(name))groups.set(name,[]);groups.get(name).push({...file,path:file.path.slice(at+1)});}
  }
  for(const [name,files] of groups){const tree=hierarchy(files),hash=sha('tree',Buffer.from(JSON.stringify(tree)));children.set(hash,tree);entries.push({path:name,type:'tree',mode:'040000',sha:hash});}
  return entries;
 }
 function expand(entries,prefix=''){
  return entries.flatMap(entry=>[{...entry,path:prefix+entry.path},...(entry.type==='tree'?expand(children.get(entry.sha),prefix+entry.path+'/'):[])]);
 }
 return {reads,request:async(url,options={})=>{
  const parsed=new URL(url),match=/\/git\/trees\/([a-f0-9]{40})$/.exec(parsed.pathname);
  if(!match||(options.method??'GET')!=='GET')return remote.request(url,options);
  reads.push(parsed.pathname+parsed.search);options.signal?.throwIfAborted();
  const id=match[1],entries=remote.trees.has(id)?hierarchy(remote.trees.get(id)):children.get(id);
  if(!entries)return new Response('',{status:404});
  const all=parsed.searchParams.has('recursive')?expand(entries):entries,truncated=parsed.searchParams.has('recursive')&&all.length>threshold;
  return new Response(JSON.stringify({sha:id,tree:truncated?all.slice(0,threshold):all,truncated}));
 }};
}
