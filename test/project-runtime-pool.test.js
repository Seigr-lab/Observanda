import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {ProjectRuntimePool} from '../src/project-runtime-pool.js';
import {retainRuntimeEnvironment} from '../src/database-runtime-environment.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const tick=()=>delay(5);
function fixture(options={}){
 const services=new Map(),stops=[];let sequence=0;
 const pool=new ProjectRuntimePool({idleMs:10000,maxIdle:2,close:async root=>{stops.push(root);services.delete(root);},...options});
 const acquire=(root,options)=>pool.acquire(root,async()=>{if(!services.has(root))services.set(root,{id:++sequence});return services.get(root);},options);
 return {pool,acquire,stops,services};
}

test('idle eviction bounds cached project services while retaining active connections',async()=>{
 const f=fixture({maxIdle:1}),a=await f.acquire('a'),b=await f.acquire('b'),c=await f.acquire('c');
 const retain=retainRuntimeEnvironment(a.env);a.release();b.release();c.release();await tick();
 assert.deepEqual(f.stops,['b']);assert.equal(f.pool.stats().active,1);assert.equal(f.pool.stats().idle,1);
 retain();retain();await tick();assert.deepEqual(f.stops,['b','c']);assert.equal(f.pool.stats().references,0);assert.equal(f.pool.stats().idle,1);
 await f.pool.closeAll();assert.deepEqual(f.stops,['b','c','a']);assert.throws(()=>retainRuntimeEnvironment(a.env),{code:'DATABASE_CANCELLED'});
});

test('closing one project drains its references and reopening waits without blocking another project',async()=>{
 const gate=deferred(),stops=[];const f=fixture({close:async root=>{stops.push(root);if(root==='a')await gate.promise;f.services.delete(root);}}),a=await f.acquire('a'),old=a.env;
 const closing=f.pool.close('a');let reopened=false;const next=f.acquire('a').then(value=>{reopened=true;return value;});
 const b=await f.acquire('b');b.release();await tick();assert.equal(stops.length,0);assert.equal(reopened,false);
 a.release();await tick();assert.deepEqual(stops,['a']);assert.equal(reopened,false);gate.resolve();await closing;
 const fresh=await next;assert.notEqual(fresh.env,old);fresh.release();await f.pool.closeAll();
});

test('idle timeout releases services but cannot expire a retained scratch connection',async()=>{
 const f=fixture({idleMs:15}),a=await f.acquire('a'),scratch=retainRuntimeEnvironment(a.env);a.release();await delay(35);assert.equal(f.stops.length,0);
 scratch();await delay(35);assert.deepEqual(f.stops,['a']);assert.equal(f.pool.stats().open,0);await f.pool.closeAll();
});

test('explicit environment consumers retain their manual lifetime until close',async()=>{
 const f=fixture({maxIdle:0,idleMs:0}),manual=await f.acquire('manual',{manual:true});manual.release();await tick();assert.equal(f.stops.length,0);
 await f.pool.close('manual');assert.deepEqual(f.stops,['manual']);await f.pool.closeAll();
});

test('failed startup and shutdown release volatile admission for authenticated recovery',async()=>{
 const f=fixture();await assert.rejects(f.pool.acquire('broken',async()=>{throw Error('Startup failed');}),/Startup failed/);assert.equal(f.pool.stats().open,0);
 const a=await f.acquire('a');a.release();let failed=false;f.pool.stop=async root=>{f.services.delete(root);if(!failed){failed=true;throw Error('Stop failed');}};
 await assert.rejects(f.pool.close('a'),/Stop failed/);assert.equal(f.pool.stats().open,0);assert.throws(()=>retainRuntimeEnvironment(a.env),{code:'DATABASE_CANCELLED'});
 const recovered=await f.acquire('a');assert.notEqual(recovered.env,a.env);recovered.release();await f.pool.closeAll();
});

test('application shutdown drains active owners and refuses new work',async()=>{
 const f=fixture(),a=await f.acquire('a');let stopped=false;const close=f.pool.closeAll().then(()=>stopped=true);
 await assert.rejects(f.acquire('b'),{code:'DATABASE_CANCELLED'});await tick();assert.equal(stopped,false);a.release();await close;assert.equal(f.pool.stats().open,0);
});
