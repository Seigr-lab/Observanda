import {defaultNumericalExecutionPolicy} from '../src/web/numerical-execution-policy.js';
import {spectrumGraphColumn} from '../src/web/dataset-spectrum-schema.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {validSpectrumRecipe,SPECTRUM_CONVENTIONS,powerOfTwoCount,signedSpectrumBin,spectrumColumnDescriptor,validSpectrumDescriptor,publicSpectrumContext,validSpectrumContext} from '../src/web/dataset-spectrum-model.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
import {defaultStructuredCalculationPolicy} from '../src/web/tools/calculation-policy.js';
import {blankUnitDefinition,exactUnitScalar} from '../src/web/measurement-unit-model.js';
const recipe=()=>({version:1,method:'radix2-fft-v1',source:{kind:'dataset',id:'11111111-1111-4111-8111-111111111111',revision:'a'.repeat(64)},column:18,range:{start:7,count:32},sampling:{step:exactUnitScalar('1'),origin:exactUnitScalar('0'),unitDefinition:blankUnitDefinition(),coordinateColumn:1},calculationPolicy:defaultStructuredCalculationPolicy(),resourcePolicy:defaultDatasetResourcePolicy(),...SPECTRUM_CONVENTIONS});
test('spectrum admission pins source, exact sampling declarations and every transform convention',()=>{
 const value=recipe();assert.equal(validSpectrumRecipe(value),true);
 for(const key of Object.keys(SPECTRUM_CONVENTIONS)){assert.equal(validSpectrumRecipe({...value,[key]:'inferred'}),false,key);const missing=structuredClone(value);delete missing[key];assert.equal(validSpectrumRecipe(missing),false,key);}
 for(const invalid of [{source:{...value.source,revision:'latest'}},{column:-1},{range:{start:0,count:3}},{range:{start:Number.MAX_SAFE_INTEGER,count:2}},{sampling:{...value.sampling,coordinateColumn:18}},{sampling:{...value.sampling,unitDefinition:{...blankUnitDefinition(),kind:'absolute'}}},{calculationPolicy:{...value.calculationPolicy,version:1}}])assert.equal(validSpectrumRecipe({...value,...invalid}),false);
 assert.equal(validSpectrumRecipe({...value,sampling:{...value.sampling,coordinateColumn:null}}),true);
 // Schema admission accepts a declaration; the evaluator checks positivity and the grid.
 assert.equal(validSpectrumRecipe({...value,sampling:{...value.sampling,step:exactUnitScalar('-1')}}),true);
});
test('full bins retain negative Nyquist without signed-32-bit indexing or implicit padding',()=>{
 for(const count of [1,2,4,1024,2**32,2**52])assert.equal(powerOfTwoCount(count),true);
 for(const count of [0,-1,3,6,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER])assert.equal(powerOfTwoCount(count),false);
 assert.deepEqual(Array.from({length:8},(_,i)=>signedSpectrumBin(i,8)),[0,1,2,3,-4,-3,-2,-1]);assert.equal(signedSpectrumBin(0,1),0);assert.equal(signedSpectrumBin(2**31,2**32),-(2**31));assert.throws(()=>signedSpectrumBin(8,8));assert.throws(()=>signedSpectrumBin(0,3));
});
test('public spectral interpretation is self-contained and preserves whether the coordinate grid was checked',()=>{
 const input=recipe(),analysis={...input.source,kind:'analysis',id:'22222222-2222-4222-8222-222222222222'},descriptor=spectrumColumnDescriptor(input,analysis,'coefficient');
 assert.equal(validSpectrumDescriptor(descriptor),true);assert.equal(descriptor.coordinateChecked,true);const published=publicSpectrumContext(descriptor);assert.equal(validSpectrumContext(published),true);assert.equal(JSON.stringify(published).includes(analysis.id),false);assert.equal(JSON.stringify(published).includes(input.source.id),false);assert.equal(Object.hasOwn(published.sampling,'coordinateColumn'),false);
 input.sampling.step.spelling='2';assert.equal(descriptor.sampling.step.spelling,'1');assert.equal(validSpectrumDescriptor({...descriptor,analysis:{...analysis,kind:'dataset'}}),false);assert.equal(validSpectrumContext({...published,source:input.source}),false);
 assert.equal(spectrumColumnDescriptor({...input,sampling:{...input.sampling,coordinateColumn:null}},analysis,'frequency').coordinateChecked,false);
});

test('graph outputs preserve only mathematically applicable spectrum interpretation',()=>{
 const r=recipe(),spectrum=spectrumColumnDescriptor(r,{...r.source,kind:'analysis'},'coefficient'),source={representation:'domain',domain:{codec:'observanda.complex'},spectrum},scalar={representation:'rational',spectrum};
 for(const index of [0,1]){const output=spectrumGraphColumn({kind:'domain',operation:'extract',component:[index]},[source],scalar);assert.equal(output.spectrum.role,index===0?'coefficient-real':'coefficient-imaginary');assert.equal(validSpectrumDescriptor(output.spectrum),true);assert.equal(validSpectrumContext(publicSpectrumContext(output.spectrum)),true);}
 assert.equal(spectrumGraphColumn({kind:'domain',operation:'copy'},[source],source).spectrum.role,'coefficient');assert.ok(spectrumGraphColumn({kind:'domain',operation:'choose'},[source,structuredClone(source)],source).spectrum);assert.equal(spectrumGraphColumn({kind:'domain',operation:'choose'},[source,{...source,spectrum:{...spectrum,count:16}}],source).spectrum,undefined);
 for(const node of [{kind:'domain-arithmetic',operation:'add'},{kind:'scalar',operation:'multiply'},{kind:'window',operation:'sum'},{kind:'domain-reshape'}])assert.equal(spectrumGraphColumn(node,[source],scalar).spectrum,undefined);
 assert.equal(spectrumGraphColumn({kind:'window',operation:'lag'},[],source),source);assert.equal(spectrumGraphColumn({kind:'column'},[],source),source);
});

test('job-scoped spectral recipes preserve execution policy through schema, extraction and public context',()=>{
 const old=recipe(),executionPolicy=defaultNumericalExecutionPolicy(),value={...old,version:2,executionPolicy};assert.equal(validSpectrumRecipe(old),true);assert.equal(validSpectrumRecipe(value),true);assert.equal(validSpectrumRecipe({...old,executionPolicy}),false);assert.equal(validSpectrumRecipe({...value,executionPolicy:undefined}),false);
 for(const invalid of [null,{...executionPolicy,scope:'scalar-operation'},{...executionPolicy,total:{...executionPolicy.total,maxOperations:0}}])assert.equal(validSpectrumRecipe({...value,executionPolicy:invalid}),false);
 const descriptor=spectrumColumnDescriptor(value,{...value.source,kind:'analysis'},'coefficient'),context=publicSpectrumContext(descriptor);assert.equal(descriptor.version,2);assert.equal(validSpectrumDescriptor(descriptor),true);assert.equal(validSpectrumContext(context),true);assert.deepEqual(context.executionPolicy,executionPolicy);assert.equal(validSpectrumContext({...context,version:1}),false);assert.equal(validSpectrumDescriptor({...descriptor,executionPolicy:undefined}),false);
 const extracted=spectrumGraphColumn({kind:'domain',operation:'extract',component:[0]},[{spectrum:descriptor}],{representation:'rational'});assert.deepEqual(extracted.spectrum.executionPolicy,executionPolicy);executionPolicy.total.maxOperations=999;assert.notEqual(descriptor.executionPolicy.total.maxOperations,999);assert.equal(JSON.stringify(context).includes(value.source.id),false);
});

test('spectral job slices cannot bypass the retained calculator invocation limits',()=>{
 const value={...recipe(),version:2,executionPolicy:defaultNumericalExecutionPolicy()};value.calculationPolicy.resources.maxOperations=100;assert.equal(validSpectrumRecipe(value),false);value.executionPolicy.slice.maxOperations=100;assert.equal(validSpectrumRecipe(value),true);value.calculationPolicy.resources.maxMilliseconds=100;assert.equal(validSpectrumRecipe(value),false);value.executionPolicy.slice.maxActiveMilliseconds=100;assert.equal(validSpectrumRecipe(value),true);const context=publicSpectrumContext(spectrumColumnDescriptor(value,{...value.source,kind:'analysis'},'frequency'));context.executionPolicy.slice.maxOperations=101;assert.equal(validSpectrumContext(context),false);
});
