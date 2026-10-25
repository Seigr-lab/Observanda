import test from 'node:test';
import assert from 'node:assert/strict';
import {createWeightedFitMoments,validateWeightedFitMoments,updateWeightedFitMoments,finishWeightedFit,WEIGHTED_FIT_RESULTS,WEIGHTED_FIT_METHOD} from '../src/dataset-weighted-fit.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
import {DatasetResourceBudget} from '../src/dataset-resource-budget.js';
import {validatePolicyScalar} from '../src/web/measurement-scalar-policy.js';
import {MaterialSequence} from '../src/material-sequence.js';
import {RetainedJsonValue} from '../src/retained-json-value.js';
const policy=resources=>({...defaultDatasetResourcePolicy(),resources:{...defaultDatasetResourcePolicy().resources,...resources}}),scalar=spelling=>({spelling,representation:'rational',radix:10});
const metric=(result,reference='0/1',evaluation='3/1')=>({operation:'weighted-affine-fit',method:WEIGHTED_FIT_METHOD,pairing:'complete-triples-v1',result,referenceX:scalar(reference),...(['fitted-mean','fitted-mean-variance'].includes(result)?{evaluationX:scalar(evaluation)}:{})});
const run=(rows,own=policy())=>rows.reduce((state,[x,y,v])=>updateWeightedFitMoments(state,x,y,v,{policy:own}),createWeightedFitMoments()),finish=(state,result,reference='0/1',evaluation='3/1',own=policy())=>finishWeightedFit(state,metric(result,reference,evaluation),{policy:own});
const analytic=[['0/1','1/1','1/1'],['1/1','3/1','4/1'],['2/1','8/1','1/1']];
// Independent small-data normal-equation oracle: no centered recurrence.
function rational(n,d=1n){if(d<0n){n=-n;d=-d;}let a=n<0n?-n:n,b=d;while(b)[a,b]=[b,a%b];return [n/(a||1n),d/(a||1n)];}
const parse=text=>rational(...text.split('/').map(BigInt)),text=value=>value.join('/'),add=(a,b)=>rational(a[0]*b[1]+b[0]*a[1],a[1]*b[1]),neg=a=>[-a[0],a[1]],sub=(a,b)=>add(a,neg(b)),mul=(a,b)=>rational(a[0]*b[0],a[1]*b[1]),div=(a,b)=>rational(a[0]*b[1],a[1]*b[0]);
function oracle(rows,reference,evaluation){let W=[0n,1n],X=W,Y=W,XX=W,XY=W;for(const row of rows){const [x,y,v]=row.map(parse),w=div([1n,1n],v);W=add(W,w);X=add(X,mul(w,x));Y=add(Y,mul(w,y));XX=add(XX,mul(w,mul(x,x)));XY=add(XY,mul(w,mul(x,y)));}const D=sub(mul(W,XX),mul(X,X)),a0=div(sub(mul(XX,Y),mul(X,XY)),D),slope=div(sub(mul(W,XY),mul(X,Y)),D),aVariance=div(XX,D),bVariance=div(W,D),cov=neg(div(X,D)),at=z=>add(a0,mul(slope,z)),variance=z=>add(add(aVariance,mul([2n,1n],mul(z,cov))),mul(mul(z,z),bVariance));return {'slope':text(slope),'intercept':text(at(reference)),'slope-variance':text(bVariance),'intercept-variance':text(variance(reference)),'coefficient-covariance':text(add(cov,mul(reference,bVariance))),'fitted-mean':text(at(evaluation)),'fitted-mean-variance':text(variance(evaluation))};}

test('supplied heteroscedastic variances give all seven exact outputs and preserve covariance signs',()=>{
 const state=run(analytic);assert.deepEqual(state,{version:1,n:3,W:'9/4',meanX:'1/1',meanY:'13/3',Sxx:'2/1',Sxy:'7/1'});
 const expected={'slope':'7/2','intercept':'5/6','slope-variance':'1/2','intercept-variance':'17/18','coefficient-covariance':'-1/2','fitted-mean':'34/3','fitted-mean-variance':'22/9'};
 for(const result of WEIGHTED_FIT_RESULTS){const actual=finish(state,result);assert.equal(actual.value,expected[result]);assert.deepEqual(actual.receipt,{version:1,method:WEIGHTED_FIT_METHOD,pairing:'complete-triples-v1',status:'ready'});}
 const anti=run(analytic.map(([x,y,v])=>[x,text(neg(parse(y))),v]));assert.equal(finish(anti,'slope').value,'-7/2');assert.equal(finish(anti,'intercept').value,'-5/6');assert.equal(finish(anti,'coefficient-covariance').value,'-1/2');assert.equal(finish(anti,'slope-variance').value,'1/2');
});

test('streaming weighted states agree with independent exact normal equations and source permutations',()=>{
 for(let seed=1;seed<=12;seed++){const rows=Array.from({length:seed+2},(_,i)=>[(i-3)+'/2',((i*i+seed*7)%19-9)+'/3',(1+(i*3+seed)%7)+'/4']),state=run(rows),expected=oracle(rows,parse('-3/2'),parse('7/3'));for(const result of WEIGHTED_FIT_RESULTS)assert.equal(finish(state,result,'-3/2','7/3').value,expected[result]);assert.deepEqual(run([...rows].reverse()),state);}
});

test('variance scaling and shifted reference change covariance correctly without residual rescaling',()=>{
 const state=run(analytic),scaled=run(analytic.map(([x,y,v])=>[x,y,text(mul(parse(v),[9n,1n]))]));
 for(const result of ['slope','intercept','fitted-mean'])assert.equal(finish(scaled,result).value,finish(state,result).value);
 for(const result of ['slope-variance','intercept-variance','coefficient-covariance','fitted-mean-variance'])assert.equal(finish(scaled,result).value,text(mul(parse(finish(state,result).value),[9n,1n])));
 assert.equal(finish(state,'intercept','1/1').value,'13/3');assert.equal(finish(state,'intercept-variance','1/1').value,'4/9');assert.equal(finish(state,'coefficient-covariance','1/1').value,'0/1');assert.equal(finish(state,'coefficient-covariance','3/1').value,'1/1');assert.equal(finish(state,'fitted-mean-variance','999/1').value,'22/9');
 const altered=run(analytic.map(([x,y,v],i)=>[x,(100*i*i)+'/1',v]));assert.equal(finish(altered,'slope-variance').value,finish(state,'slope-variance').value,'supplied variances are not multiplied by residual spread');
 const origin=10n**100n,large=run([[origin+'/1','1/1','1/1'],[(origin+1n)+'/1','3/1','4/1'],[(origin+2n)+'/1','5/1','1/1']]);assert.equal(finish(large,'slope',origin+'/1').value,'2/1');assert.equal(finish(large,'intercept',origin+'/1').value,'1/1');assert.equal(finish(large,'intercept-variance',origin+'/1').value,'17/18');
});

test('unavailable states remain explicit and invalid variances or authored coordinates never become unavailable',()=>{
 const empty=createWeightedFitMoments(),one=run([['2/1','5/1','3/1']]),constant=run([['2/1','5/1','1/1'],['2/1','8/1','4/1']]);
 for(const result of WEIGHTED_FIT_RESULTS)for(const [state,status]of [[empty,'no-pairs'],[one,'insufficient-pairs'],[constant,'zero-x-spread']]){const output=finish(state,result);assert.equal(output.value,null);assert.equal(output.receipt.status,status);}
 const two=run([['0/1','3/1','1/1'],['2/1','3/1','1/1']]);assert.equal(finish(two,'slope').value,'0/1');assert.equal(finish(two,'slope-variance').value,'1/2','two samples need no residual degrees-of-freedom estimate');
 for(const variance of ['0/1','-1/1'])assert.throws(()=>updateWeightedFitMoments(empty,'1/1','2/1',variance,{policy:policy()}),{code:'DATASET_WEIGHTED_FIT_VARIANCE'});
 for(const item of [{...metric('slope'),method:'other'},{...metric('slope'),pairing:'complete-rows-v1'},{...metric('slope'),result:'prediction-variance'},{...metric('slope'),referenceX:scalar('bad')},{...metric('slope'),referenceX:undefined},{...metric('slope'),evaluationX:scalar('1/1')},{...metric('fitted-mean'),evaluationX:undefined},{...metric('fitted-mean'),evaluationX:scalar('bad')}])assert.throws(()=>finishWeightedFit(empty,item,{policy:policy()}),{code:'DATASET_AGGREGATION'});
});

test('checkpoint validation rejects impossible or noncanonical states and resumes bounded retained state',async()=>{
 const valid=run(analytic);assert.equal(validateWeightedFitMoments(valid,{policy:policy(),count:3}),valid);
 for(const state of [{...valid,n:-1},{...valid,n:1.5},{...valid,n:0},{...valid,n:1},{...valid,W:'0/1'},{...valid,W:'-1/1'},{...valid,Sxx:'-1/1'},{...valid,Sxx:'0/1'},{...valid,meanX:'2/2'},{...valid,meanX:'00/1'},{...valid,meanX:'-0/1'},{...valid,Sxy:'0/0'},{...valid,extra:true},{...createWeightedFitMoments(),W:'1/1'}])assert.throws(()=>validateWeightedFitMoments(state,{policy:policy()}),{code:'MATERIAL_MISSING'});
 for(const count of [2,-1,1.5])assert.throws(()=>validateWeightedFitMoments(valid,{policy:policy(),count}),{code:'MATERIAL_MISSING'});
 assert.throws(()=>updateWeightedFitMoments({...valid,n:Number.MAX_SAFE_INTEGER},'1/1','1/1','1/1',{policy:policy()}),{code:'DATASET_AGGREGATION_LIMIT'});
 const own=policy({maxBits:131072,maxScalarCharacters:40000,maxOperations:200000}),d=10n**18000n+1n,rows=[['0/1','1/1','1/1'],['1/'+d,'2/1','2/1'],['2/1','3/1','4/1']],partial=run(rows.slice(0,2),own),objects=new Map(),sequences=new MaterialSequence({readMetadata:async key=>objects.get(key)??null,writeMetadata:async(key,value)=>objects.set(key,value)}),retained=new RetainedJsonValue(sequences,fn=>fn(),{namespace:'aggregation-work-chunks'}),ref=await retained.put(partial),restored=await retained.read(ref);
 assert.ok(JSON.stringify(partial).length>65536);assert.ok(ref.chunks.count>1);validateWeightedFitMoments(restored,{policy:own,count:2});const resumed=updateWeightedFitMoments(restored,...rows[2],{policy:own});assert.deepEqual(resumed,run(rows,own));for(const result of WEIGHTED_FIT_RESULTS)assert.deepEqual(finish(resumed,result,'0/1','3/1',own),finish(run(rows,own),result,'0/1','3/1',own));
});

test('original senary scalars and parameter spellings obey their own policy before canonical updates',()=>{
 const own=policy({maxScalarCharacters:6000,maxOperations:200000}),budget=new DatasetResourceBudget(own),parseSource=(spelling,representation,radix,sourcePolicy=own)=>{const value=validatePolicyScalar({spelling,representation,radix},sourcePolicy,{budget});return value.numerator+'/'+value.denominator;};let state=createWeightedFitMoments();
 for(const [x,y,v]of [['0.3','1.5','0.13'],['1','2.5','1'],['1.3','3.5','0.13']])state=updateWeightedFitMoments(state,parseSource('0'.repeat(4200)+x,'radix-fraction',6),parseSource(y,'decimal',10),parseSource(v,'radix-fraction',6),{policy:own,budget});
 const m={...metric('intercept'),referenceX:{spelling:'0.3',representation:'radix-fraction',radix:6}};assert.equal(finishWeightedFit(state,m,{policy:own,budget}).value,'3/2');assert.equal(finishWeightedFit(state,{...metric('fitted-mean'),evaluationX:{spelling:'1.3',representation:'radix-fraction',radix:6}},{policy:own,budget}).value,'7/2');
 assert.throws(()=>parseSource('0'.repeat(4200)+'1','integer',10,policy({maxScalarCharacters:16})),{code:'DATASET_CALCULATION_RESOURCE'});assert.throws(()=>parseSource((1n<<70n).toString(),'integer',10,policy({maxBits:64})),{code:'DATASET_CALCULATION_RESOURCE'});
 const before=structuredClone(state);finishWeightedFit(state,m,{policy:own});assert.deepEqual(state,before);
});

test('cumulative budgets and cancellation apply to every update and finish without resetting consumed work',()=>{
 const empty=createWeightedFitMoments();assert.throws(()=>updateWeightedFitMoments(empty,'1/1','2/1','1/1',{policy:policy({maxOperations:1})}),{code:'DATASET_CALCULATION_RESOURCE'});assert.throws(()=>updateWeightedFitMoments(empty,(1n<<70n)+'/1','1/1','1/1',{policy:policy({maxBits:64})}),{code:'DATASET_CALCULATION_RESOURCE'});
 const expired=new DatasetResourceBudget(policy());expired.remaining=-1;assert.throws(()=>validateWeightedFitMoments(empty,{policy:policy(),budget:expired}),{code:'DATASET_CALCULATION_RESOURCE'});
 const consumed=new DatasetResourceBudget(policy({maxOperations:200}));consumed.operations=199;assert.throws(()=>updateWeightedFitMoments(empty,'0/1','0/1','1/1',{policy:policy(),budget:consumed}),{code:'DATASET_CALCULATION_RESOURCE'});assert.ok(consumed.operations>=200);
 const limited=new DatasetResourceBudget(policy({maxOperations:1}));assert.throws(()=>finishWeightedFit(run(analytic),metric('slope'),{policy:policy(),budget:limited}),{code:'DATASET_CALCULATION_RESOURCE'});
 const controller=new AbortController();controller.abort();assert.throws(()=>updateWeightedFitMoments(empty,'1/1','1/1','1/1',{policy:policy(),signal:controller.signal}),{name:'AbortError'});assert.throws(()=>finishWeightedFit(empty,metric('slope'),{policy:policy(),signal:controller.signal}),{name:'AbortError'});
 const during=new AbortController(),budget=new DatasetResourceBudget(policy()),step=budget.step.bind(budget);budget.step=()=>{step();if(budget.operations===5)during.abort();};assert.throws(()=>updateWeightedFitMoments(empty,'1/1','2/1','1/1',{policy:policy(),budget,signal:during.signal}),{name:'AbortError'});
 const largePolicy=policy({maxOperations:1000000}),whole=new DatasetResourceBudget(largePolicy);let state=empty,checkpoint;for(let i=0;i<257;i++){state=updateWeightedFitMoments(state,i+'/1',(2*i+1)+'/1',(i%3+1)+'/1',{policy:largePolicy,budget:whole});if(i===127)checkpoint=JSON.parse(JSON.stringify(state));assert.equal(Object.keys(state).length,7);}
 let resumed=checkpoint;for(let i=128;i<257;i++)resumed=updateWeightedFitMoments(resumed,i+'/1',(2*i+1)+'/1',(i%3+1)+'/1',{policy:largePolicy});assert.deepEqual(resumed,state);assert.equal(finishWeightedFit(state,metric('slope'),{policy:largePolicy,budget:whole}).value,'2/1');assert.ok(whole.operations>10000);assert.equal(state.n,257);
});
