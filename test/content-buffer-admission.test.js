import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NativeResourceBudget} from '../src/native-resource-budget.js';
import {NativeMediaAdmission} from '../src/native-media-admission.js';
import {FileContent,withContentBuffer,contentBuffer} from '../src/file-content.js';
import {digest} from '../src/storage.js';

const MiB=1024*1024;
function fixture(){const budget=new NativeResourceBudget({memoryBytes:8*MiB,reserveBytes:1,available:()=>32*MiB});return {budget,admission:new NativeMediaAdmission({kind:'buffer',active:2,queued:2,memoryBytes:8*MiB,reserveBytes:1,available:()=>32*MiB,budget})};}
test('whole-buffer callbacks retain aggregate reservations until their consumers finish',async()=>{
 const {budget,admission}=fixture(),entered=Promise.withResolvers(),release=Promise.withResolvers();let admitted=0;
 class Source extends FileContent{async *read(){admitted++;yield Buffer.alloc(2*MiB,1);}}
 const source=new Source({},'unused',2*MiB,digest(Buffer.alloc(2*MiB,1))),database=budget.reserve('database',4*MiB);
 const first=withContentBuffer(source,{admission},async bytes=>{assert.equal(bytes.length,2*MiB);entered.resolve();await release.promise;return 'done';});await entered.promise;
 assert.equal(budget.stats().buffers,1);assert.equal(budget.stats().reservedBytes,8*MiB);const second=contentBuffer(source,{admission});assert.equal(admission.stats().queued,1);assert.equal(admitted,1);
 release.resolve();assert.equal(await first,'done');assert.equal((await second).length,2*MiB);assert.equal(admitted,2);assert.equal(budget.stats().buffers,0);database.release();assert.equal(budget.stats().reservedBytes,0);
});
test('queued cancellation and refused declarations never read content and release reservations',async()=>{
 const {budget,admission}=fixture(),entered=Promise.withResolvers(),finish=Promise.withResolvers();let reads=0;
 class Source extends FileContent{async *read(){reads++;yield Buffer.alloc(4*MiB);}}
 const source=new Source({},'unused',4*MiB,digest(Buffer.alloc(4*MiB))),first=withContentBuffer(source,{admission},async()=>{entered.resolve();await finish.promise;});await entered.promise;
 const controller=new AbortController(),reason=Error('cancel queued buffer'),queued=contentBuffer(source,{admission,signal:controller.signal});assert.equal(admission.stats().queued,1);controller.abort(reason);await assert.rejects(queued,error=>error===reason);assert.equal(reads,1);
 await assert.rejects(contentBuffer(source,{admission,maxBytes:3*MiB}),{code:'MEDIA_LIMIT'});finish.resolve();await first;assert.equal(budget.stats().reservedBytes,0);
 await assert.rejects(withContentBuffer(source,{admission},()=>{throw Error('consumer failure');}),/consumer failure/);assert.equal(budget.stats().reservedBytes,0);
});
