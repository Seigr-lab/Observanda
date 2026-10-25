import test from 'node:test';
import assert from 'node:assert/strict';
import {createWeightedFitMoments,updateWeightedFitMoments,finishWeightedFit} from '../src/dataset-weighted-fit.js';
import {weightedFitColumn,weightedFitVariance} from '../src/dataset-weighted-fit-units.js';
import {evaluateStatisticalUncertainty} from '../src/measurement-statistical-uncertainty.js';
import {validStatisticalUncertaintyResult} from '../src/web/measurement-statistical-uncertainty-model.js';
import {validApproximateResult} from '../src/web/tools/approximate-calculation-model.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
import {DatasetResourceBudget} from '../src/dataset-resource-budget.js';
import {defaultStructuredCalculationPolicy} from '../src/web/tools/calculation-policy.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {blankQuantity} from '../src/web/measurement-model.js';
import {blankUnitDefinition,exactUnitScalar} from '../src/web/measurement-unit-model.js';
import {validatePolicyScalar} from '../src/web/measurement-scalar-policy.js';
import {plotRational,plotRationalText,addPlotRational} from '../src/web/plot-resource-policy.js';
const resourcePolicy=defaultDatasetResourcePolicy(),scalar=spelling=>({spelling,representation:'rational',radix:10});
const unit=(dimensions,scale='1',offset='0',kind='difference')=>({...blankUnitDefinition(),dimensions,scale:exactUnitScalar(scale),offset:exactUnitScalar(offset),kind});
const sourceColumn=(name,definition,computation)=>({...defaultColumn({label:name}),representation:'rational',unit:name,resourcePolicy,quantity:{...blankQuantity(),origin:'measured',unitDefinition:definition},...(computation?{computation}:{})});
const heteroscedastic=[['0/1','1/1','1/4'],['1/1','3/1','1/1'],['2/1','8/1','1/4']];
function fixture(reference,evaluation,rows=heteroscedastic,{rounding='half-even',approximateInputs=false}={}){
 const computation=approximateInputs?{version:1,kind:'approximate-inputs'}:undefined,inputs=[sourceColumn('X',unit([{axis:'length',exponent:1}],'2','100','absolute')),sourceColumn('Y',unit([{axis:'voltage',exponent:1}],'3','-7','absolute'),computation),sourceColumn('Observation variance',unit([{axis:'voltage',exponent:2}],'36'))],budget=new DatasetResourceBudget(resourcePolicy);let state=createWeightedFitMoments();
 for(const [x,y,v]of rows)state=updateWeightedFitMoments(state,x,y,weightedFitVariance(v,inputs,{policy:resourcePolicy,budget}),{policy:resourcePolicy,budget});
 const metric=result=>({operation:'weighted-affine-fit',method:'observation-variance-affine-v1',pairing:'complete-triples-v1',column:0,pairedColumn:1,varianceColumn:2,name:result,result,referenceX:scalar(reference),...(['fitted-mean','fitted-mean-variance'].includes(result)?{evaluationX:scalar(evaluation)}:{})});
 const value=result=>finishWeightedFit(state,metric(result),{policy:resourcePolicy,budget}).value,selected=result=>({value:scalar(value(result)),column:weightedFitColumn(metric(result),inputs,{policy:resourcePolicy})}),nominal=selected('fitted-mean'),coefficients=[selected('intercept'),selected('slope')],covariance=[selected('intercept-variance'),selected('coefficient-covariance'),selected('slope-variance')];
 const delta=budget.run(()=>{const x=plotRational(evaluation,budget),r=plotRational(reference,budget);return plotRationalText(addPlotRational(x,{numerator:-r.numerator,denominator:r.denominator},budget),budget);});
 const sensitivities=[{value:scalar('1/1'),column:sourceColumn('',blankUnitDefinition())},{value:scalar(delta),column:sourceColumn('X difference',{...inputs[0].quantity.unitDefinition,kind:'difference',offset:exactUnitScalar('0')})}];
 const saved=new Map(),reads={inputs:[],covariance:[],gets:0,puts:0},work={get:async key=>{reads.gets++;return saved.get(key);},put:async(key,value)=>{reads.puts++;saved.set(key,structuredClone(value));}},source={count:2,nominal,work,readInput:async i=>{reads.inputs.push(i);return {estimate:coefficients[i],sensitivity:sensitivities[i]};},readCovariance:async(i,j)=>{reads.covariance.push([i,j]);return covariance[j*(j+1)/2+i];}},calculationPolicy={...defaultStructuredCalculationPolicy(),workingDigits:32,displayDigits:3,rounding};
 return {state,budget,source,reads,saved,covariance,coefficients,expected:value('fitted-mean-variance'),calculationPolicy,run:()=>evaluateStatisticalUncertainty(source,{resourcePolicy,calculationPolicy,budget})};
}

test('existing covariance propagation reproduces fitted-mean variance across shifted affine references and signed coefficient covariance',async()=>{
 for(const reference of ['-2/1','0/1','1/1','3/1','5/1']){const f=fixture(reference,'3/1'),used=f.budget.operations,result=await f.run();assert.equal(result.variance.scalar.spelling,f.expected);assert.equal(f.expected,'22/9');assert.equal(result.nominal.scalar.spelling,'34/3');assert.equal(validStatisticalUncertaintyResult(result),true);assert.equal(result.approximateInputs,false);assert.equal(result.squareRoot.approximate,true);assert.equal(result.variance.unitDefinition.scale.spelling,'9/1');assert.deepEqual(result.variance.unitDefinition.dimensions,[{axis:'voltage',exponent:2}]);assert.equal(result.nominal.unitDefinition.offset.spelling,'-7');assert.equal(result.standardUncertainty.unitDefinition.kind,'difference');assert.equal(result.standardUncertainty.unitDefinition.offset.spelling,'0');assert.deepEqual(f.reads.inputs,[0,1]);assert.deepEqual(f.reads.covariance,[[0,0],[0,1],[1,1]]);assert.equal(f.saved.size,5);assert.ok(f.budget.operations>used,'fit preparation and propagation consume the same cumulative budget');if(reference!=='1/1')assert.notEqual(f.covariance[1].value.spelling,'0/1');}
});

test('weighted covariance uses the existing exact-first square root and retains explicit finite rounding policy separately from input approximation',async()=>{
 for(const reference of ['0/1','2/1']){const exact=fixture(reference,'0/1',[['0/1','10/1','9/4'],['1/1','12/1','9/4']],{approximateInputs:true}),result=await exact.run();assert.equal(result.variance.scalar.spelling,'9/1');assert.equal(result.standardUncertainty.scalar.spelling,'3/1');assert.equal(result.standardUncertainty.scalar.representation,'rational');assert.equal(result.squareRoot.approximate,false);assert.equal(result.squareRoot.computation,null);assert.equal(result.approximateInputs,true);assert.equal(validStatisticalUncertaintyResult(result),true);}
 const roots=[];for(const rounding of ['floor','ceiling']){const f=fixture('0/1','3/1',heteroscedastic,{rounding}),result=await f.run();assert.equal(result.variance.scalar.spelling,f.expected);assert.equal(result.squareRoot.engine,4);assert.deepEqual(result.squareRoot.policy,f.calculationPolicy);assert.equal(result.squareRoot.approximate,true);assert.equal(result.approximateInputs,false);assert.equal(validApproximateResult(result.squareRoot.computation),true);assert.equal(result.standardUncertainty.scalar.spelling,result.squareRoot.computation.spelling);assert.ok(result.standardUncertainty.scalar.spelling.length>f.calculationPolicy.displayDigits);assert.equal(validStatisticalUncertaintyResult(result),true);const root=validatePolicyScalar(result.standardUncertainty.scalar,resourcePolicy),variance=validatePolicyScalar(result.variance.scalar,resourcePolicy),left=root.numerator*root.numerator*variance.denominator,right=variance.numerator*root.denominator*root.denominator;assert.ok(rounding==='floor'?left<right:left>right);roots.push(root);}
 assert.ok(roots[0].numerator*roots[1].denominator<roots[1].numerator*roots[0].denominator);
});

test('coefficient covariance is required and remains subject to the existing full covariance and unit validation',async()=>{
 const absent=fixture('0/1','3/1');absent.source.readCovariance=async(i,j)=>i===0&&j===1?undefined:absent.covariance[j*(j+1)/2+i];await assert.rejects(absent.run(),{code:'STATISTICAL_UNCERTAINTY_INPUT'});
 const indefinite=fixture('0/1','3/1');indefinite.covariance[1].value=scalar('100/1');await assert.rejects(indefinite.run(),{code:'STATISTICAL_UNCERTAINTY_COVARIANCE'});
 const wrongUnits=fixture('0/1','3/1');wrongUnits.covariance[1].column.quantity.unitDefinition=blankUnitDefinition();await assert.rejects(wrongUnits.run(),{code:'STATISTICAL_UNCERTAINTY_UNITS'});
});
