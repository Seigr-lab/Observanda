import test from 'node:test';
import assert from 'node:assert/strict';
import {createPearsonMoments,validatePearsonMoments,updatePearsonMoments,finishPearsonStatistic} from '../src/dataset-pearson.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
import {defaultStructuredCalculationPolicy} from '../src/web/tools/calculation-policy.js';
import {validatePolicyScalar} from '../src/web/measurement-scalar-policy.js';
import {MaterialSequence} from '../src/material-sequence.js';
import {RetainedJsonValue} from '../src/retained-json-value.js';
import {DatasetResourceBudget} from '../src/dataset-resource-budget.js';
const policy=(resources={})=>({...defaultDatasetResourcePolicy(),resources:{...defaultDatasetResourcePolicy().resources,...resources}});
const metric=(calculationPolicy=defaultStructuredCalculationPolicy())=>({operation:'correlation',method:'pearson-centered-pairs-v1',pairing:'complete-rows-v1',calculationPolicy});
const run=(pairs,own=policy())=>pairs.reduce((state,[x,y])=>updatePearsonMoments(state,String(x)+'/1',String(y)+'/1',{policy:own}),createPearsonMoments());
const finish=(state,options={})=>finishPearsonStatistic(state,metric(),{policy:policy(),...options});
test('Pearson exact centered state preserves sign, rational square roots and zero covariance',()=>{
 const state=run([[1,7],[2,5],[3,3]]);assert.deepEqual(state,{version:2,n:3,meanX:'2/1',meanY:'5/1',Cxx:'2/1',Cxy:'-4/1',Cyy:'8/1'});
 const negative=finish(state);assert.equal(negative.value,'-1/1');assert.equal(negative.receipt.evaluation.approximate,false);assert.equal(negative.receipt.evaluation.computation,null);
 assert.equal(finish(run([[1,3],[2,5],[3,7]])).value,'1/1');
 assert.equal(finish(run([[-1,0],[0,-1],[1,1]])).value,'1/2');
 assert.equal(finish(run([[-1,1],[0,-2],[1,1]])).value,'0/1');
 assert.equal(finish(run([[12,5],[-3,10]])).value,'-1/1');
});
test('irrational coefficient retains complete engine4 digits and the explicit policy, not display text',()=>{
 const calculationPolicy={...defaultStructuredCalculationPolicy(),workingDigits:32,displayDigits:4},saved=structuredClone(calculationPolicy),state=run([[1,1],[2,2],[3,4]]);
 const result=finishPearsonStatistic(state,metric(calculationPolicy),{policy:policy()});assert.equal(result.receipt.evaluation.approximate,true);assert.deepEqual(result.receipt.evaluation.policy,saved);
 const full=result.receipt.evaluation.computation;assert.equal(full.kind,'approximate-real');assert.ok(full.spelling.startsWith('0.9819805060619657'));assert.ok(full.spelling.length>20);
 const exact=validatePolicyScalar({spelling:full.spelling,representation:'decimal',radix:10},policy());assert.equal(result.value,exact.numerator+'/'+exact.denominator);
 const reversed=finishPearsonStatistic(run([[1,-1],[2,-2],[3,-4]]),metric(calculationPolicy),{policy:policy()});assert.equal(reversed.receipt.evaluation.computation.spelling,'-'+full.spelling);assert.equal(reversed.value,'-'+result.value);assert.deepEqual(calculationPolicy,saved);
});
test('empty, insufficient and both zero-spread axes retain explicit absence statuses',()=>{
 for(const [pairs,status]of [[[],'no-pairs'],[[[1,2]],'insufficient-pairs'],[[[1,2],[1,3]],'zero-x-spread'],[[[1,2],[3,2]],'zero-y-spread'],[[[1,2],[1,2]],'zero-both-spread']]){const result=finish(run(pairs));assert.equal(result.value,null);assert.equal(result.receipt.status,status);assert.equal(result.receipt.evaluation,null);}
 assert.throws(()=>finishPearsonStatistic(createPearsonMoments(),metric({...defaultStructuredCalculationPolicy(),rounding:'implicit'}),{policy:policy()}),{code:'DATASET_AGGREGATION'});
});
test('checkpoint state validates canonical counts, both variances and exact PSD without rejecting negative covariance',()=>{
 const state=run([[1,1],[2,2],[3,4]]);assert.equal(validatePearsonMoments(state,{policy:policy(),count:3}),state);
 for(const bad of [{...state,Cyy:'-1/1'},{...state,Cyy:'0/1'},{...state,Cxy:'100/1'},{...state,Cyy:'28/6'},{...state,version:1},{...state,n:2},{...state,extra:true},{...createPearsonMoments(),meanY:'1/1'},{...state,n:Number.NaN}])assert.throws(()=>validatePearsonMoments(bad,{policy:policy()}),{code:'MATERIAL_MISSING'});
 assert.throws(()=>validatePearsonMoments(state,{policy:policy(),count:4}),{code:'MATERIAL_MISSING'});
 const negative=run([[1,7],[2,5],[3,3]]);assert.equal(validatePearsonMoments(negative,{policy:policy()}),negative);
});
test('stable source order resumes exact moments, small spreads and radix-resolved rational coordinates',()=>{
 const origin=10n**80n,pairs=[[origin,1],[origin+1n,2],[origin+2n,4]],continuous=run(pairs),checkpoint=structuredClone(run(pairs.slice(0,2))),before=structuredClone(checkpoint),resumed=updatePearsonMoments(checkpoint,(origin+2n)+'/1','4/1',{policy:policy()});assert.deepEqual(resumed,continuous);assert.deepEqual(checkpoint,before);assert.equal(resumed.Cxx,'2/1');assert.equal(resumed.Cyy,'14/3');
 const exact=text=>{const value=validatePolicyScalar({spelling:text,representation:'radix-fraction',radix:6},policy());return value.numerator+'/'+value.denominator;};let state=createPearsonMoments();for(const [x,y]of [['0.3','1'],['1','2'],['1.3','3']])state=updatePearsonMoments(state,exact(x),exact(y),{policy:policy()});assert.equal(finish(state).value,'1/1');
});
test('Pearson obeys cumulative caller and engine policies and cancellation without approximation fallback',()=>{
 const state=run([[1,1],[2,2],[3,4]]),low=policy({maxOperations:1});assert.throws(()=>updatePearsonMoments(createPearsonMoments(),'1/1','2/1',{policy:low}),{code:'DATASET_CALCULATION_RESOURCE'});
 const budget=new DatasetResourceBudget(policy());budget.remaining=-1;assert.throws(()=>finish(state,{budget}),{code:'DATASET_CALCULATION_RESOURCE'});
 const consumed=new DatasetResourceBudget(policy({maxOperations:1000}));consumed.run(()=>{for(let i=0;i<998;i++)consumed.step();});assert.throws(()=>finish(state,{budget:consumed}),{code:'DATASET_CALCULATION_RESOURCE'});
 const tiny={...defaultStructuredCalculationPolicy(),resources:{...defaultStructuredCalculationPolicy().resources,maxOperations:1}};assert.throws(()=>finishPearsonStatistic(state,metric(tiny),{policy:policy()}),{code:'DATASET_CALCULATION_RESOURCE'});
 const controller=new AbortController();controller.abort();assert.throws(()=>updatePearsonMoments(createPearsonMoments(),'1/1','1/1',{policy:policy(),signal:controller.signal}),{name:'AbortError'});assert.throws(()=>finish(state,{signal:controller.signal}),{name:'AbortError'});
 assert.throws(()=>updatePearsonMoments(createPearsonMoments(),(1n<<70n)+'/1','1/1',{policy:policy({maxBits:64})}),{code:'DATASET_CALCULATION_RESOURCE'});
});

test('long exact centered sums use existing paged checkpoint storage and resume without whole observations',async()=>{
 const own=policy({maxBits:262144,maxScalarCharacters:40000,maxOperations:200000}),x='1/'+(10n**10000n+1n);let state=updatePearsonMoments(createPearsonMoments(),'0/1','0/1',{policy:own});state=updatePearsonMoments(state,x,x,{policy:own});assert.ok(state.Cyy.length>16384);
 const rows=new Map(),sequences=new MaterialSequence({readMetadata:async key=>rows.get(key)??null,writeMetadata:async(key,value)=>rows.set(key,value)}),storage=new RetainedJsonValue(sequences,fn=>fn(),{namespace:'pearson-test-checkpoint'}),reference=await storage.put(state),restored=await storage.read(reference);assert.ok(reference.chunks.count>1);assert.deepEqual(restored,state);validatePearsonMoments(restored,{policy:own,count:2});
 const resumed=updatePearsonMoments(restored,'1/1','1/1',{policy:own}),continuous=updatePearsonMoments(state,'1/1','1/1',{policy:own});assert.deepEqual(resumed,continuous);assert.equal(finishPearsonStatistic(resumed,metric(),{policy:own}).value,'1/1');assert.ok([...rows.values()].every(value=>Buffer.byteLength(value)<1048576));
});
