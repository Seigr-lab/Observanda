import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {onResponseClose} from '../src/response-close.js';

test('response close has one subscription and releases completed lifecycle callbacks',()=>{
 const response=new EventEmitter(),called=[];
 const release=Array.from({length:20},(_,index)=>onResponseClose(response,()=>called.push(index)));
 assert.equal(response.listenerCount('close'),1);
 for(let index=0;index<20;index+=2){release[index]();release[index]();}
 response.emit('close');assert.deepEqual(called,[1,3,5,7,9,11,13,15,17,19]);
 for(const end of release)end();assert.equal(response.listenerCount('close'),0);
});

test('released response scopes remove the subscription without cancelling other scopes',()=>{
 const response=new EventEmitter();let calls=0;
 const first=onResponseClose(response,()=>{calls++;});first();assert.equal(response.listenerCount('close'),0);
 const second=onResponseClose(response,()=>{calls++;});first();assert.equal(response.listenerCount('close'),1);
 const third=onResponseClose(response,()=>{calls+=100;});assert.equal(response.listenerCount('close'),1);third();
 response.emit('close');second();assert.equal(calls,1);assert.equal(response.listenerCount('close'),0);
});

test('already closed responses notify immediately while each owner keeps its own completion policy',()=>{
 const response=new EventEmitter();response.destroyed=true;let calls=0;
 onResponseClose(response,()=>{calls++;})();assert.equal(calls,1);assert.equal(response.listenerCount('close'),0);
 const complete=new EventEmitter();complete.writableEnded=true;
 onResponseClose(complete,()=>{if(!complete.writableEnded)calls++;});complete.emit('close');assert.equal(calls,1);
});
