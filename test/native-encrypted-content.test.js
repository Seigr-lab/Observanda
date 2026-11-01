import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rename,symlink,rm,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomBytes,randomUUID} from 'node:crypto';
import {Workspace,digest} from '../src/storage.js';
import {FileContent,writeContent} from '../src/file-content.js';
import {closeIdleMutationFiles,withMutationFilesSession} from '../src/mutation-files.js';
import {OperationalDiagnostics,withDiagnostics,diagnostic} from '../src/operational-diagnostics.js';
const BLOCK=1024*1024;
async function fixture(t){const root=await mkdtemp(path.join(os.tmpdir(),'observanda-encrypted-anchor-')),outside=path.join(root,'outside');await mkdir(outside);await writeFile(path.join(outside,'sentinel'),'outside');
 const owners={};for(const name of ['source','target']){const location=path.join(root,name);await mkdir(location);owners[name]=new Workspace(location,{id:randomUUID(),key:randomBytes(32)});}
 t.after(async()=>{await closeIdleMutationFiles();assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('observanda-encrypted-anchor-'));await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});return {root,outside,...owners};}
for(const resume of [false,true])test('fresh-key copying keeps opened source and target parents across replacement; resume='+resume,{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t),bytes=randomBytes(3*BLOCK+17),source=path.join(f.source.root,'original'),target=path.join(f.target.root,'original');await writeContent(f.source,source,[bytes]);let replaced=false;
 await new FileContent(f.source,source,bytes.length,digest(bytes)).copyTo(f.target,target,{resume,onProgress:async done=>{if(done<BLOCK||replaced)return;replaced=true;for(const [name,owner] of [['source',f.source],['target',f.target]]){await rename(owner.root,path.join(f.root,'opened-'+name));await symlink(f.outside,owner.root,'junction');}}});
 const restored=new Workspace(path.join(f.root,'opened-target'),f.target.vault);assert.deepEqual(await restored.readFile(path.join(restored.root,'original')),bytes);assert.deepEqual(await readdir(f.outside),['sentinel']);
});
for(const resume of [false,true])test('fresh-key publication refuses an independently created destination; resume='+resume,async t=>{
 const f=await fixture(t),bytes=randomBytes(BLOCK+9),source=path.join(f.source.root,'original'),target=path.join(f.target.root,'original');await writeContent(f.source,source,[bytes]);
 await assert.rejects(new FileContent(f.source,source,bytes.length,digest(bytes)).copyTo(f.target,target,{resume,onProgress:async done=>{if(done===bytes.length)await writeFile(target,'unrelated',{flag:'wx'});}}),{code:'EXISTS'});assert.equal(await readFile(target,'utf8'),'unrelated');
});
test('unknown-length finalization and publication stay on the admitted parent',{skip:process.platform==='win32'},async t=>{
 const f=await fixture(t),bytes=randomBytes(2*BLOCK+9),target=path.join(f.target.root,'original');
 async function* chunks(){yield bytes.subarray(0,BLOCK);await rename(f.target.root,path.join(f.root,'opened-target'));await symlink(f.outside,f.target.root,'junction');yield bytes.subarray(BLOCK);}
 await writeContent(f.target,target,chunks());const restored=new Workspace(path.join(f.root,'opened-target'),f.target.vault);assert.deepEqual(await restored.readFile(path.join(restored.root,'original')),bytes);assert.deepEqual(await readdir(f.outside),['sentinel']);
});
test('encrypted publication stays anchored if the parent is replaced after closing the staged file',async t=>{
 const f=await fixture(t),bytes=randomBytes(BLOCK+31),target=path.join(f.target.root,'original');let replaced=false;
 await withMutationFilesSession(async service=>{const open=service.open;service.open=async root=>{const directory=await open.call(service,root);if(root===f.target.root){const publish=directory.rename;directory.rename=async function(...args){if(!replaced){replaced=true;await rename(root,path.join(f.root,'opened-target'));await symlink(f.outside,root,'junction');}return publish.apply(this,args);};}return directory;};try{await writeContent(f.target,target,[bytes]);}finally{service.open=open;}});
 assert.equal(replaced,true);const restored=new Workspace(path.join(f.root,'opened-target'),f.target.vault);assert.deepEqual(await restored.readFile(path.join(restored.root,'original')),bytes);assert.deepEqual(await readdir(f.outside),['sentinel']);
});
test('successful small encrypted writes reuse one idle helper and release it explicitly',async t=>{
 const f=await fixture(t),sink=new OperationalDiagnostics();await closeIdleMutationFiles();
 await withDiagnostics(sink,async()=>{for(let i=0;i<16;i++)await writeContent(f.target,path.join(f.target.root,'item-'+i),[Buffer.from('small original '+i)]);diagnostic('request',{route:'storage',method:'POST'});});
 assert.equal((await sink.snapshot()).entries.at(-1).nativeFilesystemStarts,1);assert.equal((await readdir(f.target.root)).length,16);await sink.close();await closeIdleMutationFiles();
});
