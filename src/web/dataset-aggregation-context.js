import {validWeightedFitContext} from './dataset-weighted-fit-model.js';
import {measurementUnitContextParts} from './measurement-unit-context.js';
import {validCalculationPolicy} from './tools/calculation-policy.js';
import {t} from './i18n/index.js';
const message=(key,args)=>t('datasetAggregation',key,args);
export function aggregationQuantileContextParts(quantile,{text=message}={}){
 if(!quantile)return [];
 if(quantile.method!=='linear-n-minus-one-v1'||!quantile.probability)throw RangeError('Unsupported quantile context');
 const probability=quantile.probability,values={spelling:{spelling:probability.spelling},representation:probability.representation,radix:String(probability.radix),method:text('quantilePublicMethod')};
 return text('quantilePublicContext',{spelling:'{spelling}',representation:'{representation}',radix:'{radix}',method:'{method}'}).split(/(\{\w+\})/).filter(Boolean).map(part=>/^\{\w+\}$/.test(part)?values[part.slice(1,-1)]??part:part);
}
export function aggregationQuantileContextText(quantile,{text=message}={}){
 return aggregationQuantileContextParts(quantile,{text}).map(part=>typeof part==='string'?part:typeof part.spelling==='string'?part.spelling:text('quantilePublicRetained')).join('');
}

export function aggregationPairContextText(descriptor,{text=message}={}){
 if(!descriptor)return '';
 const {operation,method,pairing,normalization,coefficient}=descriptor;
 if(pairing!=='complete-rows-v1')throw RangeError('Unsupported paired statistic context');
 if(operation==='correlation'&&method==='pearson-centered-pairs-v1'&&normalization===undefined&&coefficient===undefined&&descriptor.calculationPolicy?.version===2&&validCalculationPolicy(descriptor.calculationPolicy)){const policy=descriptor.calculationPolicy;return text('correlationPublicContext')+'; '+text('correlationPrecision',{digits:policy.workingDigits,display:policy.displayDigits,rounding:t('calculator','rounding-'+policy.rounding),library:policy.library.name,version:policy.library.version});}
 if(operation==='covariance'&&method==='centered-pairs-v1'&&['sample','population'].includes(normalization)&&coefficient===undefined)return text('pairPublicCovariance',{denominator:normalization==='sample'?'n - 1':'n',normalization:text('pairPublic-'+normalization)});
 if(operation==='linear-fit'&&method==='ordinary-least-squares-intercept-v1'&&['slope','intercept'].includes(coefficient)&&normalization===undefined)return text('pairPublic-'+coefficient);
 throw RangeError('Unsupported paired statistic context');
}

// Only declared scientific context is rendered; source and material identifiers
// never become public text. Scalar fragments retain their authenticated stream.
export function aggregationWeightedFitContextParts(context,{text=message}={}){
 if(!validWeightedFitContext(context))throw RangeError('Unsupported weighted affine fit context');
 const scalar=value=>[{spelling:value.spelling},' '+text('scalarContext',{representation:value.representation,radix:value.radix})];
 return [text('weightedPublicMethod')+'; '+text('complete-triples-v1')+'; '+text('weightedResult-'+context.result)+'; '+text('referenceX')+': ',...scalar(context.referenceX),...(context.evaluationX?['; '+text('evaluationX')+': ',...scalar(context.evaluationX)]:[]),'; '+text('weightedPublicCoordinates')+': '+(context.coordinateUnit.unit||(!context.coordinateUnit.definition?text('weightedPublicUnitless'):'')),...(context.coordinateUnit.definition?['; ',...measurementUnitContextParts(context.coordinateUnit.definition)]:[]),'; '+text('weightedAssumptions')+' '+text('weightedNoInference')];
}
export function aggregationWeightedFitContextText(context,{text=message}={}){
 return aggregationWeightedFitContextParts(context,{text}).map(part=>typeof part==='string'?part:typeof part.spelling==='string'?part.spelling:text('weightedPublicRetained')).join('');
}
