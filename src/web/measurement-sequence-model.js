import {validDatasetResourcePolicy} from './dataset-resource-policy.js';
import {validNumeralContext} from './numeral-context.js';
const exact=(value,keys)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
export class MeasurementSequenceError extends Error{constructor(code='MEASUREMENT_SEQUENCE_INVALID'){super(code);this.code=code;}}
export const SEQUENCE_CODEC='observanda.sequence';
export const SEQUENCE_OPERATIONS=Object.freeze(['length','index','slice','concatenate','reverse']);
export const sequenceCount=value=>Number.isSafeInteger(value)&&value>=0&&!Object.is(value,-0);
export function validSequenceElement(value){return exact(value,['kind'])&&value.kind==='symbol'||exact(value,['kind','representation','radix'])&&value.kind==='numeric'&&validNumeralContext({version:1,representation:value.representation,radix:value.radix});}
// Only declaration4 is admitted here. Older declarations bearing this codec
// name must remain opaque in the shared codec owner until explicit recoding.
export function validSequenceDefinition(value){return !!(exact(value,['version','codec','codecVersion','namespace','element','resourcePolicy'])&&value.version===4&&value.codec===SEQUENCE_CODEC&&value.codecVersion===1&&typeof value.namespace==='string'&&value.namespace.trim().length>0&&value.namespace.length<=200&&!/[\u0000-\u001f]/u.test(value.namespace)&&validSequenceElement(value.element)&&validDatasetResourcePolicy(value.resourcePolicy));}
export function sameSequenceSpace(left,right){return validSequenceDefinition(left)&&validSequenceDefinition(right)&&left.namespace===right.namespace&&left.element.kind===right.element.kind&&(left.element.kind==='symbol'||left.element.representation===right.element.representation&&left.element.radix===right.element.radix);}
export function validSequenceOperation(value){
 if(!value||!SEQUENCE_OPERATIONS.includes(value.kind))return false;
 if(value.kind==='index')return exact(value,['kind','index'])&&sequenceCount(value.index);
 if(value.kind==='slice')return exact(value,['kind','start','count'])&&sequenceCount(value.start)&&sequenceCount(value.count)&&Number.isSafeInteger(value.start+value.count);
 return exact(value,['kind']);
}
export function sequenceOperationShape(operation,counts){
 if(!validSequenceOperation(operation)||!Array.isArray(counts)||counts.length!==(operation.kind==='concatenate'?2:1)||!Array.from(counts).every(sequenceCount))throw new MeasurementSequenceError();
 if(operation.kind==='index'){if(operation.index>=counts[0])throw new MeasurementSequenceError('MEASUREMENT_SEQUENCE_INDEX');return {kind:'element',count:1};}
 if(operation.kind==='length')return {kind:'length',count:1};
 if(operation.kind==='slice'){if(operation.start>counts[0]||operation.start+operation.count>counts[0])throw new MeasurementSequenceError('MEASUREMENT_SEQUENCE_INDEX');return {kind:'sequence',count:operation.count};}
 const count=operation.kind==='concatenate'?counts[0]+counts[1]:counts[0];if(!Number.isSafeInteger(count))throw new MeasurementSequenceError('MEASUREMENT_SEQUENCE_INDEX');return {kind:'sequence',count};
}
// Envelope5 is dispatched by measurement-domain-storage: original text,
// domain-components, identity, complete and count. count must equal components.count;
// the empty sequence has count0, complete:true, and an empty components descriptor with root:null.
