import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {LiveIngress,readLiveBody} from '../src/collaboration/live-ingress.js';

test('pre-auth bodies cannot spend signed capacity and admission keys vanish on release',()=>{
 const ingress=new LiveIngress(),anonymous=[];
 for(let i=0;i<8;i++)anonymous.push(ingress.acquire(null,'address-'+Math.floor(i/2)));
 assert.throws(()=>ingress.acquire(null,'new-address'),{code:'ACCESS_WAIT'});
 const signed=Array.from({length:4},()=>ingress.acquire('member','address-0'));
 assert.throws(()=>ingress.acquire('member','another-address'),{code:'ACCESS_WAIT'});
 assert.equal(ingress.reading,8);assert.equal(ingress.active,4);
 for(const release of [...anonymous,...signed]){release();release();}
 assert.equal(ingress.active,0);assert.equal(ingress.reading,0);assert.equal(ingress.preAuth.size,0);assert.equal(ingress.principals.size,0);
});

test('pre-auth deadlines close partial bodies independently of socket inactivity',async()=>{
 const stream=new PassThrough(),keepAlive=setInterval(()=>{},1000);
 try{const result=readLiveBody(stream,{timeout:30});stream.write('{');await assert.rejects(result,{code:'ACCESS_WAIT'});assert.equal(stream.destroyed,true);}finally{clearInterval(keepAlive);stream.destroy();}
 const valid=new PassThrough(),reading=readLiveBody(valid);valid.end('{"ok":true}');assert.deepEqual(await reading,{ok:true});
});
