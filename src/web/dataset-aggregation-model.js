import {measurementRef} from './measurement-model.js';
import {KEY_SEMANTICS,numericalKey} from './measurement-keys.js';
import {validNumeralContext} from './numeral-context.js';
const keys=(v,names)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>names.includes(k));
const text=(v,n)=>typeof v==='string'&&v.length<=n&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(v);
export const AGGREGATION_OPERATIONS=['median','mean','sum','min','max','count'];
export function validAggregation(v,count=256){
 return keys(v,['version','source','keys','keySemantics','values','missing','note'])&&v.version===1&&measurementRef(v.source)&&v.source.kind==='dataset'&&
 Array.isArray(v.keys)&&v.keys.length>0&&v.keys.length<=8&&new Set(v.keys).size===v.keys.length&&v.keys.every(i=>Number.isInteger(i)&&i>=0&&i<count)&&
 (v.keySemantics===undefined||Array.isArray(v.keySemantics)&&v.keySemantics.length===v.keys.length&&v.keySemantics.every(s=>KEY_SEMANTICS.includes(s)))&&
 Array.isArray(v.values)&&v.values.length>0&&v.values.length<=32&&v.values.every(s=>keys(s,['column','operation','name','output'])&&Number.isInteger(s.column)&&s.column>=0&&s.column<count&&AGGREGATION_OPERATIONS.includes(s.operation)&&text(s.name,200)&&s.name.trim()&&(s.output===undefined||validNumeralContext(s.output)))&&
 ['skip','error'].includes(v.missing)&&text(v.note,10000);
}
export const aggregationPresence=(row,column,index)=>['absent','null'].includes(row.valueKinds?.[index])?row.valueKinds[index]:column.missing.some(m=>m.value===row.cells[index])?'missing':'value';
export const aggregationKey=(row,columns,indices,semantics=[])=>JSON.stringify(indices.map((i,k)=>{
 const presence=aggregationPresence(row,columns[i],i);
 return presence==='value'&&semantics[k]==='numeric'?numericalKey(row.cells[i],columns[i]):[presence,row.cells[i]];
}));
