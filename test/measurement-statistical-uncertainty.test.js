import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {evaluateStatisticalUncertainty} from '../src/measurement-statistical-uncertainty.js';
import {DatasetResourceBudget} from '../src/dataset-resource-budget.js';
import {validatePolicyScalar} from '../src/web/measurement-scalar-policy.js';
import {defaultStatisticalUncertaintyDefinition,validStatisticalUncertaintyDefinition,validStatisticalUncertaintyInput,validStatisticalUncertaintyCovariance,validStatisticalUncertaintyOperand,validStatisticalUncertaintyResult,validStatisticalUncertaintyDescriptor,statisticalUncertaintyCovarianceCount,statisticalUncertaintyCovariancePosition} from '../src/web/measurement-statistical-uncertainty-model.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
import {defaultStructuredCalculationPolicy} from '../src/web/tools/calculation-policy.js';
import {blankUnitDefinition,exactUnitScalar} from '../src/web/measurement-unit-model.js';
const scalar=(spelling,representation='rational',radix=10)=>({spelling:representation==='rational'&&!String(spelling).includes('/')?String(spelling)+'/1':String(spelling),representation,radix});
const unit=(dimensions=[],scale='1',offset='0',kind='difference')=>({...blankUnitDefinition(),kind,dimensions,scale:scalar(scale),offset:scalar(offset)});
const operand=(spelling,unitDefinition=unit(),options={})=>{const value=scalar(spelling,options.representation??'rational',options.radix??10);return {value,column:{representation:value.representation,radix:value.radix,unit:'',missing:[],quantity:{origin:'derived',conversion:null,calibration:null,unitDefinition},...(options.policy?{resourcePolicy:options.policy}:{}),...(options.computation?{computation:options.computation}:{})}};};
function fixture(matrix,sensitivities=matrix.map(()=>1),options={}){
 const count=matrix.length,stored=new Map(),reads=[],inputReads=[],stats={active:0,maximum:0,gets:0,puts:0},resourcePolicy=structuredClone(options.resourcePolicy??defaultDatasetResourcePolicy()),calculationPolicy=structuredClone(options.calculationPolicy??defaultStructuredCalculationPolicy());
 resourcePolicy.resources.maxMilliseconds=30000;calculationPolicy.resources.maxMilliseconds=5000;
 const io=async operation=>{stats.maximum=Math.max(stats.maximum,++stats.active);try{return await operation();}finally{stats.active--;}};
 const work={get:key=>io(()=>{stats.gets++;assert.equal(typeof key,'string');return structuredClone(stored.get(key));}),put:(key,value)=>io(()=>{stats.puts++;assert.equal(typeof key,'string');assert.ok(typeof value==='string'||Object.keys(value).sort().join()==='dimensions,sensitivity');stored.set(key,structuredClone(value));})};
 const source={count,nominal:options.nominal??operand('10'),work,readInput:async i=>{inputReads.push(i);return options.readInput?options.readInput(i):{estimate:operand(String(i)),sensitivity:operand(String(sensitivities[i]))};},readCovariance:async(i,j)=>{reads.push([i,j]);return options.readCovariance?options.readCovariance(i,j):operand(String(matrix[i][j]));}};
 return {source,resourcePolicy,calculationPolicy,reads,inputReads,stats,stored,run:extra=>evaluateStatisticalUncertainty(source,{resourcePolicy,calculationPolicy,...extra})};
}
const value=result=>result.variance.scalar.spelling;
const source=()=>({ref:{kind:'dataset',id:randomUUID(),revision:'a'.repeat(64)},selector:{kind:'cell',page:0,row:0,column:0}});

test('shared uncertainty declarations pin estimates and require explicit complete covariance entries',()=>{
 const d=defaultStatisticalUncertaintyDefinition();assert.equal(validStatisticalUncertaintyDefinition(d),true);assert.equal(validStatisticalUncertaintyDefinition(d,{complete:true}),false);Object.assign(d,{nominal:source(),rationale:'First-order terms adequate over declared input uncertainties.',evaluationPoint:'At the pinned input estimates.'});assert.equal(validStatisticalUncertaintyDefinition(d,{complete:true}),true);
 const declared={kind:'declared',scalar:scalar('0'),unitDefinition:unit(),rationale:'Declared zero covariance of these estimates.'},input={id:randomUUID(),name:'Input estimate',estimate:source(),sensitivity:declared};assert.equal(validStatisticalUncertaintyInput(input,d.resourcePolicy),true);assert.equal(validStatisticalUncertaintyOperand({kind:'cell',source:source()},d.resourcePolicy),true);assert.equal(validStatisticalUncertaintyOperand({...declared,rationale:''},d.resourcePolicy),false);
 assert.equal(validStatisticalUncertaintyCovariance({i:0,j:1,value:declared},d.resourcePolicy),true);assert.equal(validStatisticalUncertaintyCovariance({i:1,j:0,value:declared},d.resourcePolicy),false);assert.equal(validStatisticalUncertaintyDefinition({...d,coverage:'95%'}),false);
 assert.equal(statisticalUncertaintyCovarianceCount(0),0);assert.equal(statisticalUncertaintyCovarianceCount(33),561);assert.equal(statisticalUncertaintyCovariancePosition(2,3),8);assert.throws(()=>statisticalUncertaintyCovarianceCount(Number.MAX_SAFE_INTEGER));assert.throws(()=>statisticalUncertaintyCovariancePosition(1,0));
 const ref={kind:'analysis',id:randomUUID(),revision:'b'.repeat(64)},descriptor={version:1,method:d.method,role:'standard',definition:ref,analysis:ref,squareRoot:{engine:4,policy:d.calculationPolicy,approximate:true}};assert.equal(validStatisticalUncertaintyDescriptor(descriptor),true);assert.equal(validStatisticalUncertaintyDescriptor({...descriptor,coverage:'95%'}),false);
});

test('exact correlated propagation retains signed covariance, singular cancellation and rational roots',async()=>{
 for(const [matrix,c,variance,standard] of [[[[4,1],[1,9]],[1,2],'44/1',null],[[[4,-2],[-2,9]],[3,2],'48/1',null],[[[1,1],[1,1]],[1,-1],'0/1','0/1'],[[[0,0],[0,4]],[10,3],'36/1','6/1'],[[['4/9']],[1],'4/9','2/3']]){
  const f=fixture(matrix,c),result=await f.run();assert.equal(value(result),variance);assert.equal(validStatisticalUncertaintyResult(result),true);if(standard!==null){assert.equal(result.standardUncertainty.scalar.spelling,standard);assert.equal(result.squareRoot.approximate,false);assert.equal(result.squareRoot.computation,null);}else{assert.equal(result.squareRoot.approximate,true);assert.equal(result.standardUncertainty.scalar.spelling,result.squareRoot.computation.spelling);}
  assert.equal(f.stats.maximum,1);assert.equal(f.reads.length,statisticalUncertaintyCovarianceCount(matrix.length));assert.deepEqual(f.inputReads,matrix.map((_,i)=>i));
 }
});

test('full PSD validation rejects negative variance, zero-pivot residuals and globally indefinite correlation',async()=>{
 for(const matrix of [[[-1]],[[0,1],[1,2]],[[1,2],[2,1]],[[1,'-3/4','-3/4'],['-3/4',1,'-3/4'],['-3/4','-3/4',1]]])await assert.rejects(fixture(matrix,matrix.map(()=>0)).run(),{code:'STATISTICAL_UNCERTAINTY_COVARIANCE'});
 const missing=fixture([[1,0],[0,1]],undefined,{readCovariance:(i,j)=>i===0&&j===1?undefined:operand('1')});await assert.rejects(missing.run(),{code:'STATISTICAL_UNCERTAINTY_INPUT'});
});

test('declared scales convert covariance and sensitivity while absolute offsets do not enter variance',async()=>{
 const Y=[{axis:'voltage',exponent:1}],X=[{axis:'length',exponent:1}],ratio=[{axis:'length',exponent:-1},{axis:'voltage',exponent:1}],squareX=[{axis:'length',exponent:2}];
 const f=fixture([[9]],[3],{nominal:operand('12',unit(Y,'2','100','absolute')),readInput:()=>({estimate:operand('10',unit(X,'10','1000','absolute')),sensitivity:operand('3',unit(ratio,'5'))}),readCovariance:()=>operand('9',unit(squareX,'4'))}),result=await f.run();
 assert.equal(value(result),'2025/1');assert.equal(result.standardUncertainty.scalar.spelling,'45/1');assert.deepEqual(result.nominal.scalar,scalar('12'));assert.equal(result.nominal.unitDefinition.offset.spelling,'100/1');assert.equal(result.standardUncertainty.unitDefinition.kind,'difference');assert.equal(result.standardUncertainty.unitDefinition.scale.spelling,'2/1');assert.equal(result.standardUncertainty.unitDefinition.offset.spelling,'0');assert.equal(result.variance.unitDefinition.scale.spelling,'4/1');assert.deepEqual(result.variance.unitDefinition.dimensions,[{axis:'voltage',exponent:2}]);
 for(const bad of [operand('1',unit(X)),operand('1',unit([], '1','1','absolute'))]){const invalid=fixture([[1]],[1],{readInput:()=>({estimate:operand('1'),sensitivity:bad})});await assert.rejects(invalid.run(),{code:'STATISTICAL_UNCERTAINTY_UNITS'});}
 await assert.rejects(fixture([[1]],undefined,{readCovariance:()=>operand('1',unit(X))}).run(),{code:'STATISTICAL_UNCERTAINTY_UNITS'});
 const noUnit=operand('1');delete noUnit.column.quantity.unitDefinition;await assert.rejects(fixture([[1]],[1],{nominal:noUnit}).run(),{code:'STATISTICAL_UNCERTAINTY_UNITS'});
});

test('mixed radices and approximate source provenance survive exact propagation and explicit square-root policy',async()=>{
 const computation={version:1,kind:'approximate-inputs'},policy=defaultStructuredCalculationPolicy();Object.assign(policy,{workingDigits:32,displayDigits:3,rounding:'floor'});
 const f=fixture([[1]],['1'],{calculationPolicy:policy,readInput:()=>({estimate:operand('10',unit(),{representation:'radix',radix:6,computation}),sensitivity:operand('0.3',unit(),{representation:'radix-fraction',radix:6})}),readCovariance:()=>operand('20',unit(),{representation:'radix',radix:6})}),result=await f.run();
 assert.equal(value(result),'3/1');assert.equal(result.approximateInputs,true);assert.equal(result.squareRoot.approximate,true);assert.equal(result.squareRoot.policy.rounding,'floor');assert.ok(result.standardUncertainty.scalar.spelling.length>policy.displayDigits);assert.equal(result.standardUncertainty.scalar.representation,'decimal');assert.equal(validStatisticalUncertaintyResult(result),true);
 const exact=await fixture([[4]],[1],{readInput:()=>({estimate:operand('1',unit(),{computation}),sensitivity:operand('1')})}).run();assert.equal(exact.approximateInputs,true);assert.equal(exact.squareRoot.approximate,false);
 const unavailable=fixture([[4]]);unavailable.calculationPolicy.library.version='0.0.0';await assert.rejects(unavailable.run(),{code:'STATISTICAL_UNCERTAINTY_LIBRARY'});
});

test('callback matrix elimination remains bounded beyond 32 inputs and preserves explicit triangle order',async()=>{
 const n=33,matrix=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>i===j?1:0)),f=fixture(matrix);f.resourcePolicy.resources.maxOperations=1000000;
 const result=await f.run();assert.equal(value(result),'33/1');assert.equal(f.stats.maximum,1);assert.deepEqual(f.reads,Array.from({length:n},(_,j)=>Array.from({length:j+1},(_,i)=>[i,j])).flat());assert.equal(f.stored.size,n+statisticalUncertaintyCovarianceCount(n));
});

test('long resolved scalar spellings retain source context without changing numerical value',async()=>{
 const p=defaultDatasetResourcePolicy();Object.assign(p.resources,{maxScalarCharacters:12000,maxExponent:12000,maxOperations:1000000,maxMilliseconds:30000});const long='1.'+'0'.repeat(9000),f=fixture([[1]],undefined,{resourcePolicy:p,nominal:operand(long,unit(),{representation:'decimal',policy:p}),readInput:()=>({estimate:operand(long,unit(),{representation:'decimal',policy:p}),sensitivity:operand(long,unit(),{representation:'decimal',policy:p})})});
 const result=await f.run();assert.equal(result.nominal.scalar.spelling,long);assert.equal(value(result),'1/1');assert.equal(result.standardUncertainty.scalar.spelling,'1/1');assert.equal(validStatisticalUncertaintyResult(result),true);
});

test('owned scalar limits and a cumulative operation budget refuse instead of rounding or resetting',async()=>{
 const own=defaultDatasetResourcePolicy();own.resources.maxScalarCharacters=16;
 await assert.rejects(fixture([[1]],undefined,{nominal:operand('1'.repeat(17),unit(),{representation:'integer',policy:own})}).run(),{code:'DATASET_CALCULATION_RESOURCE'});
 const f=fixture(Array.from({length:10},(_,i)=>Array.from({length:10},(_,j)=>i===j?1:0)));f.resourcePolicy.resources.maxOperations=500;await assert.rejects(f.run(),{code:'DATASET_CALCULATION_RESOURCE'});assert.ok(f.inputReads.length>0);assert.ok(f.reads.length<55);
 const noCeiling=fixture([[1]]);noCeiling.source.count=1000000;noCeiling.resourcePolicy.resources.maxOperations=20;await assert.rejects(noCeiling.run(),{code:'DATASET_CALCULATION_RESOURCE'});
 const rootLimit=fixture([[(2n**80n).toString()]]);rootLimit.calculationPolicy.resources.maxBits=64;await assert.rejects(rootLimit.run(),{code:'DATASET_CALCULATION_RESOURCE'});
 const excluded=operand('1');excluded.excluded=true;await assert.rejects(fixture([[1]],undefined,{nominal:excluded}).run(),{code:'STATISTICAL_UNCERTAINTY_INPUT'});
 const absent=operand('1');absent.presence='absent';await assert.rejects(fixture([[1]],undefined,{readCovariance:()=>absent}).run(),{code:'STATISTICAL_UNCERTAINTY_INPUT'});
});

test('scratch waits do not consume numeric elapsed time, and access/cancellation remain checked',async t=>{
 let clock=0;t.mock.method(Date,'now',()=>clock);
 const f=fixture([[4]]),get=f.source.work.get;f.source.work.get=async key=>{clock+=100000;return get(key);};f.resourcePolicy.resources.maxMilliseconds=1000;assert.equal((await f.run()).standardUncertainty.scalar.spelling,'2/1');
 const controller=new AbortController(),cancelled=fixture([[1,0],[0,1]]),read=cancelled.source.readCovariance;cancelled.source.readCovariance=async(i,j)=>{const value=await read(i,j);controller.abort();return value;};await assert.rejects(cancelled.run({signal:controller.signal}),{name:'AbortError'});assert.equal(cancelled.reads.length,1);
 const access=Object.assign(Error('Access revoked'),{code:'ACCESS_LOCKED'}),revoked=fixture([[1]]);let checks=0;await assert.rejects(revoked.run({check:()=>{if(++checks===4)throw access;}}),error=>error===access);assert.equal(checks,4);
 t.mock.method(Date,'now',()=>clock+=100);const timed=fixture([[1]]);timed.resourcePolicy.resources.maxMilliseconds=1;await assert.rejects(timed.run(),{code:'DATASET_CALCULATION_RESOURCE'});
});


test('injected evaluation budget preserves source-validation consumption and rejects a different owner policy',async()=>{
 const baseline=fixture([[4]]),measured=new DatasetResourceBudget(baseline.resourcePolicy);await baseline.run({budget:measured});const needed=measured.operations;assert.ok(needed>20);
 const limited=fixture([[4]]);limited.resourcePolicy.resources.maxOperations=needed+5;const shared=new DatasetResourceBudget(limited.resourcePolicy);
 while(shared.operations<20)validatePolicyScalar(scalar('123/7'),limited.resourcePolicy,{budget:shared});const validationOperations=shared.operations;
 await assert.rejects(limited.run({budget:shared}),{code:'DATASET_CALCULATION_RESOURCE'});assert.ok(shared.operations>validationOperations);
 assert.equal((await limited.run({budget:new DatasetResourceBudget(limited.resourcePolicy)})).standardUncertainty.scalar.spelling,'2/1');
 const other=fixture([[4]]),wrongPolicy=structuredClone(other.resourcePolicy);wrongPolicy.resources.maxOperations--;await assert.rejects(other.run({budget:new DatasetResourceBudget(wrongPolicy)}),{code:'STATISTICAL_UNCERTAINTY_INVALID'});assert.deepEqual(other.inputReads,[]);
 await assert.rejects(other.run({budget:{scalarPolicy:other.resourcePolicy,run:operation=>operation()}}),{code:'STATISTICAL_UNCERTAINTY_INVALID'});
});
