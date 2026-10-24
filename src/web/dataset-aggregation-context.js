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
