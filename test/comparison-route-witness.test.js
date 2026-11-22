import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {comparisonRouteWitness} from '../src/comparison-route-witness.js';
import {databaseCapacity,scratchDatabase} from '../src/postgres.js';
const reference=()=>({workspaceId:randomUUID(),kind:'dataset',id:randomUUID(),revision:'a'.repeat(64)});
const owner=()=>({workspaceId:randomUUID(),projectId:randomUUID(),labBookId:null});
const identity=ref=>ref.workspaceId+'/'+ref.kind+'/'+ref.id;
function fixture(signal){
 const locations=new Map(),calls={locate:0};
 const routes=comparisonRouteWitness({signal,locate:async ref=>{calls.locate++;return locations.get(identity(ref));}});
 return {routes,locations,calls};
}
test('live route witnesses keep observed owners in scratch storage, refuse a changed owner and close their storage',async()=>{
 const baseline=databaseCapacity().active,f=fixture(),refs=Array.from({length:320},reference),target=owner();
 try{
  for(const ref of refs){f.locations.set(identity(ref),target);await f.routes.observe(ref,target);}
  assert.equal(databaseCapacity().active,baseline+1);
  const captured=await f.routes.capture([refs[0],refs[319]]);assert.deepEqual(captured.map(value=>value.owner),[target,target]);assert.equal(f.calls.locate,0);
  await assert.rejects(f.routes.observe(refs[319],owner()),{code:'WORKSPACE_CHANGED'});
  assert.equal(databaseCapacity().active,baseline);
 }finally{await f.routes.close();}
 assert.equal(databaseCapacity().active,baseline);await assert.rejects(f.routes.observe(reference(),target),{code:'WORKSPACE_CHANGED'});
});
test('captured admission routes survive reader closure, reject rerouting and do not update a prior witness',async()=>{
 const baseline=databaseCapacity().active,ref=reference(),target=owner(),admission=fixture();admission.locations.set(identity(ref),target);
 await admission.routes.observe(ref,target);const captured=await admission.routes.capture([ref]);await admission.routes.close();assert.equal(databaseCapacity().active,baseline);
 await assert.rejects(admission.routes.capture([ref]),{code:'WORKSPACE_CHANGED'});
 const worker=fixture();worker.locations.set(identity(ref),target);
 try{
  await worker.routes.assert(captured);
  await assert.rejects(worker.routes.observe(ref,owner()),{code:'WORKSPACE_CHANGED'});assert.equal(databaseCapacity().active,baseline);
 }finally{await worker.routes.close();}
 const stale=fixture();stale.locations.set(identity(ref),owner());
 try{await assert.rejects(stale.routes.assert(captured),{code:'WORKSPACE_CHANGED'});assert.equal(databaseCapacity().active,baseline);}finally{await stale.routes.close();}
});
test('route capture is bounded, exact and cancellation releases temporary state',async()=>{
 const baseline=databaseCapacity().active,controller=new AbortController(),f=fixture(controller.signal),ref=reference(),target=owner();f.locations.set(identity(ref),target);
 await f.routes.observe(ref,target);controller.abort();await f.routes.close();assert.equal(databaseCapacity().active,baseline);
 await assert.rejects(f.routes.capture([ref]),{name:'AbortError'});
 const missing=fixture();try{await assert.rejects(missing.routes.capture([ref]),{code:'WORKSPACE_CHANGED'});}finally{await missing.routes.close();}
 const excessive=fixture();try{await assert.rejects(excessive.routes.capture(Array.from({length:197},reference)),{code:'INVALID'});}finally{await excessive.routes.close();}
 assert.equal(databaseCapacity().active,baseline);
});
test('failed scratch setup releases the connection and leaves closed route APIs',async t=>{
 const observer=await scratchDatabase(),prototype=Object.getPrototypeOf(observer),run=prototype.run,baseline=databaseCapacity().active;
 const spy=t.mock.method(prototype,'run',function(sql,...values){return run.call(this,sql.startsWith('CREATE TEMP TABLE obs_work_')?'SELECT 1/0':sql,...values);});
 const f=fixture();try{
  await assert.rejects(f.routes.observe(reference(),owner()),{code:'22012'});await f.routes.close();assert.equal(databaseCapacity().active,baseline);
  await assert.rejects(f.routes.capture([reference()]),{code:'WORKSPACE_CHANGED'});
 }finally{spy.mock.restore();await observer.close();}
});
