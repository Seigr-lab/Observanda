// An authored pairing of immutable clock observations. Calendar meaning, counter
// unwrapping and clock reset segmentation are never inferred here.
import {measurementRef,validLocator,isScalarRepresentation,validQuantity,validTime,blankClock,blankQuantity} from './measurement-model.js';
import {validDatasetResourcePolicy} from './dataset-resource-policy.js';
import {validPolicyScalar,validatePolicyScalar,withScalarPolicy} from './measurement-scalar-policy.js';
import {validComputation,derivedComputation} from './measurement-computation.js';
import {materialReferenceKey,materialReference} from './material-reference.js';
import {defaultColumn} from './dataset-schema.js';
import {defaultDomain} from './measurement-domain-model.js';
export const CLOCK_SYNCHRONIZATION_TOOL='Observanda clock synchronization';
export const CLOCK_SYNCHRONIZATION_STATUS_NAMESPACE='observanda.clock-synchronization-status.v1';
export const CLOCK_SYNCHRONIZATION_STATUSES=Object.freeze(['ready','missing-input','excluded-input','outside-validity']);
const keys=(value,required,optional=[])=>!!value&&typeof value==='object'&&!Array.isArray(value)&&required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>required.includes(key)||optional.includes(key));
const text=(value,max)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);
const index=value=>Number.isSafeInteger(value)&&value>=0;
const invalid=(code='MEASUREMENT_CLOCK_SYNCHRONIZATION')=>Object.assign(new Error(code),{code});
const datasetRef=value=>measurementRef(value)&&value.kind==='dataset';
const sameRef=(a,b)=>materialReferenceKey(a)===materialReferenceKey(b);
const cell=value=>validLocator(value)&&value.ref.kind==='dataset'&&value.selector.kind==='cell';
const distinct=(a,b)=>a.selector.page!==b.selector.page||a.selector.row!==b.selector.row;
export function validSynchronizationTime(value){return validTime(value)&&['elapsed','inferred-elapsed','external'].includes(value.kind)&&(!value.clock||value.clock.wrap==='none'&&value.clock.reset==='none');}
export function assertSynchronizationColumn(column){
 if(!column||!isScalarRepresentation(column)||!text(column.unit,100)||!validSynchronizationTime(column.time)||column.quantity!==undefined&&!validQuantity(column.quantity,column.unit))throw invalid();
 return column;
}
export function validClockSynchronization(value){
 if(!keys(value,['version','method','source','anchors','validity','target','rationale','resourcePolicy'],['tool','computation','inputs'])||value.version!==1||value.method!=='two-anchor-affine'||value.tool!==undefined&&value.tool!==CLOCK_SYNCHRONIZATION_TOOL||!validDatasetResourcePolicy(value.resourcePolicy)||value.computation!==undefined&&(!validComputation(value.computation)||value.computation.kind!=='approximate-inputs'))return false;
 if(value.inputs!==undefined&&(!Array.isArray(value.inputs)||!value.inputs.every(measurementRef)))return false;
 if(!keys(value.source,['ref','column'])||!datasetRef(value.source.ref)||!index(value.source.column)||!Array.isArray(value.anchors)||value.anchors.length!==2||!value.anchors.every(pair=>keys(pair,['source','reference'])&&cell(pair.source)&&cell(pair.reference)))return false;
 const [a,b]=value.anchors;if(!value.anchors.every(pair=>sameRef(pair.source.ref,value.source.ref)&&pair.source.selector.column===value.source.column)||!sameRef(a.reference.ref,b.reference.ref)||a.reference.selector.column!==b.reference.selector.column||!distinct(a.source,b.source)||!distinct(a.reference,b.reference))return false;
 const target=value.target;
 return keys(value.validity,['lower','upper'])&&['lower','upper'].every(key=>validPolicyScalar(value.validity[key],value.resourcePolicy))&&keys(target,['unit','time'],['quantity'])&&text(target.unit,100)&&(target.quantity===undefined||validQuantity(target.quantity,target.unit))&&validSynchronizationTime(target.time)&&text(value.rationale,10000)&&!!value.rationale.trim();
}
export function validClockSynchronizationDescriptor(value){
 return keys(value,['version','method','validity','epoch','sourceUnit','sourceReference','resourcePolicy'])&&value.version===1&&value.method==='two-anchor-affine'&&validDatasetResourcePolicy(value.resourcePolicy)&&keys(value.validity,['lower','upper'])&&['lower','upper'].every(key=>validPolicyScalar(value.validity[key],value.resourcePolicy))&&text(value.epoch,500)&&text(value.sourceUnit,100)&&text(value.sourceReference,500);
}
export function validateClockSynchronizationDescriptor(value,{budget}={}){
 if(!validClockSynchronizationDescriptor(value))throw invalid();return withScalarPolicy(value.resourcePolicy,budget,b=>{const lower=validatePolicyScalar(value.validity.lower,value.resourcePolicy,{budget:b}),upper=validatePolicyScalar(value.validity.upper,value.resourcePolicy,{budget:b});if(b.product(lower.numerator,upper.denominator)>b.product(upper.numerator,lower.denominator))throw invalid('MEASUREMENT_CLOCK_SYNCHRONIZATION_RANGE');return value;});
}
export function clockSynchronizationColumn(node,column,content,{policy}={}){
 assertSynchronizationColumn(column);
 if(!validClockSynchronization(content)||!measurementRef(node.model)||node.model.kind!=='analysis'||!['value','status'].includes(node.operation)||!['absent','error'].includes(node.outside)||policy!==undefined&&!validDatasetResourcePolicy(policy))throw invalid();
 const synchronization={version:1,method:'two-anchor-affine',validity:structuredClone(content.validity),epoch:content.target.time.clock?.epoch??'',sourceUnit:column.unit,sourceReference:column.time.reference,resourcePolicy:structuredClone(content.resourcePolicy)};
 const output={...defaultColumn({label:column.name||'Clock synchronization'}),missing:[],synchronization,...derivedComputation(column,content)};
 if(node.operation==='status')return {...output,representation:'domain',domain:{...defaultDomain('symbol'),namespace:CLOCK_SYNCHRONIZATION_STATUS_NAMESPACE}};
 const time=structuredClone(content.target.time),clock=time.clock??{...blankClock(),wrap:'none',reset:'none'};
 time.clock={...clock,model:materialReference(node.model),referenceData:materialReference(content.anchors[0].reference.ref)};
 return {...output,representation:'rational',radix:10,unit:content.target.unit,quantity:{...structuredClone(content.target.quantity??blankQuantity()),origin:'derived'},time,resourcePolicy:structuredClone(policy??content.resourcePolicy)};
}
