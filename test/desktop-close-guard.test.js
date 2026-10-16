import {test} from 'node:test';
import assert from 'node:assert/strict';
import {closeGuard} from '../desktop/close-guard.js';

test('close waits visibly for a busy service and cancellation prevents automatic closing',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let busy=true,choice=false,closed=0,waiting=false,questions=0;
 const guard=closeGuard({status:async()=>({busy,failure:0}),ask:async()=>{questions++;return choice;},close:()=>{assert.ok(guard.allowed);closed++;},waiting:value=>waiting=value,failed:()=>assert.fail('Unexpected failure'),unavailable:()=>assert.fail('Unexpected status failure')});t.after(()=>guard.dispose());
 await guard.request();assert.equal(closed,0);assert.equal(waiting,false);
 choice=true;await guard.request();assert.equal(waiting,true);assert.equal(closed,0);
 guard.cancel();busy=false;t.mock.timers.tick(1000);await Promise.resolve();assert.equal(closed,0);
 busy=true;await guard.request();busy=false;t.mock.timers.tick(500);await Promise.resolve();await Promise.resolve();assert.equal(closed,1);assert.equal(waiting,false);assert.equal(questions,3);
});

test('failure or missing status keeps the window open instead of implying completion',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let state={busy:true,failure:0},failed=0,unavailable=0;
 const guard=closeGuard({status:async()=>{if(!state)throw Error();return state;},ask:async()=>true,close:()=>assert.fail('Work has not succeeded'),waiting:()=>{},failed:()=>failed++,unavailable:()=>unavailable++});t.after(()=>guard.dispose());
 await guard.request();state={busy:false,failure:1};t.mock.timers.tick(500);await Promise.resolve();await Promise.resolve();assert.equal(failed,1);
 state=null;await guard.request();assert.equal(unavailable,1);
});
