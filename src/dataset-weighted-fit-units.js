// Inverse supplied observation variances, with X treated as fixed.
// https://www.itl.nist.gov/div898/handbook/pmd/section4/pmd452.htm
// Absolute variance scale is retained; no residual-based rescaling is inferred.
import {AppError} from './errors.js';
import {withScalarPolicy,isScalarResourceFailure,validatePolicyScalar} from './web/measurement-scalar-policy.js';
import {plotRational,plotRationalText,multiplyPlotRational,dividePlotRational} from './web/plot-resource-policy.js';
import {validateUnitDefinition,unitScalar,unitOperationDimensions,exactUnitScalar,sameUnitDimensions,convertUnitValue} from './web/measurement-unit-model.js';
import {validWeightedFitMetric,weightedFitEvaluated} from './web/dataset-weighted-fit-model.js';
import {isScalarRepresentation,blankQuantity} from './web/measurement-model.js';
import {defaultColumn} from './web/dataset-schema.js';
import {derivedColumnComputation,derivedComputation} from './web/measurement-computation.js';
import {resultContext} from './web/numeral-context.js';
const scalar=spelling=>({spelling,representation:'rational',radix:10});
const fail=()=>{throw new AppError('DATASET_WEIGHTED_FIT_UNITS');};
function operate(policy,budget,operation){try{return withScalarPolicy(policy,budget,operation);}catch(error){if(error instanceof AppError||isScalarResourceFailure(error)||error.name==='AbortError')throw error;fail();}}
const difference=unit=>({...unit,kind:'difference',offset:exactUnitScalar('0')});
function combine(left,right,operation,policy,budget){
 const dimensions=unitOperationDimensions(operation,difference(left),difference(right),null,budget).dimensions,a=unitScalar(left.scale,budget,left.resourcePolicy),b=unitScalar(right.scale,budget,right.resourcePolicy),scale=operation==='multiply'?multiplyPlotRational(a,b,budget):dividePlotRational(a,b,budget);
 return {version:2,kind:'difference',dimensions,scale:scalar(plotRationalText(scale,budget)),offset:exactUnitScalar('0'),resourcePolicy:structuredClone(policy)};
}
function sourceUnits(columns,policy,budget){
 if(!Array.isArray(columns)||columns.length!==3||columns.some(column=>!isScalarRepresentation(column)))fail();
 const units=columns.map(column=>column.quantity?.unitDefinition);
 if(units.every(unit=>!unit)){if(columns.some(column=>column.unit!==''))fail();return null;}
 if(units.some(unit=>!unit))fail();for(const unit of units)validateUnitDefinition(unit,{budget});
 const [x,y,variance]=units,targetVariance=combine(y,y,'multiply',policy,budget);
 if(variance.kind!=='difference'||!sameUnitDimensions(variance,targetVariance))fail();
 return {x,y,variance,targetVariance};
}
export function weightedFitVariance(value,columns,{policy,budget}={}){
 return operate(policy,budget,b=>{const units=sourceUnits(columns,policy,b),number=plotRational(value,b);if(number.numerator<=0n)throw new AppError('DATASET_WEIGHTED_FIT_VARIANCE');return units?plotRationalText(convertUnitValue(number,units.variance,units.targetVariance,b),b):plotRationalText(number,b);});
}
export function weightedFitColumn(metric,columns,{policy,keys=[],perCell=false}={}){
 return operate(policy,undefined,b=>{
  if(!validWeightedFitMetric(metric,policy)||!Array.isArray(keys))throw new AppError('DATASET_AGGREGATION');
  validatePolicyScalar(metric.referenceX,policy,{budget:b});if(weightedFitEvaluated(metric))validatePolicyScalar(metric.evaluationX,policy,{budget:b});
  const units=sourceUnits(columns,policy,b),[x,y]=columns;let unit='',unitDefinition;
  if(units){
   const slope=combine(units.y,units.x,'divide',policy,b);
   if(['intercept','fitted-mean'].includes(metric.result)){unit=y.unit;unitDefinition=structuredClone(units.y);}
   else if(metric.result==='slope')unitDefinition=slope;
   else if(metric.result==='slope-variance')unitDefinition=combine(slope,slope,'multiply',policy,b);
   else if(metric.result==='coefficient-covariance')unitDefinition=combine(units.y,slope,'multiply',policy,b);
   else unitDefinition=units.targetVariance;
  }
  const coordinateUnit={unit:x.unit,definition:x.quantity?.unitDefinition?structuredClone(x.quantity.unitDefinition):null};
  const weightedFit={version:1,method:metric.method,pairing:metric.pairing,result:metric.result,referenceX:structuredClone(metric.referenceX),...(weightedFitEvaluated(metric)?{evaluationX:structuredClone(metric.evaluationX)}:{}),resourcePolicy:structuredClone(policy),coordinateUnit};
  const context=resultContext(metric.output),quantity={...blankQuantity(),origin:'derived',...(unitDefinition?{unitDefinition}:{})};
  return {...defaultColumn({label:metric.name}),representation:context.representation,radix:context.radix,unit,quantity,resourcePolicy:structuredClone(policy),weightedFit,...(perCell?derivedColumnComputation(...columns,...keys):derivedComputation(...columns,...keys))};
 });
}
