import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rmdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {withMutationFilesSession} from '../src/mutation-files.js';
import {nativeMember,nativeMemberCursor} from '../src/native-storage-tree.js';
import {copyRuntimeWithProof,runtimeProofEntries,verifyRuntimeProof,retireRuntimeFromProof} from '../src/postgres-runtime-upgrade-proof.js';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fixture(t){const parent=path.resolve(os.tmpdir()),root=await mkdtemp(path.join(parent,'observanda-runtime-proof-')),source=path.join(root,'source'),target=path.join(root,'target');await mkdir(source);await mkdir(target);t.after(async()=>{assert.equal(path.dirname(root),parent);assert.match(path.basename(root),/^observanda-runtime-proof-/);await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});return {root,source,target,journal:{id:randomUUID(),key:randomBytes(32).toString('hex'),pages:0}};}
function countDirectories(root){const stats={opens:0,hashes:0,active:0,peak:0},wrapped=new WeakSet();function wrap(directory,owned=false){if(wrapped.has(directory))return directory;wrapped.add(directory);if(owned){stats.active++;stats.peak=Math.max(stats.peak,stats.active);}const open=directory.directory,close=directory.close,hash=directory.hash;let closed=false;directory.directory=async function(...args){stats.opens++;const child=await open.apply(this,args);return child?wrap(child,true):child;};directory.close=async function(){if(closed)return;closed=true;try{return await close.call(this);}finally{if(owned)stats.active--;}};directory.hash=async function(...args){stats.hashes++;return hash.apply(this,args);};return directory;}return {root:wrap(root),stats,reset(){assert.equal(stats.active,0);stats.opens=stats.hashes=stats.peak=0;}};}

test('runtime proof verification and retirement retain bounded ancestry while hashing every file',async t=>{
 const f=await fixture(t),body=Buffer.alloc(8192,19),expected=hash(body);for(let branch=0;branch<4;branch++){const directory=path.join(f.source,'data','base',String(branch),'files');await mkdir(directory,{recursive:true});for(let i=0;i<64;i++)await writeFile(path.join(directory,String(i).padStart(4,'0')),body);}await writeFile(path.join(f.root,'external'),'preserved');
 await withMutationFilesSession(async service=>{const source=await service.open(f.source),target=await service.open(f.target);try{
  await copyRuntimeWithProof(source,target,f.journal,{directory:f.target});const measured=countDirectories(target);
  // Measure the prior per-file ancestry work against the same native files.
  for await(const entry of runtimeProofEntries(target,f.journal))await nativeMember(target,entry.path,async(parent,name)=>{if(entry.directory){const child=await parent.directory(name);await child.close();}else assert.equal((await parent.hash(name)).sha256,expected);});
  const baseline={...measured.stats};assert.equal(baseline.hashes,256);measured.reset();await verifyRuntimeProof(source,target,f.journal);assert.equal(measured.stats.hashes,256);assert.equal(measured.stats.active,0);assert.ok(measured.stats.peak<=6);assert.ok(measured.stats.opens<baseline.opens/10);const verified={...measured.stats};
  const retired=countDirectories(source);await retireRuntimeFromProof(source,target,f.journal);assert.equal(retired.stats.hashes,256);assert.equal(retired.stats.active,0);assert.ok(retired.stats.peak<=5);assert.ok(retired.stats.opens<baseline.opens/10);assert.deepEqual(await readdir(f.source),[]);assert.equal(await readFile(path.join(f.root,'external'),'utf8'),'preserved');
  assert.equal(hash(await readFile(path.join(f.target,'data/base/3/files/0063'))),expected);t.diagnostic(JSON.stringify({files:256,depth:4,baselineTarget:baseline,verifiedTarget:verified,retiredSource:retired.stats}));
 }finally{await source.close();await target.close();}});
});

test('retirement cancellation closes cursors and retries tolerate already removed parents',async t=>{
 const f=await fixture(t);for(const branch of ['a','b']){await mkdir(path.join(f.source,branch));for(let i=0;i<32;i++)await writeFile(path.join(f.source,branch,String(i).padStart(2,'0')),'retained '+branch+i);}
 await withMutationFilesSession(async service=>{const source=await service.open(f.source),target=await service.open(f.target);try{
  await copyRuntimeWithProof(source,target,f.journal,{directory:f.target});let first;for await(const entry of runtimeProofEntries(target,f.journal))if(!entry.directory){first=entry.path.split('/')[0];break;}assert.ok(['a','b'].includes(first));const controller=new AbortController(),measured=countDirectories(source),directory=source.directory;let removed=0;
  source.directory=async function(...args){const child=await directory.apply(this,args);if(child){const remove=child.remove;child.remove=async function(...values){const result=await remove.apply(this,values);if(++removed===32)controller.abort();return result;};}return child;};
  await assert.rejects(retireRuntimeFromProof(source,target,f.journal,controller.signal),{name:'AbortError'});assert.equal(measured.stats.active,0);assert.deepEqual(await readdir(path.join(f.source,first)),[]);await rmdir(path.join(f.source,first));source.directory=directory;
  await retireRuntimeFromProof(source,target,f.journal);assert.equal(measured.stats.active,0);assert.deepEqual(await readdir(f.source),[]);assert.equal(await readFile(path.join(f.target,first,'31'),'utf8'),'retained '+first+31);
 }finally{await source.close();await target.close();}});
});

test('cursor missing-parent recovery does not cache absence and tampered leaves remain intact',async t=>{
 const f=await fixture(t);await mkdir(path.join(f.source,'branch'));await writeFile(path.join(f.source,'branch','leaf'),'retained');
 await withMutationFilesSession(async service=>{const source=await service.open(f.source),target=await service.open(f.target);try{
  const cursor=nativeMemberCursor(source,{missing:true});try{assert.equal((await cursor.member('new/leaf')).directory,null);await mkdir(path.join(f.source,'new'));await writeFile(path.join(f.source,'new','leaf'),'new');const found=await cursor.member('new/leaf');assert.equal((await found.directory.read(found.name)).bytes.toString(),'new');}finally{await cursor.close();}
  await copyRuntimeWithProof(source,target,f.journal,{directory:f.target});const measured=countDirectories(source);await writeFile(path.join(f.source,'branch','leaf'),'tampered');await assert.rejects(retireRuntimeFromProof(source,target,f.journal),{code:'DATABASE_GUARD_STORAGE',reason:'source-or-copy-changed'});assert.equal(measured.stats.active,0);assert.equal(await readFile(path.join(f.source,'branch','leaf'),'utf8'),'tampered');assert.equal(await readFile(path.join(f.target,'branch','leaf'),'utf8'),'retained');
 }finally{await source.close();await target.close();}});
});

test('native hashing preserves exact digests across empty, partial-buffer and large files',async t=>{
 const f=await fixture(t);await withMutationFilesSession(async service=>{const source=await service.open(f.source);try{
  for(const size of [0,4095,65537,1048593,16777216]){const bytes=Buffer.alloc(size,37),name=String(size);await writeFile(path.join(f.source,name),bytes);const result=await source.hash(name);assert.equal(result.bytes,size);assert.equal(result.sha256,hash(bytes));assert.equal(result.identity,(await source.stat(name)).identity);}
 }finally{await source.close();}});
});
