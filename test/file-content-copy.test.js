import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,readdir,writeFile,rm,utimes} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {Workspace,digest} from '../src/storage.js';
import {FileContent,writeContent} from '../src/file-content.js';
import {clearVault} from '../src/encryption.js';
import {withOperationProgress} from '../src/operation-progress.js';
async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-owner-file-copy-')),source=new Workspace(path.join(root,'source'),{id:randomUUID(),key:randomBytes(32)}),target=new Workspace(path.join(root,'target'),{id:randomUUID(),key:randomBytes(32)});
 await mkdir(source.root);await mkdir(target.root);const file=path.join(source.root,'original'),destination=path.join(target.root,'original'),bytes=randomBytes(3*1024*1024+51),written=await writeContent(source,file,[bytes]),content=new FileContent(source,file,written.size,written.sha256);
 t.after(async()=>{clearVault(source.vault);clearVault(target.vault);assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('observanda-owner-file-copy-'));await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
 return {root,source,target,file,destination,bytes,content};
}
test('owned encrypted transfer reads the source once and publishes only authenticated content',async t=>{
 const f=await fixture(t),progress=[],updates=[];
 const result=await withOperationProgress(p=>updates.push(p),()=>f.content.copyTo(f.target,f.destination,{onProgress:(done,total)=>{assert.equal(total,f.bytes.length);progress.push(done);}}));
 assert.deepEqual(result,{size:f.bytes.length,sha256:digest(f.bytes)});assert.deepEqual(await f.target.readFile(f.destination),f.bytes);
 assert.notDeepEqual(await readFile(f.destination),await readFile(f.file));assert.deepEqual(await readdir(f.target.root),['original']);
 assert.equal(progress[0],0);assert.equal(progress.at(-1),f.bytes.length);assert.equal(progress.length,5);
 // Operation byte accounting includes one source read and one destination
 // write. A preliminary verify/read pass would increase this measured count.
 assert.equal(updates.at(-1).activity.bytes,f.bytes.length*2);
 const before=await readFile(f.destination);await assert.rejects(f.content.copyTo(f.target,f.destination),{code:'EXISTS'});assert.deepEqual(await readFile(f.destination),before);
});
test('invalid or changed originals and cancelled transfers never publish a partial destination',async t=>{
 const f=await fixture(t),original=await readFile(f.file),tampered=Buffer.from(original);tampered[tampered.length-1]^=1;await writeFile(f.file,tampered);
 await assert.rejects(f.content.copyTo(f.target,f.destination),{code:'ENCRYPTION_DAMAGED'});assert.deepEqual(await readdir(f.target.root),[]);await writeFile(f.file,original);
 const wrong=new FileContent(f.source,f.file,f.content.size,'0'.repeat(64));await assert.rejects(wrong.copyTo(f.target,f.destination),{code:'MEDIA_INVALID'});assert.deepEqual(await readdir(f.target.root),[]);
 await assert.rejects(f.content.copyTo(f.target,f.destination,{onProgress:async done=>{if(done===f.bytes.length){const date=new Date(Date.now()+5000);await utimes(f.file,date,date);}}}),{code:'MEDIA_INVALID'});assert.deepEqual(await readdir(f.target.root),[]);
 const abort=new AbortController();await assert.rejects(f.content.copyTo(f.target,f.destination,{signal:abort.signal,onProgress:done=>{if(done>0)abort.abort();}}),{name:'AbortError'});assert.deepEqual(await readdir(f.target.root),[]);
 const plaintext=new Workspace(f.target.root);await assert.rejects(f.content.copyTo(plaintext,f.destination),{code:'INVALID'});assert.deepEqual(await readdir(f.target.root),[]);
});
