import {test} from 'node:test';
import assert from 'node:assert/strict';
import {queryCallbackSource} from '../src/query-callback-source.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('callback source applies row backpressure and returns metadata only after completion',async()=>{
 let produced=0,drained=false;const source=queryCallbackSource(async emit=>{try{for(let id=0;id<1000;id++){produced++;await emit({id});}return {total:produced};}finally{drained=true;}}),iterator=source.rows[Symbol.asyncIterator]();
 assert.throws(()=>source.finish(),{code:'INVALID'});assert.deepEqual((await iterator.next()).value,{id:0});await tick();assert.equal(produced,1);assert.equal(drained,false);
 let count=1;for await(const row of iterator){assert.equal(row.id,count);count++;}assert.equal(count,1000);assert.equal(drained,true);assert.deepEqual(source.finish(),{total:1000});
});
test('early iterator return cancels and drains its pending producer',async()=>{
 let emitted=0,closed=false;const source=queryCallbackSource(async(emit,signal)=>{try{for(;;){signal.throwIfAborted();emitted++;await emit({emitted});}}finally{closed=true;}}),iterator=source.rows[Symbol.asyncIterator]();
 await iterator.next();await iterator.return();assert.equal(closed,true);assert.ok(emitted<=2);assert.throws(()=>source.finish(),{code:'INVALID'});
});
test('source errors and request cancellation propagate without leaving a producer active',async()=>{
 const failure=Error('source failed'),source=queryCallbackSource(async emit=>{await emit({id:1});throw failure;});await assert.rejects(async()=>{for await(const _row of source.rows){}},error=>error===failure);
 const controller=new AbortController(),entered=Promise.withResolvers();let closed=false;const waiting=queryCallbackSource(async(_emit,signal)=>{entered.resolve();try{await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}finally{closed=true;}},{signal:controller.signal});
 const pending=waiting.rows.next();await entered.promise;controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(closed,true);
});
