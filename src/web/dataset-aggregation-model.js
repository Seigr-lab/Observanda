import {validPolicyScalar} from './measurement-scalar-policy.js';
import {validDatasetResourcePolicy} from './dataset-resource-policy.js';
import {datasetColumnPosition} from './dataset-column-selection.js';
import {measurementRef} from './measurement-model.js';
import {KEY_SEMANTICS,numericalKey} from './measurement-keys.js';
import {validNumeralContext} from './numeral-context.js';
const keys=(v,names)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>names.includes(k));
const text=(v,n)=>typeof v==='string'&&v.length<=n&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(v);
export const AGGREGATION_OPERATIONS=['median','mean','sum','min','max','count','quantile','covariance','linear-fit'];
export const isPairStatisticMetric=value=>['covariance','linear-fit'].includes(value?.operation);
export function validPairStatisticMetric(value,count=Number.MAX_SAFE_INTEGER){
 const covariance=value?.operation==='covariance';
 return isPairStatisticMetric(value)&&keys(value,['column','pairedColumn','operation','name','output','method','pairing',covariance?'normalization':'coefficient'])&&
 ['column','pairedColumn'].every(key=>Number.isSafeInteger(value[key])&&value[key]>=0&&value[key]<count)&&value.pairing==='complete-rows-v1'&&
 (covariance?value.method==='centered-pairs-v1'&&['sample','population'].includes(value.normalization):value.method==='ordinary-least-squares-intercept-v1'&&['slope','intercept'].includes(value.coefficient))&&
 text(value.name,200)&&!!value.name.trim()&&(value.output===undefined||validNumeralContext(value.output));
}
function validMetric(value,version,policy,count){
 if(isPairStatisticMetric(value))return version===5&&validPairStatisticMetric(value,count);
 return keys(value,['column','operation','name','output','method','probability'])&&Number.isSafeInteger(value.column)&&value.column>=0&&value.column<count&&AGGREGATION_OPERATIONS.includes(value.operation)&&
 (value.operation==='quantile'?version>=4&&value.method==='linear-n-minus-one-v1'&&validPolicyScalar(value.probability,policy):value.method===undefined&&value.probability===undefined)&&
 text(value.name,200)&&value.name.trim()&&(value.output===undefined||validNumeralContext(value.output));
}
export function validPairStatisticReceipt(value,metric,count){
 if(!validPairStatisticMetric(metric)||!Number.isSafeInteger(count)||count<0||!keys(value,['version','method','pairing','status'])||Object.keys(value).length!==4||value.version!==1||value.method!==metric.method||value.pairing!==metric.pairing)return false;
 if(count===0)return value.status==='no-pairs';
 if(count===1&&(metric.operation==='linear-fit'||metric.normalization==='sample'))return value.status==='insufficient-pairs';
 return metric.operation==='covariance'?value.status==='ready':['ready','zero-x-spread'].includes(value.status);
}
export function validAggregation(v,count=Number.MAX_SAFE_INTEGER){
 return keys(v,['version','source','keys','keySemantics','values','missing','note','resourcePolicy'])&&[1,2,3,4,5].includes(v.version)&&(v.version>=3?validDatasetResourcePolicy(v.resourcePolicy):v.resourcePolicy===undefined)&&measurementRef(v.source)&&v.source.kind==='dataset'&&
 Array.isArray(v.keys)&&v.keys.length>0&&v.keys.length<=8&&new Set(v.keys).size===v.keys.length&&v.keys.every(i=>Number.isSafeInteger(i)&&i>=0&&i<count)&&
 (v.keySemantics===undefined||Array.isArray(v.keySemantics)&&v.keySemantics.length===v.keys.length&&v.keySemantics.every(s=>KEY_SEMANTICS.includes(s)||v.version>=2&&s==='domain'))&&
 Array.isArray(v.values)&&v.values.length>0&&v.values.length<=32&&v.values.every(s=>validMetric(s,v.version,v.resourcePolicy,count))&&
 ['skip','error'].includes(v.missing)&&text(v.note,10000);
}
export const aggregationPresence=(row,column,index)=>{const at=datasetColumnPosition(row,index);return ['absent','null'].includes(row.valueKinds?.[at])?row.valueKinds[at]:column.missing.some(m=>m.value===row.cells[at])?'missing':'value';};
export const aggregationKey=(row,columns,indices,semantics=[])=>JSON.stringify(indices.map((i,k)=>{
 const at=datasetColumnPosition(row,i),presence=aggregationPresence(row,columns[at],i);
 return presence==='value'&&semantics[k]==='numeric'?numericalKey(row.cells[at],columns[at]):[presence,row.cells[at]];
}));

export function validQuantileReceipt(value,policy,count,members){
 if(count===0)return value===null;
 const point=p=>keys(p,['rank','member'])&&Object.keys(p).length===2&&Number.isSafeInteger(p.rank)&&p.rank>=0&&p.rank<count&&Number.isSafeInteger(p.member)&&p.member>=0&&p.member<members;
 return !!value&&keys(value,['version','method','lower','upper','weight'])&&Object.keys(value).length===5&&value.version===1&&value.method==='linear-n-minus-one-v1'&&point(value.lower)&&point(value.upper)&&value.lower.rank<=value.upper.rank&&value.upper.rank-value.lower.rank<=1&&(value.lower.rank!==value.upper.rank||value.lower.member===value.upper.member)&&validPolicyScalar(value.weight,policy);
}
