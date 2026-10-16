import {createHash} from 'node:crypto';
export const sha=(type,bytes)=>createHash('sha1').update(`${type} ${bytes.length}\0`).update(bytes).digest('hex');
export function githubFixture({branch='observanda-site',initialFiles=null,initialPages=null,repository='notebook'}={}){
 const calls=[],blobs=new Map(),trees=new Map(),commits=new Map(),served=new Map();let head=null,pages=initialPages,hook=null,manifest=null;
 const seed=(files,{message='',parents=[]}={})=>{const entries=Object.entries(files).map(([path,content])=>{const bytes=Buffer.from(content),hash=sha('blob',bytes);blobs.set(hash,bytes);return {path,type:'blob',mode:'100644',sha:hash};}),tree=sha('tree',Buffer.from(JSON.stringify(entries)));trees.set(tree,entries);head='a'.repeat(40);commits.set(head,{tree,parents,message});return head;};
 if(initialFiles)seed(initialFiles);
 const request=async(url,options={})=>{
  const route=new URL(url).pathname,method=options.method??'GET',data=options.body?JSON.parse(options.body):undefined,call={route,method,data};calls.push(call);
  await hook?.(call,'before',options.signal);options.signal?.throwIfAborted();
  const ok=data=>new Response(JSON.stringify(data),{status:200});let response;
  if(new URL(url).hostname==='public.example'){
   if(route.endsWith('/publication.json'))return new Response(manifest??'unavailable');
   const name=decodeURIComponent(route.replace(/^\/research\//,''));if(served.has(name))return new Response(served.get(name));
   let file;try{file=JSON.parse(manifest).files.find(f=>f.path===name);}catch{}
   const bytes=file&&[...blobs.values()].find(b=>createHash('sha256').update(b).digest('hex')===file.sha256);
   return bytes?new Response(bytes):new Response('',{status:404});
  }
  if(route==='/user')response=ok({login:'fixture-account'});
  else if(route==='/repos/example/'+repository)response=ok({id:123,full_name:'example/'+repository,permissions:{push:true},default_branch:'main'});
  else if(route.endsWith('/git/ref/heads/'+branch))response=head?ok({object:{sha:head}}):new Response('',{status:404});
  else if(route.endsWith('/git/ref/heads/main'))response=ok({object:{sha:'b'.repeat(40)}});
  else if(route.endsWith('/pages')){if(['POST','PUT'].includes(method))pages=data;response=pages?ok(pages):new Response('',{status:404});}
  else if(route.endsWith('/git/blobs')){const bytes=Buffer.from(data.content,'base64'),hash=sha('blob',bytes);blobs.set(hash,bytes);response=ok({sha:hash});}
  else if(route.endsWith('/git/trees')){const entries=new Map((data.base_tree?trees.get(data.base_tree):[]).map(e=>[e.path,e]));for(const entry of data.tree){if(entry.sha===null)entries.delete(entry.path);else entries.set(entry.path,entry);}const result=[...entries.values()],hash=sha('tree',Buffer.from(JSON.stringify(result)));trees.set(hash,result);response=ok({sha:hash});}
  else if(/\/git\/trees\/[a-f0-9]+$/.test(route))response=ok({tree:trees.get(route.split('/').at(-1)),truncated:false});
  else if(route.endsWith('/git/commits')){const hash=sha('commit',Buffer.from(JSON.stringify(data)));commits.set(hash,data);response=ok({sha:hash});}
  else if(/\/git\/commits\/[a-f0-9]+$/.test(route)){const c=commits.get(route.split('/').at(-1));response=ok({...c,tree:{sha:c?.tree}});}
  else if(route.endsWith('/git/refs')||route.endsWith('/git/refs/heads/'+branch)){
   if(method==='POST'&&head||method==='PATCH'&&(data.force!==false||!commits.get(data.sha)?.parents.includes(head)))response=new Response('',{status:422});
   else{head=data.sha;response=ok({object:{sha:head}});}
  }else throw Error('Unexpected mock route: '+route);
  await hook?.(call,'after',options.signal);return response;
 };
 return {request,calls,blobs,trees,commits,seed,get head(){return head;},setHead(value){head=value;},setHook(value){hook=value;},setManifest(value){manifest=value;},setServed(path,value){served.set(path,value);}};
}

export function repositoryFixture({exists=false,defaultBranch='main',ownerType='User',repositoryId=123}={}){
 const remote=githubFixture({branch:'main'}),base='/repos/example/notebook';let isPrivate=true,setupHook=null,beforeHook=null,tags=[];
 const repo=()=>({id:repositoryId,full_name:'example/notebook',private:isPrivate,default_branch:defaultBranch,permissions:{push:true,admin:true}});
 const request=async(url,options={})=>{
  const route=new URL(url).pathname,method=options.method??'GET',data=options.body?JSON.parse(options.body):null,call={route,method,data};
  await beforeHook?.(call);let response;const ok=value=>new Response(JSON.stringify(value));
  if(route==='/user')response=ok({login:'example'});
  else if(route===base)response=exists?ok(repo()):new Response('',{status:404});
  else if(route==='/users/example')response=ok({login:'example',type:ownerType});
  else if(route==='/user/repos'||route==='/orgs/example/repos'){
   if(exists)response=new Response('',{status:422});else{exists=true;isPrivate=data.private;response=ok(repo());}
  }else if(route===base+'/branches')response=ok(remote.head?[{name:defaultBranch,commit:{sha:remote.head}}]:[]);
  else if(route===base+'/tags')response=ok(tags);
  else if(route.startsWith(base+'/git/ref/heads/'))response=remote.head?(route===base+'/git/ref/heads/'+defaultBranch?ok({object:{sha:remote.head}}):new Response('',{status:404})):new Response(JSON.stringify({message:'Git Repository is empty.'}),{status:409});
  else if(route===base+'/contents/.nojekyll'){
   if(method!=='PUT'||data.content!=='')throw Error('Unexpected initialization');
   if(!remote.head){const commit=remote.seed({'.nojekyll':''},{message:data.message});response=ok({commit:{sha:commit}});}
   else{
    // A concurrent first commit can win between the empty check and PUT.
    // Contents without a previous SHA may add a file, but cannot replace one.
    const prior=remote.head,entries=remote.trees.get(remote.commits.get(prior).tree);
    if(entries.some(e=>e.path==='.nojekyll'))response=new Response('',{status:422});
    else{
     const empty=Buffer.alloc(0),blob=sha('blob',empty);remote.blobs.set(blob,empty);
     const next=[...entries,{path:'.nojekyll',type:'blob',mode:'100644',sha:blob}],tree=sha('tree',Buffer.from(JSON.stringify(next))),value={tree,parents:[prior],message:data.message},commit=sha('commit',Buffer.from(JSON.stringify(value)));
     remote.trees.set(tree,next);remote.commits.set(commit,value);remote.setHead(commit);response=ok({commit:{sha:commit}});
    }
   }
  }else if(route.startsWith(base+'/branches/')&&route.endsWith('/rename')){defaultBranch=data.new_name;response=ok({name:defaultBranch});}
  else return remote.request(url,options);
  remote.calls.push(call);await setupHook?.(call);return response;
 };
 return {...remote,request,get head(){return remote.head;},setSetupHook(hook){setupHook=hook;},setSetupBeforeHook(hook){beforeHook=hook;},setRepositoryId(value){repositoryId=value;},setTags(value){tags=value;}};
}
