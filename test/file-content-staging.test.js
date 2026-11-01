import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {Workspace,digest} from '../src/storage.js';
import {FileContent,contentStagedStream,writeContent,describeContent,contentBuffer} from '../src/file-content.js';
import {OwnedFileContent} from '../src/owned-file-content.js';
import {withOperationProgress,operationStage} from '../src/operation-progress.js';
import {withMutationFilesSession} from '../src/mutation-files.js';
import {clearVault} from '../src/encryption.js';
import {SEGMENTED_BLOCK_BYTES,SEGMENTED_HEADER_BYTES,SEGMENTED_CHUNK_OVERHEAD} from '../src/segmented-file-format.js';

async function fixture(t){const root=await mkdtemp(path.join(os.tmpdir(),'observanda-staged-read-')),workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)});t.after(async()=>{clearVault(workspace.vault);assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('observanda-staged-read-'));await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});return {root,workspace,file:path.join(root,'source'),target:path.join(root,'target')};}
test('explicit chunk reads authenticate only consumed segments while full reads preserve their promise',async t=>{
 const f=await fixture(t),bytes=randomBytes(5*SEGMENTED_BLOCK_BYTES+9);await writeContent(f.workspace,f.file,[bytes]);const content=new FileContent(f.workspace,f.file,bytes.length,digest(bytes)),raw=await readFile(f.file);raw[raw.length-1]^=1;await writeFile(f.file,raw);
 const events=[];await withOperationProgress(event=>events.push(event),()=>operationStage('chunk-preview',{},async()=>{for await(const chunk of content.readChunks()){assert.deepEqual(chunk,bytes.subarray(0,SEGMENTED_BLOCK_BYTES));break;}}));
 assert.equal(events.at(-1).activity.bytes,8+SEGMENTED_HEADER_BYTES+SEGMENTED_BLOCK_BYTES+SEGMENTED_CHUNK_OVERHEAD);
 let released=false;await assert.rejects(async()=>{for await(const _chunk of content.read())released=true;},{code:'ENCRYPTION_DAMAGED'});assert.equal(released,false);
 await f.workspace.writeFile(f.file,bytes);const legacy=await readFile(f.file);legacy[legacy.length-1]^=1;await writeFile(f.file,legacy);await assert.rejects(async()=>{for await(const _chunk of content.readChunks())released=true;},{code:'ENCRYPTION_DAMAGED'});assert.equal(released,false);
});
for(const legacy of [false,true])test(`private staged consumption verifies in one source pass (${legacy?'legacy':'segmented'})`,async t=>{
 const f=await fixture(t),bytes=randomBytes(2*1024*1024+13);if(legacy)await f.workspace.writeFile(f.file,bytes);else await writeContent(f.workspace,f.file,[bytes]);
 const content=new FileContent(f.workspace,f.file,bytes.length,digest(bytes)),events=[];let collected=0;
 await withOperationProgress(event=>events.push(event),()=>operationStage('one-pass',{},async()=>{for await(const chunk of contentStagedStream(content))collected+=chunk.length;}));
 assert.equal(collected,bytes.length);assert.equal(events.at(-1).activity.bytes,bytes.length);
 const raw=await readFile(f.file);raw[raw.length-1]^=1;await writeFile(f.file,raw);await f.workspace.writeFile(f.target,'previous');const previous=await readFile(f.target);
 await assert.rejects(writeContent(f.workspace,f.target,contentStagedStream(content),{expected:{size:content.size,sha256:content.sha256}}),error=>['MEDIA_INVALID','ENCRYPTION_DAMAGED'].includes(error.code));assert.deepEqual(await readFile(f.target),previous);assert.deepEqual((await readdir(f.root)).sort(),['source','target']);
 let released=false;await assert.rejects(async()=>{for await(const _bytes of content.read())released=true;});assert.equal(released,false,'The complete-before-first-byte API remains unchanged');
});
test('segmented descriptors avoid a body pass while final copying still verifies corruption',async t=>{
 const f=await fixture(t),bytes=randomBytes(3*1024*1024+11);await writeContent(f.workspace,f.file,[bytes]);let readBytes=0;
 await withMutationFilesSession(async service=>{const original=service.open;service.open=async function(...args){const directory=await original.apply(this,args),file=directory.file;directory.file=async function(name,...options){const handle=await file.call(this,name,...options);if(name==='source'){const read=handle.read;handle.read=async function(...args){const result=await read.apply(this,args);readBytes+=result.bytesRead;return result;};}return handle;};return directory;};try{
  const content=await describeContent(f.workspace,f.file,{verification:'descriptor'});assert.equal(content.size,bytes.length);assert.equal(content.sha256,digest(bytes));assert.equal(readBytes,104);
 }finally{service.open=original;}});
 const stored=await readFile(f.file);stored[stored.length-1]^=1;await writeFile(f.file,stored);const metadata=await describeContent(f.workspace,f.file,{verification:'descriptor'});
 await assert.rejects(metadata.copyTo(f.workspace,f.target));await assert.rejects(readFile(f.target),{code:'ENOENT'});await assert.rejects(describeContent(f.workspace,f.file));
});
test('staged deferred owners keep their lease and refuse revocation before publication',async t=>{
 const f=await fixture(t),bytes=randomBytes(2*1024*1024);await writeContent(f.workspace,f.file,[bytes]);const content=new FileContent(f.workspace,f.file,bytes.length,digest(bytes));let held=false,closed=0;
 const owner=new OwnedFileContent(f.workspace,f.file,content.size,content.sha256,async consume=>{held=true;try{return await consume(content);}finally{held=false;closed++;}});
 for await(const _bytes of contentStagedStream(owner)){assert.equal(held,true);break;}assert.equal(held,false);assert.equal(closed,1);
 const controller=new AbortController(),reason=Error('cancel staged input');async function* source(){for await(const part of contentStagedStream(owner,{signal:controller.signal})){yield part;controller.abort(reason);}}
 await assert.rejects(writeContent(f.workspace,f.target,source(),{expected:{size:owner.size,sha256:owner.sha256},signal:controller.signal}),error=>error===reason||error.name==='AbortError');assert.equal(held,false);await assert.rejects(readFile(f.target),{code:'ENOENT'});
 class Specialized extends FileContent{async *read(){yield bytes;}}
 assert.deepEqual(Buffer.concat(await Array.fromAsync(contentStagedStream(new Specialized({},'unopened',bytes.length,digest(bytes))))),bytes);
 assert.deepEqual(await contentBuffer(content),bytes);
});
