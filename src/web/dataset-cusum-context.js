import {t} from './i18n/index.js';
import {validCusumContext} from './dataset-cusum-model.js';
import {measurementUnitContextParts} from './measurement-unit-context.js';
import {numericalExecutionPolicyContext} from './numerical-execution-policy-ui.js';
export const cusumText=(key,args)=>t('datasetCusum',key,args);
export function cusumContextParts(context,{text=cusumText}={}){
 if(!context)return [];if(!validCusumContext(context))throw RangeError('Invalid public CUSUM context');
 const scalar=value=>[{spelling:value.spelling},' ('+text('publicScalar',{representation:value.representation,radix:value.radix})+')'],values={method:text('publicMethod'),role:text('publicRole-'+context.role),count:String(context.count),target:scalar(context.target),allowance:scalar(context.allowance),threshold:scalar(context.threshold),conventions:text('publicConventions'),gaps:text('publicGaps-'+context.gaps),afterSignal:text('publicAfter-'+context.afterSignal),unit:measurementUnitContextParts(context.unitDefinition),execution:numericalExecutionPolicyContext(context.executionPolicy),interpretation:text('publicInterpretation')};
 return text('publicContext',Object.fromEntries(Object.keys(values).map(key=>[key,'{'+key+'}']))).split(/(\{\w+\})/).filter(Boolean).flatMap(part=>/^\{\w+\}$/.test(part)?values[part.slice(1,-1)]??part:part);
}
export function cusumContextText(context,{text=cusumText}={}){return cusumContextParts(context,{text}).map(part=>typeof part==='string'?part:typeof part.spelling==='string'?part.spelling:text('publicRetained')).join('');}
export function cusumRoleText(context,{text=cusumText}={}){if(!validCusumContext(context))throw RangeError('Invalid public CUSUM context');return text('role-'+context.role);}
