import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DeviceStore} from '../src/security/device-store.js';
import {ExchangeIdentity} from '../src/collaboration/exchange-identity.js';
import {exchangeDeclaration,writeExchange,readExchange,exchangeTransferDuration} from '../src/collaboration/exchange-stream.js';
import {AppError} from '../src/errors.js';

test('signed encrypted declarations authorize senders before any body is consumed',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-declaration-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const protector={available:()=>true,protect:async bytes=>Buffer.from(bytes),unprotect:async bytes=>Buffer.from(bytes)},identity=name=>new ExchangeIdentity(new DeviceStore({file:path.join(directory,name),protector}));
 const sender=identity('sender'),recipient=identity('recipient'),contact=await recipient.contact(),selection={id:'private selection'},entries=[{kind:'description',name:'selection',content:JSON.stringify(selection)},{kind:'original',name:'original',content:Buffer.alloc(8192,7)}],declaration=await exchangeDeclaration(entries,selection),encoded=Buffer.concat(await Array.fromAsync(writeExchange(sender,contact,entries,{declaration})));
 assert.equal(encoded.includes(Buffer.from('private selection')),false);
 const before=Date.now(),events=[];const result=await readExchange(recipient,[encoded],async(info,content)=>{events.push(info.kind);assert.deepEqual(Buffer.concat(await Array.fromAsync(content)),Buffer.from(entries[events.length-2].content));},{requireDeclaration:true,authorizeDeclaration:async value=>{assert.equal(value.sender.id,(await sender.signer.public()).id);assert.deepEqual(value.declaration,declaration);assert.ok(value.expiresAt>=before+exchangeTransferDuration(declaration.bytes));assert.ok(value.expiresAt<=Date.now()+exchangeTransferDuration(declaration.bytes));events.push('authorized');}});
 assert.deepEqual(events,['authorized','description','original']);assert.equal(result.entries,2);
 let consumed=0;const consume=async(_info,content)=>{consumed++;for await(const part of content)void part;};
 await assert.rejects(readExchange(recipient,[encoded],consume,{requireDeclaration:true,authorizeDeclaration:()=>{throw new AppError('COLLABORATION_DENIED');}}),{code:'COLLABORATION_DENIED'});assert.equal(consumed,0);
 await assert.rejects(readExchange(recipient,[encoded],consume,{requireDeclaration:true,maxBytes:10}),{code:'LIMIT'});assert.equal(consumed,0);
 await assert.rejects(readExchange(recipient,[encoded],consume,{requireDeclaration:true,expectedSender:'0'.repeat(64)}),{code:'COLLABORATION_PACKAGE'});assert.equal(consumed,0);
 await assert.rejects(readExchange(recipient,[encoded],consume,{requireDeclaration:true,maxFileBytes:4096}),{code:'LIMIT'});assert.equal(consumed,1,'Only the small authenticated description precedes the oversized original');
 consumed=0;const legacy=Buffer.concat(await Array.fromAsync(writeExchange(sender,contact,entries)));await assert.rejects(readExchange(recipient,[legacy],consume,{requireDeclaration:true}),{code:'COLLABORATION_PACKAGE'});assert.equal(consumed,0);
 const damaged=Buffer.from(encoded),headerEnd=14+encoded.readUInt32BE(10);damaged[headerEnd+30]^=1;await assert.rejects(readExchange(recipient,[damaged],consume,{requireDeclaration:true}),{code:'COLLABORATION_PACKAGE'});assert.equal(consumed,0);
 const mismatched={...selection,id:'different selection'},wrongDeclaration=await exchangeDeclaration(entries,mismatched),wrong=Buffer.concat(await Array.fromAsync(writeExchange(sender,contact,entries,{declaration:wrongDeclaration})));
 await assert.rejects(readExchange(recipient,[wrong],consume,{requireDeclaration:true}),{code:'COLLABORATION_PACKAGE'});assert.equal(consumed,0,'The first description must match the authorized declaration');
 const truncated=encoded.subarray(0,-1);await assert.rejects(readExchange(recipient,[truncated],consume,{requireDeclaration:true}),{code:'COLLABORATION_PACKAGE'});
 const finalDamage=Buffer.from(encoded);finalDamage[finalDamage.length-20]^=1;await assert.rejects(readExchange(recipient,[finalDamage],consume,{requireDeclaration:true}),{code:'COLLABORATION_PACKAGE'});
 await assert.rejects(Array.fromAsync(writeExchange(sender,contact,entries,{declaration:{...declaration,entries:3}})),{code:'COLLABORATION_PACKAGE'});
 // Time spent encrypting/storing already received bytes is not network idle.
 await readExchange(recipient,[encoded],async(_info,content)=>{for await(const _part of content)await new Promise(resolve=>setTimeout(resolve,60));},{requireDeclaration:true,idleTimeoutMs:20,timeoutMs:2000});
 let authorized=false;
 await assert.rejects(readExchange(recipient,[encoded],async(_info,content)=>{for await(const _part of content)await new Promise(resolve=>setTimeout(resolve,250));},{requireDeclaration:true,idleTimeoutMs:1000,timeoutMs:100,authorizeDeclaration:({expiresAt})=>{authorized=true;assert.ok(expiresAt<=Date.now()+100);}}),{code:'COLLABORATION_PACKAGE'});assert.ok(authorized);
});

test('authenticated transfer deadlines scale with declared bytes without a thirty minute ceiling',()=>{
 assert.equal(exchangeTransferDuration(0),30000);assert.equal(exchangeTransferDuration(65536),31000);
 assert.equal(exchangeTransferDuration(2**40),30000+2**24*1000);assert.ok(exchangeTransferDuration(2**30)>30*60*1000);
 for(const invalid of [-1,Infinity,1.5,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>exchangeTransferDuration(invalid),{code:'COLLABORATION_PACKAGE'});
});

test('stalled input and cancellation do not wait for an uncooperative iterator to close',{timeout:2000},async()=>{
 const source={async *[Symbol.asyncIterator](){await new Promise(()=>{});}};
 await assert.rejects(readExchange({},source,()=>assert.fail('body consumed'),{idleTimeoutMs:20,timeoutMs:100}),{code:'COLLABORATION_PACKAGE'});
 const controller=new AbortController(),pending=readExchange({},source,()=>assert.fail('body consumed'),{signal:controller.signal});controller.abort();await assert.rejects(pending,{name:'AbortError'});
 const endlessEmpty={async *[Symbol.asyncIterator](){for(;;)yield Buffer.alloc(0);}};await assert.rejects(readExchange({},endlessEmpty,()=>assert.fail('body consumed')),{code:'COLLABORATION_PACKAGE'});
 const slowBytes={async *[Symbol.asyncIterator](){for(const byte of Buffer.from('OBSSHARE1\n')){await new Promise(resolve=>setTimeout(resolve,8));yield Buffer.from([byte]);}}};
 await assert.rejects(readExchange({},slowBytes,()=>assert.fail('body consumed'),{idleTimeoutMs:100,timeoutMs:25}),{code:'COLLABORATION_PACKAGE'});
});
