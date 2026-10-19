import {test} from 'node:test';
import assert from 'node:assert/strict';
import filesystem,{mkdtemp,readFile,readdir,writeFile,rm} from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {Workspace,digest} from '../src/storage.js';
import {FileContent,writeContent,contentBuffer} from '../src/file-content.js';
import {withOperationProgress,operationStage} from '../src/operation-progress.js';
import {clearVault} from '../src/encryption.js';
for(const encrypted of [false,true])test(`streamed files retain compatibility with existing storage (${encrypted?'encrypted':'plain'})`,async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-stream-')),workspace=new Workspace(root,encrypted?{id:randomUUID(),key:randomBytes(32)}:null),file=path.join(root,'asset'),bytes=randomBytes(3*1024*1024+57);
 const written=await writeContent(workspace,file,[bytes.subarray(0,37),bytes.subarray(37)]);assert.equal(written.size,bytes.length);assert.equal(written.sha256,digest(bytes));assert.deepEqual(await workspace.readFile(file),bytes);
 const content=new FileContent(workspace,file,written.size,written.sha256),progress=[];assert.deepEqual(await withOperationProgress(value=>progress.push(value),()=>operationStage('read-buffer',{},()=>contentBuffer(content))),bytes);assert.equal(progress.at(-1).activity.bytes,bytes.length,'Whole-buffer admission must read the original exactly once');await assert.rejects(contentBuffer(new FileContent(workspace,file,bytes.length-1,written.sha256)),{code:'MEDIA_INVALID'});await assert.rejects(contentBuffer(new FileContent(workspace,file,bytes.length,'0'.repeat(64))),{code:'MEDIA_INVALID'});const ranged=[];for await(const b of content.stream(1023,1024*1024+11))ranged.push(b);assert.deepEqual(Buffer.concat(ranged),bytes.subarray(1023,1024*1024+12));
 await workspace.writeFile(file,bytes);assert.deepEqual(await contentBuffer(content),bytes);
 if(encrypted){
  const key=Buffer.from(workspace.vault.key),aad=workspace.fileAAD;
  try{workspace.fileAAD=function(file){const result=aad.call(this,file);clearVault(this.vault);return result;};await assert.rejects(contentBuffer(content),{code:'ACCESS_LOCKED'});}
  finally{workspace.fileAAD=aad;workspace.vault.key=Buffer.from(key);key.fill(0);}
 }

 const stored=await readFile(file);stored[stored.length-1]^=1;await writeFile(file,stored);let released=false;await assert.rejects(async()=>{for await(const b of content.stream()){released=true;}},e=>['MEDIA_INVALID','ENCRYPTION_DAMAGED'].includes(e.code));assert.equal(released,false);await assert.rejects(contentBuffer(content),error=>['MEDIA_INVALID','ENCRYPTION_DAMAGED'].includes(error.code));
});
test('rejected and interrupted streams leave no partial files',async()=>{const root=await mkdtemp(path.join(os.tmpdir(),'observanda-stream-')),ws=new Workspace(root);await assert.rejects(writeContent(ws,path.join(root,'asset'),[Buffer.alloc(10)],{maxBytes:5}),e=>e.code==='MEDIA_LIMIT');async function* broken(){yield Buffer.alloc(9);throw new Error('interrupted');}await assert.rejects(writeContent(ws,path.join(root,'asset'),broken()),/interrupted/);assert.deepEqual(await readdir(root),[]);});

// Preparation reports bytes privately; the ordinary write promise still waits
// for durable replacement and never exposes a partially committed target.
test('prepared encrypted writes resolve only after durable replacement',{timeout:10000},async t=>{
 const parent=path.resolve(os.tmpdir()),root=await mkdtemp(path.join(parent,'observanda-stream-finalization-')),workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)}),file=path.join(root,'asset'),previous=Buffer.from('previous complete contents'),bytes=Buffer.from('New Unicode \u00c5 \u03bb \u{1f41d} contents');
 await workspace.writeFile(file,previous);
 const prepared=Promise.withResolvers(),continuePreparation=Promise.withResolvers(),syncStarted=Promise.withResolvers(),continueSync=Promise.withResolvers(),openFile=filesystem.open;
 let pending,settled=false;
 const mock=t.mock.method(filesystem,'open',async function(name,...args){
  const handle=await openFile.call(this,name,...args);
  if(args[0]==='wx'&&path.dirname(name)===root){const sync=handle.sync;handle.sync=async function(...values){syncStarted.resolve();await continueSync.promise;return sync.apply(this,values);};}
  return handle;
 });syncBuiltinESMExports();
 t.after(async()=>{continuePreparation.resolve();continueSync.resolve();await pending?.catch(()=>{});mock.mock.restore();syncBuiltinESMExports();clearVault(workspace.vault);assert.equal(path.dirname(root),parent);assert.ok(path.basename(root).startsWith('observanda-stream-finalization-'));await rm(root,{recursive:true,force:true});});
 pending=writeContent(workspace,file,[bytes],{beforeCommit:async saved=>{prepared.resolve(saved);await continuePreparation.promise;}});
 pending.then(()=>{settled=true;},()=>{settled=true;});
 assert.deepEqual(await prepared.promise,{size:bytes.length,sha256:digest(bytes)});assert.equal(settled,false);assert.deepEqual(await workspace.readFile(file),previous);
 continuePreparation.resolve();await syncStarted.promise;assert.equal(settled,false);assert.deepEqual(await workspace.readFile(file),previous);
 continueSync.resolve();const saved=await pending;assert.deepEqual(saved,{size:bytes.length,sha256:digest(bytes)});assert.deepEqual(await contentBuffer(new FileContent(workspace,file,saved.size,saved.sha256)),bytes);assert.deepEqual(await readdir(root),['asset']);
});
test('rejected or cancelled prepared writes preserve the original and remove their temporary',{timeout:10000},async t=>{
 const parent=path.resolve(os.tmpdir()),root=await mkdtemp(path.join(parent,'observanda-stream-finalization-')),workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)}),file=path.join(root,'asset'),previous=Buffer.from('retained original'),bytes=Buffer.from('replacement');
 t.after(async()=>{clearVault(workspace.vault);assert.equal(path.dirname(root),parent);assert.ok(path.basename(root).startsWith('observanda-stream-finalization-'));await rm(root,{recursive:true,force:true});});
 await workspace.writeFile(file,previous);
 for(const cancel of [false,true]){
  const reason=new Error(cancel?'Cancelled after preparation':'Preparation refused'),controller=new AbortController();
  await assert.rejects(writeContent(workspace,file,[bytes],{signal:controller.signal,beforeCommit:async saved=>{assert.deepEqual(saved,{size:bytes.length,sha256:digest(bytes)});if(cancel)controller.abort(reason);else throw reason;}}),error=>error===reason);
  assert.deepEqual(await workspace.readFile(file),previous);assert.deepEqual(await readdir(root),['asset']);
 }
});

test('ZIP64 streaming is readable and CRC-checked by an independent ZIP implementation',async()=>{
 const {zipStream}=await import('../src/zip-stream.js');const {createWriteStream}=await import('node:fs');const {Readable}=await import('node:stream');const {pipeline}=await import('node:stream/promises');const {execFileSync}=await import('node:child_process');
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-zip-')),ws=new Workspace(root),media=path.join(root,'media'),bytes=randomBytes(2*1024*1024+19);const stored=await writeContent(ws,media,[bytes]);const asset=new FileContent(ws,media,stored.size,stored.sha256),zip=path.join(root,'test.zip');
 await pipeline(Readable.from(zipStream(new Map([['empty',''],['unicode-\u00e9.txt','text'],['media/recording.wav',asset]]))),createWriteStream(zip));
 const output=execFileSync('python',['-c',"import sys,zipfile,hashlib; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; assert len(z.namelist())==3; print(hashlib.sha256(z.read('media/recording.wav')).hexdigest())",zip],{encoding:'utf8'});assert.equal(output.trim(),digest(bytes));
});
