import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LocalExportManifest} from '../src/local-export-manifest.js';
import {digest,serialize} from '../src/storage-format.js';

function fixture(){
 const data=new Map();let reads=0,largest=0;
 const workspace={async readMetadata(name,limit){reads++;const value=data.get(name)??null;if(value!==null)assert.ok(Buffer.byteLength(value)<=limit);return value;},async writeMetadata(name,value){largest=Math.max(largest,Buffer.byteLength(value));data.set(name,value);}};
 return {data,workspace,store:new LocalExportManifest(workspace,{write:fn=>fn()}),stats:()=>({reads,largest}),reset:()=>{reads=0;}};
}
const name=i=>'files/'+String(i).padStart(8,'0')+'-'+('long-name-'.repeat(48))+'.json';
const description=i=>({bytes:i,sha256:digest(String(i))});

test('local export manifests exceed the former journal envelope and seek late reviews in bounded pages',async()=>{
 const f=fixture(),builder=f.store.builder('changes'),count=25017;let fullBytes=0;
 for(let i=0;i<count;i++){const value={path:name(i),kind:'replaced',before:description(i),after:description(i+1)};fullBytes+=Buffer.byteLength(serialize(value));await builder.append(value);}
 const ref=await builder.finish();assert.ok(fullBytes>16*1024*1024);assert.ok(JSON.stringify(ref).length<1500);assert.equal(ref.root.count,count);assert.ok(f.stats().largest<262144);
 const fresh=new LocalExportManifest(f.workspace,{write:fn=>fn()});f.reset();
 const late=await fresh.page(ref,{offset:25000,limit:50});assert.equal(late.length,17);assert.equal(late[0].path,name(25000));assert.equal(late.at(-1).path,name(count-1));assert.ok(f.stats().reads<30,'A late file review scanned the preceding manifest');
 assert.deepEqual(await fresh.find(ref,name(12345)),{path:name(12345),kind:'replaced',before:description(12345),after:description(12346)});
 let visited=0;for await(const item of fresh.entries(ref)){assert.equal(item.path,name(visited));visited++;}assert.equal(visited,count);
 await assert.rejects(fresh.page(ref,{offset:-1}),{code:'INVALID'});
 const node='.observanda/materials/sequences/local-export-nodes/'+ref.root.hash+'.json';f.data.set(node,'{}');
 await assert.rejects(new LocalExportManifest(f.workspace).page(ref,{offset:25000}),{code:'LOCAL_EXPORT_DAMAGED'});
});

test('export file manifests reject duplicate names and retain earlier roots across new editions',async()=>{
 const f=fixture(),first=f.store.builder('files');await first.append({path:'index.html',...description(1)});await first.append({path:'styles.css',...description(2)});const old=await first.finish();
 const next=f.store.builder('files');await next.append({path:'index.html',...description(3)});const current=await next.finish();
 assert.equal((await f.store.find(old,'index.html')).bytes,1);assert.equal((await f.store.find(current,'index.html')).bytes,3);assert.equal((await f.store.page(old)).length,2);
 const duplicate=f.store.builder('files');await duplicate.append({path:'A.html',...description(1)});await assert.rejects(duplicate.append({path:'a.html',...description(2)}),{code:'LOCAL_EXPORT_DAMAGED'});
 await assert.rejects(f.store.builder('files').append({path:'../outside',...description(1)}),{code:'UNSAFE'});
 await assert.rejects(f.store.builder('changes').append({path:'index.html',kind:'added',before:null,after:null}),{code:'LOCAL_EXPORT_DAMAGED'});
 const empty=await f.store.builder('files').finish();assert.deepEqual(await f.store.page(empty),[]);assert.equal(await f.store.find(empty,'index.html'),null);
});
