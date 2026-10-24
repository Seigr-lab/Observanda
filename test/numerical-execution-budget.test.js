import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {defaultNumericalExecutionPolicy,validNumericalExecutionPolicy,validNumericalExecutionState,numericalExecutionLimits} from '../src/web/numerical-execution-policy.js';
import {createNumericalExecutionState,reserveNumericalExecution,settleNumericalExecution,recoverNumericalExecution,validateNumericalExecutionState,NumericalExecutionBudget} from '../src/numerical-execution-budget.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
import {DatasetResourceBudget} from '../src/dataset-resource-budget.js';
import {validatePolicyScalar} from '../src/web/measurement-scalar-policy.js';
const identity='a'.repeat(64),invalid={code:'NUMERICAL_EXECUTION_INVALID'},resource={code:'DATASET_CALCULATION_RESOURCE'};
const policy=(totalOps=20,sliceOps=10,totalTime=100,sliceTime=50)=>({version:1,scope:'numerical-job',total:{maxOperations:totalOps,maxActiveMilliseconds:totalTime},slice:{maxOperations:sliceOps,maxActiveMilliseconds:sliceTime}});
const initial=(p=policy())=>createNumericalExecutionState(identity,p);
const reserve=(state,operations=state.policy.slice.maxOperations,activeMilliseconds=state.policy.slice.maxActiveMilliseconds,id=randomUUID())=>reserveNumericalExecution(state,{id,operations,activeMilliseconds});
const serial=value=>JSON.parse(JSON.stringify(value));

test('new policy scopes reuse existing ceilings and conservative defaults without changing scalar policies',()=>{
 const expected=defaultDatasetResourcePolicy();assert.equal(defaultNumericalExecutionPolicy().total.maxOperations,expected.resources.maxOperations);assert.equal(defaultNumericalExecutionPolicy().total.maxActiveMilliseconds,expected.resources.maxMilliseconds);assert.equal(validNumericalExecutionPolicy(defaultNumericalExecutionPolicy()),true);
 assert.deepEqual(numericalExecutionLimits.total,{maxOperations:[1,1000000],maxActiveMilliseconds:[1,30000]});assert.deepEqual(numericalExecutionLimits.slice,{maxOperations:[1,50000],maxActiveMilliseconds:[1,5000]});assert.equal(validNumericalExecutionPolicy(policy(1000000,50000,30000,5000)),true);
 for(const change of [p=>p.scope='scalar-operation',p=>p.version=2,p=>p.total.maxOperations=1000001,p=>p.total.maxActiveMilliseconds=30001,p=>p.slice.maxOperations=50001,p=>p.slice.maxActiveMilliseconds=5001,p=>p.slice.maxOperations=p.total.maxOperations+1,p=>p.slice.maxActiveMilliseconds=p.total.maxActiveMilliseconds+1,p=>p.total.maxOperations=1.5,p=>p.extra=true]){const p=policy();change(p);assert.equal(validNumericalExecutionPolicy(p),false);assert.throws(()=>initial(p),invalid);}
});

test('immutable constant-size state pins command identity and exact authored policy',()=>{
 const authored=policy(),state=initial(authored),before=serial(state),reserved=reserve(state);authored.total.maxOperations=999;assert.deepEqual(state,before);assert.equal(validNumericalExecutionState(reserved),true);assert.ok(Object.isFrozen(reserved)&&Object.isFrozen(reserved.policy.total)&&Object.isFrozen(reserved.reservation));assert.throws(()=>{reserved.consumed.operations=1;},TypeError);
 assert.equal(validateNumericalExecutionState(reserved,{identity,policy:policy()}),reserved);assert.throws(()=>validateNumericalExecutionState(reserved,{identity:'b'.repeat(64)}),invalid);assert.throws(()=>validateNumericalExecutionState(reserved,{policy:policy(30)}),invalid);assert.throws(()=>initial({...policy(),scope:'scalar-operation'}),invalid);
 assert.deepEqual(Object.keys(reserved),['version','identity','policy','sequence','consumed','reservation']);assert.throws(()=>reserve(reserved),invalid);
});

test('successive slice budgets debit the same total and never reset it',()=>{
 let state=reserve(initial(policy(10,6)));let budget=new NumericalExecutionBudget(state);budget.run(()=>budget.step(4));const first=budget.finish();assert.equal(first.operations,4);assert.throws(()=>budget.run(()=>{}),invalid);assert.deepEqual(budget.finish(),first);state=settleNumericalExecution(state,first);assert.equal(state.consumed.operations,4);
 state=reserve(serial(state));budget=new NumericalExecutionBudget(state);budget.run(()=>budget.step(3));budget.run(()=>budget.step(3));assert.throws(()=>budget.run(()=>budget.step()),resource);assert.equal(budget.usage().operations,6);state=settleNumericalExecution(state,budget.finish());assert.equal(state.consumed.operations,10);assert.throws(()=>reserve(state,1,1),resource);
});

test('restart charges uncertain reservation in full and refuses stale settlement',()=>{
 const original=reserve(initial(policy(12,8,30,20))),recovered=recoverNumericalExecution(serial(original));assert.deepEqual(recovered.consumed,{operations:8,activeMilliseconds:20});assert.equal(recovered.reservation,null);assert.deepEqual(recoverNumericalExecution(recovered),recovered);assert.throws(()=>reserve(recovered,8,10),resource);
 const next=reserve(recovered,4,10,original.reservation.id);assert.equal(next.sequence,2);assert.throws(()=>settleNumericalExecution(next,{...original.reservation,operations:0,activeMilliseconds:0}),invalid);assert.throws(()=>settleNumericalExecution(recovered,{...original.reservation,operations:0,activeMilliseconds:0}),invalid);
 const spent=recoverNumericalExecution(next);assert.deepEqual(spent.consumed,{operations:12,activeMilliseconds:30});assert.throws(()=>reserve(spent,1,1),resource);
});

test('active CPU spans nested runs but excludes awaited source, checkpoint and permission I/O',async()=>{
 let clock=100;const state=reserve(initial(policy(100,100,100,20))),budget=new NumericalExecutionBudget(state,{now:()=>clock,check:async()=>{clock+=500;}});
 budget.run(()=>{clock+=5;budget.step();budget.run(()=>{clock+=3;budget.step();});clock+=4;});assert.equal(budget.usage().activeMilliseconds,12);clock+=1000;await budget.check();assert.equal(budget.usage().activeMilliseconds,12);
 assert.throws(()=>budget.run(()=>{clock+=9;budget.step();}),resource);const usage=budget.finish();assert.equal(usage.activeMilliseconds,21);assert.equal(usage.operations,2);const settled=settleNumericalExecution(state,usage);assert.equal(settled.consumed.activeMilliseconds,21);assert.throws(()=>reserve(settled,1,80),invalid);assert.doesNotThrow(()=>reserve(settled,1,20));
});

test('known CPU overrun is retained even beyond the whole allowance and cannot authorize more work',()=>{
 let clock=0;const state=reserve(initial(policy(10,10,10,10))),budget=new NumericalExecutionBudget(state,{now:()=>clock});assert.throws(()=>budget.run(()=>{budget.step();clock=15;}),resource);const settled=settleNumericalExecution(state,budget.finish());assert.equal(settled.consumed.activeMilliseconds,15);assert.equal(validNumericalExecutionState(settled),true);assert.throws(()=>reserve(settled,1,1),resource);
});

test('cancellation/access errors keep identity and known work remains settleable',async()=>{
 let clock=0;const controller=new AbortController(),reason=Error('Cancelled source'),state=reserve(initial()),budget=new NumericalExecutionBudget(state,{signal:controller.signal,now:()=>clock});assert.throws(()=>budget.run(()=>{budget.step(2);clock+=3;controller.abort(reason);budget.step();}),error=>error===reason);assert.deepEqual(settleNumericalExecution(state,budget.finish()).consumed,{operations:2,activeMilliseconds:3});
 const denied=Error('Access denied'),deniedState=reserve(initial()),locked=new NumericalExecutionBudget(deniedState,{check:async()=>{throw denied;}});await assert.rejects(locked.check(),error=>error===denied);assert.deepEqual(settleNumericalExecution(deniedState,locked.finish()).consumed,{operations:0,activeMilliseconds:0});
 const stopped=new AbortController();stopped.abort(reason);const prior=new NumericalExecutionBudget(reserve(initial()),{signal:stopped.signal});assert.throws(()=>prior.run(()=>assert.fail('Must not run')),error=>error===reason);assert.equal(prior.finish().operations,0);
});

test('scalar interpretation limits remain local while recreated scalar budgets share the reservation',()=>{
 const state=reserve(initial(policy(5,5))),execution=new NumericalExecutionBudget(state),own=defaultDatasetResourcePolicy();for(let i=0;i<2;i++){const scalar=execution.scalarBudget(own);assert.ok(scalar instanceof DatasetResourceBudget);scalar.run(()=>scalar.step());}const last=execution.scalarBudget(own);assert.throws(()=>last.run(()=>last.step()),resource);assert.equal(execution.finish().operations,5);
 const source=defaultDatasetResourcePolicy();source.resources.maxBits=64;const larger=defaultDatasetResourcePolicy(),limited=new NumericalExecutionBudget(reserve(initial(policy(500,500)))),scalar=limited.scalarBudget(larger);assert.throws(()=>scalar.run(()=>validatePolicyScalar({spelling:String(1n<<70n),representation:'integer',radix:10},source,{budget:scalar})),resource);assert.ok(limited.finish().operations>0);
});

test('malformed, mismatched and inconsistent checkpoints or receipts refuse',()=>{
 const reserved=reserve(initial());for(const change of [s=>s.extra=1,s=>s.version=2,s=>s.identity='not-a-digest',s=>s.sequence=0,s=>s.consumed.operations=-1,s=>s.consumed.operations=21,s=>s.consumed.activeMilliseconds=Infinity,s=>s.reservation.sequence=2,s=>s.reservation.operations=11,s=>s.reservation.activeMilliseconds=101,s=>s.policy.slice.maxOperations=50001]){const state=serial(reserved);change(state);assert.equal(validNumericalExecutionState(state),false);assert.throws(()=>validateNumericalExecutionState(state),invalid);}
 for(const usage of [{...reserved.reservation,id:randomUUID()},{...reserved.reservation,operations:11},{...reserved.reservation,operations:-1},{...reserved.reservation,operations:0.5},{...reserved.reservation,activeMilliseconds:NaN},{...reserved.reservation,extra:0}])assert.throws(()=>settleNumericalExecution(reserved,usage),invalid);
 assert.throws(()=>new NumericalExecutionBudget(initial()),invalid);assert.throws(()=>new NumericalExecutionBudget(reserved,{policy:policy(30)}),invalid);
 const impossible=serial(initial());impossible.consumed.operations=1;assert.equal(validNumericalExecutionState(impossible),false);
});

test('numerical work must use synchronous scopes; usage seals against later execution',()=>{
 const budget=new NumericalExecutionBudget(reserve(initial()));let invoked=false;assert.throws(()=>budget.run(async()=>{invoked=true;}),invalid);assert.equal(invoked,false);assert.throws(()=>budget.run(()=>Promise.resolve()),invalid);assert.throws(()=>budget.step(),invalid);assert.throws(()=>budget.run(()=>budget.usage()),invalid);assert.throws(()=>budget.run(()=>budget.step(0)),invalid);const settled=budget.finish();assert.ok(settled.activeMilliseconds>=0);assert.throws(()=>budget.scalarBudget(defaultDatasetResourcePolicy()),invalid);
 let clock=10;const rewind=new NumericalExecutionBudget(reserve(initial()),{now:()=>clock});assert.throws(()=>rewind.run(()=>{clock=9;}),invalid);
});

test('real awaited I/O does not spend a short numerical slice',async()=>{
 const state=reserve(initial(policy(100,100,100,50))),budget=new NumericalExecutionBudget(state),start=performance.now();budget.run(()=>budget.step(10));await new Promise(resolve=>setTimeout(resolve,75));budget.run(()=>budget.step(10));const usage=budget.finish();assert.ok(performance.now()-start>=70);assert.ok(usage.activeMilliseconds<50);assert.equal(usage.operations,20);assert.equal(settleNumericalExecution(state,usage).consumed.operations,20);
});
