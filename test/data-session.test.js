import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {createDataRegistry,createDataSession} from '../src/web/data-registry.js';

const item=title=>({key:title,title,data:{title}});
function fixture(){
 const registry=createDataRegistry(),requests=[];let changes=0;
 registry.register({id:'records',label:'Records',loadKey:(context,options)=>JSON.stringify([context.etag,options]),
  load:args=>new Promise((resolve,reject)=>requests.push({...args,resolve,reject})),items:(_context,data)=>data});
 const session=createDataSession(registry,{context:()=>({etag:'first',dataSlot:'a'}),api:()=>{},onChange:()=>changes++});
 return {session,requests,registry,get changes(){return changes;}};
}

test('card requests retain their own scope and discard late results after a filter changes',async()=>{
 const f=fixture(),a={etag:'first',dataSlot:'a'},b={...a,dataSlot:'b'};
 assert.equal(f.session.read('records',a,{tag:'field'}).status,'loading');
 f.session.read('records',b,{tag:'studio'});await setImmediate();
 assert.deepEqual(f.requests.map(r=>[r.context.dataSlot,r.options.tag]),[['a','field'],['b','studio']]);
 f.session.read('records',a,{tag:'revised'});await setImmediate();
 assert.equal(f.requests[0].signal.aborted,true);
 f.requests[2].resolve([item('New field result')]);f.requests[1].resolve([item('Studio result')]);await setImmediate();
 assert.deepEqual(f.session.read('records',a,{tag:'revised'}).items,[item('New field result')]);
 assert.deepEqual(f.session.read('records',b,{tag:'studio'}).items,[item('Studio result')]);
 const changes=f.changes;f.requests[0].resolve([item('Obsolete result')]);await setImmediate();
 assert.equal(f.changes,changes);assert.equal(f.session.read('records',a,{tag:'revised'}).items[0].title,'New field result');
 f.session.read('records',{...a,etag:'second'},{tag:'revised'});await setImmediate();assert.equal(f.requests.length,4);
 f.session.close();assert.equal(f.requests[3].signal.aborted,true);
 f.requests[3].resolve([item('Closed workspace')]);await setImmediate();assert.equal(f.changes,changes);
});

test('closed cards release their requests, retries recover independently, and static shared loads remain shared',async()=>{
 const f=fixture(),a={etag:'first',dataSlot:'a'},b={...a,dataSlot:'b'};
 f.session.read('records',a,{});f.session.read('records',b,{});await setImmediate();
 f.session.retainSlots(new Set(['b']));assert.equal(f.requests[0].signal.aborted,true);assert.equal(f.requests[1].signal.aborted,false);
 f.requests[1].reject(Error('Temporary failure'));await setImmediate();assert.equal(f.session.read('records',b,{}).status,'error');
 const {retry}=f.session;retry('records');f.session.read('records',b,{});await setImmediate();
 f.requests[2].resolve([item('Recovered')]);await setImmediate();assert.equal(f.session.read('records',b,{}).status,'ready');
 let loads=0;const shared={label:'Shared module',loadKey:'module',load:async()=>{loads++;return [item('Module')];},items:(_context,data)=>data};
 f.registry.register({...shared,id:'first'});f.registry.register({...shared,id:'second'});
 f.session.read('first');f.session.read('second');await setImmediate();assert.equal(loads,1);
 assert.equal(f.session.read('second').items[0].title,'Module');f.session.retainSlots(new Set());
 assert.equal(f.session.read('first').status,'ready');f.session.close();
});

test('protected sources prompt only on an explicit retry and late unlock results cannot revive a closed session',async()=>{
 const registry=createDataRegistry();let authorizations=0,loads=0,changes=0,release;
 registry.register({id:'protected',label:'Protected',loadKey:c=>c.etag,load:async()=>{loads++;if(loads===1)throw Object.assign(Error('Locked'),{code:'ACCESS_LOCKED'});return [item('Visible')];},items:(_c,data)=>data});
 const session=createDataSession(registry,{context:()=>({etag:'one'}),api:()=>{},onChange:()=>changes++,access:async run=>{authorizations++;await new Promise(resolve=>release=resolve);return run();}});
 session.read('protected');await setImmediate();assert.equal(session.read('protected').status,'error');assert.equal(authorizations,0);
 const retry=session.retry('protected');await setImmediate();assert.equal(authorizations,1);session.close();const previous=changes;release();await retry;assert.equal(loads,1);assert.equal(changes,previous);
});
