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
 if(operation==='covariance'&&method==='centered-pairs-v1'&&['sample','population'].includes(normalization)&&coefficient===undefined)return text('pairPublicCovariance',{denominator:normalization==='sample'?'n - 1':'n',normalization:text('pairPublic-'+normalization)});
 if(operation==='linear-fit'&&method==='ordinary-least-squares-intercept-v1'&&['slope','intercept'].includes(coefficient)&&normalization===undefined)return text('pairPublic-'+coefficient);
 throw RangeError('Unsupported paired statistic context');
}
