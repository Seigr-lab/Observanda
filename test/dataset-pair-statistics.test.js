import test from 'node:test';
import assert from 'node:assert/strict';
import {createPairMoments,validatePairMoments,updatePairMoments,finishPairStatistic,pairStatisticColumn} from '../src/dataset-pair-statistics.js';
import {validAggregation,isPairStatisticMetric,validPairStatisticMetric,validPairStatisticReceipt} from '../src/web/dataset-aggregation-model.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
import {DatasetResourceBudget} from '../src/dataset-resource-budget.js';
import {validatePolicyScalar} from '../src/web/measurement-scalar-policy.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {blankQuantity} from '../src/web/measurement-model.js';
import {blankUnitDefinition,exactUnitScalar} from '../src/web/measurement-unit-model.js';
import {MaterialSequence} from '../src/material-sequence.js';
import {RetainedJsonValue} from '../src/retained-json-value.js';
const policy=resources=>({...defaultDatasetResourcePolicy(),resources:{...defaultDatasetResourcePolicy().resources,...resources}});
const covariance=normalization=>({column:1,pairedColumn:2,operation:'covariance',method:'centered-pairs-v1',normalization,pairing:'complete-rows-v1',name:'Covariance'});
const fit=coefficient=>({column:1,pairedColumn:2,operation:'linear-fit',method:'ordinary-least-squares-intercept-v1',coefficient,pairing:'complete-rows-v1',name:coefficient});
const recipe=values=>({version:5,source:{kind:'dataset',id:'11111111-1111-4111-8111-111111111111',revision:'1'.repeat(64)},keys:[0],keySemantics:['lexical'],values,missing:'skip',note:'paired readings',resourcePolicy:policy()});
const run=(pairs,own=policy())=>pairs.reduce((state,[x,y])=>updatePairMoments(state,x,y,{policy:own}),createPairMoments());
const finish=(state,metric,own=policy())=>finishPairStatistic(state,metric,{policy:own});
const numeric=(unit='',definition)=>({...defaultColumn({label:'Reading'}),representation:'rational',unit,resourcePolicy:policy(),quantity:{...blankQuantity(),origin:'measured',...(definition?{unitDefinition:definition}:{})}});
const unit=(axis,scale='1',offset='0',kind='difference')=>({...blankUnitDefinition(),kind,dimensions:[{axis,exponent:1}],scale:exactUnitScalar(scale),offset:exactUnitScalar(offset)});
test('paired metrics require recipe5, explicit same-row pairing, roles and estimator options',()=>{
 const metrics=[covariance('sample'),covariance('population'),fit('slope'),fit('intercept')];assert.equal(validAggregation(recipe(metrics),3),true);
 for(const metric of metrics){assert.equal(isPairStatisticMetric(metric),true);assert.equal(validPairStatisticMetric(metric,3),true);for(const version of [1,2,3,4])assert.equal(validAggregation({...recipe([metric]),version,...(version<3?{resourcePolicy:undefined}:{})},3),false);}
 for(const metric of [{...covariance('sample'),pairedColumn:3},{...covariance('sample'),pairing:undefined},{...covariance('sample'),pairing:'independent'},{...covariance('sample'),normalization:'unbiased'},{...covariance('sample'),coefficient:'slope'},{...fit('slope'),normalization:'sample'},{...fit('slope'),method:'through-origin'},{...fit('slope'),coefficient:'correlation'},{...fit('slope'),probability:{spelling:'1/2',representation:'rational',radix:10}}])assert.equal(validAggregation(recipe([metric]),3),false);
 const legacy={column:1,operation:'mean',name:'Mean'},quantile={column:1,operation:'quantile',name:'Median quantile',method:'linear-n-minus-one-v1',probability:{spelling:'1/2',representation:'rational',radix:10}};
 assert.equal(validAggregation(recipe([legacy,quantile,...metrics]),3),true);assert.equal(validAggregation({...recipe([quantile]),version:4},3),true);assert.equal(validAggregation(recipe([{...legacy,pairedColumn:2}]),3),false);
 for(const version of [1,2,3,4])for(const operation of ['median','mean','sum','min','max','count']){const value={...recipe([{column:1,operation,name:operation}]),version};if(version<3)delete value.resourcePolicy;assert.equal(validAggregation(value,3),true);}
});
test('centered exact moments give sample/population covariance and unweighted intercept fit',()=>{
 const state=run([['1/1','2/1'],['2/1','4/1'],['3/1','8/1']]);assert.deepEqual(state,{version:1,n:3,meanX:'2/1',meanY:'14/3',Cxx:'2/1',Cxy:'6/1'});
 assert.equal(finish(state,covariance('population')).value,'2/1');assert.equal(finish(state,covariance('sample')).value,'3/1');assert.equal(finish(state,fit('slope')).value,'3/1');assert.equal(finish(state,fit('intercept')).value,'-4/3');
 const reordered=run([['3/1','8/1'],['1/1','2/1'],['2/1','4/1']]);assert.deepEqual(reordered,state);
 const reversed=run([['2/1','1/1'],['4/1','2/1'],['8/1','3/1']]);assert.equal(finish(reversed,covariance('sample')).value,'3/1');assert.equal(finish(reversed,fit('slope')).value,'9/28');
 const negative=run([['1/1','7/1'],['2/1','5/1'],['3/1','3/1']]);assert.equal(finish(negative,covariance('sample')).value,'-2/1');assert.equal(finish(negative,fit('slope')).value,'-2/1');assert.equal(finish(negative,fit('intercept')).value,'9/1');
});
test('all degeneracies retain explicit statuses while constant y and repeated zero pairs remain valid',()=>{
 const empty=createPairMoments(),one=run([['2/1','5/1']]),constantX=run([['2/1','3/1'],['2/1','7/1']]),constantY=run([['1/1','5/1'],['3/1','5/1']]);
 for(const metric of [covariance('sample'),covariance('population'),fit('slope'),fit('intercept')]){const result=finish(empty,metric);assert.equal(result.value,null);assert.equal(result.receipt.status,'no-pairs');assert.equal(validPairStatisticReceipt(result.receipt,metric,0),true);}
 assert.equal(finish(one,covariance('population')).value,'0/1');for(const metric of [covariance('sample'),fit('slope'),fit('intercept')]){const result=finish(one,metric);assert.equal(result.value,null);assert.equal(result.receipt.status,'insufficient-pairs');}
 for(const metric of [covariance('sample'),covariance('population')])assert.equal(finish(constantX,metric).value,'0/1');for(const metric of [fit('slope'),fit('intercept')])assert.equal(finish(constantX,metric).receipt.status,'zero-x-spread');
 assert.equal(finish(constantY,fit('slope')).value,'0/1');assert.equal(finish(constantY,fit('intercept')).value,'5/1');assert.equal(validatePairMoments(run([['0/1','0/1'],['0/1','0/1']]),{policy:policy(),count:2}).n,2);
 const ready=finish(constantY,fit('slope')).receipt;for(const receipt of [{...ready,status:'insufficient-pairs'},{...ready,status:'no-pairs'},{...ready,pairing:'independent'},{...ready,method:'unknown'},{...ready,extra:true}])assert.equal(validPairStatisticReceipt(receipt,fit('slope'),2),false);
});
test('source radix is interpreted exactly before pair updates and inputs stay immutable',()=>{
 const parse=(spelling,representation,radix)=>{const value=validatePolicyScalar({spelling,representation,radix},policy());return value.numerator+'/'+value.denominator;};
 let state=createPairMoments();for(const [x,y]of [['0.3','1.5'],['1','2.5'],['1.3','3.5']]){const before=structuredClone(state);const next=updatePairMoments(state,parse(x,'radix-fraction',6),parse(y,'decimal',10),{policy:policy()});assert.deepEqual(state,before);state=next;}
 assert.equal(finish(state,fit('slope')).value,'2/1');assert.equal(finish(state,fit('intercept')).value,'1/2');
});
test('checkpoint validation refuses noncanonical, inconsistent or mismatched paired states',()=>{
 const valid=run([['1/1','2/1'],['3/1','7/1']]);assert.equal(validatePairMoments(valid,{policy:policy(),count:2}),valid);
 for(const state of [{...valid,n:-1},{...valid,n:1.5},{...valid,n:0},{...valid,n:1},{...valid,Cxx:'-1/1'},{...valid,Cxx:'0/1'},{...valid,meanX:'2/2'},{...valid,meanX:'00/1'},{...valid,meanX:'-0/1'},{...valid,Cxy:'0/0'},{...valid,unexpected:true},{...createPairMoments(),meanX:'1/1'}])assert.throws(()=>validatePairMoments(state,{policy:policy()}),{code:'MATERIAL_MISSING'});
 assert.throws(()=>validatePairMoments(valid,{policy:policy(),count:3}),{code:'MATERIAL_MISSING'});assert.throws(()=>validatePairMoments(valid,{policy:policy(),count:-1}),{code:'MATERIAL_MISSING'});
 assert.throws(()=>updatePairMoments({...createPairMoments(),n:Number.MAX_SAFE_INTEGER},'0/1','0/1',{policy:policy()}),{code:'DATASET_AGGREGATION_LIMIT'});
});
test('bounded retained checkpoint round trips long exact moments and resumes the same source order',async()=>{
 const own=policy({maxBits:131072,maxScalarCharacters:24000,maxOperations:200000}),denominator=10n**11000n+1n,x='1/'+denominator,state=run([['0/1','0/1'],[x,x]],own);assert.ok(state.Cxx.length>8192);assert.deepEqual(validatePairMoments(state,{policy:own,count:2}),state);
 const data=new Map(),workspace={readMetadata:async key=>data.get(key)??null,writeMetadata:async(key,value)=>data.set(key,value)},sequences=new MaterialSequence(workspace),retained=new RetainedJsonValue(sequences,fn=>fn(),{namespace:'aggregation-work-chunks'}),ref=await retained.put(state),restored=await retained.read(ref),resumed=updatePairMoments(restored,'2/1','4/1',{policy:own}),continuous=run([['0/1','0/1'],[x,x],['2/1','4/1']],own);
 assert.ok(ref.chunks.count>1);assert.deepEqual(resumed,continuous);assert.deepEqual(finishPairStatistic(resumed,fit('slope'),{policy:own}),finishPairStatistic(continuous,fit('slope'),{policy:own}));assert.ok([...data.values()].every(value=>Buffer.byteLength(value)<1048576));
 const bad={...ref,hash:'0'.repeat(64)};await assert.rejects(retained.read(bad),{code:'MATERIAL_MISSING'});const controller=new AbortController();controller.abort();await assert.rejects(new RetainedJsonValue(sequences,fn=>fn(),{signal:controller.signal}).read(ref),{name:'AbortError'});
});
test('centered updates retain exact small spreads around a large authored origin',()=>{
 const origin=10n**100n,state=run([[origin+'/1','1/1'],[(origin+1n)+'/1','3/1'],[(origin+2n)+'/1','5/1']]);assert.equal(state.Cxx,'2/1');assert.equal(state.Cxy,'4/1');assert.equal(finish(state,fit('slope')).value,'2/1');assert.equal(finish(state,fit('intercept')).value,(1n-2n*origin)+'/1');
});
test('paired arithmetic and checkpoint reads obey operation, bits, time and caller budgets without fallback',()=>{
 const state=createPairMoments();assert.throws(()=>updatePairMoments(state,'1/1','2/1',{policy:policy({maxOperations:1})}),{code:'DATASET_CALCULATION_RESOURCE'});assert.throws(()=>updatePairMoments(state,(1n<<70n)+'/1','1/1',{policy:policy({maxBits:64})}),{code:'DATASET_CALCULATION_RESOURCE'});
 const budget=new DatasetResourceBudget(policy({maxOperations:1}));assert.throws(()=>updatePairMoments(state,'1/1','2/1',{policy:policy(),budget}),{code:'DATASET_CALCULATION_RESOURCE'});const expired=new DatasetResourceBudget(policy());expired.remaining=-1;assert.throws(()=>validatePairMoments(state,{policy:policy(),budget:expired}),{code:'DATASET_CALCULATION_RESOURCE'});
 const long=run([['1/1','1/1'],[(1n<<70n)+'/1','2/1']]);assert.throws(()=>validatePairMoments(long,{policy:policy({maxBits:64})}),{code:'DATASET_CALCULATION_RESOURCE'});
});
test('derived covariance and slope units use differences while intercept retains the authored y origin',()=>{
 const x=numeric('source x',unit('length','2','100','absolute')),y=numeric('source y',unit('time','3','-7','absolute')),before=structuredClone([x,y]),cov=pairStatisticColumn(covariance('sample'),[x,y],{policy:policy()}),slope=pairStatisticColumn(fit('slope'),[x,y],{policy:policy()}),intercept=pairStatisticColumn(fit('intercept'),[x,y],{policy:policy()});
 assert.deepEqual(cov.quantity.unitDefinition.dimensions,[{axis:'length',exponent:1},{axis:'time',exponent:1}]);assert.equal(cov.quantity.unitDefinition.scale.spelling,'6/1');assert.equal(cov.quantity.unitDefinition.kind,'difference');assert.equal(cov.quantity.unitDefinition.offset.spelling,'0');
 assert.deepEqual(slope.quantity.unitDefinition.dimensions,[{axis:'length',exponent:-1},{axis:'time',exponent:1}]);assert.equal(slope.quantity.unitDefinition.scale.spelling,'3/2');assert.deepEqual(intercept.quantity.unitDefinition,y.quantity.unitDefinition);assert.equal(intercept.unit,y.unit);assert.equal(intercept.time.kind,'none');assert.deepEqual([x,y],before);
 for(const result of [cov,slope,intercept]){assert.equal(result.quantity.origin,'derived');assert.equal(result.quantity.calibration,null);assert.equal(result.quantity.conversion,null);assert.equal(result.quantity.uncertainty,undefined);assert.equal(result.representation,'rational');assert.deepEqual(result.resourcePolicy,policy());}
});
test('paired output preserves approximation provenance from either input or grouping keys and refuses unit inference',()=>{
 const x=numeric(),y=numeric(),approx={...numeric(),computation:{version:1,kind:'approximate-inputs'}};
 for(const [columns,keys]of [[[x,approx],[]],[[approx,y],[]],[[x,y],[approx]]])assert.deepEqual(pairStatisticColumn(fit('slope'),columns,{policy:policy(),keys}).computation,approx.computation);
 assert.equal(pairStatisticColumn(fit('slope'),[x,y],{policy:policy()}).computation,undefined);
 for(const columns of [[numeric('uninterpreted'),y],[numeric('',unit('length')),y]])assert.throws(()=>pairStatisticColumn(covariance('sample'),columns,{policy:policy()}),{code:'DATASET_AGGREGATION_UNITS'});
 const large=unit('length');large.dimensions[0].exponent=32;assert.throws(()=>pairStatisticColumn(covariance('sample'),[numeric('x',large),numeric('y',large)],{policy:policy()}),{code:'DATASET_AGGREGATION_UNITS'});
 const scalar={...fit('slope'),output:{version:1,representation:'radix-fraction',radix:6}};assert.equal(pairStatisticColumn(scalar,[x,y],{policy:policy()}).radix,6);
});
test('owned long unit scales remain bounded and cannot borrow a larger consumer policy',()=>{
 const own=policy({maxScalarCharacters:12000,maxOperations:200000}),definition={...unit('length'),version:2,resourcePolicy:own,scale:exactUnitScalar('0'.repeat(9000)+'2')},x=numeric('x',definition),y=numeric('y',unit('time'));
 assert.equal(pairStatisticColumn(fit('slope'),[x,y],{policy:own}).quantity.unitDefinition.scale.spelling,'1/2');assert.throws(()=>pairStatisticColumn(fit('slope'),[x,y],{policy:policy()}),{code:'DATASET_CALCULATION_RESOURCE'});
 const limited=structuredClone(x);limited.quantity.unitDefinition.resourcePolicy=policy({maxBits:64});limited.quantity.unitDefinition.scale=exactUnitScalar('1'+'0'.repeat(40));assert.throws(()=>pairStatisticColumn(fit('slope'),[limited,y],{policy:own}),{code:'DATASET_CALCULATION_RESOURCE'});
});
