import {test} from 'node:test';
import assert from 'node:assert/strict';
import filesystem,{mkdtemp,rm} from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import path from 'node:path';
import os from 'node:os';
import {randomBytes,randomUUID} from 'node:crypto';
import {Workspace,digest} from '../src/storage.js';
import {FileContent,contentBuffer,writeContent} from '../src/file-content.js';

test('whole-buffer budgets and cancellation reject before storage admission or copying',async()=>{
 let admitted=false;const value=new FileContent({requireStorageKey:async()=>{admitted=true;}},'unused',100,'0'.repeat(64));
 await assert.rejects(contentBuffer(value,{maxBytes:99}),{code:'MEDIA_LIMIT'});assert.equal(admitted,false);
 await assert.rejects(contentBuffer('\u754c',{maxBytes:2}),{code:'MEDIA_LIMIT'});assert.deepEqual(await contentBuffer('\u754c',{maxBytes:3}),Buffer.from('\u754c'));
 for(const maxBytes of [-1,1.5,Infinity,NaN])await assert.rejects(contentBuffer(value,{maxBytes}),{code:'INVALID'});
 const controller=new AbortController(),reason=Error('stop buffering');controller.abort(reason);await assert.rejects(contentBuffer(Buffer.from('data'),{signal:controller.signal}),error=>error===reason);
});

test('specialized whole-buffer reads preserve owner admission, cancellation and declared size',async()=>{
 let closed=false,received;const controller=new AbortController(),reason=Error('cancel owner read');
 class Source extends FileContent{async *read(_start,_end,{signal}={}){received=signal;try{yield Buffer.from('abc');controller.abort(reason);yield Buffer.from('def');}finally{closed=true;}}}
 const value=new Source({},'unused',6,digest('abcdef'));
 await assert.rejects(contentBuffer(value,{signal:controller.signal,maxBytes:6}),error=>error===reason);assert.equal(received,controller.signal);assert.equal(closed,true);
 class WrongSize extends FileContent{async *read(){yield Buffer.from('abc');}}
 for(const size of [2,4])await assert.rejects(contentBuffer(new WrongSize({},'unused',size,digest('abc'))),{code:'MEDIA_INVALID'});
 assert.deepEqual(await contentBuffer(new WrongSize({},'unused',3,digest('abc')),{maxBytes:3}),Buffer.from('abc'));
});

test('buffered encrypted reads stop cancellation between bounded blocks and close their file',async t=>{
 const temporaryRoot=path.resolve(os.tmpdir()),root=await mkdtemp(path.join(temporaryRoot,'observanda-buffer-budget-')),workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)}),file=path.join(root,'data'),bytes=randomBytes(4*1024*1024),saved=await writeContent(workspace,file,[bytes]),value=new FileContent(workspace,file,saved.size,saved.sha256);
 t.after(async()=>{workspace.vault.key.fill(0);assert.equal(path.dirname(root),temporaryRoot);assert.ok(path.basename(root).startsWith('observanda-buffer-budget-'));await rm(root,{recursive:true,force:true});});
 const controller=new AbortController(),reason=Error('cancel disk read'),original=filesystem.open;let readBytes=0,closed=0;
 const mocked=t.mock.method(filesystem,'open',async function(name,...args){const handle=await original.call(this,name,...args);if(name===file&&args[0]==='r'){const read=handle.read,close=handle.close;handle.read=async function(...args){const result=await read.apply(this,args);readBytes+=result.bytesRead;if(readBytes>1024*1024)controller.abort(reason);return result;};handle.close=async function(){closed++;return close.call(this);};}return handle;});syncBuiltinESMExports();
 try{await assert.rejects(contentBuffer(value,{signal:controller.signal,maxBytes:bytes.length}),error=>error===reason);assert.ok(readBytes<bytes.length);assert.equal(closed,1);}finally{mocked.mock.restore();syncBuiltinESMExports();}
 assert.deepEqual(await contentBuffer(value,{maxBytes:bytes.length}),bytes);
});
