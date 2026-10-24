import {t} from './i18n/index.js';
import {validSpectrumContext,directSpectrum,spectrumOutputCount} from './dataset-spectrum-model.js';
import {measurementUnitContextParts} from './measurement-unit-context.js';
import {numericalExecutionPolicyContext} from './numerical-execution-policy-ui.js';
export const spectrumText=(key,args)=>t('datasetSpectrum',key,args);
export function spectrumContextParts(context,{text=spectrumText}={}){
 if(!context)return [];if(!validSpectrumContext(context))throw RangeError('Invalid public spectrum context');
 const scalar=value=>[{spelling:value.spelling},' ('+text('publicScalar',{representation:value.representation,radix:value.radix})+')'];
 const direct=directSpectrum(context),policy=context.calculationPolicy,window=text('publicWindow-'+context.window),conventions=context.version===3?text(direct?'publicDirectConventions':'publicFftConventions',{window}):text('publicConventions'),values={method:text(direct?'publicDirectMethod':'publicMethod'),role:text(context.version===3&&context.role==='normalized-squared-magnitude'?'publicMagnitudeV3':direct&&context.role==='frequency'?'publicDirectRole-frequency':'publicRole-'+context.role),count:String(context.count),conventions,origin:scalar(context.sampling.origin),coordinate:text(direct?'publicDirectCoordinates':context.coordinateChecked?'publicChecked':'publicUnchecked'),unit:measurementUnitContextParts(context.sampling.unitDefinition),precision:text('publicPrecision',{working:policy.workingDigits,display:policy.displayDigits,rounding:t('calculator','rounding-'+policy.rounding),library:policy.library.name,version:policy.library.version})};
 if(direct)Object.assign(values,{outputCount:String(spectrumOutputCount(context)),frequencyStart:scalar(context.frequencyGrid.start),frequencyStep:scalar(context.frequencyGrid.step),frequencyUnit:measurementUnitContextParts(context.frequencyGrid.unitDefinition)});else values.step=scalar(context.sampling.step);
 const parts=text(direct?'publicDirectContext':'publicContext',Object.fromEntries(Object.keys(values).map(key=>[key,'{'+key+'}']))).split(/(\{\w+\})/).filter(Boolean).flatMap(part=>/^\{\w+\}$/.test(part)?values[part.slice(1,-1)]??part:part);
 if(context.version===3)parts.push(' ',text('publicContributionContext',{contributedCount:String(context.contributedCount),omittedMissing:String(context.omittedMissing),omittedExcluded:String(context.omittedExcluded),missingPolicy:text('pairPolicy-'+context.missing),excludedPolicy:text('pairPolicy-'+context.excluded)}));
 return context.version>=2?[...parts,' ',numericalExecutionPolicyContext(context.executionPolicy)]:parts;
}
export function spectrumContextText(context,{text=spectrumText}={}){return spectrumContextParts(context,{text}).map(part=>typeof part==='string'?part:typeof part.spelling==='string'?part.spelling:text('publicRetained')).join('');}

export function spectrumRoleText(context,{text=spectrumText}={}){if(!validSpectrumContext(context))throw RangeError('Invalid public spectrum context');return text('role-'+context.role);}
