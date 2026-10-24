// Two positive tabular sums, initialized at zero, with strict score > h.
// https://www.itl.nist.gov/div898/handbook/pmc/section3/pmc323.htm
// An event is a threshold entry, not an estimated physical change onset.
import {DatasetResourceBudget,numericalOperation} from './dataset-resource-budget.js';
import {validDatasetResourcePolicy,datasetResourceLimits} from './web/dataset-resource-policy.js';
import {NumericalExecutionBudget} from './numerical-execution-budget.js';
import {validNumericalExecutionPolicy} from './web/numerical-execution-policy.js';
import {validatePolicyScalar,isScalarResourceFailure} from './web/measurement-scalar-policy.js';
import {validCellComputation,hasApproximateComputation} from './web/measurement-computation.js';
import {plotRational,plotRationalText,addPlotRational} from './web/plot-resource-policy.js';
import {revisionText} from './web/revision-model.js';
import {CUSUM_METHOD,validCusumPolicies} from './web/dataset-cusum-model.js';
export class DatasetCusumError extends Error{constructor(code='DATASET_CUSUM_INVALID'){super(code);this.code=code;}}
const fail=code=>{throw new DatasetCusumError(code);};
const natural=value=>Number.isSafeInteger(value)&&value>=0;
const exact=(value,keys)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const zero=()=>({numerator:0n,denominator:1n});
const subtract=(a,b,budget)=>addPlotRational(a,{numerator:-b.numerator,denominator:b.denominator},budget);
const scalar=(value,budget)=>({spelling:plotRationalText(value,budget),representation:'rational',radix:10});
const computation=value=>value?{version:1,kind:'approximate-inputs'}:null;
const exactInputKeys=['ordinal','kind','scalar','sourceScalar','resourcePolicy','computation','reason'];
const cursorKeys=['version','phase','offset','firstOrdinal','lastOrdinal','upper','lower','upperStart','lowerStart','aboveUpper','aboveLower','upperApproximateInputs','lowerApproximateInputs','upperAboveApproximateInputs','lowerAboveApproximateInputs','upperCrossings','lowerCrossings','missing','excluded','approximateInputs'];
const initialState=()=>({offset:0,firstOrdinal:null,lastOrdinal:null,upper:zero(),lower:zero(),upperStart:null,lowerStart:null,aboveUpper:false,aboveLower:false,upperApproximateInputs:false,lowerApproximateInputs:false,upperAboveApproximateInputs:false,lowerAboveApproximateInputs:false,upperCrossings:0,lowerCrossings:0,missing:0,excluded:0,approximateInputs:false});
// Shape/ordinal/count checks are cheap and constant-size. Canonical exact scores,
// threshold flags and policy-specific invariants are rechecked inside a charged
// scope when this authenticated checkpoint is resumed.
export function validCusumExecutionCursor(value,count){
 if(!Number.isSafeInteger(count)||count<1)return false;if(value===null)return true;
 if(!exact(value,cursorKeys)||value.version!==1||!['input','complete'].includes(value.phase)||!natural(value.offset)||(value.phase==='complete'?value.offset!==count:value.offset>=count||value.offset%32!==0))return false;
 for(const key of ['aboveUpper','aboveLower','upperApproximateInputs','lowerApproximateInputs','upperAboveApproximateInputs','lowerAboveApproximateInputs','approximateInputs'])if(typeof value[key]!=='boolean')return false;
 if(!['upperCrossings','lowerCrossings','missing','excluded'].every(key=>natural(value[key])&&value[key]<=value.offset)||value.missing+value.excluded>value.offset||value.upperCrossings+value.lowerCrossings>value.offset-value.missing-value.excluded)return false;
 if(value.offset===value.missing+value.excluded&&(value.approximateInputs||value.upper!=='0/1'||value.lower!=='0/1'))return false;
 if(value.offset===0){if(value.firstOrdinal!==null||value.lastOrdinal!==null||value.approximateInputs)return false;}else if(!natural(value.firstOrdinal)||!natural(value.lastOrdinal)||!Number.isSafeInteger(value.firstOrdinal+count-1)||value.lastOrdinal!==value.firstOrdinal+value.offset-1)return false;
 for(const direction of ['upper','lower']){
  const score=value[direction],start=value[direction+'Start'],above=value[direction==='upper'?'aboveUpper':'aboveLower'];if(typeof score!=='string'||score.length>datasetResourceLimits.maxScalarCharacters[1]||!/^(?:0|[1-9]\d*)\/[1-9]\d*$/.test(score))return false;
  if(score.startsWith('0/')){if(score!=='0/1'||start!==null||above||value[direction+'ApproximateInputs'])return false;}else if(value.offset===0||!natural(start)||start<value.firstOrdinal||start>value.lastOrdinal)return false;
  if(!value.approximateInputs&&(value[direction+'ApproximateInputs']||value[direction+'AboveApproximateInputs']))return false;
 }
 return true;
}
// Optional execution.slice(beforeCursor, async ({budget,work}) => nextCursor)
// must reserve durably first and atomically commit staged write(row,{budget,work})
// output with settlement and cursor. A failed/uncommitted slice emits no result.
// read(index,{budget,signal}) is ordered; await I/O outside numerical run scopes.
export async function evaluateCusum({count,read,write}={},options={}){
 const {target,allowance,threshold,resourcePolicy,gaps,afterSignal,signal,check,progress,budget:providedBudget,executionPolicy,execution}=options;
 if(!Number.isSafeInteger(count)||count<1||typeof read!=='function'||typeof write!=='function'||!validDatasetResourcePolicy(resourcePolicy)||!validCusumPolicies({gaps,afterSignal}))fail();
 if(providedBudget!==undefined&&(!(providedBudget instanceof DatasetResourceBudget)||revisionText(providedBudget.scalarPolicy)!==revisionText(resourcePolicy)))fail();
 if(execution!==undefined&&(!execution||typeof execution.slice!=='function'||!validNumericalExecutionPolicy(executionPolicy)||!validCusumExecutionCursor(execution.cursor??null,count)||providedBudget!==undefined)||execution===undefined&&executionPolicy!==undefined)fail();
 let budget=providedBudget??new DatasetResourceBudget(resourcePolicy),state=initialState(),parameters={};
 const run=(operation,code='DATASET_CUSUM_INPUT')=>{signal?.throwIfAborted();try{return numericalOperation(budget,operation);}catch(error){if(error instanceof DatasetCusumError||isScalarResourceFailure(error)||error.name==='AbortError')throw error;fail(code);}};
 const current=async()=>{signal?.throwIfAborted();await check?.();signal?.throwIfAborted();},io=async operation=>{await current();const result=await operation();await current();return result;};
 const parseParameter=(name,value)=>run(b=>{const parsed=validatePolicyScalar(value,resourcePolicy,{budget:b});if(name==='allowance'&&parsed.numerator<0n||name==='threshold'&&parsed.numerator<=0n)fail('DATASET_CUSUM_PARAMETERS');return parsed;},'DATASET_CUSUM_PARAMETERS');
 const reset=()=>{state.upper=zero();state.lower=zero();state.upperStart=null;state.lowerStart=null;state.aboveUpper=false;state.aboveLower=false;state.upperApproximateInputs=false;state.lowerApproximateInputs=false;state.upperAboveApproximateInputs=false;state.lowerAboveApproximateInputs=false;};
 const cursor=()=>run(b=>({version:1,phase:state.offset===count?'complete':'input',...state,upper:plotRationalText(state.upper,b),lower:plotRationalText(state.lower,b)}));
 const restore=value=>{if(value===null)return;run(b=>{
  if(!validCusumExecutionCursor(value,count))fail('MATERIAL_MISSING');const restored={...value};delete restored.version;delete restored.phase;
  for(const direction of ['upper','lower']){const number=plotRational(value[direction],b);if(plotRationalText(number,b)!==value[direction]||number.numerator<0n||value[direction==='upper'?'aboveUpper':'aboveLower']!==(subtract(number,parameters.threshold,b).numerator>0n))fail('MATERIAL_MISSING');restored[direction]=number;}
  if(gaps==='reject'&&(value.missing||value.excluded)||afterSignal==='reset-both-after-row'&&(value.aboveUpper||value.aboveLower))fail('MATERIAL_MISSING');state=restored;
 });};
 function transition(input,index){return run(b=>{
  b.step();if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!exactInputKeys.includes(key))||!natural(input.ordinal)||!['value','missing','excluded'].includes(input.kind)||input.reason!==undefined&&(typeof input.reason!=='string'||input.reason.length>1000))fail('DATASET_CUSUM_INPUT');
  if(state.firstOrdinal===null){if(!Number.isSafeInteger(input.ordinal+count-1))fail('DATASET_CUSUM_INPUT');state.firstOrdinal=input.ordinal;}if(input.ordinal!==state.firstOrdinal+index)fail('DATASET_CUSUM_INPUT');state.lastOrdinal=input.ordinal;state.offset=index+1;
  const base={index,ordinal:input.ordinal,status:input.kind,reason:input.reason??null};
  if(input.kind!=='value'){
   if(gaps==='reject')fail('DATASET_CUSUM_GAP');if(input.kind==='missing')state.missing++;else state.excluded++;reset();
   return {...base,upper:null,lower:null,aboveUpper:false,aboveLower:false,crossedUpper:false,crossedLower:false,upperExtent:null,lowerExtent:null,resetAfter:true,upperComputation:null,lowerComputation:null,crossedUpperComputation:null,crossedLowerComputation:null,resetComputation:null};
  }
  if(!Object.hasOwn(input,'computation')||!validCellComputation(input.computation)||!validDatasetResourcePolicy(input.resourcePolicy))fail('DATASET_CUSUM_INPUT');
  // Source spelling remains governed by its owner even after unit conversion.
  validatePolicyScalar(input.sourceScalar??input.scalar,input.resourcePolicy,{budget:b});const value=validatePolicyScalar(input.scalar,resourcePolicy,{budget:b}),deviation=subtract(value,parameters.target,b),inputApproximate=hasApproximateComputation(input),usedUpper=state.upperApproximateInputs||inputApproximate,usedLower=state.lowerApproximateInputs||inputApproximate;
  const candidateUpper=subtract(addPlotRational(state.upper,deviation,b),parameters.allowance,b),candidateLower=subtract(subtract(state.lower,deviation,b),parameters.allowance,b),nextUpper=candidateUpper.numerator>0n?candidateUpper:zero(),nextLower=candidateLower.numerator>0n?candidateLower:zero();
  state.upperStart=nextUpper.numerator===0n?null:state.upper.numerator===0n?input.ordinal:state.upperStart;state.lowerStart=nextLower.numerator===0n?null:state.lower.numerator===0n?input.ordinal:state.lowerStart;
  const nextAboveUpper=subtract(nextUpper,parameters.threshold,b).numerator>0n,nextAboveLower=subtract(nextLower,parameters.threshold,b).numerator>0n,crossedUpper=nextAboveUpper&&!state.aboveUpper,crossedLower=nextAboveLower&&!state.aboveLower,crossedUpperApproximate=usedUpper||nextAboveUpper&&state.upperAboveApproximateInputs,crossedLowerApproximate=usedLower||nextAboveLower&&state.lowerAboveApproximateInputs;
  if(crossedUpper)state.upperCrossings++;if(crossedLower)state.lowerCrossings++;state.approximateInputs ||= inputApproximate;
  const resetAfter=afterSignal==='reset-both-after-row'&&(crossedUpper||crossedLower),result={...base,upper:scalar(nextUpper,b),lower:scalar(nextLower,b),aboveUpper:nextAboveUpper,aboveLower:nextAboveLower,crossedUpper,crossedLower,upperExtent:state.upperStart===null?null:{first:state.upperStart,last:input.ordinal},lowerExtent:state.lowerStart===null?null:{first:state.lowerStart,last:input.ordinal},resetAfter,upperComputation:computation(usedUpper),lowerComputation:computation(usedLower),crossedUpperComputation:computation(crossedUpperApproximate),crossedLowerComputation:computation(crossedLowerApproximate),resetComputation:computation(afterSignal==='reset-both-after-row'&&(crossedUpperApproximate||!crossedUpper&&crossedLowerApproximate))};
  for(const field of ['upper','lower'])validatePolicyScalar(result[field],resourcePolicy,{budget:b});state.upper=nextUpper;state.lower=nextLower;state.aboveUpper=nextAboveUpper;state.aboveLower=nextAboveLower;
  // The current zero/threshold decision retains what it consumed. The next
  // numerical sum starts at a new exact zero, so expired contributions cannot
  // taint the other direction or a later accumulation. The previous-above
  // provenance remains separate for a subsequent threshold-entry decision.
  state.upperApproximateInputs=nextUpper.numerator!==0n&&usedUpper;state.lowerApproximateInputs=nextLower.numerator!==0n&&usedLower;state.upperAboveApproximateInputs=usedUpper;state.lowerAboveApproximateInputs=usedLower;if(resetAfter)reset();return result;
 });}
 const summary=()=>({version:1,method:CUSUM_METHOD,count,firstOrdinal:state.firstOrdinal,lastOrdinal:state.lastOrdinal,upperCrossings:state.upperCrossings,lowerCrossings:state.lowerCrossings,missing:state.missing,excluded:state.excluded,approximateInputs:state.approximateInputs,resourcePolicy:structuredClone(resourcePolicy),...(execution?{executionPolicy:structuredClone(executionPolicy)}:{})});
 if(!execution){
  for(const [name,value]of Object.entries({target,allowance,threshold}))parameters[name]=parseParameter(name,value);
  for(let index=0;index<count;index++){const input=await io(()=>read(index,{budget,signal})),row=transition(input,index);await io(()=>write(row));if(progress&&((index+1)%64===0||index===count-1))await io(()=>progress({phase:'input',done:index+1,total:count}));}
  await current();return summary();
 }
 let before=execution.cursor??null;
 const scoped=async(operation)=>{let expected;await current();const next=await execution.slice(before,async scope=>{
  if(!(scope?.budget instanceof NumericalExecutionBudget)||revisionText(scope.budget.policy)!==revisionText(executionPolicy)||!scope.work||typeof scope.work!=='object')fail();budget=scope.budget.scalarBudget(resourcePolicy);expected=await operation(scope.work);if(!validCusumExecutionCursor(expected,count))fail('MATERIAL_MISSING');return expected;
 });if(!validCusumExecutionCursor(next,count)||revisionText(next)!==revisionText(expected))fail('MATERIAL_MISSING');before=structuredClone(next);};
 // A fixed number of non-advancing setup scopes rechecks parameters/state and
 // charges retries too. Long independently admitted parameters do not share an
 // accidental one-slice parsing limit. Storage I/O remains outside run().
 for(const [name,value]of Object.entries({target,allowance,threshold}))await scoped(async()=>{parameters[name]=parseParameter(name,value);return before;});
 await scoped(async()=>{restore(before);return before;});
 while(state.offset<count){
  await scoped(async work=>{const end=Math.min(count,state.offset+32);while(state.offset<end){const index=state.offset,input=await io(()=>read(index,{budget,signal})),row=transition(input,index);await io(()=>write(row,{budget,work}));}return cursor();});
  if(progress)await io(()=>progress({phase:'input',done:state.offset,total:count}));
 }
 await current();return summary();
}
