import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildGithubTree,githubTreeRecords,verifyRemoteGithubTree} from '../src/github-trees.js';
import {admitGithubPlan,githubTreeFiles,githubFilePlan} from '../src/github-publication-plan.js';
import {githubFixture,sha} from './github-fixture.js';
import {truncatedGithubTrees} from './github-tree-fixture.js';

const file=(path,content=path,mode='100644')=>({path,mode,type:mode==='160000'?'commit':'blob',sha:sha('blob',Buffer.from(content))});
const entries=async stream=>{const result=[];for await(const entry of stream)result.push(entry);return result;};
const sorted=files=>[...files].sort((a,b)=>a.path.localeCompare(b.path));

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

test('a repository over ten thousand files is planned completely, with late conflicts and removals retained',async()=>{
 const files=Array.from({length:12037},(_,i)=>file('evidence/'+i+'.txt')),last=files.at(-1),candidate={files:new Map([['evidence/'+12036+'.txt','Revised']])};
 assert.equal(githubTreeFiles({tree:files}).length,files.length);
 let plan=await githubFilePlan(candidate,files,null);assert.deepEqual(plan.conflicts,[last.path]);assert.equal(plan.preserved.length,files.length-1);
 plan=await githubFilePlan(candidate,files,{files:[last,files[10000]]});assert.deepEqual(plan.conflicts,[]);assert.deepEqual(plan.removed,[files[10000].path]);assert.deepEqual(plan.replaced,[last.path]);assert.equal(plan.preservedEntries.length,files.length-2);
});

test('tree writes resume acknowledged batches, replay a lost response and retain exact files without moving a branch',async()=>{
 const remote=githubFixture({initialFiles:Object.fromEntries(Array.from({length:24},(_,i)=>['old/'+i+'.txt','Old '+i]))}),parent=remote.head,baseTree=remote.commits.get(parent).tree,original=remote.trees.get(baseTree);
 const added=Array.from({length:781},(_,i)=>file('research/'+i+'.html')),removed=original.slice(0,20).map(f=>f.path),journal={baseTree,entries:added,removed};
 let saved=null,posts=0,lost=true;const progress=[];
 const call=async(route,method='GET',data)=>{
  const response=await remote.request('https://api.github.com/repos/example/notebook'+route,{method,...(data?{body:JSON.stringify(data)}:{})});
  if(method==='POST'){posts++;assert.ok(data.tree.length<=256);assert.ok(Buffer.byteLength(JSON.stringify(data))<=128*1024);if(posts===2&&lost){lost=false;throw Error('Lost tree response');}}
  return response.json();
 };
 await assert.rejects(buildGithubTree(call,journal,{checkpoint:async()=>{saved=structuredClone(journal);}}),/Lost tree response/);
 assert.equal(saved.treeBuild.applied,256);assert.equal(saved.tree,undefined);assert.equal(remote.head,parent);
 const resumed=structuredClone(saved);await buildGithubTree(call,resumed,{checkpoint:async()=>{saved=structuredClone(resumed);},onProgress:(done,total)=>progress.push([done,total])});
 assert.equal(resumed.treeBuild.applied,added.length+removed.length);assert.equal(remote.head,parent);
 assert.deepEqual(sorted(remote.trees.get(resumed.tree)),sorted([...original.slice(20),...added]));
 const writes=remote.calls.filter(c=>c.method==='POST');assert.deepEqual(writes[1].data,writes[2].data);assert.equal(writes[0].data.base_tree,baseTree);
 assert.deepEqual(progress[0],[256,801]);const before=posts;await buildGithubTree(call,resumed,{checkpoint:async()=>assert.fail('Completed tree rewritten')});assert.equal(posts,before);
 await assert.rejects(buildGithubTree(call,{...resumed,treeBuild:{...resumed.treeBuild,total:0}},{checkpoint:async()=>{}}),{code:'PUBLISH_STALE'});
});

test('provider write byte budgets remain bounded for long paths and cancellation retains its last cursor',async()=>{
 const remote=githubFixture({initialFiles:{'keep':'Existing'}}),baseTree=remote.commits.get(remote.head).tree,journal={baseTree,entries:Array.from({length:301},(_,i)=>file('x'.repeat(3000)+'/'+i)),removed:[]},controller=new AbortController();let saved,largest=0;
 const call=async(route,method,data)=>{largest=Math.max(largest,Buffer.byteLength(JSON.stringify(data)));return (await remote.request('https://api.github.com/repos/example/notebook'+route,{method,body:JSON.stringify(data)})).json();};
 await assert.rejects(buildGithubTree(call,journal,{signal:controller.signal,checkpoint:async()=>{saved=structuredClone(journal);controller.abort();}}),{name:'AbortError'});
 assert.ok(saved.treeBuild.applied>0&&saved.treeBuild.applied<256);assert.ok(largest<=128*1024);assert.equal(saved.tree,undefined);
});

test('an oversized review is refused before creating an unreadable continuation journal',()=>{
 const plan={entries:[],preservedEntries:Array.from({length:2600},(_,i)=>file('long/'+String(i)+'/'+'x'.repeat(3800))),removed:[]};
 assert.throws(()=>admitGithubPlan(plan),error=>error.code==='PUBLISH_PLAN_CAPACITY'&&error.details[0].owner==='github-deployment-review'&&error.details[0].requestedBytes>error.details[0].maxBytes);
 assert.equal(admitGithubPlan({entries:[],preservedEntries:plan.preservedEntries.slice(0,10),removed:[]}).preservedEntries.length,10);
});
