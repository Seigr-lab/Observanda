// Windows use immutable retained row positions, never inferred clock ordering.
import {isScalarRepresentation} from './measurement-model.js';
import {defaultColumn} from './dataset-schema.js';
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
export const WINDOW_OPERATIONS=['lag','lead','sum','mean','min','max','count'];
export const windowError=()=>Object.assign(new Error('DATASET_WINDOW_INVALID'),{code:'DATASET_WINDOW_INVALID'});
export const defaultWindow=()=>({version:1,order:'retained',start:-1,end:0,boundary:'absent',missing:'propagate',excluded:'propagate'});
export function validWindow(value,operation){return exact(value,['version','order','start','end','boundary','missing','excluded'])&&value.version===1&&value.order==='retained'&&Number.isSafeInteger(value.start)&&Number.isSafeInteger(value.end)&&value.start<=value.end&&Number.isSafeInteger(value.end-value.start+1)&&['absent','partial','error'].includes(value.boundary)&&['propagate','skip','error'].includes(value.missing)&&['propagate','skip','include'].includes(value.excluded)&&WINDOW_OPERATIONS.includes(operation)&&(!['lag','lead'].includes(operation)||value.start===value.end&&(operation==='lag'?value.start<=0:value.start>=0));}
export function windowColumn(node,column){
 if(!validWindow(node.window,node.operation))throw windowError();
 if(['lag','lead','min','max'].includes(node.operation)){if(['min','max'].includes(node.operation)&&!isScalarRepresentation(column))throw windowError();return {...column};}
 if(node.operation==='count')return {...defaultColumn({label:'Window count'}),representation:'integer',missing:[]};
 if(!isScalarRepresentation(column)||column.quantity?.unitDefinition&&column.quantity.unitDefinition.kind!=='difference')throw windowError();
 const {uncertainty,...quantity}=column.quantity??{conversion:null,calibration:null};
 return {...defaultColumn({label:'Window '+node.operation}),representation:'rational',unit:column.unit,missing:[],quantity:{...quantity,origin:'derived'}};
}
export function windowDisposition(cell,column,window){
 const presence=cell.boundary?'boundary':['null','absent'].includes(cell.kind)?cell.kind:column.missing.some(m=>m.value===cell.value)?'missing':'value';
 if(presence==='boundary')return {presence,reason:'boundary',used:false,policy:window.boundary==='partial'?'skip':window.boundary==='error'?'error':'propagate'};
 if(cell.excluded&&window.excluded!=='include')return {presence,reason:'excluded',used:false,policy:window.excluded};
 if(presence!=='value')return {presence,reason:presence,used:false,policy:window.missing};
 return {presence,reason:cell.excluded?'included-excluded':'value',used:true,policy:'include'};
}
