import {t} from './i18n/index.js';
import {computationLabel,perCellComputation,resolveCellComputation,hasApproximateComputation} from './measurement-computation.js';
import {correlationPolicyDescription} from './dataset-correlation-ui.js';
const text=(key,args)=>t('measurements',key,args);
// A column capability never labels a value approximate. Only the aligned,
// selected cell descriptor is used; unavailable values have no precision claim.
export function cellComputationView(column,row,index,{esc}){
 if(['absent','null','missing','unknown'].includes(row.valueKinds?.[index]))return '';
 const entry=row.cellComputations?.[index],actual=resolveCellComputation(column,entry===undefined?{}:{computation:entry});
 if(actual===null)return perCellComputation(column)?'<small data-cell-computation="exact">'+esc(text('computationExact'))+'</small>':'';
 return '<small data-cell-computation="approximate">'+esc(computationLabel(actual))+'</small>';
}
export function computationPolicyView(value,{esc}){
 const computation=value?.computation??value;if(!hasApproximateComputation(computation)||computation.version!==2)return '';
 return '<p data-cell-computation-policy>'+esc(correlationPolicyDescription(computation.policy))+'</p>';
}
export function scalarFormatView(format,{esc}){
 if(!format?.representation||format.representation==='domain')return '';
 const representation=t('measurements',format.representation==='radix'?'radixLabel':format.representation),context=Number.isSafeInteger(format.radix)?text('computationScalarContext',{representation,radix:format.radix,unit:format.unit??''}):representation;
 return '<small data-cell-format>'+esc(context)+'</small>';
}
