import {calculatorResultScalarPolicy} from './calculator-result-values.js';
import {validatePolicyScalar,isScalarResourceFailure} from './web/measurement-scalar-policy.js';
import {validApproximateResult} from './web/tools/approximate-calculation-model.js';
import {STRUCTURED_CALCULATION_ENGINE,validStructuredResult} from './web/tools/structured-calculation-model.js';
import {calculateDetailed,calculationRuntime} from './tools/math.js';
import {calculationLibrary} from './web/tools/calculation-policy.js';
import {validCalculatorRecipe,validCalculatorSource} from './web/calculator-result-model.js';
import {validateTool} from './modules/tools.js';
import {digest,serialize} from './storage-format.js';
import {AppError} from './errors.js';
export function captureCalculatorRecipe(source,entity,expressionIndex){
 if(!validCalculatorSource(source)||entity?.id!==source.id||entity?.revision!==source.revision||entity?.type!=='calculation')throw new AppError('CALCULATOR_RESULT_INVALID');
 validateTool('calculation',entity.data);const d=entity.data;
 if(![2,3,4].includes(d.engine)||d.mode!=='expression')throw new AppError('CALCULATOR_RESULT_EXACT');
 const expression=d.expression.split(/\r?\n/)[expressionIndex],recipe={version:d.engine===4?2:1,...(d.engine===4?{structuredEngine:{...STRUCTURED_CALCULATION_ENGINE}}:{}),scope:'selected-expression',source:{...source,entityHash:digest(serialize(entity))},expressionIndex,expression,engine:d.engine,angle:d.angle,policy:d.engine>=3?structuredClone(d.policy):null,library:{...calculationLibrary}};
 if(!validCalculatorRecipe(recipe))throw new AppError(d.engine>=3&&d.policy.library.version!==calculationLibrary.version?'CALCULATOR_RESULT_LIBRARY':'CALCULATOR_RESULT_INVALID');
 return recipe;
}
function calculatorRecipeValue(recipe,value){
 if(recipe.version===3){
  if(recipe.engine!==4||!value.approximation||value.exact||value.structured||!validApproximateResult(value.computation))throw new AppError('CALCULATOR_RESULT_EXACT');
  const result={spelling:value.computation.spelling,computation:structuredClone(value.computation)};
  try{validatePolicyScalar({spelling:result.spelling,representation:'decimal',radix:10},calculatorResultScalarPolicy(recipe,result));}catch(error){if(isScalarResourceFailure(error))throw new AppError('CALCULATOR_RESULT_RESOURCE');throw error;}return result;
 }
 if(recipe.version===2&&validStructuredResult(value.structured)&&!value.approximation)return {structured:value.structured,result:value.result};
 if(!value.exact||value.approximation)throw new AppError('CALCULATOR_RESULT_EXACT');
 return {numerator:value.exact.numerator,denominator:value.exact.denominator,spelling:value.exact.numerator+'/'+value.exact.denominator};
}
function calculatorRecipeComputation(recipe){
 if(!validCalculatorRecipe(recipe))throw new AppError('CALCULATOR_RESULT_INVALID');
 if(recipe.library.version!==calculationLibrary.version)throw new AppError('CALCULATOR_RESULT_LIBRARY');
 try{
  const options={engine:recipe.engine,angle:recipe.angle,...(recipe.policy?{policy:recipe.policy}:{})},runtime=calculationRuntime(options);
  if(runtime.math.version!==recipe.library.version)throw new AppError('CALCULATOR_RESULT_LIBRARY');
  return calculateDetailed(recipe.expression,{...options,runtime});
 }catch(error){if(error instanceof AppError)throw error;if(error.code==='CALCULATION_LIBRARY_UNAVAILABLE')throw new AppError('CALCULATOR_RESULT_LIBRARY');if(error.code==='CALCULATION_STRUCTURED_RESOURCE'||/resource budget|time limit/i.test(error.message))throw new AppError('CALCULATOR_RESULT_RESOURCE');throw new AppError('CALCULATOR_RESULT_EXACT');}
}
export function evaluateCalculatorRecipe(recipe){return calculatorRecipeValue(recipe,calculatorRecipeComputation(recipe));}
// Capture chooses from the authenticated computation, never display text or a
// caller-supplied result. Historical recipe evaluation remains version-bound.
export function captureCalculatorResultRecipe(source,entity,expressionIndex){
 const recipe=captureCalculatorRecipe(source,entity,expressionIndex),value=calculatorRecipeComputation(recipe);
 const captured=recipe.engine===4&&value.approximation&&validApproximateResult(value.computation)?{...recipe,version:3}:recipe;
 calculatorRecipeValue(captured,value);return captured;
}
