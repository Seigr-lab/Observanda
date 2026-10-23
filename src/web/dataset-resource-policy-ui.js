import {t} from './i18n/index.js';
const text=(key,values)=>t('datasetResources',key,values);
import {defaultDatasetResourcePolicy,datasetResourceLimits,validDatasetResourcePolicy} from './dataset-resource-policy.js';
export function datasetResourcePolicyControls(policy,{esc,field,help=text('help'),legacy=text('legacy'),footer=text('codec')}){
 const value=policy??defaultDatasetResourcePolicy();return '<div data-dataset-resource-policy><p>'+esc(help)+'</p>'+(!policy&&legacy?'<p>'+esc(legacy)+'</p>':'')+Object.entries(datasetResourceLimits).map(([key,[min,max]])=>field(esc(text(key)),'<input type="number" required step="1" min="'+min+'" max="'+max+'" data-dataset-resource="'+key+'" value="'+esc(value.resources[key])+'"><small>'+esc(text('bounds',{min,max}))+'</small>')).join('')+(footer?'<p>'+esc(footer)+'</p>':'')+'</div>';
}
export function readDatasetResourcePolicy(root,{validate=true}={}){const result=defaultDatasetResourcePolicy();for(const key of Object.keys(datasetResourceLimits)){const input=root.querySelector('[data-dataset-resource="'+key+'"]');result.resources[key]=input?.value?.trim()?Number(input.value):'';}if(validate&&!validDatasetResourcePolicy(result))throw Error(text('invalid'));return result;}

export function datasetResourcePolicyDescription(policy,{esc,title=text('title')}={}){
 if(!validDatasetResourcePolicy(policy))return '';
 return '<details data-saved-resource-policy><summary>'+esc(title)+'</summary><dl>'+Object.keys(datasetResourceLimits).map(key=>'<dt>'+esc(text(key))+'</dt><dd>'+esc(policy.resources[key])+'</dd>').join('')+'</dl></details>';
}
