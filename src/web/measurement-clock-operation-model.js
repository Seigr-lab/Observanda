import {validClockDefinition} from './measurement-clock-model.js';
import {isScalarRepresentation,validTime,validQuantity} from './measurement-model.js';
import {unitScalar} from './measurement-unit-model.js';
import {defaultColumn} from './dataset-schema.js';
import {defaultDomain} from './measurement-domain-model.js';
const keys=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===names.length&&names.every(key=>Object.hasOwn(value,key));
const invalid=()=>Object.assign(new Error('MEASUREMENT_CLOCK_TRANSITION'),{code:'MEASUREMENT_CLOCK_TRANSITION'});
const index=value=>Number.isSafeInteger(value)&&value>=0;
export const CLOCK_OPERATIONS=['ticks','interval','status'];
export const CLOCK_STATUS_NAMESPACE='observanda.clock-transition-status.v1';
export const CLOCK_STATUSES=['ready','no-predecessor','unmatched-row','excluded-current','excluded-previous','missing-counter','invalid-counter','missing-control','invalid-control','reset','ambiguous-decrease'];
export const validClockControl=value=>keys(value,['kind'])&&value.kind==='none'||keys(value,['kind','column'])&&value.kind==='column'&&index(value.column);
export const validClockTransition=value=>keys(value,['version','wraps','resets','ambiguity'])&&value.version===1&&validClockControl(value.wraps)&&validClockControl(value.resets)&&['absent','error'].includes(value.ambiguity);
export const defaultClockTransition=()=>({version:1,wraps:{kind:'none'},resets:{kind:'none'},ambiguity:'absent'});
export function assertCounterColumn(column){
 if(!column||!isScalarRepresentation(column)||!validTime(column.time)||column.time.kind!=='counter'||!validClockDefinition(column.time.clock?.definition)||column.quantity&&!validQuantity(column.quantity,column.unit))throw invalid();
 const unit=column.quantity?.unitDefinition;if(unit){const scale=unitScalar(unit.scale),offset=unitScalar(unit.offset);if(unit.kind!=='difference'||unit.dimensions.length||scale.numerator!==scale.denominator||offset.numerator!==0n)throw invalid();}
 if(column.quantity?.origin==='requested')throw invalid();return column;
}
export function clockOperationColumn(node,column,controls=[]){
 assertCounterColumn(column);if(!CLOCK_OPERATIONS.includes(node.operation)||!validClockTransition(node.transition))throw invalid();const definition=column.time.clock.definition;
 if(node.transition.wraps.kind==='column'&&!definition.modulus)throw invalid();for(const control of controls){if(!isScalarRepresentation(control)||control.unit||control.quantity?.unitDefinition||!['none','unknown','acquisition-order'].includes(control.time.kind))throw invalid();}
 const output=defaultColumn({label:'Clock '+node.operation});output.missing=[];
 if(node.operation==='status')return {...output,representation:'domain',domain:{...defaultDomain('symbol'),namespace:CLOCK_STATUS_NAMESPACE}};
 if(node.operation==='ticks')return {...output,representation:'integer',unit:column.unit,quantity:{origin:'derived',conversion:null,calibration:column.quantity?.calibration??null}};
 if(!definition.rate)throw invalid();const rate=definition.rate;
 return {...output,representation:'rational',unit:rate.unit,quantity:{origin:'derived',conversion:column.time.clock.model??column.quantity?.conversion??null,calibration:column.quantity?.calibration??null,...(rate.unitDefinition?{unitDefinition:structuredClone(rate.unitDefinition)}:{})},time:{kind:'inferred-elapsed',reference:'Derived interval using the declared counter model',resolution:'',uncertainty:''}};
}
