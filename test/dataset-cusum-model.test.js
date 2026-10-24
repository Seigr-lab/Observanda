import {cusumGraphColumn} from '../src/web/dataset-cusum-schema.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
import {defaultNumericalExecutionPolicy} from '../src/web/numerical-execution-policy.js';
import {blankUnitDefinition,exactUnitScalar} from '../src/web/measurement-unit-model.js';
import {CUSUM_METHOD,CUSUM_CONVENTIONS,CUSUM_ROLES,validCusumRecipe,cusumColumnDescriptor,validCusumDescriptor,publicCusumContext,validCusumContext} from '../src/web/dataset-cusum-model.js';
const recipe=()=>({version:1,method:CUSUM_METHOD,source:{kind:'dataset',id:randomUUID(),revision:'a'.repeat(64)},column:18,range:{start:77,count:2048},target:exactUnitScalar('0'),allowance:exactUnitScalar('1'),threshold:exactUnitScalar('5'),unitDefinition:blankUnitDefinition(),gaps:'reset-both',afterSignal:'continue',resourcePolicy:defaultDatasetResourcePolicy(),executionPolicy:defaultNumericalExecutionPolicy(),...CUSUM_CONVENTIONS});
test('change-detection authoring pins all explicit policies and respects scalar execution ceilings',()=>{
 const value=recipe();assert.equal(validCusumRecipe(value),true);for(const key of ['executionPolicy','gaps','afterSignal','target','threshold','unitDefinition']){const invalid=structuredClone(value);delete invalid[key];assert.equal(validCusumRecipe(invalid),false,key);}assert.equal(validCusumRecipe({...value,range:{start:0,count:0}}),false);assert.equal(validCusumRecipe({...value,order:'automatic'}),false);const limited=structuredClone(value);limited.resourcePolicy.resources.maxOperations=100;assert.equal(validCusumRecipe(limited),false);limited.executionPolicy.slice.maxOperations=100;assert.equal(validCusumRecipe(limited),true);
});
test('every change-detection result role preserves exact declarations without publishing private identities',()=>{
 const value=recipe(),analysis={kind:'analysis',id:randomUUID(),revision:'b'.repeat(64)};for(const role of CUSUM_ROLES){const descriptor=cusumColumnDescriptor(value,analysis,role),context=publicCusumContext(descriptor);assert.equal(validCusumDescriptor(descriptor),true);assert.equal(validCusumContext(context),true);assert.equal(context.count,2048);assert.deepEqual(context.threshold,value.threshold);assert.deepEqual(context.executionPolicy,value.executionPolicy);for(const privateValue of [value.source.id,analysis.id,value.source.revision,analysis.revision])assert.equal(JSON.stringify(context).includes(privateValue),false);for(const key of ['source','column','range','analysis'])assert.equal(Object.hasOwn(context,key),false);assert.equal(validCusumContext({...context,analysis}),false);assert.equal(validCusumDescriptor({...descriptor,analysis:value.source}),false);}
 const descriptor=cusumColumnDescriptor(value,analysis,'upper-score');value.threshold.spelling='9';assert.equal(descriptor.threshold.spelling,'5');assert.throws(()=>cusumColumnDescriptor(value,analysis,'physical-onset'));
});

test('graph copy and positional windows preserve change-detection context while changed arithmetic drops it',()=>{
 const value=recipe(),analysis={kind:'analysis',id:randomUUID(),revision:'b'.repeat(64)},cusum=cusumColumnDescriptor(value,analysis,'upper-score'),column={representation:'rational',cusum};assert.equal(cusumGraphColumn({kind:'column'},[],column),column);assert.equal(cusumGraphColumn({kind:'window',operation:'lag'},[],column),column);assert.deepEqual(cusumGraphColumn({kind:'scalar',operation:'copy'},[column],column).cusum,cusum);assert.deepEqual(cusumGraphColumn({kind:'scalar',operation:'choose'},[column,structuredClone(column)],column).cusum,cusum);
 assert.equal(cusumGraphColumn({kind:'scalar',operation:'choose'},[column,{...column,cusum:{...cusum,role:'lower-score'}}],column).cusum,undefined);for(const node of [{kind:'scalar',operation:'add'},{kind:'window',operation:'sum'},{kind:'domain-reshape'}])assert.equal(cusumGraphColumn(node,[column],column).cusum,undefined);
});
