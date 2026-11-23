import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile,readFile,readdir,stat,unlink,symlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {digest} from '../src/storage.js';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {ExchangeParts} from '../src/collaboration/exchange-parts.js';
import {clearVault} from '../src/encryption.js';
import {DeviceStore} from '../src/security/device-store.js';
import {ExchangeIdentity} from '../src/collaboration/exchange-identity.js';
import {writeExchange,readExchange} from '../src/collaboration/exchange-stream.js';

// Part descriptors are database rows committed by the caller's writer; the
// cleanup under test owns only the staged part files.
async function fixture(t){
 const parent=path.resolve(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-parts-cleanup-'));
 const {workspace,vault}=await encryptedFixture(directory,sampleNotebook());
 t.after(async()=>{await clearVault(vault);assert.equal(path.dirname(directory),parent);assert.ok(path.basename(directory).startsWith('observanda-parts-cleanup-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const parts=owned(workspace);
 return {workspace,parts,directory,staging:path.join(workspace.root,parts.prefix)};
}
const owned=(workspace,id)=>new ExchangeParts(workspace,id,{write:operation=>workspace.withLock(operation)});
const blobs=async directory=>(await readdir(directory)).filter(name=>name.endsWith('.blob'));
const add=parts=>parts.receive({kind:'record',name:randomUUID(),size:2,sha256:digest('{}')},[Buffer.from('{}')]);

for(const count of [1,32])test('failed transfers remove their staged part files after '+count+' parts',async t=>{
 const f=await fixture(t);for(let i=0;i<count;i++)await add(f.parts);
 assert.equal((await blobs(f.staging)).length,count);
 await assert.rejects(f.parts.receive({kind:'record',name:randomUUID(),size:2,sha256:digest('xx')},[Buffer.from('{}')]));
 // A fresh owner after restart uses the operation UUID, never in-memory count.
 await owned(f.workspace,f.parts.id).discardUncommitted();await assert.rejects(stat(f.staging),{code:'ENOENT'});await f.parts.discardUncommitted();
});

test('cleanup retains committed transfers and reports unexpected entries while removing owned parts',async t=>{
 const f=await fixture(t);await add(f.parts);await writeFile(path.join(f.staging,'unexpected.txt'),'keep');
 await assert.rejects(f.parts.discardUncommitted(),{code:'UNSAFE'});assert.deepEqual(await readdir(f.staging),['unexpected.txt']);assert.equal(await readFile(path.join(f.staging,'unexpected.txt'),'utf8'),'keep');
 await unlink(path.join(f.staging,'unexpected.txt'));await owned(f.workspace,f.parts.id).discardUncommitted();
 const committed=owned(f.workspace);await add(committed);await committed.finish({direction:'incoming',selectionHash:'a'.repeat(64)});await committed.discardUncommitted();assert.equal((await committed.open()).count,1);
});

test('cleanup never follows a substituted directory among the part files',async t=>{
 const f=await fixture(t),outside=path.join(f.directory,'outside');await mkdir(outside);await writeFile(path.join(outside,'0.json'),'outside sentinel');await mkdir(f.staging,{recursive:true});
 await symlink(outside,path.join(f.staging,'items'),process.platform==='win32'?'junction':'dir');await writeFile(path.join(f.staging,'0.blob'),'owned');
 await assert.rejects(f.parts.discardUncommitted(),{code:'UNSAFE'});assert.equal(await readFile(path.join(outside,'0.json'),'utf8'),'outside sentinel');await assert.rejects(stat(path.join(f.staging,'0.blob')),{code:'ENOENT'});
});

test('a late package authentication failure leaves no filesystem staging tree',async t=>{
 const f=await fixture(t),protector={available:()=>true,protect:async bytes=>Buffer.from(bytes),unprotect:async bytes=>Buffer.from(bytes)},identity=name=>new ExchangeIdentity(new DeviceStore({file:path.join(f.directory,name),protector})),sender=identity('sender'),recipient=identity('recipient');
 const encoded=Buffer.concat(await Array.fromAsync(writeExchange(sender,await recipient.contact(),[{kind:'record',name:randomUUID(),content:'{}'}])));encoded[encoded.length-1]^=1;
 let received=0;await assert.rejects(readExchange(recipient,[encoded],async(info,content,options)=>{await f.parts.receive(info,content,options);received++;}));assert.equal(received,1);
 await f.parts.discardUncommitted();await assert.rejects(stat(f.staging),{code:'ENOENT'});
});
