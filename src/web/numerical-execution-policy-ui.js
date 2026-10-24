import {t} from './i18n/index.js';
import {defaultNumericalExecutionPolicy,numericalExecutionLimits,validNumericalExecutionPolicy} from './numerical-execution-policy.js';
export const numericalExecutionText=(key,args)=>t('numericalExecution',key,args);
export function numericalExecutionPolicyControls(policy,{esc,field}){
 return '<div data-numerical-execution-policy><p>'+esc(numericalExecutionText('help'))+'</p>'+['total','slice'].map(scope=>'<fieldset><legend>'+esc(numericalExecutionText(scope))+'</legend>'+Object.entries(numericalExecutionLimits[scope]).map(([key,[min,max]])=>field(esc(numericalExecutionText(key)),'<input type="number" required step="1" min="'+min+'" max="'+max+'" data-numerical-execution="'+scope+'.'+key+'" value="'+esc(policy[scope][key])+'"><small>'+esc(numericalExecutionText('bounds',{min,max}))+'</small>')).join('')+'</fieldset>').join('')+'<p>'+esc(numericalExecutionText('sliceHelp'))+'</p></div>';
}
export function readNumericalExecutionPolicy(root,{validate=true}={}){
 const result=defaultNumericalExecutionPolicy();for(const scope of ['total','slice'])for(const key of Object.keys(numericalExecutionLimits[scope])){const input=root.querySelector('[data-numerical-execution="'+scope+'.'+key+'"]');result[scope][key]=input?.value?.trim()?Number(input.value):'';}
 if(validate&&!validNumericalExecutionPolicy(result))throw Error(numericalExecutionText('invalid'));return result;
}
export function numericalExecutionPolicyContext(policy,{text=numericalExecutionText}={}){
 if(!validNumericalExecutionPolicy(policy))throw RangeError('Invalid numerical execution policy');return text('publicContext',{operations:policy.total.maxOperations,active:policy.total.maxActiveMilliseconds,sliceOperations:policy.slice.maxOperations,sliceActive:policy.slice.maxActiveMilliseconds});
}
