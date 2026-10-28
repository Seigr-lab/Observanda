import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DiskCapacity} from '../src/disk-capacity.js';

test('same-volume writers reserve future growth and credit only completed writes',async()=>{
 let free=100n;const budget=new DiskCapacity({probe:async()=>({id:'volume',available:free})});
 const first=await budget.reserve('first-folder',60,{reserveBytes:10});
 await assert.rejects(budget.reserve('second-folder',40),{code:'STORAGE_FULL'});
 const second=await budget.reserve('second-folder',20);assert.equal(budget.stats().reservedBytes,'80');
 await first.write(20,async()=>{free-=20n;assert.equal(budget.stats().reservedBytes,'80');});
 assert.equal(budget.stats().reservedBytes,'60');await budget.check('third-folder',10);
 await assert.rejects(budget.check('third-folder',11),{code:'STORAGE_FULL'});
 first.release();first.release();assert.equal(budget.stats().reservedBytes,'20');second.release();assert.deepEqual(budget.stats(),{active:0,pending:0,limit:128,volumes:0,reservedBytes:'0'});
});

test('pending disk probes are bounded and do not leave claims after cancellation or failure',async()=>{
 const gate=Promise.withResolvers(),budget=new DiskCapacity({maxActive:1,probe:()=>gate.promise}),controller=new AbortController();
 const pending=budget.reserve('folder',10,{signal:controller.signal});await assert.rejects(budget.reserve('folder',1),{code:'WORKLOAD_BUSY'});
 controller.abort();gate.resolve({id:'volume',available:100n});await assert.rejects(pending,{name:'AbortError'});assert.equal(budget.stats().pending,0);assert.equal(budget.stats().active,0);
 budget.probe=async()=>{throw Object.assign(Error('unavailable'),{code:'EIO'});};await assert.rejects(budget.reserve('folder',1),{code:'EIO'});assert.equal(budget.stats().pending,0);
});

test('unknown streams grow reservations, retain failed writes and refuse changed volumes',async()=>{
 let id='volume',free=100n;const budget=new DiskCapacity({probe:async()=>({id,available:free})}),ticket=await budget.reserve('folder');
 await assert.rejects(ticket.write(40,async()=>{free-=5n;throw Error('partial write');}),/partial write/);assert.equal(budget.stats().reservedBytes,'40');
 await ticket.write(40,async()=>{free-=40n;});assert.equal(budget.stats().reservedBytes,'0');
 free=10n;await assert.rejects(ticket.write(20,async()=>assert.fail('insufficient space')),{code:'STORAGE_FULL'});
 id='replacement';await assert.rejects(ticket.write(1,async()=>assert.fail('changed volume')),{code:'IO'});ticket.release();assert.equal(budget.stats().active,0);
});

test('different volumes remain independent and a running write retains its reservation',async()=>{
 const budget=new DiskCapacity({probe:async id=>({id,available:100n})}),a=await budget.reserve('one',90),b=await budget.reserve('two',90),gate=Promise.withResolvers(),entered=Promise.withResolvers();
 const writing=a.write(20,async()=>{entered.resolve();await gate.promise;});await entered.promise;
 assert.throws(()=>a.release(),{code:'LOCKED'});await assert.rejects(a.write(1,async()=>{}),{code:'INVALID'});gate.resolve();await writing;a.release();b.release();
 assert.equal(budget.stats().reservedBytes,'0');assert.equal(budget.stats().volumes,0);
});

test('checkpoint refreshes stay bounded by bytes while external space loss still stops writing',async()=>{
 let probes=0,free=100n;const budget=new DiskCapacity({probe:async()=>{probes++;return {id:'volume',available:free};}}),ticket=await budget.reserve('folder',20,{reserveBytes:10,refreshBytes:8});
 await ticket.write(4,async()=>{free-=4n;});await ticket.write(4,async()=>{free-=4n;});assert.equal(probes,1);
 free=1n;await assert.rejects(ticket.write(1,async()=>assert.fail('low space')),{code:'STORAGE_FULL'});assert.equal(probes,2);ticket.release();
});

test('unknown stream windows reserve ahead, retain other writers and fall back to available tail space',async()=>{
 let free=100n,probes=0;
 const budget=new DiskCapacity({probe:async()=>{probes++;return {id:'volume',available:free};}}),other=await budget.reserve('other',20,{reserveBytes:10}),stream=await budget.reserve('archive',0,{growthBytes:40,refreshBytes:40});
 const write=bytes=>stream.write(bytes,async()=>{free-=BigInt(bytes);});
 await write(10);assert.equal(budget.stats().reservedBytes,'50');const afterFirst=probes;
 await write(10);await write(20);assert.equal(probes,afterFirst);assert.equal(budget.stats().reservedBytes,'20');
 await write(10);assert.equal(budget.stats().reservedBytes,'40','only thirty unclaimed bytes were available for the next window');
 await write(20);assert.equal(budget.stats().reservedBytes,'20');
 await assert.rejects(write(1),{code:'STORAGE_FULL'});other.release();await write(10);stream.release();assert.equal(budget.stats().active,0);
});
