import {validPolicyScalar} from './measurement-scalar-policy.js';
import {validDatasetResourcePolicy} from './dataset-resource-policy.js';
import {datasetColumnPosition} from './dataset-column-selection.js';
import {measurementRef} from './measurement-model.js';
import {KEY_SEMANTICS,numericalKey} from './measurement-keys.js';
import {validNumeralContext} from './numeral-context.js';
const keys=(v,names)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>names.includes(k));
const text=(v,n)=>typeof v==='string'&&v.length<=n&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(v);
export const AGGREGATION_OPERATIONS=['median','mean','sum','min','max','count','quantile'];
export function validAggregation(v,count=Number.MAX_SAFE_INTEGER){
 return keys(v,['version','source','keys','keySemantics','values','missing','note','resourcePolicy'])&&[1,2,3,4].includes(v.version)&&(v.version>=3?validDatasetResourcePolicy(v.resourcePolicy):v.resourcePolicy===undefined)&&measurementRef(v.source)&&v.source.kind==='dataset'&&
 Array.isArray(v.keys)&&v.keys.length>0&&v.keys.length<=8&&new Set(v.keys).size===v.keys.length&&v.keys.every(i=>Number.isSafeInteger(i)&&i>=0&&i<count)&&
 (v.keySemantics===undefined||Array.isArray(v.keySemantics)&&v.keySemantics.length===v.keys.length&&v.keySemantics.every(s=>KEY_SEMANTICS.includes(s)||v.version>=2&&s==='domain'))&&
 Array.isArray(v.values)&&v.values.length>0&&v.values.length<=32&&v.values.every(s=>keys(s,['column','operation','name','output','method','probability'])&&Number.isSafeInteger(s.column)&&s.column>=0&&s.column<count&&AGGREGATION_OPERATIONS.includes(s.operation)&&(s.operation==='quantile'?v.version===4&&s.method==='linear-n-minus-one-v1'&&validPolicyScalar(s.probability,v.resourcePolicy):s.method===undefined&&s.probability===undefined)&&text(s.name,200)&&s.name.trim()&&(s.output===undefined||validNumeralContext(s.output)))&&
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
