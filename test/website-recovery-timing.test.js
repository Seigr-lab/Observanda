import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {websiteFilesRecovery,recoveryIdleMs,recoveryMaxWaitMs} from '../src/web/website-files-recovery.js';

test('the recovery window is bounded under continuous input, while a delayed or lost response never acknowledges newer text',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout'],now:0});
 const host={innerHTML:''},prior=globalThis.document;globalThis.document={querySelector:()=>host};
 t.after(()=>{if(prior)globalThis.document=prior;else delete globalThis.document;});
 const workspaceId=randomUUID(),siteId=randomUUID(),path='index.html',calls=[];let html='initial';
 const controller=websiteFilesRecovery({request:async(op,data)=>{
  if(op==='recovery/page')return {items:[],next:null};
  const work=Promise.withResolvers();calls.push({data,...work});return work.promise;
 },documentState:()=>({workspaceId,siteId,path,html,css:'',bookmark:null,baseRevision:'a'.repeat(64)}),upload:()=>null,restore:()=>{},
 tr:key=>key,esc:String,signal:()=>undefined,now:Date.now});
 await controller.select(siteId,path);const tick=t.mock.timers.tick.bind(t.mock.timers);
 controller.edited();tick(recoveryIdleMs-1);assert.equal(calls.length,0);tick(1);assert.equal(calls.length,1);assert.doesNotMatch(host.innerHTML,/recoveryAcknowledged/);
 const drain=()=>new Promise(resolve=>setImmediate(resolve));
 const receipt=call=>({surface:'website',state:'ready',capabilities:{recover:true},id:call.data.id,operationId:call.data.operationId,owner:{workspaceId,websiteId:siteId},documentKey:path,baseRevision:call.data.baseRevision,revision:createHash('sha256').update(call.data.operationId).digest('hex'),pictures:[],recordings:[],inputs:[],updatedAt:new Date().toISOString()});
 calls[0].resolve(receipt(calls[0]));await drain();assert.match(host.innerHTML,/recoveryAcknowledged/);
 html='first change';controller.edited();assert.doesNotMatch(host.innerHTML,/recoveryAcknowledged/);
 for(let elapsed=250;elapsed<recoveryMaxWaitMs;elapsed+=250){tick(250);html='continuous '+elapsed;controller.edited();}
 tick(249);assert.equal(calls.length,1);tick(1);assert.equal(calls.length,2);assert.equal(calls[1].data.html,html);
 html='new work during a slow write';controller.edited();tick(recoveryMaxWaitMs+1);
 assert.equal(calls.length,2);calls[1].resolve(receipt(calls[1]));await drain();
 assert.doesNotMatch(host.innerHTML,/recoveryAcknowledged/);tick(0);assert.equal(calls[2].data.html,html);
 const lost=calls[2].data.operationId;calls[2].reject(Error('Connection closed'));await drain();assert.match(host.innerHTML,/recoveryFailed/);
 let index=3;
 for(const bad of [{operationId:randomUUID()},{documentKey:'unrelated.html'},{owner:{workspaceId,websiteId:randomUUID()}},{baseRevision:'b'.repeat(64)},{revision:randomUUID()},{updatedAt:'yesterday'},{pictures:['unknown-file']},{inputs:[randomUUID()]}]){
  const retry=controller.action('retry'),call=calls[index++];assert.equal(call.data.operationId,lost);
  call.resolve({...receipt(call),...bad});await retry;
  assert.match(host.innerHTML,/recoveryFailed/);assert.doesNotMatch(host.innerHTML,/recoveryAcknowledged/);
 }
 const retry=controller.action('retry');assert.equal(calls[index].data.operationId,lost);calls[index].resolve(receipt(calls[index]));await retry;
 assert.match(host.innerHTML,/recoveryAcknowledged/);
 html='last edit';controller.edited();tick(recoveryIdleMs);const late=calls.at(-1);
 await controller.select(randomUUID(),'another.html');late.resolve(receipt(late));await drain();
 assert.doesNotMatch(host.innerHTML,/recoveryAcknowledged/);controller.reset();
});
