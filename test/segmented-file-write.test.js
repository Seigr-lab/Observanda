import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,randomBytes} from 'node:crypto';
import {Workspace,digest} from '../src/storage.js';
import {writeContent,FileContent,contentBuffer} from '../src/file-content.js';
import {clearVault} from '../src/encryption.js';
const BLOCK=1024*1024;
async function fixture(t){const root=await mkdtemp(path.join(os.tmpdir(),'observanda-segmented-write-')),vault={id:randomUUID(),key:randomBytes(32)},workspace=new Workspace(root,vault),file=path.join(root,'original');t.after(async()=>{clearVault(vault);assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('observanda-segmented-write-'));await rm(root,{recursive:true,force:true});});return {root,vault,workspace,file};}
for(const size of [0,1,BLOCK,BLOCK+1,3*BLOCK+27])test('declared immutable content writes the seekable format at boundary '+size,async t=>{
 const f=await fixture(t),bytes=randomBytes(size),expected={size,sha256:digest(bytes)};let checkpoints=0;
 async function* source(){for(let offset=0;offset<size;offset+=713)yield bytes.subarray(offset,offset+713);}
 const saved=await writeContent(f.workspace,f.file,source(),{expected,beforeCommit:value=>{assert.deepEqual(value,expected);checkpoints++;}});
 assert.equal(checkpoints,1);assert.deepEqual(saved,expected);assert.equal((await readFile(f.file)).subarray(0,8).toString(),'OBSENC02');
 assert.deepEqual(await contentBuffer(new FileContent(f.workspace,f.file,size,saved.sha256)),bytes);assert.deepEqual(await f.workspace.readFile(f.file),bytes);assert.deepEqual(await readdir(f.root),['original']);
});
test('wrong declared size or digest cancellation and revoked keys cannot replace an existing original',async t=>{
 const f=await fixture(t),prior=Buffer.from('retained original'),bytes=randomBytes(BLOCK+11),expected={size:bytes.length,sha256:digest(bytes)};
 await writeContent(f.workspace,f.file,[prior]);const original=await readFile(f.file);
 for(const declared of [{...expected,size:expected.size-1},{...expected,size:expected.size+1},{...expected,sha256:'0'.repeat(64)}]){await assert.rejects(writeContent(f.workspace,f.file,[bytes],{expected:declared}),{code:'MEDIA_INVALID'});assert.deepEqual(await readFile(f.file),original);}
 const controller=new AbortController();await assert.rejects(writeContent(f.workspace,f.file,[bytes],{expected,signal:controller.signal,beforeCommit:()=>controller.abort()}),{name:'AbortError'});
 await assert.rejects(writeContent(f.workspace,f.file,[bytes],{expected,beforeCommit:()=>clearVault(f.vault)}),{code:'ACCESS_LOCKED'});
 assert.deepEqual(await readFile(f.file),original);assert.deepEqual(await readdir(f.root),['original']);
});
