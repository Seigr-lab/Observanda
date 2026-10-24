// Exact centered complete-pair moments for the retained aggregation owner.
// Sample covariance uses n-1; unweighted least squares includes an intercept:
// https://stat.ethz.ch/R-manual/R-devel/library/stats/html/cor.html
// https://www.itl.nist.gov/div898/handbook/pmd/section1/pmd141.htm
// Values use the selected columns' authored coordinates, never inferred units.
import {AppError} from './errors.js';
import {withScalarPolicy,isScalarResourceFailure} from './web/measurement-scalar-policy.js';
import {plotRational,plotRationalText,addPlotRational,multiplyPlotRational,dividePlotRational} from './web/plot-resource-policy.js';
import {formatExactResult} from './web/measurement-format.js';
import {validDatasetResourcePolicy} from './web/dataset-resource-policy.js';
import {validPairStatisticMetric} from './web/dataset-aggregation-model.js';
import {isScalarRepresentation,blankQuantity} from './web/measurement-model.js';
import {defaultColumn} from './web/dataset-schema.js';
import {derivedComputation} from './web/measurement-computation.js';
import {resultContext} from './web/numeral-context.js';
import {validateUnitDefinition,unitScalar,unitOperationDimensions,exactUnitScalar} from './web/measurement-unit-model.js';
const fail=(code='DATASET_AGGREGATION')=>{throw new AppError(code);};
const fields=['meanX','meanY','Cxx','Cxy'],rationalContext={version:1,representation:'rational',radix:10};
const negate=value=>({...value,numerator:-value.numerator});
const subtract=(a,b,budget)=>addPlotRational(a,negate(b),budget);
const scalar=value=>({spelling:value,representation:'rational',radix:10});
function checked(operation,code){try{return operation();}catch(error){if(error instanceof AppError||isScalarResourceFailure(error)||error.name==='AbortError')throw error;fail(code);}}
const operate=(policy,budget,operation,code)=>checked(()=>withScalarPolicy(policy,budget,operation),code);
export function createPairMoments(){return {version:1,n:0,meanX:'0/1',meanY:'0/1',Cxx:'0/1',Cxy:'0/1'};}
function parsedMoments(state,budget,count){
 if(!state||typeof state!=='object'||Array.isArray(state)||Object.keys(state).sort().join()!=='Cxx,Cxy,meanX,meanY,n,version'||state.version!==1||!Number.isSafeInteger(state.n)||state.n<0||count!==undefined&&state.n!==count)fail('MATERIAL_MISSING');
 const values={};for(const key of fields){const text=state[key];if(typeof text!=='string'||!/^[-]?\d+\/[1-9]\d*$/.test(text))fail('MATERIAL_MISSING');values[key]=plotRational(text,budget);if(plotRationalText(values[key],budget)!==text)fail('MATERIAL_MISSING');}
 if(values.Cxx.numerator<0n||values.Cxx.numerator===0n&&values.Cxy.numerator!==0n||state.n===0&&fields.some(key=>values[key].numerator!==0n)||state.n===1&&(values.Cxx.numerator!==0n||values.Cxy.numerator!==0n))fail('MATERIAL_MISSING');
 return values;
}
// Recovery checks one bounded pair state. Authenticity and source counts remain
// the enclosing command-hash checkpoint and deterministic source replay's job.
export function validatePairMoments(state,{policy,budget,count}={}){
 return operate(policy,budget,b=>{if(count!==undefined&&(!Number.isSafeInteger(count)||count<0))fail('MATERIAL_MISSING');parsedMoments(state,b,count);return state;},'MATERIAL_MISSING');
}
export function updatePairMoments(state,x,y,{policy,budget}={}){
 return operate(policy,budget,b=>{
  const prior=parsedMoments(state,b);if(!Number.isSafeInteger(state.n+1))fail('DATASET_AGGREGATION_LIMIT');
  const left=plotRational(x,b),right=plotRational(y,b),n=state.n+1,divisor={numerator:BigInt(n),denominator:1n};
  const dx=subtract(left,prior.meanX,b),dy=subtract(right,prior.meanY,b),meanX=addPlotRational(prior.meanX,dividePlotRational(dx,divisor,b),b),meanY=addPlotRational(prior.meanY,dividePlotRational(dy,divisor,b),b);
  const Cxx=addPlotRational(prior.Cxx,multiplyPlotRational(dx,subtract(left,meanX,b),b),b),Cxy=addPlotRational(prior.Cxy,multiplyPlotRational(dx,subtract(right,meanY,b),b),b);
  return {version:1,n,meanX:plotRationalText(meanX,b),meanY:plotRationalText(meanY,b),Cxx:plotRationalText(Cxx,b),Cxy:plotRationalText(Cxy,b)};
 });
}
export function finishPairStatistic(state,metric,{policy,budget}={}){
 return operate(policy,budget,b=>{
  if(!validPairStatisticMetric(metric))fail();const values=parsedMoments(state,b);
  const receipt={version:1,method:metric.method,pairing:metric.pairing,status:'ready'};
  if(state.n===0)return {value:null,receipt:{...receipt,status:'no-pairs'}};
  if(state.n<2&&(metric.operation==='linear-fit'||metric.normalization==='sample'))return {value:null,receipt:{...receipt,status:'insufficient-pairs'}};
  if(metric.operation==='covariance')return {value:plotRationalText(dividePlotRational(values.Cxy,{numerator:BigInt(state.n-(metric.normalization==='sample'?1:0)),denominator:1n},b),b),receipt};
  if(values.Cxx.numerator===0n)return {value:null,receipt:{...receipt,status:'zero-x-spread'}};
  const slope=dividePlotRational(values.Cxy,values.Cxx,b),value=metric.coefficient==='slope'?slope:subtract(values.meanY,multiplyPlotRational(slope,values.meanX,b),b);
  return {value:plotRationalText(value,b),receipt};
 });
}
function pairUnits(metric,columns,policy,budget){
 const [x,y]=columns,a=x.quantity?.unitDefinition,b=y.quantity?.unitDefinition;
 if(!a&&!b){if(x.unit!==''||y.unit!=='')fail('DATASET_AGGREGATION_UNITS');return {unit:''};}
 if(!a||!b)fail('DATASET_AGGREGATION_UNITS');
 return checked(()=>{
  validateUnitDefinition(a,{budget});validateUnitDefinition(b,{budget});
  if(metric.operation==='linear-fit'&&metric.coefficient==='intercept')return {unit:y.unit,unitDefinition:structuredClone(b)};
  // Centering makes deviations differences, including absolute source axes.
  // Keep scale ownership while removing their irrelevant coordinate offsets.
  const difference=value=>({...value,kind:'difference',offset:exactUnitScalar('0')}),action=metric.operation==='covariance'?'multiply':'divide',left=action==='multiply'?a:b,right=action==='multiply'?b:a;
  const dimensions=unitOperationDimensions(action,difference(left),difference(right),null,budget).dimensions,leftScale=unitScalar(left.scale,budget,left.resourcePolicy),rightScale=unitScalar(right.scale,budget,right.resourcePolicy),scale=action==='multiply'?multiplyPlotRational(leftScale,rightScale,budget):dividePlotRational(leftScale,rightScale,budget);
  return {unit:'',unitDefinition:{version:2,kind:'difference',dimensions,scale:scalar(formatExactResult(scale,rationalContext,budget)),offset:exactUnitScalar('0'),resourcePolicy:structuredClone(policy)}};
 },'DATASET_AGGREGATION_UNITS');
}
export function pairStatisticColumn(metric,columns,{policy,keys=[]}={}){
 return operate(policy,undefined,b=>{
  if(!validDatasetResourcePolicy(policy)||!validPairStatisticMetric(metric)||!Array.isArray(columns)||columns.length!==2||columns.some(column=>!isScalarRepresentation(column)))fail();
  const {unit,unitDefinition}=pairUnits(metric,columns,policy,b),context=resultContext(metric.output),quantity={...blankQuantity(),origin:'derived',...(unitDefinition?{unitDefinition}:{})};
  return {...defaultColumn({label:metric.name}),representation:context.representation,radix:context.radix,unit,quantity,resourcePolicy:structuredClone(policy),...derivedComputation(...columns,...keys)};
 });
}
