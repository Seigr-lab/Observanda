import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {LiveAdmission,admitLivePrincipal,withLiveAdmission} from '../src/collaboration/live-admission.js';
const instance=()=>randomBytes(24).toString('hex'),address='192.0.2.10';

test('stateless challenge issuance stays bounded and binds host, source, monotonic expiry and signature',()=>{
 let now=1000;const host=new LiveAdmission(instance(),{now:()=>now}),other=new LiveAdmission(host.instance,{now:()=>now});
 try{
  const first=host.issue(address);for(let i=0;i<10000;i++)host.issue(address);
  assert.deepEqual(host.statistics(),{used:0,principals:0,maximum:8192});assert.equal(host.validate(first,address),31000);
  for(const [nonce,source] of [[first,'192.0.2.11'],[first.slice(0,63)+(first[63]==='0'?'1':'0'),address],['0'.repeat(64),address],[{},address]])assert.throws(()=>host.validate(nonce,source),{code:'COLLABORATION_EXPIRED'});
  assert.throws(()=>other.validate(first,address),{code:'COLLABORATION_EXPIRED'});
  now=31000;assert.throws(()=>host.validate(first,address),{code:'COLLABORATION_EXPIRED'});
  host.close();assert.throws(()=>host.issue(address),{code:'SERVER_CLOSING'});assert.throws(()=>host.validate(first,address),{code:'SERVER_CLOSING'});
 }finally{host.close();other.close();}
});

test('replay capacity is per authorized principal even behind one address and never evicts live nonces',()=>{
 let now=1000;const host=new LiveAdmission(instance(),{now:()=>now,perPrincipal:2,principals:2});
 try{
  const first=host.issue(address);host.consume(first,address,'first');host.consume(host.issue(address),address,'first');
  assert.throws(()=>host.consume(host.issue(address),address,'first'),{code:'ACCESS_WAIT'});
  host.consume(host.issue(address),address,'second');assert.throws(()=>host.consume(first,address,'second'),{code:'COLLABORATION_EXPIRED'});
  assert.throws(()=>host.consume(host.issue(address),address,'third'),{code:'ACCESS_WAIT'});
  assert.deepEqual(host.statistics(),{used:3,principals:2,maximum:4});
  now=31000;host.consume(host.issue(address),address,'third');assert.deepEqual(host.statistics(),{used:1,principals:1,maximum:4});
  assert.throws(()=>host.consume(first,address,'first'),{code:'COLLABORATION_EXPIRED'});
 }finally{host.close();}
});

test('request admission follows authorization once and isolates simultaneous authorization contexts',async()=>{
 const calls=[];
 await Promise.all(['alice','bob'].map(principal=>withLiveAdmission(value=>calls.push(value),async()=>{
  await Promise.resolve();admitLivePrincipal(principal);admitLivePrincipal('presence lookup');
 })));
 assert.deepEqual(calls.sort(),['alice','bob']);
 await assert.rejects(withLiveAdmission(()=>assert.fail('Unauthorized request consumed replay state'),async()=>{throw new Error('Membership denied');}),/Membership denied/);
 await assert.rejects(withLiveAdmission(()=>assert.fail('Missing authorization'),async()=>{}),{code:'COLLABORATION_DENIED'});
 let mutation=false;await assert.rejects(withLiveAdmission(()=>{throw new Error('Replay');},async()=>{admitLivePrincipal('alice');mutation=true;}),/Replay/);assert.equal(mutation,false);
 admitLivePrincipal('local request outside host');
});
