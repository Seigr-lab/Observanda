import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildGithubTree,githubTreeRecords,verifyRemoteGithubTree} from '../src/github-trees.js';
import {admitGithubPlan,githubTreeFiles} from '../src/github-publication-plan.js';
import {githubFixture,sha} from './github-fixture.js';
import {truncatedGithubTrees} from './github-tree-fixture.js';

const file=(path,content=path,mode='100644')=>({path,mode,type:mode==='160000'?'commit':'blob',sha:sha('blob',Buffer.from(content))});
const entries=async stream=>{const result=[];for await(const entry of stream)result.push(entry);return result;};
const sorted=files=>[...files].sort((a,b)=>a.path.localeCompare(b.path));
// The ordered rows of a deployment's indexed review, as buildGithubTree reads them.
const rows=collections=>({count:kind=>collections[kind]?.length??0,at:async(kind,index)=>collections[kind][index]});

test('recursive truncation falls back to immutable subtrees without dropping duplicate-content directories or modes',async()=>{
 const remote=githubFixture({initialFiles:{'README.md':'Retained','a/one.txt':'one','b/one.txt':'one','deep/inside/two.txt':'two'}}),root=remote.commits.get(remote.head).tree,files=remote.trees.get(root);
 files.push(file('bin/tool','tool','100755'),file('bin/link','../tool','120000'),file('vendor/submodule','commit','160000'));
 const adapter=truncatedGithubTrees(remote,{threshold:1}),call=async route=>(await adapter.request('https://api.github.com/repos/example/notebook'+route)).json();
 const actual=await entries(githubTreeRecords(call,root));assert.deepEqual(sorted(actual),sorted(files));
 await verifyRemoteGithubTree(call,root,files);assert.ok(adapter.reads.some(path=>!path.includes('?')));
 assert.equal(actual.filter(f=>f.path.endsWith('one.txt')).length,2);
 await assert.rejects(verifyRemoteGithubTree(call,root,files.slice(1)),{code:'PUBLISH_REMOTE'});
 await assert.rejects(verifyRemoteGithubTree(call,root,[...files,file('missing')]),{code:'PUBLISH_REMOTE'});
});

test('provider traversal rejects incomplete flat listings, malformed paths, cycles, wrong tree identities and cancellation',async()=>{
 const root='a'.repeat(40),child='b'.repeat(40),recursive={truncated:true,tree:[]};
 for(const response of [{truncated:true,tree:[]},{tree:[file('../escape')]},{tree:[file('nested/file')]},{sha:child,tree:[]},{tree:[file('same'),file('same')]},{tree:[{path:'cycle',mode:'040000',type:'tree',sha:root}]}]){
  await assert.rejects(entries(githubTreeRecords(async route=>route.includes('?')?recursive:response,root)),{code:response.truncated?'PUBLISH_TREE_INCOMPLETE':'PUBLISH_REMOTE'});
 }
 const controller=new AbortController();let calls=0;
 await assert.rejects(entries(githubTreeRecords(async()=>{calls++;controller.abort();return {tree:[file('first')]};},root,{signal:controller.signal})),{name:'AbortError'});assert.equal(calls,1);
});

test('a repository tree over ten thousand files is read completely',()=>{
 const files=Array.from({length:12037},(_,i)=>file('evidence/'+i+'.txt'));
 assert.equal(githubTreeFiles({tree:files}).length,files.length);
});

test('tree writes resume acknowledged batches, replay a lost response and retain exact files without moving a branch',async()=>{
 const remote=githubFixture({initialFiles:Object.fromEntries(Array.from({length:24},(_,i)=>['old/'+i+'.txt','Old '+i]))}),parent=remote.head,baseTree=remote.commits.get(parent).tree,original=remote.trees.get(baseTree);
 const added=Array.from({length:781},(_,i)=>file('research/'+i+'.html')),removed=original.slice(0,20).map(f=>f.path),journal={baseTree},reader=rows({entries:added,removed:removed.map(path=>({path}))});
 let saved=null,posts=0,lost=true;const progress=[];
 const call=async(route,method='GET',data)=>{
  const response=await remote.request('https://api.github.com/repos/example/notebook'+route,{method,...(data?{body:JSON.stringify(data)}:{})});
  if(method==='POST'){posts++;assert.ok(data.tree.length<=256);assert.ok(Buffer.byteLength(JSON.stringify(data))<=128*1024);if(posts===2&&lost){lost=false;throw Error('Lost tree response');}}
  return response.json();
 };
 await assert.rejects(buildGithubTree(call,journal,{reader,checkpoint:async()=>{saved=structuredClone(journal);}}),/Lost tree response/);
 assert.equal(saved.treeBuild.applied,256);assert.equal(saved.tree,undefined);assert.equal(remote.head,parent);
 const resumed=structuredClone(saved);await buildGithubTree(call,resumed,{reader,checkpoint:async()=>{saved=structuredClone(resumed);},onProgress:(done,total)=>progress.push([done,total])});
 assert.equal(resumed.treeBuild.applied,added.length+removed.length);assert.equal(remote.head,parent);
 assert.deepEqual(sorted(remote.trees.get(resumed.tree)),sorted([...original.slice(20),...added]));
 const writes=remote.calls.filter(c=>c.method==='POST');assert.deepEqual(writes[1].data,writes[2].data);assert.equal(writes[0].data.base_tree,baseTree);
 assert.deepEqual(progress[0],[256,801]);const before=posts;await buildGithubTree(call,resumed,{reader,checkpoint:async()=>assert.fail('Completed tree rewritten')});assert.equal(posts,before);
 await assert.rejects(buildGithubTree(call,{...resumed,treeBuild:{...resumed.treeBuild,total:0}},{reader,checkpoint:async()=>{}}),{code:'PUBLISH_STALE'});
 await assert.rejects(buildGithubTree(call,{baseTree},{checkpoint:async()=>{}}),{code:'PUBLISH_STALE'});
});

test('provider write byte budgets remain bounded for long paths and cancellation retains its last cursor',async()=>{
 const remote=githubFixture({initialFiles:{'keep':'Existing'}}),baseTree=remote.commits.get(remote.head).tree,journal={baseTree},reader=rows({entries:Array.from({length:301},(_,i)=>file('x'.repeat(3000)+'/'+i))}),controller=new AbortController();let saved,largest=0;
 const call=async(route,method,data)=>{largest=Math.max(largest,Buffer.byteLength(JSON.stringify(data)));return (await remote.request('https://api.github.com/repos/example/notebook'+route,{method,body:JSON.stringify(data)})).json();};
 await assert.rejects(buildGithubTree(call,journal,{reader,signal:controller.signal,checkpoint:async()=>{saved=structuredClone(journal);controller.abort();}}),{name:'AbortError'});
 assert.ok(saved.treeBuild.applied>0&&saved.treeBuild.applied<256);assert.ok(largest<=128*1024);assert.equal(saved.tree,undefined);
});

test('a review without indexed collections, including a version 1 inline review, is refused',()=>{
 assert.throws(()=>admitGithubPlan({version:1,entries:[],preservedEntries:[file('kept')],removed:[]}),{code:'PUBLISH_STALE'});
 assert.throws(()=>admitGithubPlan({version:2,entries:[],preservedEntries:[],removed:[]}),{code:'PUBLISH_OWNERSHIP'});
});
