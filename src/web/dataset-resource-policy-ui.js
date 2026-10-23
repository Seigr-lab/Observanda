import {t} from './i18n/index.js';
const text=(key,values)=>t('datasetResources',key,values);
import {defaultDatasetResourcePolicy,datasetResourceLimits,validDatasetResourcePolicy} from './dataset-resource-policy.js';
export function datasetResourcePolicyControls(policy,{esc,field}){
 const value=policy??defaultDatasetResourcePolicy();return '<div data-dataset-resource-policy><p>'+esc(text('help'))+'</p>'+(!policy?'<p>'+esc(text('legacy'))+'</p>':'')+Object.entries(datasetResourceLimits).map(([key,[min,max]])=>field(esc(text(key)),'<input type="number" required step="1" min="'+min+'" max="'+max+'" data-dataset-resource="'+key+'" value="'+value.resources[key]+'"><small>'+esc(text('bounds',{min,max}))+'</small>')).join('')+'<p>'+esc(text('codec'))+'</p></div>';
}
export function readDatasetResourcePolicy(root){const result=defaultDatasetResourcePolicy();for(const key of Object.keys(datasetResourceLimits)){const input=root.querySelector('[data-dataset-resource="'+key+'"]');result.resources[key]=input?.value?.trim()?Number(input.value):NaN;}if(!validDatasetResourcePolicy(result))throw Error(text('invalid'));return result;}
