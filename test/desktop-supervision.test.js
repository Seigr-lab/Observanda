import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {ServiceSupervisor} from '../desktop/service-supervisor.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

test('unresponsive shutdown is reported within a bounded wait and never declares work lost or kills it',async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval','Date']});const exit=deferred(),notices=[];let stops=0;
 const supervisor=new ServiceSupervisor({query:()=>new Promise(()=>{}),intervalMs:10,probeMs:5,noticeMs:30,onWaiting:notice=>notices.push(notice)});
 const stopped=supervisor.stop(()=>stops++,exit.promise);let finished=false;stopped.then(()=>finished=true);
 t.mock.timers.tick(10);await setImmediate();t.mock.timers.tick(5);await setImmediate();assert.equal(notices.length,1);assert.equal(notices[0].responding,false);assert.equal(finished,false);assert.equal(supervisor.state,'degraded');
 assert.equal(supervisor.stop(()=>stops++,exit.promise),stopped);assert.equal(stops,1);exit.resolve();await stopped;assert.equal(supervisor.state,'stopped');assert.equal(finished,true);
});
test('slow safe database shutdown reports its phase once and waits for the actual exit',async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval','Date']});const exit=deferred(),notices=[];
 const supervisor=new ServiceSupervisor({query:async()=>({phase:'database-stop'}),intervalMs:10,probeMs:5,noticeMs:30,onWaiting:notice=>notices.push(notice)});
 const stopped=supervisor.stop(()=>{},exit.promise);
 for(let i=0;i<5;i++){t.mock.timers.tick(10);await setImmediate();}
 assert.equal(notices.length,1);assert.equal(notices[0].phase,'database-stop');assert.equal(notices[0].responding,true);assert.equal(supervisor.state,'stopping');exit.resolve();await stopped;
});
test('startup and ready states recover after a missed heartbeat and every unsolicited exit is unexpected',async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval','Date']});let responds=false;
 const supervisor=new ServiceSupervisor({query:async()=>{if(!responds)throw Error('Unavailable');return {phase:'startup'};},intervalMs:10,probeMs:5});supervisor.monitor();
 t.mock.timers.tick(10);await setImmediate();assert.equal(supervisor.state,'degraded');responds=true;t.mock.timers.tick(10);await setImmediate();assert.equal(supervisor.state,'starting');supervisor.ready();assert.equal(supervisor.state,'ready');assert.equal(supervisor.exited(),true);assert.equal(supervisor.state,'stopped');
 // Exit classification intentionally does not depend on the child's code.
 const normal=new ServiceSupervisor({query:async()=>({})}),exit=deferred(),closing=normal.stop(()=>{},exit.promise);assert.equal(normal.exited(),false);exit.resolve();await closing;
});
