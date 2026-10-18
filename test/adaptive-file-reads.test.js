import {test} from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,mkdir,rm,writeFile,readFile} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {AdaptiveReadPool,adaptiveReadMap} from '../src/adaptive-reads.js';
import {workspaceFiles,hashWorkspaceFile} from '../src/workspace-inventory.js';
import {Workspace,digest,serialize} from '../src/storage.js';
import {FileContent,writeContent} from '../src/file-content.js';
import {withOperationProgress,operationStage,operationAdvance} from '../src/operation-progress.js';

async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-adaptive-reads-'));
 t.after(async()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('observanda-adaptive-reads-'));await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
 await mkdir(path.join(root,'.observanda'));return root;
}
function observedPool(){
 const pool=new AdaptiveReadPool({sampler:{start(){},stop(){},read(){return {cores:8,total:16*1024**3,available:12*1024**3,busy:0,delayMs:0};}},intervalMs:60000});
 const run=pool.run.bind(pool);let active=0,peak=0;
 pool.run=(operation,options)=>run(async()=>{active++;peak=Math.max(peak,active);try{return await operation();}finally{active--;}},options);
 return {pool,peak:()=>peak,active:()=>active};
}
test('adaptive inventories overlap real reads while retaining exact ordered receipt bytes',async t=>{
 const root=await fixture(t),observed=observedPool();
 await writeFile(path.join(root,'workspace.observanda'),'Synthetic descriptor');
 for(let i=0;i<12;i++)await writeFile(path.join(root,'.observanda',i+'.bin'),Buffer.alloc(256*1024+i,i));
 const sequential=[];
 for await(const file of workspaceFiles(root,{includeDatabase:false,hashFiles:false}))sequential.push({path:file.path,bytes:file.bytes,sha256:await hashWorkspaceFile(path.join(root,file.path))});
 const concurrent=await Array.fromAsync(workspaceFiles(root,{includeDatabase:false,readPool:observed.pool}));
 assert.equal(serialize(concurrent),serialize(sequential));assert.equal(observed.peak(),2);assert.equal(observed.active(),0);
 const controller=new AbortController();controller.abort();
 await assert.rejects(Array.fromAsync(workspaceFiles(root,{includeDatabase:false,signal:controller.signal,readPool:observed.pool})),{name:'AbortError'});
});
test('concurrent encrypted verification aggregates progress and still rejects damaged originals',async t=>{
 const root=await fixture(t),observed=observedPool(),key=randomBytes(32),workspace=new Workspace(root,{id:randomUUID(),key}),contents=[];
 t.after(()=>key.fill(0));
 for(let i=0;i<6;i++){
  const file=path.join(root,'.observanda',i+'.bin'),bytes=Buffer.alloc(1024*1024+13,i),saved=await writeContent(workspace,file,[bytes]);
  contents.push(new FileContent(workspace,file,saved.size,saved.sha256));assert.equal(saved.sha256,digest(bytes));
 }
 const events=[];
 await withOperationProgress(event=>events.push(event),()=>operationStage('checking',{total:contents.length,unit:'files'},async()=>{
  for await(const content of adaptiveReadMap(contents,(value,signal)=>value.verify({signal,reportProgress:false}),{pool:observed.pool})){assert.ok(content instanceof FileContent);operationAdvance();}
 }));
 assert.equal(observed.peak(),2);assert.equal(observed.active(),0);
 assert.ok(events.some(event=>event.stage==='checking'&&event.completed===contents.length));
 assert.ok(!events.some(event=>event.stage==='verify-file'));
 assert.equal(Math.max(...events.map(event=>event.activity.bytes)),contents.reduce((sum,item)=>sum+item.size,0));
 const bytes=await readFile(contents[1].file);bytes[bytes.length-1]^=1;await writeFile(contents[1].file,bytes);
 await assert.rejects(Array.fromAsync(adaptiveReadMap(contents,(value,signal)=>value.verify({signal,reportProgress:false}),{pool:observed.pool})),error=>['MEDIA_INVALID','ENCRYPTION_DAMAGED'].includes(error.code));
 assert.equal(observed.active(),0);
});
