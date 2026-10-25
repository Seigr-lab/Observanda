import test from 'node:test';
import assert from 'node:assert/strict';
import {weightedFitColumn,weightedFitVariance} from '../src/dataset-weighted-fit-units.js';
import {WEIGHTED_FIT_RESULTS,validWeightedFitContext} from '../src/web/dataset-weighted-fit-model.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {exactUnitScalar} from '../src/web/measurement-unit-model.js';
import {DatasetResourceBudget} from '../src/dataset-resource-budget.js';
const policy=changes=>({ ...defaultDatasetResourcePolicy(),resources:{...defaultDatasetResourcePolicy().resources,...changes}});
const scalar=(spelling='0',representation='integer',radix=10)=>({spelling,representation,radix});
const metric=result=>({operation:'weighted-affine-fit',method:'observation-variance-affine-v1',pairing:'complete-triples-v1',column:0,pairedColumn:1,varianceColumn:2,name:'estimate',result,referenceX:scalar('2'),...(['fitted-mean','fitted-mean-variance'].includes(result)?{evaluationX:scalar('3')}:{} )});
const unit=(axis,exponent=1,scale='1',kind='difference',offset='0')=>({version:1,kind,dimensions:[{axis,exponent}],scale:exactUnitScalar(scale),offset:exactUnitScalar(offset)});
const column=(label,definition)=>({...defaultColumn({label}),representation:'rational',radix:10,unit:definition?label:'',quantity:{origin:'measured',conversion:null,calibration:null,...(definition?{unitDefinition:definition}:{})}});
const sources=()=>[column('time',unit('time',1,'2','absolute','100')),column('voltage',unit('voltage',1,'3','absolute','20')),column('variance',unit('voltage',2,'18'))];
test('variance scale converts into squared Y coordinates without adding absolute offsets',()=>{
 const input=sources(),before=structuredClone(input);assert.equal(weightedFitVariance('2/1',input,{policy:policy()}),'4/1');assert.deepEqual(input,before);
 const blank=['x','y','v'].map(name=>column(name));assert.equal(weightedFitVariance('3/7',blank,{policy:policy()}),'3/7');
 for(const bad of ['0/1','-1/1'])assert.throws(()=>weightedFitVariance(bad,input,{policy:policy()}),{code:'DATASET_WEIGHTED_FIT_VARIANCE'});
});
test('each result carries its correct difference or absolute unit and coordinate interpretation',()=>{
 const source=sources(),expected={slope:['difference',[['time',-1],['voltage',1]],'3/2'],intercept:['absolute',[['voltage',1]],'3'], 'slope-variance':['difference',[['time',-2],['voltage',2]],'9/4'],'intercept-variance':['difference',[['voltage',2]],'9/1'],'coefficient-covariance':['difference',[['time',-1],['voltage',2]],'9/2'],'fitted-mean':['absolute',[['voltage',1]],'3'],'fitted-mean-variance':['difference',[['voltage',2]],'9/1']};
 for(const result of WEIGHTED_FIT_RESULTS){const value=weightedFitColumn(metric(result),source,{policy:policy(),perCell:true}),u=value.quantity.unitDefinition;assert.equal(u.kind,expected[result][0]);assert.deepEqual(u.dimensions.map(d=>[d.axis,d.exponent]),expected[result][1]);assert.equal(u.scale.spelling,expected[result][2]);assert.equal(validWeightedFitContext(value.weightedFit),true);assert.deepEqual(value.weightedFit.coordinateUnit,{unit:'time',definition:source[0].quantity.unitDefinition});assert.deepEqual(value.weightedFit.referenceX,metric(result).referenceX);if(u.kind==='difference')assert.equal(u.offset.spelling,'0');}
});
test('mixed or undeclared units, incompatible variance dimensions and absolute variances refuse',()=>{
 for(const mutate of [c=>delete c[0].quantity.unitDefinition,c=>c[2].quantity.unitDefinition=unit('time',2),c=>c[2].quantity.unitDefinition=unit('voltage',2,'1','absolute'),c=>c[1].quantity.unitDefinition.scale=scalar('0')]){const value=sources();mutate(value);assert.throws(()=>weightedFitColumn(metric('slope'),value,{policy:policy()}),{code:'DATASET_WEIGHTED_FIT_UNITS'});}
 const all=['x','y','v'].map(name=>column(name));all[0].unit='seconds';assert.throws(()=>weightedFitColumn(metric('slope'),all,{policy:policy()}),{code:'DATASET_WEIGHTED_FIT_UNITS'});
});
test('coordinate parameters parse exactly and output contexts preserve authored numeral spelling',()=>{
 const selected={...metric('fitted-mean'),referenceX:scalar('10.3','radix-fraction',6),evaluationX:scalar('0002'),output:{version:1,representation:'radix-fraction',radix:6}},result=weightedFitColumn(selected,sources(),{policy:policy()});assert.equal(result.radix,6);assert.deepEqual(result.weightedFit.referenceX,selected.referenceX);assert.deepEqual(result.weightedFit.evaluationX,selected.evaluationX);
 for(const field of ['referenceX','evaluationX'])assert.throws(()=>weightedFitColumn({...selected,[field]:scalar('invalid')},sources(),{policy:policy()}));
});
test('source-owned and caller policies both bound long unit scales and authored parameters',()=>{
 const own=policy({maxScalarCharacters:12000,maxOperations:200000}),source=sources();source[2].quantity.unitDefinition={...source[2].quantity.unitDefinition,version:2,resourcePolicy:own,scale:scalar('0'.repeat(9000)+'18')};
 assert.equal(weightedFitVariance('2/1',source,{policy:own}),'4/1');assert.throws(()=>weightedFitVariance('2/1',source,{policy:policy()}),{code:'DATASET_CALCULATION_RESOURCE'});
 const limited=structuredClone(source);limited[2].quantity.unitDefinition.resourcePolicy=policy({maxBits:64,maxScalarCharacters:12000});limited[2].quantity.unitDefinition.scale=scalar('1'+'0'.repeat(40));assert.throws(()=>weightedFitVariance('2/1',limited,{policy:own}),{code:'DATASET_CALCULATION_RESOURCE'});
 const small=new DatasetResourceBudget(policy({maxOperations:1}));assert.throws(()=>weightedFitVariance('2/1',sources(),{policy:own,budget:small}),{code:'DATASET_CALCULATION_RESOURCE'});
 assert.throws(()=>weightedFitColumn({...metric('slope'),referenceX:scalar('0'.repeat(9000)+'1')},sources(),{policy:policy()}));
});
