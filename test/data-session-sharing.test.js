import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {createDataRegistry,createDataSession} from '../src/web/data-registry.js';
const item=title=>({key:title,title,data:{title}});
function fixture(){
 const registry=createDataRegistry(),requests=[];registry.register({id:'records',label:'Records',loadKey:(_ctx,options)=>JSON.stringify(options),load:args=>new Promise((resolve,reject)=>requests.push({...args,resolve,reject})),items:(_ctx,data)=>data});
 const session=createDataSession(registry,{context:()=>({contextId:'current',book:{id:'book'}}),api:()=>{},onChange:()=>{}});return {session,requests};
}
test('eight identical dashboard cards share one pending read and one consumer cannot cancel the rest',async()=>{
 const f=fixture(),context={contextId:'current',book:{id:'book'}},slots=Array.from({length:8},(_,i)=>'slot'+i);
 for(const dataSlot of slots)assert.equal(f.session.read('records',{...context,dataSlot},{query:'same'}).status,'loading');await setImmediate();assert.equal(f.requests.length,1);
 f.session.retainSlots(new Set(slots.slice(1)));assert.equal(f.requests[0].signal.aborted,false);f.requests[0].resolve([item('Shared')]);await setImmediate();
 for(const dataSlot of slots.slice(1))assert.deepEqual(f.session.read('records',{...context,dataSlot},{query:'same'}).items,[item('Shared')]);f.session.close();
});
test('distinct query, workspace, owner and provider contexts never share pending reads',async()=>{
 const f=fixture(),base={contextId:'current',book:{id:'book'}};
 const contexts=[base,{...base,book:{id:'other'}},{...base,contextId:'next'},{...base,projectOwner:{projectId:'project',labBookId:'lab'}},{...base,projectOwner:{projectId:'project',labBookId:'other-lab'}}];
 for(const [i,ctx] of contexts.entries())f.session.read('records',{...ctx,dataSlot:'slot'+i},{query:'same'});f.session.read('records',{...base,dataSlot:'different'},{query:'other'});await setImmediate();assert.equal(f.requests.length,6);f.session.close();assert.ok(f.requests.every(request=>request.signal.aborted));
});
test('dropping all shared consumers cancels once and late results cannot replace a new request',async()=>{
 const f=fixture();for(const dataSlot of ['a','b'])f.session.read('records',{dataSlot});await setImmediate();assert.equal(f.requests.length,1);
 f.session.retainSlots(new Set());assert.equal(f.requests[0].signal.aborted,true);f.session.read('records',{dataSlot:'a'});await setImmediate();assert.equal(f.requests.length,2);
 f.requests[0].resolve([item('Old')]);await setImmediate();assert.equal(f.session.read('records',{dataSlot:'a'}).status,'loading');f.requests[1].resolve([item('New')]);await setImmediate();assert.deepEqual(f.session.read('records',{dataSlot:'a'}).items,[item('New')]);f.session.close();
});
test('shared refresh failure clears retained data from every card and allows a fresh read',async()=>{
 const f=fixture();for(const dataSlot of ['a','b'])f.session.read('records',{dataSlot});await setImmediate();f.requests[0].resolve([item('Existing')]);await setImmediate();
 f.session.invalidate('records',{retainData:true});for(const dataSlot of ['a','b'])assert.deepEqual(f.session.read('records',{dataSlot}).items,[item('Existing')]);await setImmediate();assert.equal(f.requests.length,2);
 f.requests[1].reject(Object.assign(Error('Revoked'),{code:'ACCESS_LOCKED'}));await setImmediate();for(const dataSlot of ['a','b']){const state=f.session.read('records',{dataSlot});assert.equal(state.status,'error');assert.deepEqual(state.items,[]);}
 f.session.invalidate('records');for(const dataSlot of ['a','b'])f.session.read('records',{dataSlot});await setImmediate();assert.equal(f.requests.length,3);f.session.close();
});
