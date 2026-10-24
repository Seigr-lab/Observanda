import {t} from './i18n/index.js';
import {validSpectrumContext} from './dataset-spectrum-model.js';
import {measurementUnitContextParts} from './measurement-unit-context.js';
import {numericalExecutionPolicyContext} from './numerical-execution-policy-ui.js';
export const spectrumText=(key,args)=>t('datasetSpectrum',key,args);
export function spectrumContextParts(context,{text=spectrumText}={}){
 if(!context)return [];if(!validSpectrumContext(context))throw RangeError('Invalid public spectrum context');
 const scalar=value=>[{spelling:value.spelling},' ('+text('publicScalar',{representation:value.representation,radix:value.radix})+')'];
 const policy=context.calculationPolicy,values={method:text('publicMethod'),role:text('publicRole-'+context.role),count:String(context.count),conventions:text('publicConventions'),step:scalar(context.sampling.step),origin:scalar(context.sampling.origin),coordinate:text(context.coordinateChecked?'publicChecked':'publicUnchecked'),unit:measurementUnitContextParts(context.sampling.unitDefinition),precision:text('publicPrecision',{working:policy.workingDigits,display:policy.displayDigits,rounding:t('calculator','rounding-'+policy.rounding),library:policy.library.name,version:policy.library.version})};
 const parts=text('publicContext',Object.fromEntries(Object.keys(values).map(key=>[key,'{'+key+'}']))).split(/(\{\w+\})/).filter(Boolean).flatMap(part=>/^\{\w+\}$/.test(part)?values[part.slice(1,-1)]??part:part);
 return context.version===2?[...parts,' ',numericalExecutionPolicyContext(context.executionPolicy)]:parts;
}
export function spectrumContextText(context,{text=spectrumText}={}){return spectrumContextParts(context,{text}).map(part=>typeof part==='string'?part:typeof part.spelling==='string'?part.spelling:text('publicRetained')).join('');}

export function spectrumRoleText(context,{text=spectrumText}={}){if(!validSpectrumContext(context))throw RangeError('Invalid public spectrum context');return text('role-'+context.role);}
