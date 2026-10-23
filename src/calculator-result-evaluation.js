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
export function evaluateCalculatorRecipe(recipe){
 if(!validCalculatorRecipe(recipe))throw new AppError('CALCULATOR_RESULT_INVALID');
 if(recipe.library.version!==calculationLibrary.version)throw new AppError('CALCULATOR_RESULT_LIBRARY');
 try{
  const options={engine:recipe.engine,angle:recipe.angle,...(recipe.policy?{policy:recipe.policy}:{})},runtime=calculationRuntime(options);
  if(runtime.math.version!==recipe.library.version)throw new AppError('CALCULATOR_RESULT_LIBRARY');
  const value=calculateDetailed(recipe.expression,{...options,runtime});
  if(recipe.version===2&&validStructuredResult(value.structured)&&!value.approximation)return {structured:value.structured,result:value.result};
  if(!value.exact||value.approximation)throw new AppError('CALCULATOR_RESULT_EXACT');
  return {numerator:value.exact.numerator,denominator:value.exact.denominator,spelling:value.exact.numerator+'/'+value.exact.denominator};
 }catch(error){if(error instanceof AppError)throw error;if(error.code==='CALCULATION_LIBRARY_UNAVAILABLE')throw new AppError('CALCULATOR_RESULT_LIBRARY');if(error.code==='CALCULATION_STRUCTURED_RESOURCE'||/resource budget|time limit/i.test(error.message))throw new AppError('CALCULATOR_RESULT_RESOURCE');throw new AppError('CALCULATOR_RESULT_EXACT');}
}
