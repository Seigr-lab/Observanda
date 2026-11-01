import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,readdir,rename,symlink,rm,lstat,link} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {windowsMutationFiles} from '../src/windows-mutation-files.js';
import {posixMutationFiles} from '../src/posix-mutation-files.js';

const windows={skip:!['win32','linux','darwin'].includes(process.platform)},digest=bytes=>({bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
async function fixture(t){const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-native-mutations-')),root=path.join(parent,'root'),outside=path.join(parent,'outside');await mkdir(root);await mkdir(outside);const service=await (process.platform==='win32'?windowsMutationFiles():posixMutationFiles());
 t.after(async()=>{await service.close();assert.equal(path.dirname(parent),path.resolve(os.tmpdir()));assert.ok(path.basename(parent).startsWith('observanda-native-mutations-'));await rm(parent,{recursive:true,force:true,maxRetries:10,retryDelay:100});});return {parent,root,outside,service,handle:await service.open(root)};}
test('native directory operations stream, hash, copy and recoverable no-clobber replacements',windows,async t=>{
 const f=await fixture(t),content=Buffer.alloc(12*1024*1024+13,93),expected=digest(content),progress=[];
 const before=await lstat(f.root,{bigint:true});assert.equal(f.handle.identity,before.dev+':'+before.ino);
 const a=await f.handle.directory('nested',{create:true});await a.write('original',[content.subarray(0,17),content.subarray(17)],{...expected,onProgress:n=>progress.push(n)});
 assert.ok(progress.length>0);assert.deepEqual(await readFile(path.join(f.root,'nested','original')),content);
 const hashed=await a.hash('original');assert.equal(hashed.sha256,expected.sha256);assert.equal(hashed.bytes,expected.bytes);
 await a.copy(a,'original','copy',expected);assert.equal((await a.hash('copy')).sha256,expected.sha256);
 await assert.rejects(a.copy(a,'original','copy',expected),{code:'EEXIST'});
 await a.rename('original',a,'backup',{identity:hashed.identity});await a.link('copy',a,'current');
 await assert.rejects(a.hash('copy'),{code:'UNSAFE'});assert.equal((await a.hash('current',{links:true})).sha256,expected.sha256);
 await a.remove('copy',{links:true});await a.remove('backup');assert.deepEqual(await readFile(path.join(f.root,'nested','current')),content);
 await a.write('empty',[],digest(Buffer.alloc(0)));assert.equal((await a.hash('empty')).bytes,0);
 assert.deepEqual((await Array.fromAsync(a.entries())).map(x=>x.name).sort(),['current','empty']);
 await a.remove('empty');await a.remove('current');await a.close();await f.handle.remove('nested',{folder:true});assert.deepEqual(await readdir(f.root),[]);
});
test('native operations stay anchored after ancestor replacement and reject links and traversal',windows,async t=>{
 const f=await fixture(t),original=path.join(f.parent,'original');await writeFile(path.join(f.outside,'sentinel'),'unrelated');
 await rename(f.root,original);await symlink(f.outside,f.root,'junction');
 const content=Buffer.from('authorized');await f.handle.write('created',[content],digest(content));
 assert.equal(await readFile(path.join(original,'created'),'utf8'),'authorized');assert.deepEqual(await readdir(f.outside),['sentinel']);
 await assert.rejects(f.service.open(f.root),{code:'UNSAFE'});
 await symlink(f.outside,path.join(original,'link'),'junction');await assert.rejects(f.handle.directory('link'),{code:'UNSAFE'});
 await assert.rejects(f.handle.directory('..'),{code:'UNSAFE'});assert.throws(()=>f.handle.write('../escape',[content],digest(content)),{code:'UNSAFE'});
 await assert.rejects(f.handle.remove('created',{identity:'not-the-file'}),{code:'CONFLICT'});assert.equal(await readFile(path.join(original,'created'),'utf8'),'authorized');
});
test('native failed writes remove their own incomplete file and retain unrelated data',windows,async t=>{
 const f=await fixture(t),data=Buffer.from('synthetic output');await writeFile(path.join(f.root,'sentinel'),'unrelated');
 await assert.rejects(f.handle.write('wrong-digest',[data],{bytes:data.length,sha256:'0'.repeat(64)}),{code:'STORAGE_COPY'});
 assert.deepEqual(await readdir(f.root),['sentinel']);
 await f.handle.write('after-error',[data],digest(data));assert.equal(await readFile(path.join(f.root,'after-error'),'utf8'),'synthetic output');
});

test('native leaf operations refuse hard links and symbolic links, and directory rename cannot clobber',windows,async t=>{
 const f=await fixture(t);await writeFile(path.join(f.outside,'sentinel'),'outside');
 await link(path.join(f.outside,'sentinel'),path.join(f.root,'hard'));await symlink(path.join(f.outside,'sentinel'),path.join(f.root,'symbolic'));
 for(const name of ['hard','symbolic']){await assert.rejects(f.handle.hash(name),{code:'UNSAFE'});await assert.rejects(f.handle.file(name,{mode:'update'}),{code:'UNSAFE'});}
 const first=await f.handle.directory('first',{create:true}),second=await f.handle.directory('second',{create:true});await first.close();await second.close();
 await assert.rejects(f.handle.rename('first',f.handle,'second',{folder:true}),{code:'EEXIST'});assert.equal(await readFile(path.join(f.outside,'sentinel'),'utf8'),'outside');
});
test('native handles refuse an in-place reparse conversion without following its target',{skip:process.platform!=='win32'},async t=>{
 const f=await fixture(t),data=Buffer.from('authorized');await writeFile(path.join(f.outside,'sentinel'),'unrelated');
 const result=await promisify(execFile)(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./fixtures/replace-directory-junction.ps1',import.meta.url)),'-Directory',f.root,'-Target',f.outside],{windowsHide:true});assert.equal(result.stdout.trim(),'0');
 await assert.rejects(f.handle.write('created',[data],digest(data)),{code:'UNSAFE'});
 await assert.rejects(f.handle.remove('sentinel'),{code:'UNSAFE'});await assert.rejects(f.handle.rename('sentinel',f.handle,'renamed'),{code:'UNSAFE'});
 assert.deepEqual(await readdir(f.outside),['sentinel']);assert.equal(await readFile(path.join(f.outside,'sentinel'),'utf8'),'unrelated');
});
test('native cancellation closes the worker and directory enumeration spans bounded pages',windows,async t=>{
 const f=await fixture(t);for(let i=0;i<1100;i++)await writeFile(path.join(f.root,'entry-'+i),'');let count=0;for await(const entry of f.handle.entries()){assert.equal(entry.directory,false);count++;}assert.equal(count,1100);
 const block=Buffer.alloc(1048576,17),expected=digest(Buffer.concat([block,block])),controller=new AbortController();
 async function* interrupted(){yield block;controller.abort(new Error('Synthetic cancellation'));yield block;}
 await assert.rejects(f.handle.write('interrupted',interrupted(),{...expected,signal:controller.signal}),/Synthetic cancellation/);await f.service.close();
 assert.deepEqual(await readdir(f.outside),[]);assert.equal(await readFile(path.join(f.root,'entry-0'),'utf8'),'');
});
