import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {DeviceStore} from '../src/security/device-store.js';
import {ExchangeIdentity} from '../src/collaboration/exchange-identity.js';
import {writeExchange,readExchange} from '../src/collaboration/exchange-stream.js';

test('encrypted collaboration frames bind recipient, sender and the complete ordered stream',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-sharing-stream-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 // Synthetic identities only; production adapters use operating-system key protection.
 const protector={available:()=>true,protect:async bytes=>Buffer.from(bytes),unprotect:async bytes=>Buffer.from(bytes)};
 const make=name=>new ExchangeIdentity(new DeviceStore({file:path.join(directory,name),protector}));
 const a=make('a'),b=make('b'),c=make('c'),contact=await b.contact(),sender=(await a.signer.public()).id;
 const large=randomBytes(3*1024*1024+17),entries=[{kind:'description',name:'selection',content:'PRIVATE selected research'},{kind:'original',name:'evidence',content:large},{kind:'original',name:'empty',content:Buffer.alloc(0)}];
 const encoded=Buffer.concat(await Array.fromAsync(writeExchange(a,contact,entries)));
 assert.ok(!encoded.includes(Buffer.from('PRIVATE selected research')));assert.ok(!encoded.includes(large.subarray(0,128)));
 async function decode(bytes,identity=b,expectedSender=sender){
  const seen=[];async function* parts(){for(let i=0;i<bytes.length;i+=8191)yield bytes.subarray(i,i+8191);}
  const result=await readExchange(identity,parts(),async(info,source)=>seen.push({info,bytes:Buffer.concat(await Array.fromAsync(source))}),{expectedSender});return {result,seen};
 }
 const {result,seen}=await decode(encoded);assert.equal(result.sender.id,sender);assert.equal(result.entries,3);assert.deepEqual(seen.map(s=>s.bytes),entries.map(e=>Buffer.from(e.content)));
 for(const bytes of [encoded.subarray(0,-1),encoded.subarray(0,8192),Buffer.concat([encoded,Buffer.from([0])])])await assert.rejects(decode(bytes),{code:'COLLABORATION_PACKAGE'});
 const damaged=Buffer.from(encoded);damaged[damaged.length-37]^=1;await assert.rejects(decode(damaged),{code:'COLLABORATION_PACKAGE'});
 await assert.rejects(decode(encoded,c),{code:'COLLABORATION_PACKAGE'});await assert.rejects(decode(encoded,b,(await c.signer.public()).id),{code:'COLLABORATION_PACKAGE'});
 const headerEnd=10+4+encoded.readUInt32BE(10),firstEnd=headerEnd+4+encoded.readUInt32BE(headerEnd),secondEnd=firstEnd+4+encoded.readUInt32BE(firstEnd);
 const reordered=Buffer.concat([encoded.subarray(0,headerEnd),encoded.subarray(firstEnd,secondEnd),encoded.subarray(headerEnd,firstEnd),encoded.subarray(secondEnd)]);
 await assert.rejects(decode(reordered),{code:'COLLABORATION_PACKAGE'});
 await assert.rejects(readExchange(b,[encoded],async()=>{}),{code:'COLLABORATION_PACKAGE'});
});
