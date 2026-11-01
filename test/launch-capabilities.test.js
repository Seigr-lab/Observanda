import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LaunchCapabilities} from '../src/launch-capabilities.js';

test('launch capabilities expire, are claimed once, and retain a bounded pending set',()=>{
 let now=0;const launches=new LaunchCapabilities({now:()=>now,lifetime:10,maximum:2}),first=launches.issue();launches.consume(first);assert.throws(()=>launches.consume(first),{code:'AUTH'});
 const old=launches.issue();now=10;assert.throws(()=>launches.consume(old),{code:'AUTH'});
 const evicted=launches.issue(),second=launches.issue(),third=launches.issue();assert.throws(()=>launches.consume(evicted),{code:'AUTH'});launches.consume(second);launches.consume(third);
 const stopped=launches.issue();launches.clear();assert.throws(()=>launches.consume(stopped),{code:'AUTH'});
 for(const invalid of [undefined,null,{},'guess'])assert.throws(()=>launches.consume(invalid),{code:'AUTH'});
});

test('a lost browser acknowledgement can only repeat the original tab-bound session',async()=>{
 const launches=new LaunchCapabilities(),token=launches.issue(),binding='a'.repeat(64),claim=launches.claim(token,binding),retry=launches.claim(token,binding);
 assert.throws(()=>launches.claim(token),{code:'AUTH'});assert.throws(()=>launches.claim(token,'b'.repeat(64)),{code:'AUTH'});
 claim.complete('synthetic session');assert.equal(await retry.replay,'synthetic session');assert.equal(await launches.claim(token,binding).replay,'synthetic session');
 const next=launches.issue(),failure=launches.claim(next,binding);failure.fail(Error('synthetic failure'));assert.throws(()=>launches.claim(next,'b'.repeat(64)),{code:'AUTH'});launches.claim(next,binding).complete('retry');
});
