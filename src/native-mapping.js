import {AppError} from './errors.js';
import {measurementRef,validLocator} from './web/measurement-model.js';
const fail=()=>{throw new AppError('MEASUREMENT_INVALID');};
export function validNativeMapping(m){
 return m&&Object.keys(m).every(k=>['artifact','offsetColumn','lengthColumn','pointerColumn','idColumn'].includes(k))&&measurementRef(m.artifact)&&m.artifact.kind==='artifact'&&['offsetColumn','lengthColumn','pointerColumn','idColumn'].every(k=>m[k]===null||Number.isSafeInteger(m[k])&&m[k]>=0)&&
 (m.offsetColumn!==null&&m.lengthColumn!==null&&m.pointerColumn===null||m.offsetColumn===null&&m.lengthColumn===null&&(m.pointerColumn!==null||m.idColumn!==null));
}
export function nativeRowLocator(mapping,row,size){
 if(!validNativeMapping(mapping))fail();
 const value=k=>{const absolute=mapping[k];if(absolute===null)return null;const i=row.columnIndices?row.columnIndices.indexOf(absolute):absolute;if(i<0||i>=row.cells.length||typeof row.cells[i]!=='string'||['absent','null'].includes(row.valueKinds?.[i]))fail();return row.cells[i];};
 const integer=k=>{const v=value(k);if(!/^\d+$/.test(v)||!Number.isSafeInteger(Number(v)))fail();return Number(v);};
 const selector=mapping.offsetColumn!==null?{kind:'bytes',offset:integer('offsetColumn'),length:integer('lengthColumn'),...(mapping.idColumn!==null?{nativeId:value('idColumn')}:{})}:mapping.pointerColumn!==null?{kind:'json-pointer',pointer:value('pointerColumn')}:{kind:'native-record',nativeId:value('idColumn')};
 const source={ref:mapping.artifact,selector};if(!validLocator(source)||selector.kind==='bytes'&&selector.offset+selector.length>size)fail();return source;
}
